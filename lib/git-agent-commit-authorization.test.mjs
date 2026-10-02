import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(join(tmpdir(), "agent-commit-authorization-"));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(async () => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previous;
  await rm(agentDir, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { interopDefault: false });
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { agentGitCommitAuthorization } = await jiti.import("./git-agent-commit-authorization.ts");
const { snapshotFreshManagedSessionGitWorkflow, appendManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
const { appendSessionGitWorkflow } = await jiti.import("./git-workflow-policy.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args])).stdout.trim();
const persist = (manager) => {
  manager.appendMessage({ role: "user", content: "fixture task", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
};
async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), "agent-commit-origin-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git(cwd, "init", "-qb", "base");
  await git(cwd, "config", "user.name", "Fixture");
  await git(cwd, "config", "user.email", "fixture@example.invalid");
  await git(cwd, "commit", "--allow-empty", "-qm", "base");
  allowFileRoot(cwd);
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: { commitConfirmation: "none" }, projects: {} });
  const selected = await selectGitProjectResources(cwd);
  await saveProjectAuthorization(selected, undefined, "project", "commit", "allow", await readProjectAuthorization(selected, undefined, agentDir), agentDir);
  const create = () => SessionManager.create(cwd, join(agentDir, "sessions"));
  const fresh = () => {
    const manager = create();
    snapshotFreshManagedSessionGitWorkflow(manager, DEFAULT_GIT_WORKFLOW_SETTINGS);
    persist(manager);
    return manager;
  };
  const gate = (manager, extra = {}) => agentGitCommitAuthorization({ sessionCwd: cwd, manager, selected,
    confirmation: "none", effectiveTools: () => ["read", "edit"], agentDir, ...extra });
  return { cwd, selected, create, fresh, gate };
}

test("persisted creation proof, not SDK disk-backed status, copied marker or live branch view", { skip: process.platform !== "linux" }, async (t) => {
  const f = await fixture(t);
  const fresh = f.fresh();
  await f.gate(fresh)();
  await f.gate(SessionManager.open(fresh.getSessionFile(), undefined))();
  const notFlushed = f.create();
  snapshotFreshManagedSessionGitWorkflow(notFlushed, DEFAULT_GIT_WORKFLOW_SETTINGS);
  assert.equal(notFlushed.isPersisted(), true, "SDK marks a not-yet-flushed manager disk-backed");
  await assert.rejects(f.gate(notFlushed), /authorization|persisted/);
  const cloneFile = SessionManager.open(fresh.getSessionFile(), undefined).createBranchedSession(fresh.getLeafId());
  const clone = SessionManager.open(cloneFile, undefined);
  await assert.rejects(f.gate(clone), /creation provenance/);
  const copied = f.create();
  for (const entry of fresh.getEntries().filter((e) => e.customType === "pi-web:git-workflow")) copied.appendCustomEntry(entry.customType, entry.data);
  persist(copied);
  await assert.rejects(f.gate(copied), /creation provenance/, "copy without a parent header still cannot borrow the source id");

  const bound = { getSessionId: fresh.getSessionId.bind(fresh), getSessionFile: fresh.getSessionFile.bind(fresh),
    getCwd: fresh.getCwd.bind(fresh), getHeader: fresh.getHeader.bind(fresh), getEntries: () => fresh.getEntries().slice(1) };
  await assert.rejects(f.gate(bound), /creation provenance/, "partial raw history cannot prove untouched creation");
  const branchSlice = fresh.getEntries();
  appendManagedSessionGitWorkflow(fresh, {}, { kind: "managed", settings: DEFAULT_GIT_WORKFLOW_SETTINGS });
  bound.getEntries = () => branchSlice;
  await assert.rejects(f.gate(bound), /creation provenance/, "stale branch data cannot conceal a later persisted workflow write");
  const link = join(agentDir, "linked-session.jsonl");
  await symlink(copied.getSessionFile(), link);
  bound.getSessionId = copied.getSessionId.bind(copied);
  bound.getHeader = copied.getHeader.bind(copied);
  bound.getSessionFile = () => link;
  await assert.rejects(f.gate(bound), /identity|authorization|persisted/);
});

test("only enabled managed Ask creation qualifies; recapture never upgrades old/legacy/absent callers", { skip: process.platform !== "linux" }, async (t) => {
  const f = await fixture(t);
  for (const kind of ["absent", "legacy", "old-ask", "pinned", "off", "manual", "disabled", "optout", "subagent"]) {
    const manager = f.create();
    if (["pinned", "off", "manual", "disabled", "optout", "subagent"].includes(kind)) {
      snapshotFreshManagedSessionGitWorkflow(manager, { ...DEFAULT_GIT_WORKFLOW_SETTINGS,
        enabled: kind !== "disabled", commits: ["off", "manual"].includes(kind) ? kind : "ask" });
    } else if (kind === "legacy") appendSessionGitWorkflow(manager, { mode: "current", onCreate: "stay", commits: "agent" });
    else if (kind === "old-ask") appendManagedSessionGitWorkflow(manager, {}, { kind: "managed", settings: DEFAULT_GIT_WORKFLOW_SETTINGS });
    persist(manager);
    if (kind === "pinned" || kind === "optout") appendManagedSessionGitWorkflow(manager, {}, { kind: "managed", settings: DEFAULT_GIT_WORKFLOW_SETTINGS }, kind === "optout");
    if (kind === "subagent") manager.appendCustomEntry("pi-web:subagent", { version: 1 });
    await assert.rejects(f.gate(manager), undefined, kind);
  }
  const manager = f.fresh();
  let tools = ["read", "edit"];
  const gate = f.gate(manager, { effectiveTools: () => tools });
  await gate();
  tools = ["read", "git_commit"];
  await assert.rejects(gate, /coding mutation|read-only/);
  tools = undefined;
  await assert.rejects(gate, /coding mutation|unknown/);
});

test("a pending authorization closure is bound to its original session id/file", { skip: process.platform !== "linux" }, async (t) => {
  const f = await fixture(t);
  let current = f.fresh();
  const manager = Object.fromEntries(["getSessionId", "getSessionFile", "getCwd", "getHeader", "getEntries"].map((name) => [name, () => current[name]() ]));
  const gate = f.gate(manager);
  await gate();
  current = f.fresh();
  await assert.rejects(gate, /caller changed/);
});
