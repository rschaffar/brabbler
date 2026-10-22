import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createJiti } from "jiti";
const { scratchpadPath, readScratchpad, saveScratchpad, ScratchpadConflict } = await createJiti(import.meta.url).import("./scratchpad-server.ts");
const { SCRATCHPAD_MAX_LENGTH } = await createJiti(import.meta.url).import("./scratchpad.ts");
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "scratchpad-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, path: scratchpadPath(null, root) };
}
test("global and opaque session identities cannot alias or escape; private files survive new readers", async (t) => {
  const { root, path } = fixture(t);
  const initial = readScratchpad(path);
  assert.equal(initial.text, "");
  const saved = await saveScratchpad(path, "notes\n你好 📝", initial.revision);
  assert.deepEqual(readScratchpad(path), saved);
  const session = scratchpadPath("../../global", root);
  assert.equal(dirname(session), dirname(path));
  assert.notEqual(session, path);
  assert.notEqual(scratchpadPath("null", root), path);
  await saveScratchpad(session, "local", initial.revision);
  assert.equal(readScratchpad(path).text, saved.text);
  assert.equal(readScratchpad(session).text, "local");
  if (process.platform !== "win32") {
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
  }
  assert.throws(() => scratchpadPath("", root));
  assert.throws(() => scratchpadPath("\0", root));
});
test("serialized competing writes refuse stale versions, but a lost acknowledgement is idempotent", async (t) => {
  const { path } = fixture(t);
  const initial = readScratchpad(path);
  const results = await Promise.allSettled([saveScratchpad(path, "one", initial.revision), saveScratchpad(path, "two", initial.revision)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find((r) => r.status === "rejected");
  assert.ok(rejected.reason instanceof ScratchpadConflict);
  const current = readScratchpad(path);
  assert.deepEqual(await saveScratchpad(path, current.text, initial.revision), current);
  assert.deepEqual(rejected.reason.current, current);
  assert.equal((await saveScratchpad(path, "", current.revision)).text, "");
});
test("invalid/oversized edits and corrupt saved data are never overwritten", async (t) => {
  const { path } = fixture(t);
  const first = await saveScratchpad(path, "keep", readScratchpad(path).revision);
  await assert.rejects(saveScratchpad(path, "x".repeat(SCRATCHPAD_MAX_LENGTH + 1), first.revision));
  await assert.rejects(saveScratchpad(path, "no", "bad"));
  assert.equal(readScratchpad(path).text, "keep");
  writeFileSync(path, "{corrupt");
  assert.throws(() => readScratchpad(path));
  await assert.rejects(saveScratchpad(path, "replacement", first.revision));
  assert.equal(readFileSync(path, "utf8"), "{corrupt");
});
