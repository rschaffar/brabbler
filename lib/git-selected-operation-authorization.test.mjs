import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, lstat, readFile, writeFile, rename, copyFile, mkdir, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { selectCanonicalGitResources, selectGitProjectResources, revalidateGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { loadGitProjectSettings } = await jiti.import("./git-project-settings.ts");
const { loadGitWorkflowSettings, readGitWorkflowSettingsDocument, writeGitWorkflowSettingsDocument, withGitWorkflowSettingsLock, gitWorkflowSettingsPath } = await jiti.import("./git-workflow-settings-store.ts");
const { readProjectAuthorization, saveProjectAuthorization, projectAuthorizationPath } = await jiti.import("./git-project-authorization.ts");
const { managedGitSessionFacts } = await jiti.import("./git-workflow-access.ts");
const { appendSessionToolSelection } = await jiti.import("./session-tool-selection.ts");
const { appendManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const { SELECTED_OPERATION_ACTIONS, captureSelectedOperationAuthorization: capture, revalidateSelectedOperationAuthorization: revalidate } = await jiti.import("./git-selected-operation-authorization.ts");
const exec = promisify(execFile);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// All state, settings and Git effects below live in disposable repositories and
// private agentDir, never the development checkout or the operator's settings.
// Trusted test adapter: positive physical ancestry/marker absence, not a Git
// subprocess failure reclassified as non-Git. Its complete proof is revision-bound.
async function nonGitCurrent(cwd) {
  const ancestry = [];
  for (let path = cwd; ; path = dirname(path)) {
    const info = await lstat(path, { bigint: true });
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), "physical parent required");
    assert.equal(await realpath(path), path, "no symlink ancestry");
    const identity = { device: String(info.dev), inode: String(info.ino), birthtime: String(info.birthtimeNs) };
    for (const name of [".git", "HEAD", "objects", "refs"]) {
      try { await lstat(join(path, name)); }
      catch (error) { if (error.code === "ENOENT") continue; throw error; }
      throw new Error("Git/ambiguous marker requires positive Git classification, not non-Git fallback");
    }
    ancestry.push({ cwd: path, identity });
    if (dirname(path) === path) break;
  }
  return { kind: "non-git", cwd, identity: ancestry[0].identity, noRepository: { verified: true, revision: hash(ancestry) } };
}
async function fixture(t, { nonGitCaller = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-selected-operation-auth-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent"), callerRepo = join(root, nonGitCaller ? "pi-cwd-fresh" : "caller"), repo = join(root, "selected"), feature = join(root, "feature");
  const git = async (...args) => exec("git", args, { env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(root, "no-config") } });
  if (nonGitCaller) { await mkdir(callerRepo); allowFileRoot(callerRepo); }
  for (const path of nonGitCaller ? [repo] : [callerRepo, repo]) {
    await git("init", "-qb", "main", path);
    await git("-C", path, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", `core.hooksPath=${join(root, "no-hooks")}`, "commit", "--allow-empty", "-qm", "initial");
    allowFileRoot(path);
  }
  await git("-C", repo, "worktree", "add", "-qb", "feature", feature);
  allowFileRoot(feature);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  const session = SessionManager.create(callerRepo, join(agentDir, "sessions"));
  session.appendMessage({ role: "user", content: "independent request", timestamp: Date.now() });
  appendSessionToolSelection(session, ["read", "bash", "edit", "write"]);
  session.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const owner = { sessionId: session.getSessionId(), sessionFile: session.getSessionFile(), sessionCwd: callerRepo };
  const update = (change) => withGitWorkflowSettingsLock(agentDir, async () => {
    const doc = readGitWorkflowSettingsDocument(agentDir);
    change(doc);
    writeGitWorkflowSettingsDocument(doc, agentDir);
  });
  await update((doc) => {
    doc.global = { prepareConfirmation: "ask", cleanupConfirmation: "ask" };
    doc.projects[repo] = { mainBranch: "main", cleanup: "worktree-and-branch" };
  });
  let clock = 1000;
  const calls = { caller: 0, resources: 0, policy: 0, authorization: 0, validation: 0 };
  const readers = {
    now: () => clock,
    readResources: async (selector) => { calls.resources++; return selectCanonicalGitResources(selector); },
    readCaller: async (identity) => {
      calls.caller++;
      const manager = SessionManager.open(identity.sessionFile, undefined);
      const header = manager.getHeader();
      assert.equal(header.id, identity.sessionId);
      assert.equal(header.cwd, identity.sessionCwd);
      const info = await lstat(identity.sessionFile, { bigint: true });
      assert.ok(info.isFile() && !info.isSymbolicLink());
      assert.equal(await realpath(identity.sessionFile), identity.sessionFile);
      const entries = manager.getEntries();
      const common = { persisted: true, revision: hash([String(info.dev), String(info.ino), String(info.birthtimeNs)]), facts: managedGitSessionFacts(entries) };
      if (nonGitCaller) {
        const current = await nonGitCurrent(identity.sessionCwd);
        // No cwd/project discovery: only Global and unqualified saved chat state.
        const state = await loadGitWorkflowSettings(undefined, entries, agentDir, identity.sessionId);
        const policy = Object.fromEntries(["revision", "paused", "optedOut", "global", "session", "resolved", "task"].map((key) => [key, state[key]]));
        return { ...common, current, policy };
      }
      const resources = await selectGitProjectResources(identity.sessionCwd);
      return { ...common, current: { kind: "git", resources },
        policy: await loadGitWorkflowSettings(resources.cwd, entries, agentDir, identity.sessionId) };
    },
    readPolicy: async (selected, identity) => {
      calls.policy++;
      const entries = SessionManager.open(identity.sessionFile, undefined).getEntries();
      return loadGitProjectSettings(selected, entries, agentDir, identity.sessionId);
    },
    readAuthorization: async (selected, identity) => { calls.authorization++; return readProjectAuthorization(selected, identity, agentDir); },
    revalidateResources: async (selected) => { calls.validation++; await revalidateGitProjectResources(selected); },
  };
  readers.readCurrentPolicy = (resources, identity) => readers.readPolicy(resources, identity);
  readers.readCurrentAuthorization = (resources, identity) => readers.readAuthorization(resources, identity);
  readers.revalidateCurrent = async (current, identity) => {
    if (current.kind === "git") return readers.revalidateResources(current.resources);
    calls.validation++;
    assert.equal(hash(current), hash(await nonGitCurrent(identity.sessionCwd)), "current absence/instance proof changed");
  };
  const request = (action = "checks", options = {}) => ({ action, owner, selector: { repositoryPath: repo, checkoutPath: feature },
    requestId: "live-request", requestRevision: "exact-input-revision", ...options });
  const grant = async (action, decision, scope = "project", selectedPath = feature) => {
    const selected = scope === "global" ? undefined : await selectGitProjectResources(selectedPath);
    const identity = scope === "session" ? owner : undefined;
    const before = await readProjectAuthorization(selected, identity, agentDir);
    return saveProjectAuthorization(selected, identity, scope, action, decision, before, agentDir);
  };
  const policy = (changes, path = repo) => update((doc) => { doc.projects[path] = { ...doc.projects[path], ...changes }; });
  return { root, agentDir, callerRepo, repo, feature, git, session, owner, readers, calls, request, grant, policy, update, setClock: (value) => { clock = value; } };
}
const evidence = (result, kind = "exact-approval-required") => {
  assert.equal(result.kind, "evidence", JSON.stringify(result));
  assert.equal(result.evidence.kind, kind);
  assert.equal(result.evidence.approvalToken, false);
  return result.evidence;
};
const refused = (result, code) => { assert.equal(result.kind, "blocked", JSON.stringify(result)); if (code) assert.equal(result.code, code); };

const fields = { workspace: "workspaceConfirmation", checks: "checkConfirmation", prepare: "prepareConfirmation", integration: "integrateConfirmation", cleanup: "cleanupConfirmation" };

test("fresh non-Git managed chat authorizes explicit B without moving or inventing a Git repository A", async (t) => {
  const f = await fixture(t, { nonGitCaller: true });
  appendManagedSessionGitWorkflow(f.session, {}, { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS } });
  // A is just a physical pi-cwd directory. A UI/non-Git 'Project' preference
  // must not become canonical Git policy, branches, recipes or standing grants.
  await f.policy({ enabled: false, delivery: "pr", mainBranch: "not-B-main" }, f.callerRepo);
  const readers = { ...f.readers,
    readCurrentPolicy: async () => { throw new Error("non-Git has no canonical Project policy"); },
    readCurrentAuthorization: async () => { throw new Error("non-Git has no current Project grant"); },
    readPolicy: async (resources, owner) => { assert.equal(resources.cwd, f.feature); return f.readers.readPolicy(resources, owner); },
    readAuthorization: async (resources, owner) => { assert.equal(resources.cwd, f.feature); return f.readers.readAuthorization(resources, owner); },
  };
  const initial = await readers.readCaller(f.owner);
  assert.equal(initial.current.kind, "non-git");
  assert.equal(initial.current.noRepository.verified, true);
  assert.equal(initial.policy.resolved.session.values.workspace, "current");
  assert.equal(Object.hasOwn(initial.current, "branch"), false);
  assert.equal(Object.hasOwn(initial.policy, "project"), false);
  for (const action of SELECTED_OPERATION_ACTIONS) {
    const ask = f.request(action);
    const capturedAsk = evidence(await capture(ask, readers));
    f.setClock(capturedAsk.expiresAt + 120_000);
    evidence(await revalidate(ask, capturedAsk, readers));
    await f.policy({ [fields[action]]: "none" });
    const none = f.request(action, { confirmation: "none" });
    refused(await capture(none, readers), "saved-allow-required");
    await f.grant(action, "allow", "session"); // exact saved B × non-Git caller
    evidence(await capture(ask, readers)); // Allow does not suppress default Ask
    const capturedNone = evidence(await capture(none, readers), "saved-allow");
    f.setClock(capturedNone.expiresAt + 120_000);
    evidence(await revalidate(none, capturedNone, readers), "saved-allow");
  }
  assert.equal(SessionManager.open(f.owner.sessionFile, undefined).getCwd(), f.callerRepo);
  await assert.rejects(lstat(join(f.callerRepo, ".git")), /ENOENT/, "no CLI/Git fake A was created");
  assert.equal(f.calls.resources > 0, true, "B remains independently physically selected");
});

test("non-Git own chat restrictions still clamp selected B Allow", async (t) => {
  const f = await fixture(t, { nonGitCaller: true });
  await f.policy({ checkConfirmation: "none" });
  await f.grant("checks", "allow", "session");
  const request = f.request("checks", { confirmation: "none" });
  evidence(await capture(request, f.readers), "saved-allow");
  appendManagedSessionGitWorkflow(f.session, { enabled: false }, { kind: "none" });
  refused(await capture(request, f.readers), "disabled");
  appendManagedSessionGitWorkflow(f.session, {}, { kind: "none" }, true);
  refused(await capture(request, f.readers), "opted-out");
  appendManagedSessionGitWorkflow(f.session, {}, { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS, enabled: false } });
  refused(await capture(request, f.readers), "disabled");
  appendManagedSessionGitWorkflow(f.session, { checkConfirmation: "disabled" }, { kind: "none" });
  refused(await capture(request, f.readers), "confirmation-disabled");
  appendManagedSessionGitWorkflow(f.session, {}, { kind: "none" });
  for (const delivery of ["pr", "leave"]) {
    appendManagedSessionGitWorkflow(f.session, { delivery }, { kind: "none" });
    for (const action of ["integration", "cleanup"]) refused(await capture(f.request(action), f.readers), "delivery-not-local");
  }
  appendManagedSessionGitWorkflow(f.session, {}, { kind: "none" });
  for (const tools of [[], ["read"]]) {
    appendSessionToolSelection(f.session, tools);
    refused(await capture(request, f.readers), "coding-tools-required");
  }
  appendSessionToolSelection(f.session, ["bash"]);
  const unknown = { ...f.readers, readCaller: async (...args) => ({ ...await f.readers.readCaller(...args), facts: { subagent: false } }) };
  refused(await capture(request, unknown), "coding-tools-required");
  await f.update((doc) => { doc.paused = true; });
  refused(await capture(request, f.readers), "paused");
  await f.update((doc) => { doc.paused = false; doc.global.enabled = false; });
  refused(await capture(request, f.readers), "disabled");
  await f.update((doc) => { doc.global.enabled = true; });
  // Settings writes stale the B-specific grant; explicit renewal is needed.
  await f.grant("checks", "allow", "session");
  evidence(await capture(request, f.readers), "saved-allow");
  f.session.appendCustomEntry("pi-web:subagent", { parentId: "parent" });
  refused(await capture(request, f.readers), "ordinary-caller-required");
});

test("unknown/broken/parent/symlink Git identity cannot masquerade as verified non-Git", async (t) => {
  const f = await fixture(t, { nonGitCaller: true });
  const request = f.request();
  for (const change of [{ kind: "unknown" }, { noRepository: { verified: false, revision: "probe" } },
    { noRepository: { verified: true, revision: "" } }, { identity: { device: "unknown", inode: "1", birthtime: "2" } }, { cwd: f.root }]) {
    const readers = { ...f.readers, readCaller: async (...args) => {
      const caller = await f.readers.readCaller(...args);
      return { ...caller, current: { ...caller.current, ...change } };
    } };
    refused(await capture(request, readers), "caller-identity-unavailable");
  }
  for (const path of [join(f.callerRepo, ".git"), join(f.root, ".git")]) {
    await writeFile(path, "unreadable or broken gitdir: /missing", { mode: 0o000 });
    refused(await capture(request, f.readers), "live-read-failed");
    await rm(path);
  }
  // Bare/ambiguous signatures are not ordinary no-repository proof either.
  await mkdir(join(f.callerRepo, "objects"));
  refused(await capture(request, f.readers), "live-read-failed");
  await rm(join(f.callerRepo, "objects"), { recursive: true });
  const actual = `${f.callerRepo}-physical`;
  await rename(f.callerRepo, actual);
  await symlink(actual, f.callerRepo);
  refused(await capture(request, f.readers), "live-read-failed");
});

test("non-Git instance/state/header changes and non-Git→Git fence pre-effect evidence", async (t) => {
  const f = await fixture(t, { nonGitCaller: true });
  const request = f.request();
  let captured = evidence(await capture(request, f.readers));
  appendSessionToolSelection(f.session, ["bash"]);
  refused(await revalidate(request, captured, f.readers), "revision-changed");
  captured = evidence(await capture(request, f.readers));
  const backup = `${f.callerRepo}-old`;
  await rename(f.callerRepo, backup);
  await mkdir(f.callerRepo);
  refused(await revalidate(request, captured, f.readers), "revision-changed");
  captured = evidence(await capture(request, f.readers));
  const oldHeader = `${f.owner.sessionFile}.old`;
  await rename(f.owner.sessionFile, oldHeader);
  await copyFile(oldHeader, f.owner.sessionFile);
  refused(await revalidate(request, captured, f.readers), "revision-changed");
  captured = evidence(await capture(request, f.readers));
  await f.git("init", "-qb", "now-git", f.callerRepo); // transition, not an eligibility bootstrap
  refused(await revalidate(request, captured, f.readers), "live-read-failed");
});

test("non-Git proof changes during capture refuse instead of minting an observation", async (t) => {
  const f = await fixture(t, { nonGitCaller: true });
  const readers = { ...f.readers, readPolicy: async (...args) => {
    const policy = await f.readers.readPolicy(...args);
    await writeFile(join(f.callerRepo, ".git"), "unknown Git marker");
    return policy;
  } };
  refused(await capture(f.request(), readers), "live-read-failed");
});

test("verified detached Git caller uses current identity scope without a fabricated branch; B stays local", async (t) => {
  const f = await fixture(t);
  const original = await f.readers.readCaller(f.owner);
  const peer = join(f.root, "caller-peer");
  await f.git("-C", f.callerRepo, "worktree", "add", "-qb", "real-peer", peer);
  allowFileRoot(peer);
  await f.git("-C", f.callerRepo, "checkout", "--detach");
  const readCurrent = async () => {
    assert.equal((await f.git("-C", f.callerRepo, "rev-parse", "--is-inside-work-tree")).stdout.trim(), "true");
    const resources = { ...original.current.resources, branch: null };
    for (const [key, path] of [["project", resources.projectRoot], ["checkout", resources.cwd], ["common", resources.commonDir], ["git", resources.gitDir], ["marker", join(resources.cwd, ".git")]]) {
      const info = await lstat(path, { bigint: true });
      assert.ok(info.isDirectory() && !info.isSymbolicLink());
      assert.deepEqual(resources.identities[key], { device: String(info.dev), inode: String(info.ino), birthtime: String(info.birthtimeNs) });
    }
    return { ...original, current: { kind: "git", resources },
      policy: await loadGitWorkflowSettings(f.callerRepo, f.session.getEntries(), f.agentDir, f.owner.sessionId) };
  };
  const scopePeer = async (resources) => {
    assert.equal(resources.branch, null, "no caller branch fabricated");
    const actual = await selectGitProjectResources(peer);
    assert.equal(actual.projectRoot, resources.projectRoot);
    assert.deepEqual(actual.identities.project, resources.identities.project);
    assert.deepEqual(actual.identities.common, resources.identities.common);
    return actual;
  };
  const readers = { ...f.readers, readCaller: readCurrent,
    // These are independently live Project/Chat×Project readers. A real peer
    // proves the same canonical grant scope; it never becomes B's native source.
    readCurrentPolicy: async (resources, owner) => ({ ...await f.readers.readPolicy(await scopePeer(resources), owner), cwd: resources.cwd }),
    readCurrentAuthorization: async (resources, owner) => f.readers.readAuthorization(await scopePeer(resources), owner),
    revalidateCurrent: async () => { await readCurrent(); },
  };
  evidence(await capture(f.request(), readers));
  await f.grant("checks", "deny", "project", peer);
  refused(await capture(f.request(), readers), "saved-deny");
  await f.grant("checks", "inherit", "project", peer);
  // Detached *selected* source is still invalid. No native branch relaxation.
  await f.git("-C", f.feature, "checkout", "--detach");
  refused(await capture(f.request(), readers), "live-read-failed");
});

test("all five independent actions capture Ask evidence without task consent or fake target/base/checks", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(SELECTED_OPERATION_ACTIONS, ["workspace", "checks", "prepare", "integration", "cleanup"]);
  const settingsBefore = await readFile(gitWorkflowSettingsPath(f.agentDir), "utf8");
  const refsBefore = (await f.git("-C", f.repo, "show-ref")).stdout;
  for (const action of SELECTED_OPERATION_ACTIONS) {
    const request = f.request(action);
    const captured = evidence(await capture(request, f.readers));
    assert.equal(captured.expiresAt - captured.capturedAt, 30_000);
    assert.equal(captured.action, action);
    assert.equal(captured.requestId, request.requestId);
    assert.deepEqual(evidence(await revalidate(request, captured, f.readers)), captured);
  }
  assert.equal(await readFile(gitWorkflowSettingsPath(f.agentDir), "utf8"), settingsBefore);
  assert.equal((await f.git("-C", f.repo, "show-ref")).stdout, refsBefore);
  await assert.rejects(readFile(projectAuthorizationPath(f.agentDir)), /ENOENT/);
  assert.deepEqual(f.calls, { caller: 20, resources: 10, policy: 40, authorization: 40, validation: 20 });
  // Direct-main checks are independent of any integration target or recipe.
  evidence(await capture(f.request("checks", { selector: { repositoryPath: f.repo, checkoutPath: f.repo } }), f.readers));
  refused(await capture(f.request("commit"), f.readers), "invalid-request");
});

test("caller builtin defaults never substitute for independent selected prepare/cleanup policy", async (t) => {
  const f = await fixture(t);
  await f.update((doc) => { doc.global = {}; });
  for (const action of ["prepare", "cleanup"]) {
    // These actions default Disabled in A and B. B's explicit Project Ask
    // enables B eligibility without changing A or inventing a captured task.
    refused(await capture(f.request(action), f.readers), "confirmation-disabled");
    await f.policy({ [fields[action]]: "ask" });
    evidence(await capture(f.request(action), f.readers));
    await f.policy({ [fields[action]]: "disabled" }, f.callerRepo);
    refused(await capture(f.request(action), f.readers), "confirmation-disabled");
    await f.policy({ [fields[action]]: "ask" }, f.callerRepo);
  }
});

test("each action: selected disabled refuses Ask; none needs explicit request, corresponding none and independent action Allow", async (t) => {
  const f = await fixture(t);
  for (const action of SELECTED_OPERATION_ACTIONS) {
    const field = fields[action];
    await f.policy({ [field]: "disabled" });
    refused(await capture(f.request(action), f.readers), "confirmation-disabled");
    await f.policy({ [field]: "none" });
    evidence(await capture(f.request(action), f.readers)); // default Ask, not policy-driven automatic
    evidence(await capture(f.request(action, { confirmation: "ask" }), f.readers));
    refused(await capture(f.request(action, { confirmation: "none" }), f.readers), "saved-allow-required");
    await f.grant(action, "allow");
    evidence(await capture(f.request(action), f.readers)); // Allow never suppresses default Ask
    evidence(await capture(f.request(action, { confirmation: "none" }), f.readers), "saved-allow");
    await f.policy({ [field]: "ask" });
    refused(await capture(f.request(action, { confirmation: "none" }), f.readers), "saved-allow-required");
    await f.grant(action, "deny");
    refused(await capture(f.request(action), f.readers), "saved-deny");
    refused(await capture(f.request(action, { confirmation: "ask" }), f.readers), "saved-deny");
    await f.grant(action, "inherit");
  }
});

test("old Global commit Allow and caller-current Allow cannot substitute selected prepare/cleanup/checks grants", async (t) => {
  const f = await fixture(t);
  await f.grant("commit", "allow", "global");
  for (const action of ["checks", "prepare", "cleanup"]) {
    await f.policy({ [fields[action]]: "none" });
    await f.grant(action, "allow", "project", f.callerRepo);
    refused(await capture(f.request(action, { confirmation: "none" }), f.readers), "saved-allow-required");
  }
  // An exact Ask remains possible, but its human approval is not an input or an
  // output of this helper; no approved boolean/receipt/candidate is synthesized.
  const result = await capture(f.request("cleanup"), f.readers);
  evidence(result);
  for (const key of ["approved", "receipt", "candidate", "token", "delete", "automaticCleanup"]) assert.equal(Object.hasOwn(result.evidence, key), false);
});

test("caller live pause/opt-out/enablement, keyed restrictions, task disablement and tools clamp selected B Allow", async (t) => {
  const f = await fixture(t);
  await f.policy({ checkConfirmation: "none" });
  await f.grant("checks", "allow");
  const request = f.request("checks", { confirmation: "none" });
  evidence(await capture(request, f.readers), "saved-allow");
  await f.policy({ enabled: false }, f.callerRepo);
  refused(await capture(request, f.readers), "disabled");
  await f.policy({ enabled: true }, f.callerRepo);
  await f.update((doc) => { doc.paused = true; });
  refused(await capture(request, f.readers), "paused");
  await f.update((doc) => { doc.paused = false; });
  appendManagedSessionGitWorkflow(f.session, {}, { kind: "none" }, true);
  refused(await capture(request, f.readers), "opted-out");
  appendManagedSessionGitWorkflow(f.session, {}, { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS, enabled: false } });
  refused(await capture(request, f.readers), "disabled");
  // Task enabled but captured old target/base/checks/confirmation are not B's
  // operation authority. Only its explicit task-wide disabled bit clamps.
  appendManagedSessionGitWorkflow(f.session, {}, { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS,
    enabled: true, baseBranch: "absent-old-base", targetBranch: "absent-old-target", checks: [{ label: "old", argv: ["false"] }] } });
  evidence(await capture(request, f.readers), "saved-allow");
  f.session.appendCustomEntry("pi-web:git-project-settings", { version: 1, projectRoot: f.callerRepo, overrides: { enabled: false } });
  refused(await capture(request, f.readers), "disabled");
  f.session.appendCustomEntry("pi-web:git-project-settings", { version: 1, projectRoot: f.callerRepo, overrides: {} });
  f.session.appendCustomEntry("pi-web:git-project-settings", { version: 1, projectRoot: f.repo, overrides: { enabled: false } });
  refused(await capture(request, f.readers), "disabled");
  f.session.appendCustomEntry("pi-web:git-project-settings", { version: 1, projectRoot: f.repo, overrides: {} });
  for (const tools of [[], ["read", "grep"]]) {
    appendSessionToolSelection(f.session, tools);
    refused(await capture(request, f.readers), "coding-tools-required");
  }
  const liveTools = { ...f.readers, readCaller: async (owner) => ({ ...await f.readers.readCaller(owner), facts: { subagent: false, tools: ["bash"] } }) };
  evidence(await capture(request, liveTools), "saved-allow", "effective tools override saved selection");
  for (const facts of [{ subagent: false }, { subagent: false, tools: [] }, { subagent: true, tools: ["bash"] }, { tools: ["bash"] }]) {
    refused(await capture(request, { ...f.readers, readCaller: async (owner) => ({ ...await f.readers.readCaller(owner), facts }) }));
  }
  refused(await capture(request, { ...liveTools, readCaller: async (owner) => ({ ...await liveTools.readCaller(owner), persisted: false }) }), "ordinary-caller-required");
});

test("explicit Global/canonical Project disablement stays a clamp despite narrower enabled overrides", async (t) => {
  const f = await fixture(t);
  appendManagedSessionGitWorkflow(f.session, { enabled: true }, { kind: "none" });
  for (const projectRoot of [f.callerRepo, f.repo]) {
    f.session.appendCustomEntry("pi-web:git-project-settings", { version: 1, projectRoot, overrides: { enabled: true } });
    await f.policy({ enabled: true }, projectRoot);
  }
  await f.update((doc) => { doc.global.enabled = false; });
  refused(await capture(f.request(), f.readers), "disabled");
  await f.update((doc) => { doc.global.enabled = true; });
  evidence(await capture(f.request(), f.readers));
  for (const projectRoot of [f.callerRepo, f.repo]) {
    await f.policy({ enabled: false }, projectRoot);
    refused(await capture(f.request(), f.readers), "disabled");
    await f.policy({ enabled: true }, projectRoot);
  }
});

test("current caller Deny and operation-disabled clamp Ask and selected none", async (t) => {
  const f = await fixture(t);
  await f.policy({ checkConfirmation: "none" });
  await f.grant("checks", "allow");
  await f.grant("checks", "deny", "session", f.callerRepo);
  refused(await capture(f.request(), f.readers), "saved-deny");
  refused(await capture(f.request("checks", { confirmation: "none" }), f.readers), "saved-deny");
  await f.grant("checks", "inherit", "session", f.callerRepo);
  await f.policy({ checkConfirmation: "disabled" }, f.callerRepo);
  refused(await capture(f.request(), f.readers), "confirmation-disabled");
  await f.policy({ checkConfirmation: "ask" }, f.callerRepo);
  f.session.appendCustomEntry("pi-web:git-project-settings", { version: 1, projectRoot: f.callerRepo,
    overrides: { checkConfirmation: "disabled" } });
  refused(await capture(f.request(), f.readers), "confirmation-disabled");
  refused(await capture(f.request("checks", { confirmation: "none" }), f.readers), "confirmation-disabled");
});

test("prepare needs explicit saved Project main, never Global/task names or main source", async (t) => {
  const f = await fixture(t);
  await f.policy({ mainBranch: null });
  await f.update((doc) => { doc.global.mainBranch = "main"; }); // legacy Global record, not a designation
  appendManagedSessionGitWorkflow(f.session, {}, { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS, mainBranch: "main" } });
  refused(await capture(f.request("prepare"), f.readers), "project-main-required");
  await f.policy({ mainBranch: "main" });
  evidence(await capture(f.request("prepare"), f.readers));
  refused(await capture(f.request("prepare", { selector: { repositoryPath: f.repo, checkoutPath: f.repo } }), f.readers), "source-is-main");
  // A Session/Global origin cannot fabricate the designation via a resolver.
  const inherited = { ...f.readers, readPolicy: async (...args) => {
    const policy = await f.readers.readPolicy(...args);
    policy.resolved.session.origins.mainBranch = "global";
    return policy;
  } };
  refused(await capture(f.request("prepare"), inherited), "project-main-required");
});

test("selected integration/cleanup require local B delivery, not A's unrelated Project preference", async (t) => {
  const f = await fixture(t);
  for (const action of ["integration", "cleanup"]) await f.grant(action, "allow", "global");
  for (const delivery of ["pr", "leave"]) {
    await f.policy({ delivery }, f.callerRepo);
    for (const action of ["integration", "cleanup"]) evidence(await capture(f.request(action), f.readers));
    await f.policy({ delivery });
    for (const action of ["integration", "cleanup"]) {
      refused(await capture(f.request(action), f.readers), "delivery-not-local");
      refused(await capture(f.request(action, { confirmation: "none" }), f.readers), "delivery-not-local");
    }
    await f.policy({ delivery: "local" });
  }
  // Explicit canonical Chat×Project and unqualified legacy negatives remain
  // caller restrictions, distinct from A's arbitrary Project delivery.
  for (const delivery of ["pr", "leave"]) {
    f.session.appendCustomEntry("pi-web:git-project-settings", { version: 1, projectRoot: f.callerRepo, overrides: { delivery } });
    for (const action of ["integration", "cleanup"]) refused(await capture(f.request(action), f.readers), "delivery-not-local");
    f.session.appendCustomEntry("pi-web:git-project-settings", { version: 1, projectRoot: f.callerRepo, overrides: {} });
    appendManagedSessionGitWorkflow(f.session, { delivery }, { kind: "none" });
    for (const action of ["integration", "cleanup"]) refused(await capture(f.request(action), f.readers), "delivery-not-local");
    appendManagedSessionGitWorkflow(f.session, {}, { kind: "none" });
  }
  for (const action of ["integration", "cleanup"]) evidence(await capture(f.request(action), f.readers));
});

test("cleanup retain refuses even Ask/Allow; only explicit eligible mode admits separate native eligibility", async (t) => {
  const f = await fixture(t);
  await f.grant("cleanup", "allow", "global");
  await f.policy({ cleanup: "retain", cleanupConfirmation: "none" });
  for (const confirmation of [undefined, "ask", "none"]) {
    refused(await capture(f.request("cleanup", { confirmation }), f.readers), "cleanup-mode-required");
  }
  // Missing mode resolves to builtin retain, not a deletion permission.
  await f.update((doc) => { delete doc.projects[f.repo].cleanup; });
  refused(await capture(f.request("cleanup"), f.readers), "cleanup-mode-required");
  await f.policy({ cleanup: "worktree-and-branch" });
  evidence(await capture(f.request("cleanup"), f.readers));
  evidence(await capture(f.request("cleanup", { confirmation: "none" }), f.readers), "saved-allow");
  const builtinMode = { ...f.readers, readPolicy: async (...args) => {
    const policy = await f.readers.readPolicy(...args);
    policy.resolved.session.origins.cleanup = "builtin";
    return policy;
  } };
  refused(await capture(f.request("cleanup"), builtinMode), "cleanup-mode-required");
  assert.ok((await f.git("-C", f.repo, "worktree", "list", "--porcelain")).stdout.includes(f.feature));
});

test("pre-effect rereads grants/policy/caller/resources and rejects revocation, epoch, request and tool changes", async (t) => {
  const f = await fixture(t);
  await f.policy({ checkConfirmation: "none" });
  await f.grant("checks", "allow");
  const request = f.request("checks", { confirmation: "none" });
  let captured = evidence(await capture(request, f.readers), "saved-allow");
  const before = { ...f.calls };
  evidence(await revalidate(request, captured, f.readers), "saved-allow");
  for (const key of Object.keys(before)) assert.ok(f.calls[key] > before[key], `${key} must reread`);
  refused(await revalidate({ ...request, requestId: "other-request" }, captured, f.readers), "revision-changed");
  refused(await revalidate({ ...request, requestRevision: "changed-checks-or-refs" }, captured, f.readers), "revision-changed");
  refused(await revalidate({ ...request, confirmation: "ask" }, captured, f.readers), "revision-changed");
  await f.grant("checks", "deny");
  refused(await revalidate(request, captured, f.readers), "saved-deny");
  await f.grant("checks", "allow");
  captured = evidence(await capture(request, f.readers), "saved-allow");
  await f.policy({ checkConfirmation: "none" }); // equal-value settings write is a revision fence
  refused(await revalidate(request, captured, f.readers), "revision-changed");
  captured = evidence(await capture(request, f.readers), "saved-allow");
  appendSessionToolSelection(f.session, ["read"]);
  refused(await revalidate(request, captured, f.readers), "coding-tools-required");
  appendSessionToolSelection(f.session, ["bash"]);
  captured = evidence(await capture(request, f.readers), "saved-allow");
  await f.git("-C", f.feature, "branch", "-m", "renamed");
  refused(await revalidate(request, captured, f.readers), "revision-changed");
});

test("identical full live reads refresh observations before/after expiry without renewing exact approval", async (t) => {
  const f = await fixture(t);
  const request = f.request();
  const captured = evidence(await capture(request, f.readers));
  for (const now of [captured.expiresAt - 1, captured.expiresAt, captured.expiresAt + 120_000]) {
    f.setClock(now);
    const before = { ...f.calls };
    const refreshed = evidence(await revalidate(request, captured, f.readers));
    assert.notStrictEqual(refreshed, captured);
    assert.equal(refreshed.capturedAt, now);
    assert.equal(refreshed.expiresAt, now + 30_000);
    for (const key of ["revision", "requestId", "requestRevision", "kind", "action"]) assert.equal(refreshed[key], captured[key]);
    for (const key of Object.keys(before)) assert.ok(f.calls[key] > before[key], `${key} must reread even after expiry`);
    // The outer controller's exact approval/native candidate is independent:
    // this helper returns no approval and does not create a new request ID.
    assert.equal(Object.hasOwn(refreshed, "approved"), false);
  }
  refused(await revalidate({ ...request, requestId: "different-live-request" }, captured, f.readers), "revision-changed");
  refused(await revalidate({ ...request, requestRevision: "different-native-candidate" }, captured, f.readers), "revision-changed");
  const backup = `${f.owner.sessionFile}.old`;
  await rename(f.owner.sessionFile, backup);
  await copyFile(backup, f.owner.sessionFile);
  refused(await revalidate(request, captured, f.readers), "revision-changed");
});

test("expired none observations still require fresh Allow and unchanged policy/caller/resources", async (t) => {
  const f = await fixture(t);
  await f.policy({ checkConfirmation: "none" });
  await f.grant("checks", "allow");
  const request = f.request("checks", { confirmation: "none" });
  let captured = evidence(await capture(request, f.readers), "saved-allow");
  f.setClock(captured.expiresAt + 120_000);
  evidence(await revalidate(request, captured, f.readers), "saved-allow");
  await f.grant("checks", "inherit");
  refused(await revalidate(request, captured, f.readers), "saved-allow-required");
  await f.grant("checks", "allow");
  refused(await revalidate(request, captured, f.readers), "revision-changed", "a renewed grant is a new revision");
  captured = evidence(await capture(request, f.readers), "saved-allow");
  f.setClock(captured.expiresAt + 120_000);
  await f.grant("checks", "deny");
  refused(await revalidate(request, captured, f.readers), "saved-deny");
  await f.grant("checks", "allow");
  captured = evidence(await capture(request, f.readers), "saved-allow");
  f.setClock(captured.expiresAt + 120_000);
  await f.policy({ checkConfirmation: "none" });
  refused(await revalidate(request, captured, f.readers), "revision-changed");
  captured = evidence(await capture(request, f.readers), "saved-allow");
  f.setClock(captured.expiresAt + 120_000);
  appendSessionToolSelection(f.session, ["read"]);
  refused(await revalidate(request, captured, f.readers), "coding-tools-required");
  appendSessionToolSelection(f.session, ["bash"]);
  captured = evidence(await capture(request, f.readers), "saved-allow");
  f.setClock(captured.expiresAt + 120_000);
  await f.git("-C", f.feature, "branch", "-m", "renamed");
  refused(await revalidate(request, captured, f.readers), "revision-changed");
});

test("observation refresh rejects future clock, invalid formats and mismatched evidence request/revision", async (t) => {
  const f = await fixture(t);
  const request = f.request();
  const captured = evidence(await capture(request, f.readers));
  f.setClock(captured.capturedAt - 1);
  refused(await revalidate(request, captured, f.readers), "invalid-evidence");
  f.setClock(captured.expiresAt + 120_000);
  for (const change of [{ version: 2 }, { approvalToken: true }, { kind: "approved" }, { action: "commit" },
    { requestId: "" }, { requestRevision: "" }, { revision: "not-a-revision" }, { capturedAt: -1 },
    { capturedAt: NaN }, { expiresAt: Infinity }, { expiresAt: captured.expiresAt + 1 }]) {
    refused(await revalidate(request, { ...captured, ...change }, f.readers), "invalid-evidence");
  }
  for (const change of [{ requestId: "other-request" }, { requestRevision: "other-candidate" }, { revision: "a".repeat(64) }]) {
    refused(await revalidate(request, { ...captured, ...change }, f.readers), "revision-changed");
  }
  for (const now of [NaN, Infinity, -1, 0.5]) {
    f.setClock(now);
    refused(await revalidate(request, captured, f.readers), "invalid-evidence");
  }
});

test("unavailable/corrupt/mismatched live readers fail closed; mixed policy/grant reads never fabricate authority", async (t) => {
  const f = await fixture(t);
  for (const method of ["readCaller", "readResources", "readPolicy", "readAuthorization", "revalidateResources", "readCurrentPolicy", "readCurrentAuthorization", "revalidateCurrent"]) {
    refused(await capture(f.request(), { ...f.readers, [method]: async () => { throw new Error("unavailable"); } }), "live-read-failed");
  }
  refused(await capture(f.request(), { ...f.readers, readCaller: async (owner) => {
    const caller = await f.readers.readCaller(owner); caller.policy.projectRoot = f.repo; return caller;
  } }), "caller-policy-mismatch");
  refused(await capture(f.request(), { ...f.readers, readPolicy: async (...args) => {
    const policy = await f.readers.readPolicy(...args); policy.projectRoot = f.callerRepo; return policy;
  } }), "selected-policy-mismatch");
  refused(await capture(f.request(), { ...f.readers, readResources: async () => selectGitProjectResources(f.callerRepo) }), "resource-mismatch");
  await f.policy({ checkConfirmation: "none" });
  // A genuinely absent grant file means no Allow, unlike losing a published one.
  await assert.rejects(lstat(projectAuthorizationPath(f.agentDir)), { code: "ENOENT" });
  refused(await capture(f.request("checks", { confirmation: "none" }), f.readers), "saved-allow-required");
  await f.grant("checks", "allow");
  let changed = false;
  const racing = { ...f.readers, readAuthorization: async (...args) => {
    if (!changed) { changed = true; await f.policy({ checkConfirmation: "ask" }); }
    return f.readers.readAuthorization(...args);
  } };
  refused(await capture(f.request("checks", { confirmation: "none" }), racing), "live-state-changed");
  const request = f.request();
  const captured = evidence(await capture(request, f.readers));
  const savedGrants = await readFile(projectAuthorizationPath(f.agentDir));
  await writeFile(projectAuthorizationPath(f.agentDir), "{", { mode: 0o600 });
  refused(await capture(request, f.readers), "live-read-failed");
  await rm(projectAuthorizationPath(f.agentDir));
  // Removing corruption cannot rebaseline authority or erase a saved Deny.
  refused(await capture(f.request("checks", { confirmation: "none" }), f.readers), "live-read-failed");
  await writeFile(projectAuthorizationPath(f.agentDir), savedGrants, { mode: 0o600 });
  refused(await capture(request, f.readers), "live-read-failed");
  refused(await revalidate(request, captured, f.readers), "live-read-failed");
});

test("detached selected checkout fails closed independently of authority-file corruption", async (t) => {
  const f = await fixture(t);
  evidence(await capture(f.request(), f.readers));
  await f.git("-C", f.feature, "checkout", "--detach");
  refused(await capture(f.request(), f.readers), "live-read-failed");
});
