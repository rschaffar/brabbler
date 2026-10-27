import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { nativeCleanupAccess } from "./cleanup-access.fixture.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { gitProjectActions } = await jiti.import("./project-management.ts");
const { executeBrowserDiscard, executeGitOperation } = await jiti.import("./server.ts");
const { captureBrowserDiscard, performBrowserDiscard, createCleanupBudget } = await jiti.import("./cleanup.ts");
const { browserDiscardOperation } = await jiti.import("./discard.ts");
const { gitWorkflowManifest: manifest } = await jiti.import("./manifest.ts");
const { updatePluginSettings, readPluginSettings } = await jiti.import("../../lib/plugins/settings.ts");
const { preparePluginReview } = await jiti.import("../../lib/plugins/review-store.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgSign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(t, kind = "not-integrated") {
  const root = mkdtempSync(join(tmpdir(), "pi-browser-discard-test-"));
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  t.after(() => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; rmSync(root, { recursive: true, force: true }); });
  const cwd = join(root, "repo"), path = join(root, "feature");
  git(root, "init", "-qb", "main", cwd); git(cwd, "config", "user.name", "Fixture"); git(cwd, "config", "user.email", "fixture@example.invalid");
  writeFileSync(join(cwd, ".gitignore"), "generated/\n*.pyc\n__pycache__/\n");
  mkdirSync(join(cwd, "src")); writeFileSync(join(cwd, "src/source"), "base\n"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "Base");
  const baseTip = git(cwd, "rev-parse", "HEAD");
  git(cwd, "worktree", "add", "-qb", "feature", path);
  writeFileSync(join(path, "src/source"), "feature\n"); git(path, "add", "."); git(path, "commit", "-qm", "Feature");
  const tip = git(path, "rev-parse", "HEAD");
  if (kind === "integrated") git(cwd, "merge", "--no-ff", "-qm", "Integrate", "feature");
  if (kind === "detached") git(path, "checkout", "--detach", tip);
  if (kind === "unknown") writeFileSync(join(cwd, ".git/shallow"), `${baseTip}\n`);
  const mainTip = git(cwd, "rev-parse", "HEAD");
  updatePluginSettings(manifest, "global", cwd, { enabled: true }, []);
  const set = (values) => updatePluginSettings(manifest, "project", cwd, values, []);
  set({ discardResources: "ask", cleanupFeature: "deny", targetBranch: "main", approvedArtifactRoots: null });
  const payload = { subject: kind === "detached" ? { kind: "detached", head: tip } : { kind: "branch", branch: "feature", tip },
    worktreePath: path, removeWorktree: true, deleteBranch: kind !== "detached", comparisonTarget: { branch: "main", tip: mainTip } };
  const cards = [], receipts = []; let releases = 0;
  const ui = { prepareReview: preparePluginReview, isDirectoryInUse: () => false, reserveDirectory: () => () => { releases++; },
    operationReceipt: (_id, receipt) => receipts.push(structuredClone(receipt)),
    // A trusted host mock supplies final confirmation. Actual affirmative checkbox
    // binding/persistence is tested by the generic project-host tests, not by JSON.
    pluginCard: async (_id, card) => { cards.push(structuredClone(card)); return "approve"; } };
  const call = (extra = {}, custom = {}, invocation = cwd) => gitProjectActions.execute(invocation, "remove", { ...payload, ...extra }, { ...ui, ...custom }, new AbortController().signal, () => {});
  const artifact = (name = "generated") => { mkdirSync(join(path, name), { recursive: true }); writeFileSync(join(path, name, "cache"), "generated\n"); };
  return { root, cwd, path, baseTip, tip, mainTip, payload, cards, receipts, ui, set, call, artifact, releases: () => releases };
}
function captureAccess(f, overrides = {}) {
  return nativeCleanupAccess(f.cwd, { rejectUnignoredUntracked: true, ...overrides });
}
const passed = (result) => assert.notEqual(result.isError, true, result.content[0].text);
const failed = (result, pattern) => { assert.equal(result.isError, true, result.content[0].text); assert.match(result.content[0].text, pattern); };

test("browser operation cannot enter the public agent executor or select explicit artifact roots", async (t) => {
  const f = fixture(t), op = browserDiscardOperation(f.payload, f.cwd);
  await assert.rejects(executeGitOperation(f.cwd, op, f.ui), /Unsupported agent Git action/);
  await assert.rejects(executeBrowserDiscard(f.cwd, { ...op, artifactRoots: ["src/source"] }, f.ui), /explicit artifact roots/);
  assert.ok(existsSync(f.path)); assert.equal(f.cards.length, 0); assert.equal(f.receipts.length, 0);
});

test("final frozen card derives branch-loss requirement for all evidence states, never preparation JSON", async (t) => {
  // Each real graph/proof path remains native; the permission cross-product belongs to resource-rules.test.mjs.
  for (const [kind, mode] of [["integrated", "allow"], ["not-integrated", "ask"], ["unknown", "allow"], ["no-target", "allow"]]) await t.test(`${kind}/${mode}`, async (st) => {
    const f = fixture(st, kind); f.set({ discardResources: mode });
    const extra = kind === "no-target" ? { comparisonTarget: undefined } : {};
    if (kind === "no-target") f.set({ targetBranch: null });
    passed(await f.call(extra));
    assert.equal(f.cards.length, 1); assert.equal(Boolean(f.cards[0].requiredAcknowledgment), kind !== "integrated");
    assert.match(f.cards[0].fields.find((field) => field.label === "Integration evidence").value, new RegExp(kind === "no-target" ? "unknown" : kind));
    assert.equal(f.receipts[0].phase, "prepared"); assert.equal(f.receipts[0].authorization.mode, "ask");
    assert.match(f.receipts[0].authorization.source, new RegExp(`manual browser confirmation.*${mode}`));
    assert.equal(f.receipts.at(-1).phase, "succeeded"); assert.equal(f.receipts.at(-1).authorization.decision, "user-approved");
    assert.equal(f.receipts.at(-1).card.requiredAcknowledgment, f.cards[0].requiredAcknowledgment);
    assert.equal(existsSync(f.path), false); assert.equal(git(f.cwd, "branch", "--list", "feature"), ""); assert.equal(f.releases(), 1);
  });
});

test("unreadable comparison graph is Unknown evidence, not a structural deletion bypass or an integration gate", async (t) => {
  const f = fixture(t), missing = "a".repeat(40);
  writeFileSync(join(f.cwd, ".git/refs/heads/missing-graph"), `${missing}\n`);
  passed(await f.call({ comparisonTarget: { branch: "missing-graph", tip: missing } }));
  assert.ok(f.cards[0].requiredAcknowledgment);
  assert.match(f.cards[0].fields.find((field) => field.label === "Integration evidence").value, /unknown/);
  assert.equal(existsSync(f.path), false);
});

test("worktree-only removal never fabricates branch-loss acknowledgment; branch-only removal retains contents", async (t) => {
  for (const choice of ["worktree-only", "branch-only"]) await t.test(choice, async (st) => {
    const f = fixture(st); let extra = { deleteBranch: false };
    if (choice === "branch-only") { git(f.path, "checkout", "--detach", f.tip); extra = { removeWorktree: false, worktreePath: undefined }; }
    passed(await f.call(extra));
    assert.equal(Boolean(f.cards[0].requiredAcknowledgment), choice === "branch-only");
    assert.equal(existsSync(f.path), choice === "branch-only");
    if (choice === "worktree-only") assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip);
    else assert.equal(readFileSync(join(f.path, "src/source"), "utf8"), "feature\n");
    assert.equal(f.receipts.at(-1).completedEffects.length, 1);
  });
});

test("branchless unique detached removal binds full HEAD and removes only its physical worktree and registration", async (t) => {
  const f = fixture(t, "detached");
  f.set({ discardResources: "allow", cleanupWorktree: "keep", cleanupBranch: "keep", cleanupArtifacts: "keep" });
  // The existing fixture detaches at feature's reachable tip. Commit HERE, not
  // on a branch: capture/staleness or reachable-detached positives are not this
  // original browser input's unique, branchless native removal conjunction.
  writeFileSync(join(f.path, "unique-detached.txt"), "unique detached disposable work\n");
  git(f.path, "add", "unique-detached.txt");
  git(f.path, "commit", "-qm", "Unique branchless detached removal fixture");
  const uniqueHead = git(f.path, "rev-parse", "HEAD");
  assert.match(uniqueHead, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
  assert.notEqual(uniqueHead, f.tip);
  assert.equal(git(f.path, "branch", "--show-current"), "");
  assert.equal(git(f.path, "status", "--porcelain"), "");
  const refsBefore = git(f.cwd, "for-each-ref", "--format=%(refname) %(objectname)");
  assert.equal(git(f.cwd, "for-each-ref", "--format=%(refname)", "--points-at", uniqueHead), "", "no ref names the unique HEAD");
  assert.equal(git(f.cwd, "for-each-ref", "--format=%(refname)", "--contains", uniqueHead), "", "no ref reaches the unique HEAD");
  const registeredBefore = git(f.cwd, "worktree", "list", "--porcelain");
  // The shared git helper trims stdout, including the final record's newline.
  // Restore that delimiter only; keep exact physical path/full HEAD/field values.
  assert.equal(`${registeredBefore}\n`.includes(`worktree ${f.path}\nHEAD ${uniqueHead}\ndetached\n`), true);

  // Same actual remove adapter/native executor and trusted UI entry as the
  // existing native cases. This does NOT claim host digest/nonce or browser
  // checkbox proof. Await the complete original call before reading effects.
  passed(await f.call({ subject: { kind: "detached", head: uniqueHead },
    worktreePath: f.path, removeWorktree: true, deleteBranch: false, comparisonTarget: undefined,
  }, { pluginCard: async (...args) => {
    assert.equal(existsSync(f.path), true, "review publication has no removal effects");
    assert.equal(git(f.path, "rev-parse", "HEAD"), uniqueHead);
    assert.equal(git(f.cwd, "for-each-ref", "--format=%(refname) %(objectname)"), refsBefore);
    return f.ui.pluginCard(...args);
  } }));
  assert.equal(f.cards.length, 1);
  const card = f.cards[0];
  assert.equal(card.fields.find(field => field.label === "Exact subject")?.value, `Detached HEAD at ${uniqueHead}`);
  assert.equal(card.fields.find(field => field.label === "Worktree")?.value, `Remove: ${f.path}`);
  assert.equal(card.fields.find(field => field.label === "Local branch")?.value, "Keep (no branch deletion)");
  assert.equal(card.requiredAcknowledgment, undefined);
  assert.equal(card.sections.some(section => section.title === "Detached commit warning"), true);
  const completed = f.receipts.at(-1);
  assert.equal(f.receipts[0].phase, "prepared");
  assert.equal(completed.phase, "succeeded");
  assert.equal(completed.authorization.decision, "user-approved");
  assert.equal(completed.card.requiredAcknowledgment, undefined);
  assert.deepEqual(completed.completedEffects, [`Removed worktree: ${f.path}`], "no artifact or branch effect is invented");
  assert.equal(existsSync(f.path), false);
  const registeredAfter = git(f.cwd, "worktree", "list", "--porcelain");
  assert.equal(registeredAfter.includes(`worktree ${f.path}\n`), false);
  assert.equal(registeredAfter.includes(`worktree ${f.cwd}\n`), true, "main checkout remains registered");
  assert.equal(git(f.cwd, "for-each-ref", "--format=%(refname) %(objectname)"), refsBefore, "every ref is unchanged");
  assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip);
  assert.equal(f.releases(), 1, "the original native directory reservation is released");
});

test("valid clean detached worktree removal binds HEAD and warns without a branch-loss checkbox", async (t) => {
  const f = fixture(t, "detached"); f.artifact(); f.set({ cleanupWorktree: "keep", cleanupBranch: "keep", cleanupArtifacts: "keep" });
  passed(await f.call({ comparisonTarget: undefined }));
  assert.equal(f.cards[0].requiredAcknowledgment, undefined); assert.match(JSON.stringify(f.cards[0]), /Detached commit warning|permanent commit retention/);
  assert.equal(existsSync(f.path), false); assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip);
  assert.equal(f.receipts.at(-1).completedEffects.length, 2);
});

test("manual discard ignores completed-feature Keep preferences but not its independent permission", async (t) => {
  const f = fixture(t, "integrated"); f.artifact();
  f.set({ cleanupFeature: "allow", cleanupWorktree: "keep", cleanupBranch: "keep", cleanupArtifacts: "keep" });
  const legacy = { featureBranch: "feature", featureTip: f.tip, integrationCommit: f.mainTip, targetBranch: "main", worktreePath: f.path, removeWorktree: true, deleteBranch: true };
  failed(await gitProjectActions.execute(f.cwd, "cleanup", legacy, f.ui, new AbortController().signal, () => {}), /Keep choice/);
  f.set({ discardResources: "deny" }); await assert.rejects(f.call(), /disabled or denied/);
  assert.equal(f.cards.length, 0); assert.ok(existsSync(f.path));
  f.set({ discardResources: "allow", cleanupFeature: "deny" }); passed(await f.call());
  assert.match(JSON.stringify(f.cards[0]), /Needs one-time approval/);
});

test("legacy cleanup remains integrated-only even when manual discard is allowed", async (t) => {
  const f = fixture(t); f.set({ cleanupFeature: "allow", discardResources: "allow" });
  failed(await gitProjectActions.execute(f.cwd, "cleanup", { featureBranch: "feature", featureTip: f.tip, integrationCommit: f.mainTip, targetBranch: "main", worktreePath: f.path, removeWorktree: true, deleteBranch: true }, f.ui, new AbortController().signal, () => {}), /Command failed/);
  assert.ok(existsSync(f.path)); assert.equal(f.cards.length, 0);
});

test("rejection, cancellation and missing browser UI retain exact resources even under Allow", async (t) => {
  for (const answer of ["reject", null, "missing"]) await t.test(String(answer), async (st) => {
    const f = fixture(st); f.set({ discardResources: "allow", approvedArtifactRoots: "generated" }); f.artifact();
    failed(await f.call({}, { pluginCard: answer === "missing" ? undefined : async (_id, card) => {
      assert.ok(card.requiredAcknowledgment); assert.ok(existsSync(f.path)); assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip); return answer;
    } }), /not approved|live Brabbler browser UI/);
    assert.ok(existsSync(join(f.path, "generated/cache"))); assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip);
    assert.equal(f.receipts.at(-1).effectStarted, false);
  });
});

test("dirty/unignored source, filters, index flags, locks and active resources refuse before approval", async (t) => {
  for (const reason of ["dirty", "untracked", "filter", "index", "locked", "active"]) await t.test(reason, async (st) => {
    const f = fixture(st), custom = { pluginCard: () => assert.fail("Unsafe state must not reach approval") };
    if (reason === "dirty") writeFileSync(join(f.path, "src/source"), "local work\n");
    if (reason === "untracked") writeFileSync(join(f.path, "personal"), "keep\n");
    if (reason === "filter") { writeFileSync(join(f.path, ".gitattributes"), "src/source filter=unsafe\n"); git(f.path, "add", ".gitattributes"); }
    if (reason === "index") git(f.path, "update-index", "--assume-unchanged", "src/source");
    if (reason === "locked") git(f.cwd, "worktree", "lock", f.path);
    if (reason === "active") custom.isDirectoryInUse = () => true;
    // Adapter may reject status/filter availability before entering the executor.
    let result;
    try { result = await f.call({}, custom); } catch (error) { assert.match(String(error), /untracked|filter|unavailable/i); }
    if (result) failed(result, /source changes|untracked|filter|Hidden index|locked|active use/);
    assert.ok(existsSync(f.path)); assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip);
  });
});

test("designated and comparison targets are protected independently, not overridden by temporary comparison", async (t) => {
  for (const selected of ["designated", "comparison"]) await t.test(selected, async (st) => {
    const f = fixture(st); git(f.cwd, "branch", "other", f.mainTip);
    if (selected === "designated") f.set({ targetBranch: "feature" });
    failed(await f.call({ comparisonTarget: selected === "comparison" ? { branch: "feature", tip: f.tip } : { branch: "other", tip: f.mainTip } }), /designated or comparison target/);
    assert.equal(f.cards.length, 0); assert.ok(existsSync(f.path));
  });
});

test("symbolic designated targets conservatively block disposal of their referents, including detached subjects", async (t) => {
  for (const kind of ["not-integrated", "detached", "dangling"]) await t.test(kind, async (st) => {
    const f = fixture(st, kind);
    git(f.cwd, "symbolic-ref", "refs/heads/designated", kind === "dangling" ? "refs/heads/missing-referent" : "refs/heads/feature");
    f.set({ targetBranch: "designated" });
    failed(await f.call({ comparisonTarget: undefined }), /symbolic designated targets/);
    assert.equal(f.cards.length, 0); assert.ok(existsSync(f.path)); assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip);
  });
});

test("missing designated target with no comparison remains removable with Unknown evidence", async (t) => {
  const f = fixture(t); f.set({ targetBranch: "missing-designated" });
  passed(await f.call({ comparisonTarget: undefined }));
  assert.ok(f.cards[0].requiredAcknowledgment);
  assert.match(f.cards[0].fields.find((field) => field.label === "Integration evidence").value, /unknown: no-comparison-target/);
});

test("a designated target becoming symbolic after review or between effects retains remaining resources", async (t) => {
  for (const when of ["review", "after-worktree"]) await t.test(when, async (st) => {
    const f = fixture(st, "integrated"); f.set({ targetBranch: "missing-designated" }); let changed = false;
    failed(await f.call({}, { pluginCard: async (_id, card) => {
      assert.equal(card.requiredAcknowledgment, undefined);
      if (when === "review") git(f.cwd, "symbolic-ref", "refs/heads/missing-designated", "refs/heads/feature");
      return "approve";
    }, operationReceipt: (_id, receipt) => {
      f.receipts.push(structuredClone(receipt));
      if (when === "after-worktree" && !changed && receipt.completedEffects?.some((effect) => effect.startsWith("Removed worktree:"))) {
        changed = true; git(f.cwd, "symbolic-ref", "refs/heads/missing-designated", "refs/heads/feature");
      }
    } }), /symbolic designated targets/);
    assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip);
    assert.equal(f.receipts.at(-1).completedEffects.length, when === "review" ? 0 : 1);
    assert.equal(existsSync(f.path), when === "review"); assert.equal(f.releases(), 1);
  });
});

test("main, selected and descendant invocation resources remain protected", async (t) => {
  for (const resource of ["main", "selected", "descendant"]) await t.test(resource, async (st) => {
    const f = fixture(st); f.set({ targetBranch: null });
    const payload = resource === "main" ? { ...f.payload, subject: { kind: "branch", branch: "main", tip: f.mainTip }, worktreePath: f.cwd, comparisonTarget: undefined } : { ...f.payload, comparisonTarget: undefined };
    const invocation = resource === "descendant" ? join(f.path, "src") : resource === "selected" ? f.path : f.cwd;
    const op = browserDiscardOperation(payload, resource === "selected" ? f.path : f.cwd);
    failed(await executeBrowserDiscard(invocation, op, f.ui), /main|selected|invocation|caller/);
    assert.ok(existsSync(f.path)); assert.equal(f.cards.length, 0);
  });
});

test("exact branch/ref, physical paths and registration guards refuse symbolic refs or aliases", async (t) => {
  for (const reason of ["symbolic", "stale-tip", "alias", "retained-checkout", "prunable"]) await t.test(reason, async (st) => {
    const f = fixture(st); let extra = {};
    if (reason === "symbolic") { git(f.cwd, "symbolic-ref", "refs/heads/alias", "refs/heads/feature"); extra = { subject: { kind: "branch", branch: "alias", tip: f.tip }, removeWorktree: false, worktreePath: undefined }; }
    if (reason === "stale-tip") extra.subject = { ...f.payload.subject, tip: f.baseTip };
    if (reason === "alias") { const alias = join(f.root, "alias"); symlinkSync(f.path, alias); extra.worktreePath = alias; }
    if (reason === "retained-checkout") extra = { removeWorktree: false, worktreePath: undefined };
    if (reason === "prunable") { renameSync(f.path, join(f.root, "moved")); extra = { removeWorktree: false, worktreePath: undefined }; }
    failed(await executeBrowserDiscard(f.cwd, browserDiscardOperation({ ...f.payload, ...extra }, f.cwd), f.ui), /symbolic branch refs|Feature branch changed|physical|retained in a registered/);
    assert.equal(f.cards.length, 0); assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip);
  });
});

test("detached movement, reattachment and Git-admin replacement stale the frozen review", async (t) => {
  for (const change of ["movement", "reattach", "admin"]) await t.test(change, async (st) => {
    const f = fixture(st, "detached");
    failed(await f.call({}, { pluginCard: async (_id, card) => {
      assert.equal(card.requiredAcknowledgment, undefined);
      if (change === "movement") git(f.path, "checkout", "--detach", f.baseTip);
      if (change === "reattach") git(f.path, "checkout", "feature");
      if (change === "admin") { const admin = git(f.path, "rev-parse", "--absolute-git-dir"), backup = join(f.root, "old-admin"); renameSync(admin, backup); cpSync(backup, admin, { recursive: true }); }
      return "approve";
    } }), /Detached HEAD moved or reattached|resources changed/);
    assert.ok(existsSync(f.path)); assert.equal(f.receipts.at(-1).effectStarted, false); assert.equal(f.releases(), 1);
  });
});

test("new ignored/unignored files, dirty source and newly active use after approval retain resources", async (t) => {
  for (const change of ["ignored", "unignored", "dirty", "active", "unignore-artifact"]) await t.test(change, async (st) => {
    const f = fixture(st); let active = false, exclude;
    if (change === "unignore-artifact") {
      exclude = git(f.path, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude");
      writeFileSync(exclude, "once-ignored/\n"); f.artifact("once-ignored"); f.set({ approvedArtifactRoots: "once-ignored" });
    }
    failed(await f.call({}, { isDirectoryInUse: () => active, pluginCard: async () => {
      if (change === "ignored") writeFileSync(join(f.path, "later.pyc"), "not reviewed");
      if (change === "unignored") writeFileSync(join(f.path, "personal"), "not reviewed");
      if (change === "dirty") writeFileSync(join(f.path, "src/source"), "local changes");
      if (change === "active") active = true;
      if (change === "unignore-artifact") writeFileSync(exclude, "");
      return "approve";
    } }), /Unknown cleanup resource|source changes|untracked|active use|resources changed/);
    assert.ok(existsSync(f.path)); assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip); assert.equal(f.receipts.at(-1).effectStarted, false);
  });
});

test("originally proven branch deletion refuses proof loss before or between effects, but tolerates advancement", async (t) => {
  for (const change of ["before", "after-worktree", "advance"]) await t.test(change, async (st) => {
    const f = fixture(st, "integrated"); let changed = false;
    const result = await f.call({}, { pluginCard: async (_id, card) => {
      assert.equal(card.requiredAcknowledgment, undefined);
      if (change === "before") git(f.cwd, "update-ref", "refs/heads/main", f.baseTip);
      if (change === "advance") git(f.cwd, "commit", "--allow-empty", "-qm", "Unrelated advancement");
      return "approve";
    }, operationReceipt: (_id, receipt) => {
      f.receipts.push(structuredClone(receipt));
      if (change === "after-worktree" && !changed && receipt.completedEffects?.some((effect) => effect.startsWith("Removed worktree:"))) { changed = true; git(f.cwd, "update-ref", "refs/heads/main", f.baseTip); }
    } });
    if (change === "advance") passed(result);
    else { failed(result, /Originally proven branch integration/); assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip); assert.equal(result.details.effects.length, change === "before" ? 0 : 1); }
  });
});

test("an originally proven comparison ref disappearing or becoming symbolic cannot downgrade approval", async (t) => {
  for (const change of ["missing", "symbolic"]) await t.test(change, async (st) => {
    const f = fixture(st, "integrated"); f.set({ targetBranch: "missing-designated" });
    failed(await f.call({}, { pluginCard: async (_id, card) => {
      assert.equal(card.requiredAcknowledgment, undefined);
      if (change === "missing") git(f.cwd, "update-ref", "-d", "refs/heads/main", f.mainTip);
      else {
        git(f.cwd, "branch", "same-tip-referent", f.mainTip);
        git(f.cwd, "symbolic-ref", "refs/heads/main", "refs/heads/same-tip-referent");
      }
      return "approve";
    } }), /Comparison target ref changed or is symbolic/);
    assert.ok(existsSync(f.path)); assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip);
    assert.equal(f.receipts.at(-1).effectStarted, false);
  });
});

test("frozen proven deletion fails closed on unavailable graph or replaced/omitted comparison binding", async (t) => {
  const f = fixture(t, "integrated"), op = browserDiscardOperation(f.payload, f.cwd);
  const policy = readPluginSettings(manifest, f.cwd).effective;
  let loseGraph = false;
  // Pure recapture fault injection: no native effect is dispatched by this test.
  const access = {
    rejectUnignoredUntracked: true,
    git: (cwd, args) => {
      if (loseGraph && args[0] === "merge-base") throw Object.assign(new Error("fixture graph unavailable"), { status: 128 });
      return git(cwd, ...args);
    },
    checkout: (path) => path,
    branchTip: (cwd, branch) => git(cwd, "rev-parse", "--verify", `refs/heads/${branch}^{commit}`),
    worktrees: () => [{ path: f.cwd, branch: "main", head: f.mainTip, detached: false }, { path: f.path, branch: "feature", head: f.tip, detached: false }],
    project: () => join(f.cwd, ".git"), inUse: () => false,
  };
  const snapshot = await captureBrowserDiscard(f.cwd, op, policy, access);
  assert.equal(snapshot.lossEvidence.state, "integrated");
  loseGraph = true;
  await assert.rejects(captureBrowserDiscard(f.cwd, op, policy, access, undefined, false, snapshot), /Originally proven branch integration/);
  for (const comparisonTarget of [undefined, { branch: "other", tip: f.mainTip }, { branch: "main", tip: f.baseTip }]) {
    await assert.rejects(captureBrowserDiscard(f.cwd, { ...op, comparisonTarget }, policy, access, undefined, false, snapshot), /Originally proven comparison ref binding changed/);
  }
  assert.ok(existsSync(f.path)); assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip);
});

test("branch deletion uses exact CAS without a force fallback when a ref changes at dispatch", async (t) => {
  for (const kind of ["not-integrated", "integrated"]) await t.test(kind, async (st) => {
    const f = fixture(st, kind); let raced = false;
    failed(await f.call({}, { operationReceipt: (_id, receipt) => {
      f.receipts.push(structuredClone(receipt));
      if (!raced && receipt.attemptedEffect?.startsWith("Delete local branch:")) { raced = true; git(f.cwd, "update-ref", "refs/heads/feature", f.baseTip); }
    } }), /Command failed|expected/);
    assert.equal(raced, true); assert.equal(existsSync(f.path), false); assert.equal(git(f.cwd, "rev-parse", "feature"), f.baseTip);
    assert.equal(f.receipts.at(-1).completedEffects.length, 1); assert.equal(f.releases(), 1);
  });
});

test("dispatch-time designated-target aliasing blocks both proven and acknowledged branch deletion", async (t) => {
  for (const kind of ["integrated", "not-integrated"]) for (const choice of ["branch-only", "worktree-and-branch"]) await t.test(`${kind}/${choice}`, async (st) => {
    const f = fixture(st, kind); git(f.cwd, "branch", "designated", f.mainTip); f.set({ targetBranch: "designated" }); let raced = false;
    const extra = choice === "branch-only" ? { removeWorktree: false, worktreePath: undefined } : {};
    if (choice === "branch-only") git(f.path, "checkout", "--detach", f.tip);
    failed(await f.call(extra, { operationReceipt: (_id, receipt) => {
      f.receipts.push(structuredClone(receipt));
      if (!raced && receipt.attemptedEffect?.startsWith("Delete local branch:")) {
        raced = true;
        assert.equal(Boolean(receipt.card.requiredAcknowledgment), kind !== "integrated");
        git(f.cwd, "symbolic-ref", "refs/heads/designated", "refs/heads/feature");
      }
    } }), /symbolic designated targets/);
    assert.equal(raced, true); assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip);
    assert.equal(git(f.cwd, "symbolic-ref", "refs/heads/designated"), "refs/heads/feature");
    assert.equal(git(f.cwd, "rev-parse", "designated"), f.tip); assert.equal(git(f.cwd, "rev-parse", "main"), f.mainTip);
    assert.equal(existsSync(f.path), choice === "branch-only");
    assert.equal(f.receipts.at(-1).phase, "failed");
    assert.equal(f.receipts.at(-1).completedEffects.length, choice === "branch-only" ? 0 : 1);
    assert.equal(f.releases(), choice === "branch-only" ? 0 : 1);
    for (const branch of ["main", "feature"]) assert.equal(existsSync(join(f.cwd, ".git/refs/heads", `${branch}.lock`)), false);
  });
});

test("proven native deletion binds the recaptured comparison tip through dispatch, including direct-ref identity", async (t) => {
  for (const choice of ["branch-only", "worktree-and-branch"]) for (const change of ["moved", "removed", "symbolic", "dangling"]) await t.test(`${choice}/${change}`, async (st) => {
    const f = fixture(st, "integrated"); f.set({ targetBranch: "missing-designated" }); let raced = false;
    const extra = choice === "branch-only" ? { removeWorktree: false, worktreePath: undefined } : {};
    if (choice === "branch-only") git(f.path, "checkout", "--detach", f.tip);
    if (change === "symbolic") git(f.cwd, "branch", "same-tip-referent", f.mainTip);
    failed(await f.call(extra, { operationReceipt: (_id, receipt) => {
      f.receipts.push(structuredClone(receipt));
      if (!raced && receipt.attemptedEffect?.startsWith("Delete local branch:")) {
        raced = true;
        assert.equal(receipt.card.requiredAcknowledgment, undefined);
        if (change === "moved") git(f.cwd, "update-ref", "refs/heads/main", f.baseTip);
        else if (change === "removed") git(f.cwd, "update-ref", "-d", "refs/heads/main", f.mainTip);
        else git(f.cwd, "symbolic-ref", "refs/heads/main", `refs/heads/${change === "symbolic" ? "same-tip-referent" : "missing-referent"}`);
      }
    } }), /Command failed|Comparison target ref changed or is symbolic/);
    assert.equal(raced, true); assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip);
    assert.equal(existsSync(f.path), choice === "branch-only");
    assert.equal(f.receipts.at(-1).phase, "failed");
    assert.equal(f.receipts.at(-1).completedEffects.length, choice === "branch-only" ? 0 : 1);
    assert.equal(f.releases(), choice === "branch-only" ? 0 : 1);
    if (change === "symbolic") {
      assert.equal(git(f.cwd, "symbolic-ref", "refs/heads/main"), "refs/heads/same-tip-referent");
      assert.equal(git(f.cwd, "rev-parse", "same-tip-referent"), f.mainTip);
    }
  });
});

test("prepared proven deletion refuses dispatch-time graph proof loss even when comparison tip is unchanged", async (t) => {
  const f = fixture(t, "integrated"); let raced = false;
  failed(await f.call({}, { operationReceipt: (_id, receipt) => {
    f.receipts.push(structuredClone(receipt));
    if (!raced && receipt.attemptedEffect?.startsWith("Delete local branch:")) {
      raced = true; writeFileSync(join(f.cwd, ".git/shallow"), `${f.mainTip}\n`);
    }
  } }), /Originally proven branch integration/);
  assert.equal(raced, true); assert.equal(git(f.cwd, "rev-parse", "main"), f.mainTip);
  assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip); assert.equal(existsSync(f.path), false);
  assert.equal(f.receipts.at(-1).completedEffects.length, 1); assert.equal(f.releases(), 1);
});

test("prepared proven deletion rejects a same-tip symbolic subject without deleting its referent", async (t) => {
  const f = fixture(t, "integrated"); git(f.cwd, "branch", "same-tip-subject", f.tip); let raced = false;
  failed(await f.call({}, { operationReceipt: (_id, receipt) => {
    f.receipts.push(structuredClone(receipt));
    if (!raced && receipt.attemptedEffect?.startsWith("Delete local branch:")) {
      raced = true; git(f.cwd, "symbolic-ref", "refs/heads/feature", "refs/heads/same-tip-subject");
    }
  } }), /symbolic branch refs/);
  assert.equal(raced, true); assert.equal(existsSync(f.path), false);
  assert.equal(git(f.cwd, "symbolic-ref", "refs/heads/feature"), "refs/heads/same-tip-subject");
  assert.equal(git(f.cwd, "rev-parse", "same-tip-subject"), f.tip);
  assert.equal(f.receipts.at(-1).completedEffects.length, 1); assert.equal(f.releases(), 1);
});

test("proven deletion refuses unsupported transaction versions before effects, without a no-op probe", async (t) => {
  const f = fixture(t, "integrated"), op = browserDiscardOperation(f.payload, f.cwd);
  const policy = readPluginSettings(manifest, f.cwd).effective;
  for (const version of ["git version 2.33.0", "unrecognized version"]) {
    const access = captureAccess(f, { git: (cwd, args) => args[0] === "--version" ? version : git(cwd, ...args) });
    await assert.rejects(captureBrowserDiscard(f.cwd, op, policy, access), /requires Git 2\.34 or newer/);
  }
  const access = captureAccess(f, { git: (cwd, args) => {
    assert.notEqual(args[0], "--version", "Acknowledged Unknown deletion must not acquire a new integration/version gate");
    return git(cwd, ...args);
  } });
  assert.equal((await captureBrowserDiscard(f.cwd, { ...op, comparisonTarget: undefined }, policy, access)).lossEvidence.state, "unknown");
  assert.ok(existsSync(f.path)); assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip);
});

test("a concurrent checkout appearing during final branch-only recapture prevents native deletion", async (t) => {
  for (const kind of ["integrated", "not-integrated"]) await t.test(kind, async (st) => {
    const f = fixture(st, kind); git(f.path, "checkout", "--detach", f.tip);
    const op = browserDiscardOperation({ ...f.payload, worktreePath: undefined, removeWorktree: false }, f.cwd);
    const policy = readPluginSettings(manifest, f.cwd).effective, concurrent = join(f.root, "concurrent");
    let checkpointHits = 0;
    const nativeAccess = captureAccess(f);
    const access = { ...nativeAccess, worktrees: (cwd, checkpoint) => {
      // Only the final branch-deletion recapture names this fresh registration
      // read; initial capture and pre-effect revalidation stay native and unarmed.
      if (checkpoint === "final-branch-registration-capture") {
        checkpointHits++;
        git(f.cwd, "worktree", "add", concurrent, "feature");
      }
      return nativeAccess.worktrees(cwd, checkpoint);
    } };
    const snapshot = await captureBrowserDiscard(f.cwd, op, policy, access);
    assert.equal(snapshot.lossEvidence.state, kind); assert.equal(checkpointHits, 0);
    const effects = [], dispatched = [];
    await assert.rejects(performBrowserDiscard(f.cwd, op, policy, access, snapshot, () => {},
      async () => assert.fail("New registered checkout must block native deletion"), effects,
      (description) => dispatched.push(description), createCleanupBudget()), /retained in a registered worktree/);
    assert.equal(checkpointHits, 1, "Final branch-registration capture checkpoint must fire exactly once");
    assert.deepEqual(effects, []); assert.deepEqual(dispatched, []);
    assert.ok(existsSync(concurrent)); assert.equal(git(concurrent, "symbolic-ref", "HEAD"), "refs/heads/feature");
    assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip); assert.ok(existsSync(f.path));
    assert.equal(git(f.cwd, "rev-parse", "main"), f.mainTip);
    for (const path of [f.path, concurrent]) assert.equal(readFileSync(join(path, "src/source"), "utf8"), "feature\n");
  });
});

test("prepared proven deletion rechecks a concurrent checkout attached at dispatch", async (t) => {
  const f = fixture(t, "integrated"), concurrent = join(f.root, "concurrent");
  git(f.path, "checkout", "--detach", f.tip); let raced = false;
  failed(await f.call({ removeWorktree: false, worktreePath: undefined }, { operationReceipt: (_id, receipt) => {
    f.receipts.push(structuredClone(receipt));
    if (!raced && receipt.attemptedEffect?.startsWith("Delete local branch:")) {
      raced = true; git(f.cwd, "worktree", "add", concurrent, "feature");
    }
  } }), /retained in a registered worktree/);
  assert.equal(raced, true); assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip);
  assert.equal(git(concurrent, "symbolic-ref", "HEAD"), "refs/heads/feature");
  assert.ok(existsSync(f.path)); assert.equal(f.receipts.at(-1).phase, "failed");
  assert.deepEqual(f.receipts.at(-1).completedEffects, []); assert.equal(f.releases(), 0);
});

test("pre-step persistence failure prevents dispatch; completed-step failure retains remaining resources", async (t) => {
  for (const failure of ["intent", "completion"]) await t.test(failure, async (st) => {
    const f = fixture(st); f.artifact();
    failed(await f.call({}, { operationReceipt: (_id, receipt) => {
      f.receipts.push(structuredClone(receipt));
      if (failure === "intent" && receipt.phase === "executing" && receipt.attemptedEffect) throw new Error("fixture intent persistence failure");
      if (failure === "completion" && receipt.phase === "executing" && receipt.completedEffects?.length) throw new Error("fixture completion persistence failure");
    } }), /persistence failure/);
    assert.ok(existsSync(f.path)); assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip); assert.equal(f.releases(), 1);
    assert.equal(existsSync(join(f.path, "generated/cache")), failure === "intent");
    assert.equal(f.receipts.at(-1).effectStarted, failure === "completion");
  });
});

test("nested artifact inventory/effects are shared and never sweep unapproved siblings", { skip: process.platform !== "linux" }, async (t) => {
  const f = fixture(t); f.artifact("src/__pycache__"); writeFileSync(join(f.path, "src/source.pyc"), "generated\n"); let injected = false;
  failed(await f.call({}, { operationReceipt: (_id, receipt) => {
    f.receipts.push(structuredClone(receipt));
    if (!injected && receipt.completedEffects?.length) { injected = true; writeFileSync(join(f.path, "src/new.pyc"), "not approved\n"); }
  } }), /Unknown cleanup resource|resources changed/);
  assert.equal(f.receipts.at(-1).completedEffects.length, 1); assert.ok(existsSync(join(f.path, "src/new.pyc")));
  assert.ok(existsSync(join(f.path, "src/source.pyc"))); assert.equal(readFileSync(join(f.path, "src/source"), "utf8"), "feature\n");
});

test("same-device mount boundaries remain blocked before manual approval", { skip: process.platform !== "linux" }, async (t) => {
  const f = fixture(t); f.artifact(); let mountReads = 0;
  const access = captureAccess(f, { readMountInfo: () => {
    mountReads++;
    return `${readFileSync("/proc/self/mountinfo", "utf8")}\n1 1 0:1 / ${join(f.path, "generated")} rw - tmpfs tmpfs rw\n`;
  } });
  await assert.rejects(captureBrowserDiscard(f.cwd, browserDiscardOperation(f.payload, f.cwd), readPluginSettings(manifest, f.cwd).effective, access), /Mounted cleanup|mounted filesystem/);
  assert.ok(mountReads > 0); assert.ok(existsSync(join(f.path, "generated/cache")));
  assert.equal(git(f.cwd, "rev-parse", "feature"), f.tip); assert.equal(f.cards.length, 0);
});
