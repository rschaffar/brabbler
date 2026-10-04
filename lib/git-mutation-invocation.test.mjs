import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
const { createJiti } = await import("jiti"), jiti = createJiti(import.meta.url);
const { captureGitMutationAuthority } = await jiti.import("./git-mutation-invocation.ts");
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "mutation-owner-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const gitDir = join(root, ".git"); mkdirSync(gitDir);
  const identity = (path) => { const s = statSync(path, { bigint: true }); return { device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) }; };
  const owner = { sessionId: "fixture-owner", sessionFile: join(root, "session.json"), generation: "fixture-generation" };
  writeFileSync(owner.sessionFile, JSON.stringify(owner));
  const resource = { projectRoot: root, cwd: root, branch: "main", commonDir: gitDir, gitDir,
    identities: { project: identity(root), checkout: identity(root), common: identity(gitDir), git: identity(gitDir), marker: identity(gitDir) } };
  const live = { revision: 1, allowed: true };
  const input = { owner, readAuthorityRevisionSync: () => String(live.revision), assertCurrentSync(binding) {
    assert.ok(live.allowed); assert.deepEqual(binding.owner, owner); assert.equal(readFileSync(owner.sessionFile, "utf8"), JSON.stringify(owner));
  } };
  const data = { kind: "workspace", source: resource, candidateSha256: "a".repeat(64) };
  return { input, live, data };
}
test("workspace/cleanup use independent original owner invocations, frozen bindings and single consumption", (t) => {
  const { input, data } = fixture(t), first = captureGitMutationAuthority(input).bind(data), second = captureGitMutationAuthority(input).bind({ ...data, kind: "cleanup" });
  assert.throws(() => { first.binding.source.branch = "foreign"; }); first.consumeSync(); first.assertCurrentSync();
  second.consumeSync(); second.assertCurrentSync(); assert.throws(() => first.consumeSync()); first.retire(); first.retire(); assert.throws(() => first.assertCurrentSync());
  second.assertCurrentSync(); second.retire();
});
test("revision captured before await cannot be rebased by changing/restoring permission or replacing reader", async (t) => {
  const { input, live, data } = fixture(t), baseline = captureGitMutationAuthority(input);
  live.allowed = false; live.revision++; await Promise.resolve(); live.allowed = true; live.revision++;
  input.readAuthorityRevisionSync = () => "1";
  assert.throws(() => baseline.bind(data), /authority changed/);
});
test("missing/fabricated shape or asynchronous guards refuse, accidental rejected thenables are drained", async (t) => {
  const { input } = fixture(t);
  assert.throws(() => captureGitMutationAuthority(undefined));
  assert.throws(() => captureGitMutationAuthority({ ...input, owner: { ...input.owner, sessionFile: "relative.json" } }));
  assert.throws(() => captureGitMutationAuthority({ ...input, assertCurrentSync: async () => {} }));
  assert.throws(() => captureGitMutationAuthority({ ...input, readAuthorityRevisionSync() { return Promise.reject(Error("fixture rejection")); } }));
  await new Promise((resolve) => setImmediate(resolve));
});
test("actual owner-file/generation mismatch refuses rather than fabricating replacement authority", (t) => {
  const { input, data } = fixture(t), invocation = captureGitMutationAuthority(input).bind(data);
  writeFileSync(input.owner.sessionFile, JSON.stringify({ ...input.owner, generation: "new-owner" }));
  assert.throws(() => invocation.consumeSync()); invocation.retire();
});
