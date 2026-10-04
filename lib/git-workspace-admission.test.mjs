import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";
const oldHome = process.env.HOME, oldXdg = process.env.XDG_CONFIG_HOME;
const configHome = fs.mkdtempSync(path.join(tmpdir(), "workspace-adapter-config-"));
process.env.HOME = configHome; process.env.XDG_CONFIG_HOME = configHome;
after(() => {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
  fs.rmSync(configHome, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url);
const { createGitWorkspaceAdmission } = await jiti.import("./git-workspace-admission.ts");
const { captureGitWorkspaceOperation, applyGitWorkspaceOperation, readGitWorkspaceNativeProof } = await jiti.import("./git-workspace-operation.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const git = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
test("adapter is diagnostics only, with no ownership or ledger API", () => {
  let called = false;
  const adapter = createGitWorkspaceAdmission({ agentDir: "/nonexistent/never-read", beginIntent() { called = true; }, assertAdmission() { called = true; } });
  assert.deepEqual(Object.keys(adapter).sort(), ["onCompleted", "onFailure", "onIntent"]);
  assert.equal(called, false);
});
for (const diagnostic of ["throws", "never-settles", "post-success-state-moves"]) test(`actual native completion is independent of diagnostic ${diagnostic}`, async (t) => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "workspace-adapter-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo"), destinationPath = path.join(root, "feature");
  git(root, "init", "-qb", "main", repo); git(repo, "config", "user.name", "Test"); git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "commit.gpgsign", "false"); fs.writeFileSync(path.join(repo, "file"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-qm", "base");
  allowFileRoot(root);
  const owner = { sessionId: randomUUID(), sessionFile: path.join(root, "owner.json"), generation: randomUUID() };
  fs.writeFileSync(owner.sessionFile, JSON.stringify(owner));
  let candidateHash, approved = false, proof;
  const authority = { owner, readAuthorityRevisionSync: () => "original-scope:1", assertCurrentSync(binding) {
    assert.deepEqual(binding.owner, JSON.parse(fs.readFileSync(owner.sessionFile))); assert.equal(binding.source.cwd, repo);
    if (approved) assert.equal(binding.candidateSha256, candidateHash); else candidateHash = binding.candidateSha256;
  } };
  const adapter = createGitWorkspaceAdmission({ agentDir: path.join(root, "unavailable-agent"), async onCompleted(p) {
    proof = p; assert.equal(readGitWorkspaceNativeProof(p).destination.cwd, destinationPath);
    if (diagnostic === "throws") throw Error("storage failed");
    if (diagnostic === "never-settles") return new Promise(() => {});
    fs.writeFileSync(path.join(destinationPath, "file"), "later independent user edit\n");
  } });
  const candidate = await captureGitWorkspaceOperation({ mode: "create", repositoryPath: repo, sourceCheckoutPath: repo, destinationPath,
    branch: "feature", baseBranch: "main", expectedBaseOid: git(repo, "rev-parse", "HEAD") }, adapter, authority);
  approved = true;
  const result = await applyGitWorkspaceOperation({ candidate, authorize: async () => assert.equal(approved, true) });
  assert.equal(result.status, "created"); assert.equal(result.diagnostics, diagnostic === "post-success-state-moves" ? "recorded" : "unavailable");
  assert.equal(readGitWorkspaceNativeProof(result).resultOid, result.oid);
  assert.equal(readGitWorkspaceNativeProof(proof).resultOid, result.oid);
  assert.equal(readGitWorkspaceNativeProof(JSON.parse(JSON.stringify(proof))), undefined);
  assert.equal(fs.existsSync(path.join(root, "unavailable-agent")), false);
});
