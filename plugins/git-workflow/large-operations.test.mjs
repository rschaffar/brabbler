import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";
const root = mkdtempSync(join(tmpdir(), "pi-large-git-"));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(root, { recursive: true, force: true }); });
const jiti = createJiti(import.meta.url);
const { executeGitOperation } = await jiti.import("./server.ts");
import { saveOperationReview, reviewMetadata, reviewProposal, reviewFiles, reviewPatch } from "./review-host.fixture.mjs";
const { snapshotOperationReceipt } = await jiti.import("../../lib/operation-receipts.ts");
const { validatePluginCard } = await jiti.import("../../lib/plugins/ui.ts");
const { gitWorkflowManifest } = await jiti.import("./manifest.ts");
const { updatePluginSettings } = await jiti.import("../../lib/plugins/settings.ts");
const { run } = await jiti.import("./process.ts");
const { sortedDirectoryNames } = await jiti.import("./inventory-names.ts");
let count = 0;
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgSign=false", ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
function fixture(mode) {
  const repo = join(root, `repo-${++count}`); mkdirSync(repo);
  git(repo, "init", "-qb", "main"); git(repo, "config", "user.name", "Test"); git(repo, "config", "user.email", "test@example.invalid");
  writeFileSync(join(repo, "base"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-qm", "base");
  updatePluginSettings(gitWorkflowManifest, "global", repo, { enabled: true, targetBranch: "main", merge: mode, commit: mode, mergeChecks: [], commitChecks: [] }, []);
  const receipts = [], cards = [];
  const ui = { saveOperationReview,
    operationReceipt(id, receipt) { receipts.push(snapshotOperationReceipt(id, receipt, receipts.length + 1)); },
    async pluginCard(id, card) { validatePluginCard(card); cards.push(structuredClone(card)); return "approve"; },
  };
  return { repo, receipts, cards, ui };
}
const success = (result) => assert.notEqual(result.isError, true, result.content[0].text);
for (const mode of ["ask", "allow"]) for (const size of [1_476_834, 3 * 1024 * 1024]) {
  test(`${mode}: merge ${size} bytes through production card/receipt validators`, async () => {
    const f = fixture(mode), feature = `${f.repo}-feature`;
    git(f.repo, "worktree", "add", "-b", "feature", feature);
    writeFileSync(join(feature, "large"), "x".repeat(size) + "\n"); git(feature, "add", "."); git(feature, "commit", "-qm", "large");
    success(await executeGitOperation(f.repo, { action: "merge", checkout: f.repo, featureBranch: "feature" }, f.ui));
    assert.equal(readFileSync(join(f.repo, "large"), "utf8").length, size + 1);
    assert.equal(f.cards.length, mode === "ask" ? 1 : 0);
    assert.equal(f.receipts.at(-1).phase, "succeeded");
    const ref = f.receipts[0].card.review;
    assert.equal(ref.version, 2);
    assert.ok(f.receipts.every((r) => !r.card.patch && reviewProposal(r.card.review).fingerprint === reviewMetadata(ref).fingerprint));
    assert.ok(JSON.stringify(f.receipts).length < 50000, "receipts must not repeat the large patch");
    const page = await reviewFiles(ref); assert.equal(page.total, 1);
    const raw = await reviewPatch(ref, page.files[0].id);
    assert.ok(raw.includes("+" + "x".repeat(size)), "all immutable Git bytes stream on demand, including giant lines");
    const settlement = reviewMetadata(f.receipts.at(-1).card.review);
    assert.deepEqual(settlement.proposal, ref); assert.equal(settlement.outcome.completed, true);
    assert.equal(settlement.result.captured.comparison.after, git(f.repo, "rev-parse", "HEAD"));
    assert.equal(existsSync(join(root, "agent/brabbler/reviews")), false);
    assert.equal(git(f.repo, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 3);
  });
}
test("257 whole files and a long message preserve unrelated staging; many checks and noisy output remain executable", async () => {
  const f = fixture("allow");
  const files = Array.from({ length: 257 }, (_, i) => `selected-${i}`);
  for (const name of files) writeFileSync(join(f.repo, name), name);
  writeFileSync(join(f.repo, "unrelated"), "keep staged"); git(f.repo, "add", "unrelated");
  const message = "Large exact message\n\n" + "m".repeat(70000);
  updatePluginSettings(gitWorkflowManifest, "project", f.repo, { commitChecks: [{ name: "noisy", command: `${JSON.stringify(process.execPath)} -e 'process.stdout.write("x".repeat(3*1024*1024))'` }] }, []);
  success(await executeGitOperation(f.repo, { action: "commit", checkout: f.repo, mode: "files", files, message }, f.ui));
  assert.equal(git(f.repo, "diff", "--cached", "--name-only"), "unrelated");
  assert.equal(git(f.repo, "show", "-s", "--format=%B"), message);
  assert.equal(f.receipts.at(-1).checks[0].status, "passed");
  assert.equal((await reviewFiles(f.receipts[0].card.review)).total, 257);
  const metadata = reviewMetadata(f.receipts[0].card.review);
  assert.deepEqual(metadata.operation.files, files);
  assert.equal(metadata.operation.message, message);
  assert.equal(metadata.checks[0].name, "noisy");
  assert.equal(existsSync(join(root, "agent/brabbler/reviews")), false);
});
test("check deadlines terminate noisy processes, while ordinary successful output is only display-limited", async () => {
  const command = `${JSON.stringify(process.execPath)} -e 'process.stdout.write("x".repeat(3*1024*1024))'`;
  assert.match(await run(command, [], root, true), /display limited/);
  await assert.rejects(run(`${JSON.stringify(process.execPath)} -e 'setInterval(()=>{},1000)'`, [], root, true, undefined, undefined, 50), /configured timeout/);
});
test("HEAD-restored attributes cannot execute a clean filter while preparing an unapproved candidate", async () => {
  const f = fixture("ask"), marker = join(root, `filter-marker-${count}`);
  writeFileSync(join(f.repo, ".gitattributes"), "base filter=forbidden\n");
  git(f.repo, "add", ".gitattributes"); git(f.repo, "commit", "-qm", "attributes");
  git(f.repo, "rm", ".gitattributes");
  git(f.repo, "config", "filter.forbidden.clean", `touch '${marker}'; cat`);
  writeFileSync(join(f.repo, "base"), "changed\n");
  const result = await executeGitOperation(f.repo, { action: "commit", checkout: f.repo, mode: "files", files: ["base"], message: "candidate" }, f.ui);
  assert.equal(result.isError, true); assert.match(result.content[0].text, /filter attributes/);
  assert.equal(f.cards.length, 0); assert.equal(existsSync(marker), false);
});
test("whole-file effect staging cannot run a configured fsmonitor hook", async () => {
  const f = fixture("allow"), hook = join(root, `monitor-${count}`), marker = `${hook}.ran`;
  writeFileSync(hook, `#!/bin/sh\nprintf ran > '${marker}'\nprintf '\\0'\n`, { mode: 0o755 });
  git(f.repo, "config", "core.fsmonitor", hook);
  writeFileSync(join(f.repo, "base"), "changed\n");
  success(await executeGitOperation(f.repo, { action: "commit", checkout: f.repo, mode: "files", files: ["base"], message: "candidate" }, f.ui));
  assert.equal(existsSync(marker), false);
});
test("external inventory sort preserves every escaped name and yields deterministically across runs", async () => {
  const path = join(root, "sort"); mkdirSync(path);
  const names = ["z", "a\nname", "quote\"", "b", "other", "last", "alpha"];
  for (const name of names) writeFileSync(join(path, name), "");
  const sorted = []; for await (const name of sortedDirectoryNames(path, () => {}, 2)) sorted.push(name);
  assert.deepEqual(sorted, [...names].sort());
});
