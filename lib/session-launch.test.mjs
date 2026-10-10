import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { executeSessionLaunch, launchDirectory } = await jiti.import("../plugins/session-launch/server.ts");
const { sessionLaunchManifest: manifest } = await jiti.import("../plugins/session-launch/manifest.ts");
const { readPluginSettings, updatePluginSettings, pluginSettingsPath } = await jiti.import("./plugins/settings.ts");
const { validateOperationReceipt } = await jiti.import("./operation-receipts.ts");
const ID = "11111111-1111-4111-8111-111111111111", CHILD = "22222222-2222-4222-8222-222222222222";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-session-launch-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(root, { recursive: true, force: true }); });
  const cwd = join(root, "project"), foreign = join(root, "foreign");
  mkdirSync(cwd); mkdirSync(foreign);
  const caller = { id: ID, cwd };
  const set = (scope, values, destination = cwd, reset = []) => updatePluginSettings(manifest, scope, destination, values, reset, undefined, caller);
  const receipts = [], calls = [];
  let answer = { action: "approve" }, resolveCalls = 0;
  const host = {
    async resolve(request) { resolveCalls++; return { cwd: request.cwd, provider: "test", modelId: "fixture", thinkingLevel: "off", modelSpeed: "standard", toolNames: ["read"], accounts: {} }; },
    async start(config, prompt, creator, operationId, beforePrompt) { beforePrompt(CHILD); calls.push({ config, prompt, creator, operationId }); return CHILD; },
  };
  const ui = { operationReceipt(_id, receipt) { validateOperationReceipt(receipt); receipts.push(structuredClone(receipt)); },
    async pluginCardWithDetails(_id, card, signal) { assert.equal(signal.aborted, false); assert.equal(card.allowDetails, true); return answer; } };
  const run = (request = { prompt: "Exact task" }, signal) => executeSessionLaunch(request, caller, ui, signal, "call-1", host);
  return { root, cwd, foreign, caller, set, receipts, calls, host, ui, run, answer: (value) => { answer = value; }, resolveCalls: () => resolveCalls };
}
test("Ask approves one exact independent launch with durable stages and safe link", async (t) => {
  const f = fixture(t), result = await f.run();
  assert.equal(result.details.accepted, true); assert.equal(result.details.sessionId, CHILD);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].prompt, "Exact task");
  assert.deepEqual(f.receipts.map((r) => r.phase), ["prepared", "authorized", "executing", "executing", "succeeded"]);
  assert.equal(f.receipts.at(-1).authorization.decision, "user-approved");
  assert.equal(f.receipts.at(-1).effectStarted, true);
  assert.equal(f.receipts.at(-1).card.sessionLinks[0].sessionId, CHILD);
  assert.match(f.receipts.at(-1).summary, /not a claim.*task succeeded/);
});
test("request changes returns feedback, reject and cancellation never start", async (t) => {
  const f = fixture(t);
  for (const answer of [{ action: "request-changes", details: "Use the other directory" }, { action: "reject" }, null]) {
    f.answer(answer); const result = await f.run();
    assert.equal(result.details.accepted, false); assert.equal(f.calls.length, 0);
    assert.equal(result.details.requestChanges, answer?.action === "request-changes");
    if (answer?.details) assert.equal(result.details.feedback, answer.details);
    assert.equal(f.receipts.at(-1).phase, "cancelled");
  }
});
test("Allow records policy authorization and never shows a card; Deny precedes resolve", async (t) => {
  const f = fixture(t); f.set("session", { launch: "allow" });
  f.ui.pluginCardWithDetails = () => { throw new Error("must not ask"); };
  assert.equal((await f.run()).details.accepted, true);
  assert.equal(f.receipts.at(-1).authorization.decision, "policy-authorized");
  assert.equal(f.receipts.at(-1).authorization.source, "session");
  f.set("session", { launch: "deny" }); const previous = f.resolveCalls();
  assert.equal((await f.run()).isError, true); assert.equal(f.resolveCalls(), previous); assert.equal(f.calls.length, 1);
});
test("destination settings isolate foreign projects and spawned session IDs", async (t) => {
  const f = fixture(t); f.set("session", { launch: "allow" }); f.set("project", { launch: "deny" }, f.foreign);
  assert.equal((await f.run({ prompt: "Foreign", cwd: f.foreign })).isError, true);
  assert.equal(f.calls.length, 0);
  assert.equal(readPluginSettings(manifest, f.cwd, undefined, { id: CHILD, cwd: f.cwd }).effective.launch, "ask");
  f.set("project", { launch: "ask" }, f.foreign); let cards = 0;
  f.ui.pluginCardWithDetails = async () => { cards++; return { action: "approve" }; };
  assert.equal((await f.run({ prompt: "Foreign", cwd: f.foreign })).details.accepted, true); assert.equal(cards, 1);
  assert.equal(f.receipts.at(-1).authorization.source, "project");
});
test("Git linked worktrees share launch policy but foreign repositories do not", (t) => {
  const f = fixture(t), linked = join(f.root, "linked");
  const git = (...args) => execFileSync("git", ["-C", f.cwd, ...args], { stdio: "ignore" });
  git("init", "-b", "main"); git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgSign=false", "commit", "--allow-empty", "-m", "Initial");
  git("worktree", "add", "-b", "feature", linked); f.set("session", { launch: "allow" });
  assert.equal(readPluginSettings(manifest, linked, undefined, f.caller).effective.launch, "allow");
  assert.equal(readPluginSettings(manifest, f.foreign, undefined, f.caller).effective.launch, "ask");
});
test("relevant live changes cancel waiting approval and stale Allow does not start", async (t) => {
  const f = fixture(t);
  f.ui.pluginCardWithDetails = async (_id, _card, signal) => { f.set("session", { launch: "deny" }); assert.equal(signal.aborted, true); return { action: "approve" }; };
  assert.equal((await f.run()).isError, true); assert.equal(f.calls.length, 0);
  f.set("session", { launch: "allow" });
  const resolve = f.host.resolve;
  f.host.resolve = async (...args) => { const config = await resolve(...args); f.set("global", { enabled: false }); return config; };
  assert.equal((await f.run()).isError, true); assert.equal(f.calls.length, 0);
});
test("destination replacement during approval refuses; relative/file paths and malformed settings fail closed", async (t) => {
  const f = fixture(t);
  f.ui.pluginCardWithDetails = async () => { renameSync(f.cwd, f.cwd + "-old"); mkdirSync(f.cwd); return { action: "approve" }; };
  assert.equal((await f.run()).isError, true); assert.equal(f.calls.length, 0);
  assert.throws(() => launchDirectory("relative"), /absolute/);
  writeFileSync(join(f.root, "file"), "x"); assert.throws(() => launchDirectory(join(f.root, "file")), /not a directory/);
  f.set("global", {}); writeFileSync(pluginSettingsPath(manifest), "invalid");
  assert.equal((await f.run()).isError, true); assert.equal(f.calls.length, 0);
});
test("receipt failure before effect refuses; post-creation errors retain identity and honest outcome", async (t) => {
  const f = fixture(t); f.ui.operationReceipt = () => { throw new Error("disk full"); };
  assert.equal((await f.run()).isError, true); assert.equal(f.calls.length, 0);
  f.ui.operationReceipt = (_id, receipt) => f.receipts.push(structuredClone(receipt));
  f.host.start = async (_config, _prompt, _caller, _operationId, beforePrompt) => { beforePrompt(CHILD); throw new Error("preflight rejected"); };
  const failed = await f.run();
  assert.equal(failed.isError, true); assert.equal(failed.details.accepted, false); assert.equal(failed.details.sessionId, CHILD);
  assert.equal(f.receipts.at(-1).effectStarted, true); assert.match(f.receipts.at(-1).summary, /retained/);
});
test("failure to persist completion never reports rollback or loses actual prompt acceptance", async (t) => {
  const f = fixture(t);
  f.ui.operationReceipt = (_id, receipt) => { if (["succeeded", "failed"].includes(receipt.phase)) throw new Error("terminal receipt unavailable"); };
  const result = await f.run();
  assert.equal(result.isError, true); assert.equal(result.details.accepted, true); assert.equal(result.details.sessionId, CHILD);
  assert.equal(result.details.receiptError, "terminal receipt unavailable"); assert.equal(f.calls.length, 1);
});
test("Stop during startup retains created session but prevents its initial prompt", async (t) => {
  const f = fixture(t), controller = new AbortController();
  f.host.start = async (_config, _prompt, _caller, _operationId, beforePrompt) => { controller.abort(); beforePrompt(CHILD); throw new Error("unreachable"); };
  const result = await f.run(undefined, controller.signal);
  assert.equal(result.isError, true); assert.equal(result.details.sessionId, CHILD); assert.equal(result.details.accepted, false);
  assert.equal(f.calls.length, 0);
});
