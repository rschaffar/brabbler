import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";
const root = mkdtempSync(join(tmpdir(), "pi-git-plugin-tests-"));
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
after(() => { if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir; rmSync(root, { recursive: true, force: true }); });
const jiti = createJiti(import.meta.url);
const { executeGitOperation: executeWithReceipts } = await jiti.import("./server.ts");
const { OPERATION_MARKERS } = await jiti.import("./operation-paths.ts");
const { preparePluginReview, reviewEntry, reviewPreview } = await jiti.import("../../lib/plugins/review-store.ts");
const { snapshotOperationReceipt } = await jiti.import("../../lib/operation-receipts.ts");
const { validatePluginCard } = await jiti.import("../../lib/plugins/ui.ts");
const executeGitOperation = (cwd, op, ui, ...rest) => executeWithReceipts(cwd, op, {
  prepareReview: preparePluginReview,
  operationReceipt(id, receipt) { snapshotOperationReceipt(id, receipt, 1); },
  ...ui,
  ...(ui?.pluginCard ? { pluginCard: (id, card, signal) => { validatePluginCard(card); return ui.pluginCard(id, card, signal); } } : {}),
}, ...rest);
const { gitWorkflowManifest } = await jiti.import("./manifest.ts");
const { updatePluginSettings } = await jiti.import("../../lib/plugins/settings.ts");
function git(cwd, ...args) { return execFileSync("git", ["-C", cwd, "-c", "commit.gpgSign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
let n = 0;
function fixture(suffix = "") {
  const repo = join(root, `repo-${++n}${suffix}`);
  git(root, "init", "-b", "main", repo);
  git(repo, "config", "user.name", "Test"); git(repo, "config", "user.email", "test@example.invalid");
  writeFileSync(join(repo, "a"), "base a\n"); writeFileSync(join(repo, "b"), "base b\n");
  git(repo, "add", "."); git(repo, "commit", "-m", "Initial");
  updatePluginSettings(gitWorkflowManifest, "global", repo, { enabled: true, targetBranch: "main", commit: "ask", rebase: "ask", merge: "ask", createWorktree: "ask", attachWorktree: "ask", removeWorktree: "ask", commitChecks: [], mergeChecks: [], mergeMethod: "non-ff" }, []);
  return repo;
}
function set(repo, values) { updatePluginSettings(gitWorkflowManifest, "project", repo, values, []); }
const approved = { pluginCard: async () => "approve" };
const call = (repo, op, ui = approved, signal) => executeGitOperation(repo, op, ui, signal);
const commit = (repo, extra = {}) => ({ action: "commit", checkout: repo, mode: "files", files: ["a"], message: "Exact message\n\nBody", ...extra });
function change(repo) { writeFileSync(join(repo, "a"), "changed a\n"); }
function success(result) { assert.notEqual(result.isError, true, result.content[0].text); assert.equal(result.details.completed, true); }
function failed(result, pattern) { assert.equal(result.isError, true); assert.match(result.content[0].text, pattern); }

for (const linked of [false, true]) {
  for (const marker of OPERATION_MARKERS) {
    test(`${linked ? "linked" : "primary"} checkout refuses ${marker} before approval or effects`, async () => {
      const repo = fixture();
      const selected = linked ? feature(repo) : repo;
      const markerPath = git(selected, "rev-parse", "--path-format=absolute", "--git-path", marker);
      if (["rebase-merge", "rebase-apply", "sequencer"].includes(marker)) mkdirSync(markerPath);
      else writeFileSync(markerPath, "");
      const before = git(selected, "rev-parse", "HEAD");
      let approvals = 0;
      const result = await call(repo, commit(repo, { checkout: selected }), { pluginCard: async () => { approvals++; return "approve"; } });
      failed(result, new RegExp(`Conflicting Git operation: ${marker}`));
      assert.equal(approvals, 0);
      assert.equal(result.details.effectStarted, false);
      assert.equal(git(selected, "rev-parse", "HEAD"), before);
    });
  }
}

test("marker resolution preserves a real checkout path containing embedded newlines and Unicode", async () => {
  const repo = fixture("-MERGE_HEAD\nquote ' \tµ");
  writeFileSync(git(repo, "rev-parse", "--path-format=absolute", "--git-path", "CHERRY_PICK_HEAD"), "");
  failed(await call(repo, commit(repo)), /Conflicting Git operation: CHERRY_PICK_HEAD/);
});

test("a conflict marker appearing during approval is rechecked before effects", async () => {
  const repo = fixture(); change(repo);
  const before = git(repo, "rev-parse", "HEAD");
  const result = await call(repo, commit(repo), { pluginCard: async () => {
    writeFileSync(git(repo, "rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"), "");
    return "approve";
  } });
  failed(result, /Conflicting Git operation: MERGE_HEAD/);
  assert.equal(result.details.effectStarted, false);
  assert.equal(git(repo, "rev-parse", "HEAD"), before);
});

test("disabled and denied calls have no UI or effects; allow bypasses approval", async () => {
  const repo = fixture(); change(repo); const before = git(repo, "rev-parse", "HEAD");
  updatePluginSettings(gitWorkflowManifest, "global", repo, { enabled: false }, []);
  failed(await call(repo, commit(repo), { pluginCard() { assert.fail("UI on disabled plugin"); } }), /disabled/);
  updatePluginSettings(gitWorkflowManifest, "global", repo, { enabled: true }, []); set(repo, { commit: "deny" });
  failed(await call(repo, commit(repo), { pluginCard() { assert.fail("UI on denied action"); } }), /denied/);
  assert.equal(git(repo, "rev-parse", "HEAD"), before);
  set(repo, { commit: "allow" }); success(await call(repo, commit(repo), { pluginCard() { assert.fail("Approval on allow"); } }));
  assert.equal(git(repo, "log", "-1", "--format=%B"), "Exact message\n\nBody");
});
test("ask shows exact resource, message, patch and checks; decline and no UI do not execute", async () => {
  const repo = fixture(); change(repo); const before = git(repo, "rev-parse", "HEAD");
  set(repo, { commitChecks: [{ name: "Bounded check", command: "printf checked" }] });
  let card;
  failed(await call(repo, commit(repo), { pluginCard: async (_id, supplied) => { card = supplied; return "reject"; } }), /not approved/);
  assert.equal(card.title, "Git commit");
  assert.deepEqual(card.sections.find((section) => section.title === "Commit message"), { title: "Commit message", text: "Exact message\n\nBody", code: true });
  assert.deepEqual(card.sections.find((section) => section.title === "Required checks").fields, [{ label: "Bounded check", value: "printf checked", code: true }]);
  assert.equal(card.fields.find((field) => field.label === "Checkout").value, repo);
  assert.match(card.scope, /entire commit candidate and the listed checks/);
  assert.match(card.sections.find((section) => section.notice).text, /do not certify a separately exported candidate tree/);
  assert.ok(card.sections.find((section) => section.title === "Technical details").collapsible);
  assert.equal(card.actions.find((action) => action.primary).label, "Approve commit");
  assert.equal(card.patch, undefined);
  assert.match((await reviewPreview(card.review, await reviewEntry(card.review, 1))).text, /changed a/);
  assert.equal(git(repo, "rev-parse", "HEAD"), before);
  failed(await call(repo, commit(repo), {}), /live Pi Web/);
  success(await call(repo, commit(repo)));
});
test("permission and global enable changes cancel pending approvals; unrelated permissions do not", async () => {
  for (const changed of [{ commit: "deny" }, { commit: "allow" }, { enabled: false }]) {
    const repo = fixture(); change(repo); const before = git(repo, "rev-parse", "HEAD");
    failed(await call(repo, commit(repo), { pluginCard: async (_id, _card, signal) => {
      updatePluginSettings(gitWorkflowManifest, Object.hasOwn(changed, "enabled") ? "global" : "project", repo, changed, []);
      assert.equal(signal.aborted, true); return null;
    } }), /not approved/);
    assert.equal(git(repo, "rev-parse", "HEAD"), before);
  }
  const repo = fixture(); change(repo);
  success(await call(repo, commit(repo), { pluginCard: async (_id, _card, signal) => { set(repo, { removeWorktree: "deny" }); assert.equal(signal.aborted, false); return "approve"; } }));
});
test("approval stale-state checks bind files, index, HEAD and required checks", async () => {
  for (const mutate of [
    (repo) => writeFileSync(join(repo, "a"), "another edit\n"),
    (repo) => { writeFileSync(join(repo, "b"), "staged unrelated\n"); git(repo, "add", "b"); },
    (repo) => git(repo, "commit", "--allow-empty", "-m", "Other writer"),
    (repo) => set(repo, { commitChecks: [{ name: "New", command: "true" }] }),
  ]) {
    const repo = fixture(); change(repo);
    failed(await call(repo, commit(repo), { pluginCard: async () => { mutate(repo); return "approve"; } }), /Stale operation/);
    assert.notEqual(git(repo, "log", "-1", "--format=%s"), "Exact message");
  }
});
test("selected whole files preserve unrelated staging; staged mode preserves unstaged content", async () => {
  const repo = fixture();
  writeFileSync(join(repo, "a"), "partially staged a\n"); git(repo, "add", "a"); change(repo);
  writeFileSync(join(repo, "b"), "staged b\n"); git(repo, "add", "b"); writeFileSync(join(repo, "b"), "unstaged b\n");
  success(await call(repo, commit(repo)));
  assert.equal(git(repo, "show", "HEAD:a"), "changed a"); assert.equal(git(repo, "show", "HEAD:b"), "base b");
  assert.equal(git(repo, "show", ":b"), "staged b"); assert.equal(readFileSync(join(repo, "b"), "utf8"), "unstaged b\n");
  assert.equal(git(repo, "diff", "--cached", "--name-only"), "b");
  success(await call(repo, commit(repo, { mode: "staged", files: undefined, message: "Staged exact" })));
  assert.equal(git(repo, "show", "HEAD:b"), "staged b"); assert.equal(readFileSync(join(repo, "b"), "utf8"), "unstaged b\n");
});
test("literal files and deletions work; resource/path errors do not mutate", async () => {
  const repo = fixture();
  const weird = ":(glob)*"; writeFileSync(join(repo, weird), "literal\n");
  success(await call(repo, commit(repo, { files: [weird] })));
  assert.equal(git(repo, "ls-tree", "--name-only", "HEAD"), `${weird}\na\nb`);
  rmSync(join(repo, "a")); success(await call(repo, commit(repo, { message: "Deletion" })));
  const other = fixture(); change(other);
  success(await executeGitOperation(repo, commit(other), approved));
  failed(await call(repo, commit(repo, { files: ["../escape"] })), /Invalid selected/);
  failed(await call(repo, commit(repo, { files: ["."] })), /directories/);
});
test("failed checks, changed state after checks and native lock failure report honest outcomes", async () => {
  const repo = fixture(); change(repo); const before = git(repo, "rev-parse", "HEAD");
  set(repo, { commitChecks: [{ name: "Fail", command: "exit 7" }] });
  const failedCheck = await call(repo, commit(repo)); failed(failedCheck, /checks started/); assert.equal(failedCheck.details.effectStarted, false);
  set(repo, { commitChecks: [{ name: "Edit", command: "printf modified > a" }] });
  failed(await call(repo, commit(repo)), /Stale operation/);
  assert.equal(git(repo, "rev-parse", "HEAD"), before);
  set(repo, { commitChecks: [] }); writeFileSync(join(repo, ".git", "index.lock"), "other writer");
  const locked = await call(repo, commit(repo)); failed(locked, /partial changes|conflict state/); assert.equal(locked.details.effectStarted, true);
  assert.equal(git(repo, "rev-parse", "HEAD"), before); rmSync(join(repo, ".git", "index.lock"));
});
function feature(repo, branch = "feature") {
  const path = join(`${repo}-worktrees`, branch); mkdirSync(`${repo}-worktrees`, { recursive: true });
  git(repo, "worktree", "add", "-b", branch, path);
  return path;
}
test("create/attach/remove use exact local resources and never automatic cleanup", async () => {
  const repo = fixture(); const path = join(`${repo}-worktrees`, "selected");
  success(await call(repo, { action: "createWorktree", checkout: repo, branch: "selected", baseBranch: "main", path }));
  assert.equal(git(path, "branch", "--show-current"), "selected");
  failed(await call(repo, { action: "createWorktree", checkout: repo, branch: "selected", baseBranch: "main", path: join(`${repo}-worktrees`, "second") }), /new branch/);
  writeFileSync(join(path, "untracked"), "keep");
  failed(await call(repo, { action: "removeWorktree", checkout: repo, path }), /clean worktree/); rmSync(join(path, "untracked"));
  success(await call(repo, { action: "removeWorktree", checkout: repo, path }));
  assert.equal(existsSync(path), false); assert.ok(git(repo, "rev-parse", "refs/heads/selected"));
  success(await call(repo, { action: "attachWorktree", checkout: repo, branch: "selected", baseBranch: "selected", path }));
  failed(await executeGitOperation(path, { action: "removeWorktree", checkout: repo, path }, approved), /caller checkout/);
  failed(await call(repo, { action: "removeWorktree", checkout: repo, path: repo }), /main or caller/);
});
test("rebase onto configured local target and merge non-FF; no cleanup", async () => {
  const repo = fixture(); const path = feature(repo); change(path); git(path, "add", "a"); git(path, "commit", "-m", "Feature");
  writeFileSync(join(repo, "b"), "target b\n"); git(repo, "add", "b"); git(repo, "commit", "-m", "Target");
  success(await call(repo, { action: "rebase", checkout: path, featureBranch: "feature" }));
  assert.equal(git(path, "show", "HEAD:b"), "target b");
  set(repo, { mergeChecks: [{ name: "Feature check", command: "test -f a" }] });
  const target = git(repo, "rev-parse", "HEAD"); const featureTip = git(path, "rev-parse", "HEAD");
  success(await call(repo, { action: "merge", checkout: repo, featureBranch: "feature" }));
  assert.equal(git(repo, "show", "-s", "--format=%P", "HEAD"), `${target} ${featureTip}`);
  assert.equal(existsSync(path), true);
});
test("preflight refuses clean filters before even status can run them", async () => {
  const repo = fixture(); const marker = join(root, "filter-was-run");
  writeFileSync(join(repo, ".gitattributes"), "a filter=unsafe\n");
  git(repo, "config", "filter.unsafe.clean", `touch '${marker}'; cat`);
  change(repo);
  failed(await call(repo, commit(repo), { pluginCard() { assert.fail("Filter repository must refuse before asking"); } }), /filter attributes/);
  assert.equal(existsSync(marker), false);
});

test("rebase never updates another branch and merge ignores configured no-commit/squash options", async () => {
  const repo = fixture(); const path = feature(repo); change(path); git(path, "add", "a"); git(path, "commit", "-m", "Feature");
  git(path, "branch", "other-feature"); const otherTip = git(path, "rev-parse", "refs/heads/other-feature");
  git(repo, "config", "rebase.updateRefs", "true");
  writeFileSync(join(repo, "b"), "advance\n"); git(repo, "add", "b"); git(repo, "commit", "-m", "Advance");
  success(await call(repo, { action: "rebase", checkout: path, featureBranch: "feature" }));
  assert.equal(git(repo, "rev-parse", "refs/heads/other-feature"), otherTip);
  git(repo, "config", "branch.main.mergeOptions", "--squash --no-commit");
  success(await call(repo, { action: "merge", checkout: repo, featureBranch: "feature" }));
  assert.equal(git(repo, "show", "-s", "--format=%P", "HEAD").split(" ").length, 2);
  assert.equal(existsSync(join(repo, ".git", "MERGE_HEAD")), false);
});

test("worktree and merge selections refuse changed branch tips after approval", async () => {
  const repo = fixture(); const path = join(`${repo}-worktrees`, "stale");
  failed(await call(repo, { action: "createWorktree", checkout: repo, branch: "stale", baseBranch: "main", path }, {
    pluginCard: async () => { git(repo, "commit", "--allow-empty", "-m", "Base moved"); return "approve"; },
  }), /Stale operation/);
  assert.equal(existsSync(path), false);
  const linked = feature(repo); change(linked); git(linked, "add", "a"); git(linked, "commit", "-m", "Feature");
  failed(await call(repo, { action: "merge", checkout: repo, featureBranch: "feature" }, {
    pluginCard: async () => { git(linked, "commit", "--allow-empty", "-m", "Feature moved"); return "approve"; },
  }), /Stale operation/);
});

test("disabling or Stop after native commit starts lets its write settle honestly", async () => {
  const repo = fixture(); change(repo); set(repo, { commit: "allow" });
  const shim = join(root, "git-shim"); mkdirSync(shim);
  const marker = join(shim, "started");
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  writeFileSync(join(shim, "git"), `#!${process.execPath}\nconst {spawnSync}=require('node:child_process'); const fs=require('node:fs'); const args=process.argv.slice(2); if(args.includes('commit')) { fs.writeFileSync(${JSON.stringify(marker)},'started'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250); } const result=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'}); process.exit(result.status ?? 1);`, { mode: 0o700 });
  const oldPath = process.env.PATH; process.env.PATH = `${shim}:${oldPath}`;
  try {
    const controller = new AbortController();
    const pending = call(repo, commit(repo), {}, controller.signal);
    const deadline = Date.now() + 10000;
    while (!existsSync(marker)) { assert.ok(Date.now() < deadline); await delay(10); }
    updatePluginSettings(gitWorkflowManifest, "global", repo, { enabled: false }, []);
    controller.abort();
    success(await pending);
    assert.equal(git(repo, "log", "-1", "--format=%s"), "Exact message");
    failed(await call(repo, commit(repo)), /disabled/);
  } finally { process.env.PATH = oldPath; }
});

test("cross-repository commits use selected permissions and checks, preserving the caller", async () => {
  const caller = fixture(); change(caller); git(caller, "add", "a");
  const callerHead = git(caller, "rev-parse", "HEAD"); const callerIndex = git(caller, "write-tree");
  const callerStatus = git(caller, "status", "--porcelain");
  set(caller, { commit: "deny", commitChecks: [{ name: "Caller check must not run", command: "exit 7" }] });
  const repo = fixture(); const linked = feature(repo);
  for (const checkout of [repo, linked]) for (const mode of ["files", "staged"]) {
    writeFileSync(join(checkout, "a"), `selected ${mode}\n`);
    if (mode === "staged") git(checkout, "add", "a");
    set(repo, { commit: "allow", commitChecks: [{ name: "Selected checkout", command: `test "$PWD" = '${checkout}'` }] });
    success(await call(caller, commit(checkout, { mode, files: mode === "files" ? ["a"] : undefined }), {}));
    assert.equal(git(checkout, "show", "HEAD:a"), `selected ${mode}`);
  }
  assert.equal(git(caller, "rev-parse", "HEAD"), callerHead);
  assert.equal(git(caller, "write-tree"), callerIndex);
  assert.equal(git(caller, "status", "--porcelain"), callerStatus);
});

test("all six actions honor the selected repository's Deny before UI, checks or effects", async () => {
  const caller = fixture(); const repo = fixture(); change(repo);
  const before = git(repo, "rev-parse", "HEAD"); const marker = join(root, "denied-check");
  const path = join(`${repo}-worktrees`, "selected");
  const operations = [commit(repo),
    ...["rebase", "merge"].map((action) => ({ action, checkout: repo, featureBranch: "feature" })),
    ...["createWorktree", "attachWorktree"].map((action) => ({ action, checkout: repo, branch: "selected", baseBranch: "main", path })),
    { action: "removeWorktree", checkout: repo, path }];
  for (const op of operations) {
    set(caller, { [op.action]: "allow" });
    set(repo, { [op.action]: "deny", commitChecks: [{ name: "Must not run", command: `touch '${marker}'` }], mergeChecks: [{ name: "Must not run", command: `touch '${marker}'` }] });
    const result = await call(caller, op, { pluginCard() { assert.fail("UI on selected-project Deny"); } });
    failed(result, /denied/); assert.equal(result.details.effectStarted, false); assert.equal(result.details.checksStarted, false);
  }
  assert.equal(git(repo, "rev-parse", "HEAD"), before);
  assert.equal(existsSync(marker), false); assert.equal(existsSync(path), false);
});

test("cross-repository pending approvals follow selected settings, not caller project changes", async () => {
  for (const changed of [{ commit: "deny" }, { commit: "allow" }, { commitChecks: [{ name: "New check", command: "printf selected" }] }]) {
    const caller = fixture(); const repo = fixture(); change(repo); const before = git(repo, "rev-parse", "HEAD");
    set(caller, { commit: "allow" });
    failed(await call(caller, commit(repo), { pluginCard: async (_id, card, signal) => {
      assert.equal(card.fields.find((field) => field.label === "Checkout").value, repo);
      set(caller, { commit: "deny", commitChecks: [{ name: "Caller", command: "exit 7" }] });
      assert.equal(signal.aborted, false);
      set(repo, changed); assert.equal(signal.aborted, true); return null;
    } }), /not approved/);
    assert.equal(git(repo, "rev-parse", "HEAD"), before);
  }
  const caller = fixture(); const repo = fixture(); change(repo);
  success(await call(caller, commit(repo), { pluginCard: async (_id, _card, signal) => {
    change(caller); set(caller, { commit: "deny" }); assert.equal(signal.aborted, false); return "approve";
  } }));
  writeFileSync(join(repo, "a"), "next edit\n");
  failed(await call(caller, commit(repo), { pluginCard: async () => { writeFileSync(join(repo, "a"), "late edit\n"); return "approve"; } }), /Stale operation/);
  set(repo, { commitChecks: [{ name: "State-changing selected check", command: "printf modified > a" }] });
  const before = git(repo, "rev-parse", "HEAD");
  const result = await call(caller, commit(repo)); failed(result, /Stale operation/);
  assert.equal(result.details.checksStarted, true); assert.equal(result.details.effectStarted, false);
  assert.equal(git(repo, "rev-parse", "HEAD"), before);
});

test("all Git tools operate across repositories and from non-Git caller directories", async () => {
  for (const caller of [fixture(), join(root, "non-git-caller")]) {
    mkdirSync(caller, { recursive: true });
    const callerIsGit = caller !== join(root, "non-git-caller");
    const callerHead = callerIsGit ? git(caller, "rev-parse", "HEAD") : null;
    if (callerIsGit) {
      change(caller);
      set(caller, { commit: "deny", rebase: "deny", merge: "deny", createWorktree: "deny", attachWorktree: "deny", removeWorktree: "deny",
        targetBranch: "caller-only", mergeMethod: "ff-only", mergeChecks: [{ name: "Caller check must not run", command: "exit 7" }] });
    }
    const repo = fixture(); git(repo, "branch", "-m", "delivery"); change(repo);
    set(repo, { targetBranch: "delivery", commitChecks: [{ name: "Selected commit checkout", command: `test "$PWD" = '${repo}'` }] });
    success(await call(caller, commit(repo)));
    const path = join(`${repo}-worktrees`, "selected");
    success(await call(caller, { action: "createWorktree", checkout: repo, branch: "selected", baseBranch: "delivery", path }));
    writeFileSync(join(path, "a"), "feature a\n"); git(path, "add", "a"); git(path, "commit", "-m", "Feature");
    writeFileSync(join(repo, "b"), "target b\n"); git(repo, "add", "b"); git(repo, "commit", "-m", "Target");
    success(await call(caller, { action: "rebase", checkout: path, featureBranch: "selected" }));
    assert.equal(git(path, "show", "HEAD:b"), "target b");
    const target = git(repo, "rev-parse", "HEAD"); const featureTip = git(path, "rev-parse", "HEAD");
    set(repo, { mergeChecks: [{ name: "Selected feature checkout", command: `test "$PWD" = '${path}'` }] });
    success(await call(caller, { action: "merge", checkout: repo, featureBranch: "selected" }));
    assert.equal(git(repo, "show", "-s", "--format=%P", "HEAD"), `${target} ${featureTip}`);
    assert.equal(existsSync(path), true);
    success(await call(caller, { action: "removeWorktree", checkout: repo, path }));
    assert.equal(existsSync(path), false); assert.equal(git(repo, "rev-parse", "refs/heads/selected"), featureTip);
    success(await call(caller, { action: "attachWorktree", checkout: repo, branch: "selected", baseBranch: "selected", path }));
    assert.equal(git(path, "rev-parse", "HEAD"), featureTip);
    if (callerIsGit) { assert.equal(git(caller, "rev-parse", "HEAD"), callerHead); assert.equal(git(caller, "status", "--porcelain"), "M a"); }
    else assert.equal(existsSync(join(caller, ".git")), false);
  }
});

test("selected checkout roots remain explicit and approvals cannot follow retargeted aliases", async () => {
  const caller = fixture(); const repo = fixture(); change(repo); const before = git(repo, "rev-parse", "HEAD");
  const nested = join(repo, "nested"); mkdirSync(nested);
  const plain = join(root, "not-a-repo"); mkdirSync(plain);
  for (const checkout of [".", nested, plain, join(repo, ".git")]) {
    const result = await call(caller, commit(checkout), { pluginCard() { assert.fail("UI for invalid checkout"); } });
    assert.equal(result.isError, true); assert.equal(result.details.effectStarted, false);
  }
  rmSync(nested, { recursive: true });
  const other = fixture(); change(other); const otherBefore = git(other, "rev-parse", "HEAD");
  const alias = join(root, "checkout-alias"); symlinkSync(repo, alias, "dir");
  failed(await call(caller, commit(alias), { pluginCard: async (_id, card) => {
    assert.equal(card.fields.find((field) => field.label === "Checkout").value, repo);
    rmSync(alias); symlinkSync(other, alias, "dir"); return "approve";
  } }), /Stale operation/);
  assert.equal(git(repo, "rev-parse", "HEAD"), before); assert.equal(git(other, "rev-parse", "HEAD"), otherBefore);
});

test("related branch checkouts cannot escape the selected repository through a symlink", async () => {
  const caller = fixture(); const repo = fixture(); const linked = feature(repo); const other = fixture();
  renameSync(linked, `${linked}-backup`); symlinkSync(other, linked, "dir");
  failed(await call(caller, { action: "merge", checkout: repo, featureBranch: "feature" }, { pluginCard() { assert.fail("UI for foreign related checkout"); } }), /selected repository/);
});

test("worktree removal still protects the caller checkout when its cwd is a subdirectory", async () => {
  const repo = fixture(); const path = feature(repo); const nested = join(path, "nested"); mkdirSync(nested);
  writeFileSync(join(nested, "tracked"), "keep\n"); git(path, "add", "nested"); git(path, "commit", "-m", "Nested caller");
  failed(await call(nested, { action: "removeWorktree", checkout: repo, path }), /caller checkout/);
  assert.equal(existsSync(nested), true);
});

test("FF-only refuses divergence without fallback; conflicts remain explicit", async () => {
  for (const action of ["merge", "rebase"]) {
    const repo = fixture(); const path = feature(repo); change(path); git(path, "add", "a"); git(path, "commit", "-m", "Feature");
    writeFileSync(join(repo, "a"), "target conflict\n"); git(repo, "add", "a"); git(repo, "commit", "-m", "Target");
    if (action === "merge") {
      set(repo, { mergeMethod: "ff-only" }); failed(await call(repo, { action, checkout: repo, featureBranch: "feature" }), /Not possible to fast-forward/);
      assert.equal(existsSync(join(repo, ".git", "MERGE_HEAD")), false); set(repo, { mergeMethod: "non-ff" });
    }
    const checkout = action === "merge" ? repo : path;
    const result = await call(repo, { action, checkout, featureBranch: "feature" });
    failed(result, /conflict/i); assert.equal(result.details.effectStarted, true); assert.match(git(checkout, "status", "--porcelain"), /UU a/);
    failed(await call(repo, { action, checkout, featureBranch: "feature" }), /Conflicting Git operation/);
  }
});
