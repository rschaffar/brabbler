import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { acquireDirectoryReservation, assertDirectoryAdmissionAllowed } = await jiti.import("./directory-reservations.ts");
const { physicalDirectoryPath } = await jiti.import("./path-security.ts");
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-directory-reservation-"));
  const directory = join(root, "target");
  const descendant = join(directory, "child");
  const sibling = join(root, "target-sibling");
  const alias = join(root, "alias");
  mkdirSync(descendant, { recursive: true });
  mkdirSync(sibling);
  symlinkSync(directory, alias, "dir");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, directory, descendant, sibling, alias };
}

test("physical directory leases block same/descendant admission and overlapping leases, not siblings or ancestor cwd", (t) => {
  const { root, directory, descendant, sibling, alias } = fixture(t);
  const observations = [];
  const release = acquireDirectoryReservation(alias, (physical) => { observations.push(physical); return false; });
  t.after(release);
  assert.deepEqual(observations, [physicalDirectoryPath(directory)]);
  for (const path of [directory, alias, descendant, join(alias, "child", "not-created")]) {
    assert.throws(() => assertDirectoryAdmissionAllowed(path), /reserved/);
    assert.throws(() => acquireDirectoryReservation(path, () => false), /overlaps/);
  }
  assert.throws(() => acquireDirectoryReservation(root, () => false), /overlaps/);
  assert.doesNotThrow(() => assertDirectoryAdmissionAllowed(root));
  assert.doesNotThrow(() => assertDirectoryAdmissionAllowed(sibling));
  const releaseSibling = acquireDirectoryReservation(sibling, () => false);
  releaseSibling();
  release(); release();
  assert.doesNotThrow(() => assertDirectoryAdmissionAllowed(descendant));
  const next = acquireDirectoryReservation(directory, () => false);
  t.after(next);
  release();
  assert.throws(() => assertDirectoryAdmissionAllowed(directory), /reserved/, "old release cannot remove a newer lease");
});

test("busy or failed observations do not acquire a lease", (t) => {
  const { directory } = fixture(t);
  assert.throws(() => acquireDirectoryReservation(directory, () => true), /in use/);
  assert.throws(() => acquireDirectoryReservation(directory, () => { throw new Error("observation failed"); }), /observation failed/);
  assert.doesNotThrow(() => assertDirectoryAdmissionAllowed(directory));
  const release = acquireDirectoryReservation(directory, () => false);
  release();
});

test("reservations survive async native settlement and module reloads until explicit release", async (t) => {
  const { directory } = fixture(t);
  const release = acquireDirectoryReservation(directory, () => false);
  t.after(release);
  await new Promise((resolve) => setImmediate(resolve));
  const freshJiti = createJiti(import.meta.url, { moduleCache: false });
  const fresh = await freshJiti.import("./directory-reservations.ts");
  assert.throws(() => fresh.assertDirectoryAdmissionAllowed(directory), /reserved/);
  assert.throws(() => fresh.acquireDirectoryReservation(directory, () => false), /overlaps/);
  release();
  assert.doesNotThrow(() => fresh.assertDirectoryAdmissionAllowed(directory));
});
