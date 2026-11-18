import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isImmutableNixStorePath } = await jiti.import("./path-security.ts");

// A real store object, not owned by the test user, exists for the Node runtime in Nix sandboxes.
const runtime = realpathSync(process.execPath);
const object = /^\/nix\/store\/[0-9a-df-np-sv-z]{32}-[^/]+/.exec(runtime)?.[0];

test("immutable Nix store predicate accepts physical paths inside a store object the server cannot modify", { skip: object ? false : "requires a Nix store Node runtime" }, () => {
  assert.equal(isImmutableNixStorePath(object), true);
  assert.equal(isImmutableNixStorePath(runtime), true);
  assert.equal(isImmutableNixStorePath(join(object, "absent-child")), true, "absence inside an immutable object stays absent");
});

test("immutable Nix store predicate refuses the store root, non-canonical, malformed and ordinary paths", t => {
  const base = mkdtempSync(join(tmpdir(), "nix-store-predicate-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const hash = "0".repeat(32);
  for (const candidate of ["/nix/store", "/nix/store/", `/nix/store/${"e".repeat(32)}-bad-alphabet`, `/nix/store/${hash}`,
    `/nix/store/${hash}-name/../escape`, `/nix//store/${hash}-name`, `nix/store/${hash}-name`, base, join(base, `nix/store/${hash}-name`)]) {
    assert.equal(isImmutableNixStorePath(candidate), false, candidate);
  }
  if (object) {
    assert.equal(isImmutableNixStorePath(`${object}/../${object.slice("/nix/store/".length)}`), false, "non-normalized spelling");
    assert.equal(isImmutableNixStorePath(`/nix/store/${hash}-missing-object`), false, "missing objects are not admitted");
  }
});
