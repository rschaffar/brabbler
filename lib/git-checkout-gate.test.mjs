import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { createJiti } = await import("jiti");
const { acquireGitCheckoutGate, isGitCheckoutGated } = await createJiti(import.meta.url).import("./git-checkout-gate.ts");

test("checkout gates reserve both roots and release exactly once", () => {
  const source = "/tmp/pi-web-gate-source";
  const target = "/tmp/pi-web-gate-target";
  const release = acquireGitCheckoutGate([source, target]);
  try {
    assert.equal(isGitCheckoutGated(source), true);
    assert.equal(isGitCheckoutGated(target), true);
    assert.equal(isGitCheckoutGated("/tmp/pi-web-gate-unrelated"), false);
    assert.throws(() => acquireGitCheckoutGate(["/tmp/pi-web-gate-unrelated", target]), /busy/);
    assert.equal(isGitCheckoutGated("/tmp/pi-web-gate-unrelated"), false);
  } finally { release(); release(); }
  assert.equal(isGitCheckoutGated(source), false);
  assert.equal(isGitCheckoutGated(target), false);
});

test("checkout gate also blocks a session cwd referring to the same physical path by symlink", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-web-gate-alias-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const link = join(base, "alias");
  await symlink(base, link, "dir");
  const release = acquireGitCheckoutGate([base]);
  try {
    assert.equal(isGitCheckoutGated(link), true);
    assert.throws(() => acquireGitCheckoutGate([link]), /busy/);
  } finally { release(); }
  assert.equal(isGitCheckoutGated(link), false);
});
