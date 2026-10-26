import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { finished } from "node:stream/promises";
import { lstatSync } from "node:fs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";
import { createCommitGate } from "./commit-gate.fixture.mjs";
const root = mkdtempSync(join(tmpdir(), "pi-git-plugin-tests-"));
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
after(() => { if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir; rmSync(root, { recursive: true, force: true }); });
const jiti = createJiti(import.meta.url);
const { executeGitOperation: executeWithReceipts } = await jiti.import("./server.ts");
const { OPERATION_MARKERS } = await jiti.import("./operation-paths.ts");
const { preparePluginReview, reviewEntry, reviewPreview, reviewManifest, reviewStream } = await jiti.import("../../lib/plugins/review-store.ts");
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
test("five browser preview/reject tuples preserve selected native resources and exact read-only cards", async () => {
  // Native storage download API, not HTTP/browser historical-download proof.
  const download = async (ref, entry) => {
    const stream = await reviewStream(ref, entry);
    if (!stream) return Buffer.alloc(0);
    const closed = finished(stream, { cleanup: true }); void closed.catch(() => {});
    const chunks = [];
    try { for await (const chunk of stream) chunks.push(Buffer.from(chunk)); }
    finally { stream.destroy(); await closed; }
    assert.equal(stream.closed, true); assert.equal(stream.fd, null);
    return Buffer.concat(chunks);
  };
  // Frozen command resources, in the original order; one shared native history.
  const repo = fixture(); git(repo, "branch", "comparison-base");
  git(repo, "branch", "target"); git(repo, "switch", "-c", "feature");
  change(repo); git(repo, "add", "a"); git(repo, "commit", "-m", "Feature");
  const target = join(`${repo}-worktrees`, "target");
  git(repo, "worktree", "add", target, "target");
  writeFileSync(join(target, "b"), "target b\n"); git(target, "add", "b"); git(target, "commit", "-m", "Target");
  set(repo, { targetBranch: "target" });
  const destination = join(`${repo}-worktrees`, "preview-new");
  const identity = path => { const s = lstatSync(path); return [s.dev, s.ino, s.mode]; };
  const state = () => ({ refs: git(repo, "show-ref"), registrations: git(repo, "worktree", "list", "--porcelain"),
    checkouts: [repo, target].map(path => ({ path, identity: identity(path), head: git(path, "rev-parse", "HEAD"),
      status: git(path, "status", "--porcelain"), index: readFileSync(git(path, "rev-parse", "--path-format=absolute", "--git-path", "index")).toString("hex"),
      files: ["a", "b"].map(name => [name, identity(join(path, name)), readFileSync(join(path, name)).toString("hex")]) })),
    destination: existsSync(destination) });
  for (const [action, title] of [["rebase", "Git rebase"], ["merge", "Git merge"], ["createWorktree", "Create Git worktree"],
    ["attachWorktree", "Attach Git worktree"], ["removeWorktree", "Remove Git worktree"]]) {
    const op = action === "rebase" || action === "merge" ? { action, checkout: action === "merge" ? target : repo, featureBranch: "feature" }
      : action === "removeWorktree" ? { action, checkout: repo, path: target }
      : { action, checkout: repo, branch: action === "attachWorktree" ? "comparison-base" : "preview-new",
        baseBranch: action === "attachWorktree" ? "comparison-base" : "target", path: destination };
    const before = state(); let cards = 0;
    const result = await call(repo, op, { pluginCard: async (_id, card) => {
      cards++; assert.equal(card.title, title); assert.equal(card.patch, undefined, "reference-only review");
      assert.equal(card.fields.find(f => f.label === "Checkout").value, op.checkout);
      assert.equal(card.fields.find(f => f.label === "Branch").value, action === "merge" ? "target" : "feature");
      const fields = Object.fromEntries(card.fields.map(f => [f.label, f.value]));
      const notes = card.sections.find(s => s.title === "Operation notes").text;
      assert.match(notes, /unsigned and hook-free/); assert.match(card.scope, /entire selected operation/);
      if (action === "rebase" || action === "merge") {
        assert.equal(fields["Feature → target"], "feature → target");
        assert.match(notes, /not a predicted rebase\/merge result/);
      } else if (action === "removeWorktree") {
        assert.equal(fields["Remove worktree"], target); assert.match(notes, /Branch and session history remain/);
      } else {
        assert.equal(fields["Base branch"], op.baseBranch); assert.equal(fields["Worktree branch"], op.branch);
        assert.equal(fields.Destination, destination);
      }
      // Bundle identity includes data, entry metadata AND offsets. Validate it
      // through the public owner API; it is not SHA256(downloaded data alone).
      assert.deepEqual(await reviewManifest(card.review, "git-workflow"), {
        version: 1, pluginId: "git-workflow", operationId: card.operationId,
        entries: card.review.entries, bytes: card.review.bytes, sha256: card.review.sha256,
      });
      const entries = []; let offset = 0;
      for (let id = 0; id < card.review.entries; id++) {
        const entry = await reviewEntry(card.review, id), body = await reviewPreview(card.review, entry);
        assert.equal(body.complete, true);
        const bytes = Buffer.from(body.text);
        assert.equal(entry.start, offset); assert.equal(bytes.length, entry.bytes); offset += entry.bytes;
        assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
        assert.deepEqual(await download(card.review, entry), bytes);
        entries.push({ entry, text: body.text });
      }
      const exact = JSON.parse(entries[0].text);
      assert.deepEqual(exact.operation, op); assert.equal(exact.presentation.operationId, card.operationId);
      assert.deepEqual(exact.presentation.fields, card.fields);
      const bytes = Buffer.from(entries.map(e => e.text).join(""));
      assert.equal(bytes.length, card.review.bytes);
      assert.deepEqual(await download(card.review), bytes, "complete native download preserves all exact entry bytes");
      const patch = entries.filter(e => e.entry.kind === "patch").map(e => e.text).join("");
      if (action === "merge" || action === "rebase") {
        const base = git(repo, "merge-base", "target", "feature"), tip = git(repo, "rev-parse", "feature");
        assert.deepEqual(exact.comparison, { before: base, after: tip });
        const expected = execFileSync("git", ["-C", repo, "diff", "--binary", "--no-color", "--no-ext-diff", "--no-textconv", base, tip, "--"], { encoding: "utf8" });
        assert.equal(patch, expected); assert.notEqual(patch, "");
      } else { assert.equal(patch, ""); assert.equal(exact.comparison, undefined); }
      return "reject";
    } });
    failed(result, /not approved/); assert.equal(cards, 1);
    assert.equal(result.details.effectStarted, false); assert.equal(result.details.checksStarted, false);
    assert.deepEqual(state(), before, `${action}: rejection has no native effect`);
  }
});

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
for (const action of ["rebase", "merge"]) for (const dirty of [false, true]) test(`${action} ${dirty ? "dirty" : "clean"} wrong-checkout guidance names the required branch and path without checks or effects`, async () => {
  const repo = fixture("-quote ' µ"); const path = feature(repo);
  change(path); git(path, "add", "a"); git(path, "commit", "-m", "Feature");
  const targetTip = git(repo, "rev-parse", "HEAD"); const featureTip = git(path, "rev-parse", "HEAD");
  set(repo, { mergeChecks: [{ name: "Must not run", command: "exit 7" }] });
  const selected = action === "merge" ? path : repo;
  const required = action === "merge" ? repo : path;
  const branch = action === "merge" ? "main" : "feature";
  const selectedBranch = action === "merge" ? "feature" : "main";
  if (dirty) writeFileSync(join(selected, "a"), "uncommitted wrong-checkout edit\n");
  const selectedStatus = git(selected, "status", "--porcelain");
  const selectedIndex = git(selected, "write-tree");
  const result = await call(repo, { action, checkout: selected, featureBranch: "feature" }, {
    pluginCard() { assert.fail("Wrong checkout must refuse before approval"); },
  });
  failed(result, new RegExp(`git_${action} checkout must be`));
  const text = result.content[0].text;
  assert.ok(text.includes(`${action === "merge" ? "target" : "feature"} branch ${JSON.stringify(branch)}`), text);
  assert.ok(text.includes(`selected branch ${JSON.stringify(selectedBranch)} at ${JSON.stringify(selected)}`), text);
  assert.ok(text.includes(`Use checkout: ${JSON.stringify(required)}`), text);
  assert.equal(result.details.checksStarted, false); assert.equal(result.details.effectStarted, false);
  assert.equal(git(repo, "rev-parse", "HEAD"), targetTip); assert.equal(git(path, "rev-parse", "HEAD"), featureTip);
  assert.equal(git(repo, "branch", "--show-current"), "main"); assert.equal(git(path, "branch", "--show-current"), "feature");
  assert.equal(git(selected, "status", "--porcelain"), selectedStatus);
  assert.equal(git(selected, "write-tree"), selectedIndex); assert.equal(git(required, "status", "--porcelain"), "");
});

test("merge wrong-checkout guidance handles a target with no registered checkout without creating one", async () => {
  const repo = fixture(); const path = feature(repo);
  git(repo, "switch", "-c", "other");
  const registrations = git(repo, "worktree", "list", "--porcelain");
  const result = await call(repo, { action: "merge", checkout: path, featureBranch: "feature" }, {
    pluginCard() { assert.fail("Missing target checkout must refuse before approval"); },
  });
  failed(result, /git_merge checkout must be.*target branch "main"/);
  assert.match(result.content[0].text, /no registered checkout; arrange one explicitly/);
  assert.doesNotMatch(result.content[0].text, /Use checkout:/);
  assert.equal(result.details.checksStarted, false); assert.equal(result.details.effectStarted, false);
  assert.equal(git(repo, "worktree", "list", "--porcelain"), registrations);
  assert.equal(git(repo, "branch", "--show-current"), "other"); assert.equal(git(path, "branch", "--show-current"), "feature");
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

// Exercise the same guard after human approval, after checks and at final dispatch.
function mergeMutationUi(stage, mutate) {
  let changed = false;
  const once = () => { if (!changed) { changed = true; mutate(); } };
  return {
    pluginCard: async () => { if (stage === "approval") once(); return "approve"; },
    operationReceipt(id, receipt) {
      snapshotOperationReceipt(id, receipt, 1);
      if (stage === "checks" && receipt.phase === "checking" && receipt.checks.every((check) => check.status === "passed")) once();
      if (stage === "dispatch" && receipt.phase === "executing") once();
    },
  };
}
for (const stage of ["approval", "checks", "dispatch"]) test(`merge ignores unrelated worktree changes at ${stage}`, async () => {
  const repo = fixture(); const path = feature(repo);
  change(path); git(path, "add", "a"); git(path, "commit", "-m", "Feature");
  const other = feature(repo, "unrelated"); const removed = feature(repo, "removed");
  const targetTip = git(repo, "rev-parse", "HEAD"); const featureTip = git(path, "rev-parse", "HEAD");
  set(repo, { mergeChecks: [{ name: "Feature check", command: "test -f a" }] });
  let unrelatedTip;
  success(await call(repo, { action: "merge", checkout: repo, featureBranch: "feature" }, mergeMutationUi(stage, () => {
    git(other, "commit", "--allow-empty", "-m", "Other session");
    git(other, "rebase", "feature");
    git(other, "switch", "-c", "other-branch");
    git(repo, "worktree", "lock", other);
    feature(repo, "new-worktree");
    git(repo, "worktree", "remove", removed);
    unrelatedTip = git(other, "rev-parse", "HEAD");
  })));
  assert.ok(unrelatedTip, "mutation checkpoint reached");
  assert.equal(git(repo, "show", "-s", "--format=%P", "HEAD"), `${targetTip} ${featureTip}`);
  assert.equal(git(path, "rev-parse", "HEAD"), featureTip);
  assert.equal(git(other, "rev-parse", "HEAD"), unrelatedTip);
  assert.equal(git(other, "branch", "--show-current"), "other-branch");
});
for (const stage of ["approval", "checks", "dispatch"]) for (const selected of ["feature", "target"]) {
  test(`merge refuses changed ${selected} tip at ${stage}`, async () => {
    const repo = fixture(); const path = feature(repo);
    change(path); git(path, "add", "a"); git(path, "commit", "-m", "Feature");
    set(repo, { mergeChecks: [{ name: "Feature check", command: "test -f a" }] });
    let targetTip;
    const result = await call(repo, { action: "merge", checkout: repo, featureBranch: "feature" }, mergeMutationUi(stage, () => {
      git(selected === "feature" ? path : repo, "commit", "--allow-empty", "-m", "Selected branch moved");
      targetTip = git(repo, "rev-parse", "HEAD");
    }));
    failed(result, /Stale operation/);
    assert.ok(targetTip, "mutation checkpoint reached");
    assert.equal(result.details.effectStarted, false);
    assert.equal(git(repo, "rev-parse", "HEAD"), targetTip);
  });
}
for (const selected of ["feature", "target"]) for (const mutation of ["dirty", "switch", "move", "lock"]) {
  test(`merge still binds ${selected} checkout ${mutation}`, async () => {
    const repo = fixture(); const path = feature(repo);
    change(path); git(path, "add", "a"); git(path, "commit", "-m", "Feature");
    const targetTip = git(repo, "rev-parse", "HEAD");
    const source = selected === "feature" ? path : repo;
    const result = await call(repo, { action: "merge", checkout: repo, featureBranch: "feature" }, mergeMutationUi("approval", () => {
      if (mutation === "dirty") writeFileSync(join(source, "b"), "uncommitted edit\n");
      if (mutation === "switch") git(source, "switch", "-c", "replacement");
      if (mutation === "move") {
        if (selected === "feature") git(repo, "worktree", "move", path, `${path}-moved`);
        else { git(repo, "switch", "-c", "replacement"); git(path, "worktree", "add", join(`${repo}-worktrees`, "new-target"), "main"); }
      }
      // Git does not support locking the primary checkout.
      if (mutation === "lock") {
        if (selected === "feature") git(repo, "worktree", "lock", path);
        else writeFileSync(git(repo, "rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"), "");
      }
    }));
    failed(result, /Stale operation|must be clean|checkout must be|Conflicting Git operation/);
    assert.equal(result.details.effectStarted, false);
    assert.equal(git(repo, "rev-parse", "refs/heads/main"), targetTip);
  });
}

test("disabling or Stop after native commit starts lets its write settle honestly", async () => {
  const repo = fixture(); change(repo); set(repo, { commit: "allow" });
  const before = git(repo, "rev-parse", "HEAD");
  const shim = join(root, "git-shim"); mkdirSync(shim);
  const marker = join(shim, "started");
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  // Only commit enters the IPC gate; no per-preflight Node launch or settling sleep.
  const gate = await createCommitGate(shim, { gitPath: realGit, nodePath: process.execPath,
    shellPath: execFileSync("which", ["sh"], { encoding: "utf8" }).trim(), marker });
  const oldPath = process.env.PATH; process.env.PATH = `${shim}:${oldPath}`;
  const controller = new AbortController();
  let pending; const failures = [];
  try {
    pending = call(repo, commit(repo), {}, controller.signal);
    await Promise.race([gate.ready, pending.then(() => assert.fail("Operation settled without entering the native gate"))]);
    assert.equal(readFileSync(marker, "utf8"), "started");
    assert.equal(git(repo, "rev-parse", "HEAD"), before, "Real commit must remain held until release");
    updatePluginSettings(gitWorkflowManifest, "global", repo, { enabled: false }, []);
    controller.abort();
    gate.release();
    assert.deepEqual(await gate.closed, { code: 0, signal: null }, "Real Git child must close after release");
    success(await pending); // Joins the actual shim close AND executor reporting.
    assert.equal(git(repo, "log", "-1", "--format=%s"), "Exact message");
    failed(await call(repo, commit(repo)), /disabled/);
  } catch (error) { failures.push(error); }
  finally {
    controller.abort(); gate.release();
    try { await pending; } catch (error) { if (!failures.includes(error)) failures.push(error); }
    process.env.PATH = oldPath;
    try { await gate.close(); } catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Native commit gate assertion/settlement/cleanup failed");
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

// Original cross-approve/cross-cancel conjunction in the EXISTING native repo
// fixture. No SDK session/model startup and no new fixture/seed implementation.
test("original foreign Ask/PWD approval and selected Deny cancellation preserve caller, source and both candidate files", async () => {
  const { readPluginSettings } = await jiti.import('../../lib/plugins/settings.ts');
  const caller = fixture(), selected = fixture('-foreign');
  git(selected, 'branch', '-m', 'delivery');
  const session = { id: '55555555-5555-4555-8555-555555555555', cwd: caller };
  updatePluginSettings(gitWorkflowManifest, 'session', caller,
    gitWorkflowManifest.presets['always-ask'].values, [], undefined, session);
  updatePluginSettings(gitWorkflowManifest, 'global', caller, { targetBranch: 'target' }, [], undefined, session);
  const checks = [{ name: 'Selected checkout check', command: `test "$PWD" = '${selected}'` }];
  const callerCheck = [{ name: 'Caller check must not run', command: 'exit 7' }];
  const errors = [], receipts = [], cards = [];
  const remember = error => { if (!errors.includes(error)) errors.push(error); };
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const callerState = () => ({ head: git(caller, 'rev-parse', 'HEAD'), index: git(caller, 'write-tree'),
    status: git(caller, 'status', '--porcelain'), a: readFileSync(join(caller, 'a'), 'utf8'),
    draft: readFileSync(join(caller, 'draft.txt'), 'utf8'), second: readFileSync(join(caller, 'second-draft.txt'), 'utf8') });
  // These are operation inputs copied from the existing browser command, NOT
  // changes to fixture() or to its tracked base/history seeds.
  const writeCandidate = (checkout, mode) => {
    const lines = Array.from({ length: 5000 }, (_, index) => `Plugin context ${index + 1}\n`);
    lines[49] = `Plugin whole-file candidate ${mode}\n`;
    lines[4499] = `Plugin distant candidate ${mode}\n`;
    writeFileSync(join(checkout, 'draft.txt'), lines.join(''));
    writeFileSync(join(checkout, 'second-draft.txt'), `Second plugin candidate ${mode}\n`);
    return { action: 'commit', checkout, mode: 'files', files: ['draft.txt', 'second-draft.txt'], message: `Plugin browser commit ${mode}` };
  };
  let pending;
  try {
    for (const width of [1280, 390]) {
      // Preserve original dirty caller premise and exact candidate write order.
      change(caller); git(caller, 'add', 'a');
      writeCandidate(caller, `cancel-${width}`);
      set(caller, { commit: 'deny', commitChecks: callerCheck });
      set(selected, { commit: 'ask', commitChecks: checks });
      const beforeCaller = callerState(), beforeSelected = git(selected, 'rev-parse', 'HEAD');
      const op = writeCandidate(selected, `cross-approve-${width}`);
      const origin = readPluginSettings(gitWorkflowManifest, selected, undefined, session);
      assert.equal(origin.sessionApplicable, false);
      assert.deepEqual(origin.sessionOverrides, {});
      assert.equal(origin.effective.commit, 'ask'); assert.equal(origin.sources.commit, 'project');
      assert.deepEqual(origin.effective.commitChecks, checks);
      assert.equal(origin.global.targetBranch, 'target');
      const own = readPluginSettings(gitWorkflowManifest, caller, undefined, session);
      assert.equal(own.effective.commit, 'deny'); assert.deepEqual(own.effective.commitChecks, callerCheck);
      const from = receipts.length, cardFrom = cards.length;
      const ui = {
        operationReceipt(id, receipt) { receipts.push(snapshotOperationReceipt(id, receipt, receipts.length + 1)); },
        async pluginCard(id, card, signal) {
          try {
            cards.push(card);
            assert.equal(id, 'git-workflow'); assert.equal(signal.aborted, false);
            assert.equal(card.fields.find(field => field.label === 'Checkout').value, selected);
            assert.equal(card.fields.find(field => field.label === 'Branch').value, 'delivery');
            assert.deepEqual(card.sections.find(section => section.title === 'Required checks').fields,
              [{ label: checks[0].name, value: checks[0].command, code: true }]);
            assert.equal(card.sections.find(section => section.title === 'Commit message').text, op.message);
            assert.equal(card.review.operationId, card.operationId);
            const entry = await reviewEntry(card.review, 0);
            const exact = JSON.parse((await reviewPreview(card.review, entry)).text);
            assert.deepEqual(exact.operation, op);
            assert.equal(exact.presentation.operationId, card.operationId);
            assert.equal(exact.comparison.before, beforeSelected);
            assert.equal(receipts[from].authorization.revision, digest(origin));
            return 'approve';
          } catch (error) { remember(error); throw error; }
        },
      };
      pending = executeGitOperation(caller, op, ui, undefined, session);
      const approvedResult = await pending; pending = undefined;
      if (errors.length) throw errors[0];
      success(approvedResult);
      assert.equal(cards.length, cardFrom + 1);
      assert.deepEqual(callerState(), beforeCaller);
      assert.notEqual(git(selected, 'rev-parse', 'HEAD'), beforeSelected);
      assert.equal(git(selected, 'show', 'HEAD:draft.txt'), readFileSync(join(selected, 'draft.txt'), 'utf8').trimEnd());
      assert.equal(git(selected, 'show', 'HEAD:second-draft.txt'), `Second plugin candidate cross-approve-${width}`);
      const terminal = receipts.at(-1), nativeCard = cards.at(-1);
      assert.equal(terminal.phase, 'succeeded');
      assert.equal(terminal.operationId, nativeCard.operationId);
      assert.equal(terminal.card.review.id, nativeCard.review.id);
      assert.equal(terminal.authorization.mode, 'ask'); assert.equal(terminal.authorization.source, 'project');
      assert.equal(terminal.authorization.decision, 'user-approved');
      assert.equal(terminal.authorization.revision, digest(origin));

      const committed = git(selected, 'rev-parse', 'HEAD');
      const cancelOp = writeCandidate(selected, `cross-cancel-${width}`);
      const cancelOrigin = readPluginSettings(gitWorkflowManifest, selected, undefined, session);
      let cancelledCard;
      pending = executeGitOperation(caller, cancelOp, {
        operationReceipt(id, receipt) { receipts.push(snapshotOperationReceipt(id, receipt, receipts.length + 1)); },
        async pluginCard(id, card, signal) {
          try {
            cancelledCard = card;
            assert.equal(id, 'git-workflow'); assert.equal(signal.aborted, false);
            assert.equal(card.fields.find(field => field.label === 'Checkout').value, selected);
            assert.deepEqual(card.sections.find(section => section.title === 'Required checks').fields,
              [{ label: checks[0].name, value: checks[0].command, code: true }]);
            assert.equal(card.sections.find(section => section.title === 'Commit message').text, cancelOp.message);
            set(caller, { commit: 'allow' });
            assert.equal(signal.aborted, false, 'caller Allow does not cancel selected Ask');
            assert.equal(digest(readPluginSettings(gitWorkflowManifest, selected, undefined, session)), digest(cancelOrigin));
            set(selected, { commit: 'deny' });
            assert.equal(signal.aborted, true, 'selected project Deny cancels the ORIGINAL pending request');
            return null;
          } catch (error) { remember(error); throw error; }
        },
      }, undefined, session);
      const refused = await pending; pending = undefined;
      if (errors.length) throw errors[0];
      failed(refused, /not approved/);
      assert.equal(refused.details.effectStarted, false); assert.equal(refused.details.checksStarted, false);
      assert.equal(git(selected, 'rev-parse', 'HEAD'), committed);
      assert.deepEqual(callerState(), beforeCaller);
      assert.equal(readFileSync(join(selected, 'second-draft.txt'), 'utf8'), `Second plugin candidate cross-cancel-${width}\n`);
      assert.equal(receipts.at(-1).operationId, cancelledCard.operationId);
      assert.equal(receipts.at(-1).card.review.id, cancelledCard.review.id);
      assert.equal(receipts.at(-1).authorization.revision, digest(cancelOrigin));
      updatePluginSettings(gitWorkflowManifest, 'project', caller, {}, ['commit', 'commitChecks'], undefined, session);
      assert.equal(readPluginSettings(gitWorkflowManifest, selected, undefined, session).effective.commit, 'deny');
    }
  } catch (error) { remember(error); }
  finally {
    // No manually held peers exist here. Await the admitted ORIGINAL executor,
    // which includes selected checks/native child/reporting and callback work.
    if (pending) { try { await pending; } catch (error) { remember(error); } }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'Original selected Ask/check/cancellation conjunction failed');
});

// Own Cancel is a null UI result with a LIVE signal, not Reject, policy abort
// or Stop. Exact selected-file inputs are native operations in the existing
// fixture; its OIDs/session IDs never substitute for installed SDK authority.
test('original own Cancel keeps its live signal, builtin Ask session origin and complete native state', async () => {
  const { readPluginSettings } = await jiti.import('../../lib/plugins/settings.ts');
  const repo = fixture('-own-cancel');
  const errors = [], receipts = [];
  const remember = error => { if (!errors.includes(error)) errors.push(error); };
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const files = ['draft.txt', 'second-draft.txt'];
  const writeCandidate = mode => {
    const lines = Array.from({ length: 5000 }, (_, index) => `Plugin context ${index + 1}\n`);
    lines[49] = `Plugin whole-file candidate ${mode}\n`;
    lines[4499] = `Plugin distant candidate ${mode}\n`;
    writeFileSync(join(repo, files[0]), lines.join(''));
    writeFileSync(join(repo, files[1]), `Second plugin candidate ${mode}\n`);
    return { action: 'commit', checkout: repo, mode: 'files', files, message: `Plugin browser commit ${mode}` };
  };
  const state = () => {
    // Complete our own status refresh BEFORE reading the raw index snapshot.
    const status = git(repo, 'status', '--porcelain');
    return { head: git(repo, 'rev-parse', 'HEAD'), status,
      index: readFileSync(git(repo, 'rev-parse', '--path-format=absolute', '--git-path', 'index')),
      files: files.map(file => readFileSync(join(repo, file))),
      unrelated: ['a', 'b'].map(file => readFileSync(join(repo, file))) };
  };
  let pending;
  try {
    for (const width of [1280, 390]) {
      const session = { id: `own-cancel-${width}`, cwd: repo };
      // Explicit selected-file preimage setup, not a rewrite of fixture() or
      // the installed cross-profile HEAD/tree/Allow/Large history.
      writeCandidate(`reconnect-${width}`);
      git(repo, 'add', '--', ...files);
      git(repo, 'commit', '-m', `Native own Cancel preimage ${width}`);
      const mode = `cancel-${width}`, op = writeCandidate(mode);
      const global = readPluginSettings(gitWorkflowManifest, repo).global;
      updatePluginSettings(gitWorkflowManifest, 'global', repo,
        { enabled: true, targetBranch: 'target' }, Object.keys(global).filter(key => !['enabled', 'targetBranch'].includes(key)), undefined, session);
      updatePluginSettings(gitWorkflowManifest, 'session', repo,
        gitWorkflowManifest.presets['always-ask'].values, [], undefined, session);
      updatePluginSettings(gitWorkflowManifest, 'session', repo, {}, ['commit'], undefined, session);
      const origin = readPluginSettings(gitWorkflowManifest, repo, undefined, session);
      const sessionValues = { ...gitWorkflowManifest.presets['always-ask'].values };
      delete sessionValues.commit;
      assert.equal(origin.sessionId, session.id);
      assert.equal(origin.sessionProject, git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
      assert.equal(origin.project, origin.sessionProject);
      assert.equal(origin.sessionApplicable, true, 'own Cancel carries the actual own session project');
      assert.deepEqual(origin.global, { enabled: true, targetBranch: 'target' });
      assert.deepEqual(origin.overrides, {});
      assert.deepEqual(origin.sessionOverrides, sessionValues);
      assert.equal(origin.effective.commit, 'ask');
      assert.equal(origin.sources.commit, 'builtin', 'original UI resets session commit to builtin, not fixture-global Ask');
      assert.deepEqual(origin.effective.commitChecks, []);
      assert.equal(origin.sources.commitChecks, 'builtin');
      assert.equal(origin.sources.mergeChecks, 'builtin');
      assert.equal(origin.sources.enabled, 'global');
      assert.equal(origin.sources.targetBranch, 'global');
      for (const key of Object.keys(sessionValues)) assert.equal(origin.sources[key], 'session');
      const before = state(), from = receipts.length;
      let suppliedCard, suppliedSignal, callbacks = 0;
      pending = executeGitOperation(repo, op, {
        operationReceipt(id, receipt) {
          try { assert.equal(id, 'git-workflow'); receipts.push(snapshotOperationReceipt(id, receipt, receipts.length + 1)); }
          catch (error) { remember(error); throw error; }
        },
        async pluginCard(id, card, signal) {
          try {
            callbacks++; suppliedCard = card; suppliedSignal = signal;
            assert.equal(id, 'git-workflow');
            assert.equal(signal.aborted, false, 'manual own Cancel begins with a live policy signal');
            assert.equal(card.fields.find(field => field.label === 'Checkout').value, repo);
            assert.equal(card.fields.find(field => field.label === 'Branch').value, 'main');
            assert.equal(card.sections.find(section => section.title === 'Commit message').text, op.message);
            assert.equal(card.sections.some(section => section.title === 'Required checks'), false);
            assert.equal(card.review.operationId, card.operationId);
            assert.equal(card.review.entries, 3);
            const exact = JSON.parse((await reviewPreview(card.review, await reviewEntry(card.review, 0))).text);
            assert.deepEqual(exact.operation, op);
            assert.equal(exact.presentation.operationId, card.operationId);
            assert.deepEqual(exact.presentation.fields, card.fields);
            assert.equal(exact.comparison.before, before.head);
            assert.equal(receipts[from].authorization.revision, digest(origin), 'own Cancel receipt retains the complete own-session origin');
            const draftPatch = (await reviewPreview(card.review, await reviewEntry(card.review, 1))).text;
            const secondPatch = (await reviewPreview(card.review, await reviewEntry(card.review, 2))).text;
            assert.equal(draftPatch.includes(`-Plugin whole-file candidate reconnect-${width}\n`), true);
            assert.equal(draftPatch.includes(`+Plugin whole-file candidate ${mode}\n`), true);
            assert.equal(draftPatch.includes(`-Plugin distant candidate reconnect-${width}\n`), true);
            assert.equal(draftPatch.includes(`+Plugin distant candidate ${mode}\n`), true);
            assert.equal(secondPatch.includes(`+Second plugin candidate ${mode}\n`), true);
            assert.equal(git(repo, 'show', `${before.head}:draft.txt`).split('\n').length, 5000);
            assert.equal(signal.aborted, false, 'no settings write or outer Stop fabricates Cancel');
            return null;
          } catch (error) { remember(error); throw error; }
        },
      }, undefined, session);
      const result = await pending; pending = undefined;
      if (errors.length) throw errors[0];
      assert.equal(callbacks, 1);
      assert.equal(suppliedSignal.aborted, false, 'manual own Cancel settles without aborting its signal');
      failed(result, /not approved/);
      assert.equal(result.details.completed, false);
      assert.equal(result.details.checksStarted, false);
      assert.equal(result.details.effectStarted, false);
      assert.deepEqual(result.details.effects, []);
      assert.deepEqual(state(), before, 'manual own Cancel preserves HEAD, RAW index, both candidate files and unrelated files');
      const current = receipts.slice(from);
      assert.deepEqual(current.map(receipt => receipt.phase), ['prepared', 'cancelled']);
      assert.equal(result.details.operationId, suppliedCard.operationId);
      assert.equal(current.at(-1).authorization.mode, 'ask');
      assert.equal(current.at(-1).authorization.source, 'builtin');
      assert.equal(current.at(-1).authorization.decision, 'not-approved');
      for (const receipt of current) {
        assert.equal(receipt.operationId, suppliedCard.operationId);
        assert.equal(receipt.card.review.id, suppliedCard.review.id);
        assert.equal(receipt.card.review.operationId, suppliedCard.operationId);
        assert.equal(receipt.authorization.revision, digest(origin));
        assert.equal(receipt.effectStarted, false);
      }
    }
  } catch (error) { remember(error); }
  finally {
    // Join the actual executor after EVERY callback/body/receipt failure before
    // retaining SAME original errors; no ACK/null result as a native idle probe.
    if (pending) { try { await pending; } catch (error) { remember(error); } }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'Original own Cancel/native origin and settlement failed');
});
