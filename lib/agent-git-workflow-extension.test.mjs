import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const { createJiti } = await import("jiti");
const { createAgentGitWorkflowExtension } = await createJiti(import.meta.url).import("./agent-git-workflow-extension.ts");
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args])).stdout.trim();
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-web-agent-git-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await git(dir, "init", "-q", "-b", "target");
  await git(dir, "config", "user.name", "Test");
  await git(dir, "config", "user.email", "test@example.invalid");
  await writeFile(path.join(dir, "a"), "first\n");
  await git(dir, "add", "a");
  await git(dir, "commit", "-qm", "initial");
  let tool;
  createAgentGitWorkflowExtension(dir).factory({ registerTool: (value) => { tool = value; } });
  return { dir, tool };
}
const context = (cwd, gitAction) => ({ cwd, hasUI: true, ui: { gitAction } });

test("agent commit is human-bound even without a saved policy", async (t) => {
  const { dir, tool } = await fixture(t);
  await writeFile(path.join(dir, "a"), "changed\n");
  const original = await git(dir, "rev-parse", "HEAD");
  let shown;
  const params = { operation: "commit", paths: ["a"], message: "Exact message" };
  const refused = await tool.execute("call", params, undefined, undefined, context(dir, async (candidate) => {
    shown = candidate;
    return false;
  }));
  assert.equal(refused.details.approved, false);
  assert.equal(await git(dir, "rev-parse", "HEAD"), original);
  assert.equal(shown.kind, "commit");
  assert.equal(shown.preview.head, original);
  assert.deepEqual(shown.preview.paths, ["a"]);
  assert.match(shown.diff.patch, /\+changed/);
  assert.equal(shown.message, "Exact message");
  const approved = await tool.execute("call", params, undefined, undefined, context(dir, async () => true));
  assert.equal(approved.details.status, "committed");
  assert.deepEqual(approved.details.parents, [original]);
  assert.equal(await git(dir, "show", "-s", "--format=%s", "HEAD"), "Exact message");
});

test("changed candidate after approval fails closed; no implicit retry", async (t) => {
  const { dir, tool } = await fixture(t);
  await writeFile(path.join(dir, "a"), "changed\n");
  const original = await git(dir, "rev-parse", "HEAD");
  const response = await tool.execute("call", { operation: "commit", paths: ["a"], message: "Approve" }, undefined, undefined,
    context(dir, async () => { await writeFile(path.join(dir, "a"), "changed again\n"); return true; }));
  assert.equal(response.isError, true);
  assert.equal(await git(dir, "rev-parse", "HEAD"), original);
});

test("generic merge and individual comparison are read-only without policy", async (t) => {
  const { dir, tool } = await fixture(t);
  await git(dir, "checkout", "-qb", "feature");
  await writeFile(path.join(dir, "a"), "changed\n");
  await git(dir, "add", "a");
  await git(dir, "commit", "-qm", "one");
  const featureOid = await git(dir, "rev-parse", "HEAD");
  const candidates = [];
  const ui = context(dir, async (candidate) => { candidates.push(candidate); return true; });
  await tool.execute("call", { operation: "review", targetBranch: "target" }, undefined, undefined, ui);
  await tool.execute("call", { operation: "review", targetBranch: "target", commitOids: [featureOid] }, undefined, undefined, ui);
  assert.deepEqual(candidates.map((item) => item.selection.kind), ["merge", "commits"]);
  assert.equal(candidates[0].review.featureOid, featureOid);
  assert.match(candidates[0].diff.patch, /\+changed/);
  assert.equal(await git(dir, "rev-parse", "HEAD"), featureOid);
  assert.equal(await git(dir, "rev-parse", "target"), candidates[0].review.targetOid);
});

test("refuses mismatched cwd, missing UI and unreviewed mutations", async (t) => {
  const { dir, tool } = await fixture(t);
  const params = { operation: "commit", paths: ["a"], message: "No" };
  assert.equal((await tool.execute("call", params, undefined, undefined, context("/elsewhere", async () => true))).isError, true);
  assert.equal((await tool.execute("call", params, undefined, undefined, { cwd: dir, hasUI: false, ui: {} })).isError, true);
});
