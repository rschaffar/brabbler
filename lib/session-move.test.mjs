import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";
import { bindingTestModule } from "./git-workflow-binding-test-loader.mjs";

const jiti = createJiti(import.meta.url);
const usage = await jiti.import("./git-workspace-usage.ts");
const require = createRequire(import.meta.url);
const known = () => ({ known: true, entries: [] });
const empty = () => ({ sessions: known(), terminals: known(), checks: known(), inflight: known() });
const { outputText } = ts.transpileModule(readFileSync(new URL("./session-move.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

test("binding fault-injection loader retains the real shared cleanup placement fence", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-loader-usage-")), child = join(root, "child"); mkdirSync(child);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let settingsCalls = 0;
  const imports = { "@earendil-works/pi-coding-agent": { getAgentDir: () => join(root, "fixture-agent") },
    "./git-workflow-settings-store": { withGitWorkflowSettingsLock() { settingsCalls++; throw new Error("must not move"); } } };
  for (const name of ["rpc-manager", "session-reader", "session-path", "subagents", "subagent-runtime", "git-workflow-binding-store", "git-workflow-write-epoch"]) imports[`./${name}`] = {};
  // Deliberately omit ./git-workspace-usage: the loader must resolve its REAL TS
  // implementation and share the Symbol lease with the normally loaded module.
  const loaded = bindingTestModule("./session-move.ts", imports);
  const lease = usage.createTrustedWorkspaceUsage(empty).acquireLease(root);
  try {
    await assert.rejects(loaded.moveSessionFamily("fixture", child), /cleanup blocks session relocation/);
    assert.equal(settingsCalls, 0);
    lease.assertUnused();
  } finally { lease.release(); }
});

test("cleanup fences moves before family/settings lock waits; queued destination placements block leases", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-move-usage-")), child = join(root, "child"); mkdirSync(child);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let unlock, settingsCalls = 0;
  const sentinel = new Error("fixture stops before any actual move");
  const context = { exports: {}, __piSessionMoveLock: new Promise((resolve) => { unlock = resolve; }), require(id) {
    if (id === "./git-workspace-usage") return usage;
    if (id === "@earendil-works/pi-coding-agent") return { getAgentDir: () => join(root, "fixture-agent") };
    if (id === "./git-workflow-settings-store") return { withGitWorkflowSettingsLock() { settingsCalls++; throw sentinel; } };
    if (id.startsWith("node:")) return require(id);
    return {};
  } };
  runInNewContext(outputText, context);
  const trusted = usage.createTrustedWorkspaceUsage(empty);
  const lease = trusted.acquireLease(root);
  await assert.rejects(context.exports.moveSessionFamily("fixture", child), /cleanup blocks session relocation/);
  assert.equal(settingsCalls, 0);
  lease.release();
  const moving = context.exports.moveSessionFamily("fixture", child);
  const failure = assert.rejects(moving, (error) => error === sentinel);
  assert.throws(() => trusted.acquireLease(root), (error) => error.code === "inflight");
  assert.equal(settingsCalls, 0);
  unlock(); await failure;
  assert.equal(settingsCalls, 1);
  const after = trusted.acquireLease(root); after.release();
  assert.equal(context.__piSessionMoveLock, undefined);
});
