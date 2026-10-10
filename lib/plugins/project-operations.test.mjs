import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createJiti } from "jiti";

// Exercise the real project host, private record writes and decision route without
// loading Git adapters, the SDK, observer services or user settings/session data.
// Only admission/adapter/storage capabilities are stubbed; writes stay in this fixture.
const fixtureKey = Symbol.for("pi-web:test/project-acknowledgment");
const liveKey = Symbol.for("pi-web:project-operations/v1");
const terminal = (op) => ["succeeded", "failed", "cancelled", "outcome-unknown"].includes(op.state);
async function waitFor(read, predicate) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = await read();
    if (predicate(value)) return value;
    if (Date.now() > deadline) assert.fail(`Timed out: ${JSON.stringify(value)}`);
    await delay(5);
  }
}
async function fixture(t, required = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-project-ack-host-"))), cwd = join(root, "cwd");
  mkdirSync(cwd);
  const previous = [globalThis[fixtureKey], globalThis[liveKey]];
  const f = { root, cwd, enabled: true, admitted: true, preparations: 0, answers: [], loaded: new Set(), releases: [], failWrite: () => false,
    card: { title: "Exact generic review", fields: [{ label: "Resource", value: "resource-1" }],
      ...(required ? { requiredAcknowledgment: "I accept the listed loss." } : {}),
      actions: [{ id: "approve", label: "Approve", primary: true }, { id: "reject", label: "Keep" }] } };
  globalThis[fixtureKey] = f; globalThis[liveKey] = new Map();
  t.after(async () => {
    f.failWrite = () => false;
    for (const release of f.releases) release();
    for (const item of globalThis[liveKey].values()) item.controller.abort();
    await delay(20);
    [globalThis[fixtureKey], globalThis[liveKey]] = previous;
    rmSync(root, { recursive: true, force: true });
  });
  f.resolveProject = async () => ({ identity: root, anchor: cwd, relatedDirectories: [] });
  f.recordPath = (id) => join(root, "pi-web/project-operations", `${id}.json`);
  f.saved = (id) => JSON.parse(readFileSync(f.recordPath(id), "utf8"));
  f.receipt = (phase) => ({ version: 1, operationId: f.operationId, card: { ...f.card, operationId: f.operationId }, phase,
    authorization: { mode: "ask", source: "manual confirmation", revision: "fixture", decision: phase === "succeeded" ? "user-approved" : phase === "cancelled" ? "not-approved" : "pending" },
    checks: [], effectStarted: false });
  f.adapter = { resolveProject: (...args) => f.resolveProject(...args), execute: async (_cwd, _action, _payload, ui, signal) => {
    f.preparations++; f.ui = ui;
    ui.operationReceipt("example", f.receipt("prepared"));
    await f.beforeCard?.();
    const answer = await ui.pluginCard("example", f.card, signal);
    f.answers.push(answer);
    if (answer === "approve") f.atRelease = f.saved(f.operationId);
    ui.operationReceipt("example", f.receipt(answer === "approve" ? "succeeded" : "cancelled"));
    return { answer };
  } };
  f.plugin = { manifest: { id: "example" }, projectActions: f.adapter };
  const stubDir = join(root, "stubs"); mkdirSync(stubDir);
  const alias = {};
  const preamble = 'const f = globalThis[Symbol.for("pi-web:test/project-acknowledgment")];\n';
  const stub = (name, source) => { const path = join(stubDir, `${name}.cjs`); writeFileSync(path, preamble + `f.loaded.add(${JSON.stringify(name)});\n` + source); return path; };
  const bind = (specifier, target) => {
    alias[specifier] = target;
    if (specifier.startsWith(".")) {
      alias[`${specifier}.ts`] = target;
      const absolute = fileURLToPath(new URL(`${specifier}.ts`, new URL("./project-operations.ts", import.meta.url)));
      alias[absolute] = target; alias[absolute.slice(0, -3)] = target;
    }
  };
  bind("@earendil-works/pi-coding-agent", stub("agent", "exports.getAgentDir = () => f.root;"));
  bind("./registry", stub("registry", 'exports.bundledPlugin = (id) => { if (id !== "example") throw new Error("Unknown fixture plugin"); return f.plugin; };'));
  bind("./settings", stub("settings", "exports.readPluginSettings = () => ({ enabled: f.enabled });"));
  bind("../file-access", stub("access", 'exports.getAllowedFileRoots = async () => new Set([f.cwd]); exports.getKnownAllowedFileRoots = () => new Set([f.cwd]); exports.allowFileRoot = () => {}; exports.isFilePathAllowed = (path) => f.admitted && path === f.cwd; exports.isExistingFilePathAllowed = exports.isFilePathAllowed;'));
  bind("../atomic-file", stub("atomic", 'exports.writePrivateFileAtomicSync = (path, data) => { if (f.failWrite(JSON.parse(data))) throw new Error("fixture write failure"); require("node:fs").writeFileSync(path, data, { mode: 0o600 }); };'));
  bind("../directory-reservations", stub("reservation", "exports.acquireDirectoryReservation = () => () => {};"));
  bind("./review-store", stub("reviews", 'exports.preparePluginReview = () => { throw new Error("Unexpected review build"); };'));
  bind("../rpc-manager", stub("rpc", "exports.hasBusyRpcSessionWithin = () => false;"));
  bind("../terminal-manager", stub("terminal", "exports.hasActiveTerminalWithin = () => false;"));
  alias["@/lib/request-security"] = stub("security", "exports.isApiRequestAllowed = () => true;");
  alias["@/lib/plugins/project-operations"] = fileURLToPath(new URL("./project-operations.ts", import.meta.url));
  alias["@/lib/plugins/project-acknowledgment"] = fileURLToPath(new URL("./project-acknowledgment.ts", import.meta.url));
  const jiti = createJiti(import.meta.url, { alias, moduleCache: false, fsCache: false });
  f.host = await jiti.import("./project-operations.ts");
  for (const name of ["agent", "registry", "settings", "access", "atomic", "reservation", "reviews"])
    assert.ok(f.loaded.has(name), `Required capability stub was not loaded: ${name}`);
  f.input = { cwd, requestId: randomUUID(), action: "example-action", payload: { resource: "resource-1" } };
  f.prepare = async (input = f.input) => { f.operationId = input.requestId; return f.host.prepareProjectAction("example", input); };
  f.get = () => f.host.getProjectOperation("example", f.input.requestId);
  f.wait = (predicate = (op) => op.state === "review") => waitFor(f.get, predicate);
  f.decide = (decision, acknowledgment) => f.host.decideProjectOperation("example", f.input.requestId, cwd, decision, acknowledgment);
  f.route = () => jiti.import("../../app/api/plugins/bundled/[id]/project-actions/[operationId]/route.ts");
  return f;
}
const envelope = (op) => ({ cardDigest: op.acknowledgment.cardDigest, accepted: true });

test("host binds manual acknowledgment, persists before release, and checks duplicate approval envelopes", async (t) => {
  const f = await fixture(t); const first = await f.prepare(), review = await f.wait();
  assert.equal(first.id, f.input.requestId);
  assert.equal(review.acknowledgment.label, f.card.requiredAcknowledgment);
  assert.equal(review.acknowledgment.accepted, undefined);
  assert.deepEqual((await f.get()).acknowledgment, review.acknowledgment, "poll identity is stable");
  assert.deepEqual((await f.prepare()).acknowledgment, review.acknowledgment);
  assert.equal(f.preparations, 1, "UUID recovery does not reprepare");
  await assert.rejects(f.prepare({ ...f.input, payload: { resource: "resource-2" } }), /different preparation/);
  for (const answer of [undefined, { ...envelope(review), accepted: false }, { ...envelope(review), accepted: "true" },
    { ...envelope(review), cardDigest: "b".repeat(64) }, { ...envelope(review), extra: true }])
    await assert.rejects(f.decide("approve", answer), /acknowledgment/);
  assert.deepEqual(f.answers, []);
  const proof = envelope(review);
  await Promise.all([f.decide("approve", proof), f.decide("approve", proof)]);
  const result = await f.wait(terminal);
  assert.equal(result.state, "succeeded"); assert.deepEqual(f.answers, ["approve"]);
  assert.equal(f.atRelease.decision, "approve"); assert.equal(f.atRelease.acknowledgment.accepted, true);
  assert.equal(f.atRelease.acknowledgment.acceptedAt, f.atRelease.decisionAt);
  assert.equal(result.card, undefined); assert.equal(result.acknowledgment.accepted, true);
  assert.deepEqual(result.receipt.card.actions, []);
  await assert.rejects(f.ui.pluginCard("example", f.card), /already claimed/, "one operation cannot regain authority after a claim");
  assert.equal((await f.decide("approve", proof)).state, "succeeded");
  await assert.rejects(f.decide("approve"), /current exact card/);
  await assert.rejects(f.decide("approve", { ...proof, cardDigest: "c".repeat(64) }), /current exact card/);
  await assert.rejects(f.decide("reject"), /already claimed/);
  f.enabled = false;
  assert.equal((await f.prepare()).state, "succeeded", "saved UUID lookup works after disablement");
  assert.equal((await f.host.listProjectOperations("example", f.cwd))[0].acknowledgment.accepted, true);
  assert.ok(existsSync(f.recordPath(first.id)));
});

test("descriptor publication failure exposes no live controls or approval authority", async (t) => {
  const f = await fixture(t);
  f.failWrite = (record) => record.state === "review" && record.acknowledgment !== undefined;
  await f.prepare(); const result = await f.wait(terminal);
  assert.equal(result.state, "failed"); assert.equal(result.card, undefined);
  assert.equal(result.acknowledgment, undefined); assert.deepEqual(f.answers, []);
  assert.equal(f.saved(result.id).acknowledgment, undefined);
  assert.equal(result.receipt.card.requiredAcknowledgment, f.card.requiredAcknowledgment);
});

test("legacy review remains compatible with four-argument callers and rejects invented acknowledgment", async (t) => {
  const f = await fixture(t, false); await f.prepare(); const review = await f.wait();
  assert.equal(review.acknowledgment, undefined);
  await assert.rejects(f.decide("approve", { cardDigest: "a".repeat(64), accepted: true }), /does not accept/);
  await f.host.decideProjectOperation("example", f.input.requestId, f.cwd, "approve");
  assert.equal((await f.wait(terminal)).state, "succeeded");
  assert.deepEqual(f.answers, ["approve"]);
});

test("failed approval write preserves pending controls; Stop/reject revoke without healthy storage", async (t) => {
  for (const decision of ["approve", "reject", "stop"]) await t.test(decision, async (st) => {
    const f = await fixture(st); await f.prepare(); const review = await f.wait();
    f.failWrite = (record) => record.decision === decision;
    if (decision === "approve") {
      await assert.rejects(f.decide("approve", envelope(review)), /write failure/);
      const unchanged = await f.get();
      assert.ok(unchanged.card); assert.equal(unchanged.acknowledgment.accepted, undefined);
      assert.equal(f.saved(review.id).decision, undefined); assert.deepEqual(f.answers, []);
      f.failWrite = () => false;
      await f.decide("approve", envelope(review));
      assert.equal((await f.wait(terminal)).state, "succeeded");
    } else {
      const response = await f.decide(decision);
      assert.equal(response.card, undefined); assert.match(response.persistenceError, /Authority revoked/);
      await assert.rejects(f.decide("approve", envelope(review)), /already claimed/);
      await f.wait(terminal);
      assert.equal(f.answers.includes("approve"), false);
      assert.equal(response.acknowledgment.accepted, undefined);
    }
  });
});

test("identical replacement cards get fresh identity; in-flight ownership reads return current descriptor/card", async (t) => {
  const f = await fixture(t);
  f.adapter.execute = async (_cwd, _action, _payload, ui, signal) => {
    f.ui = ui; ui.operationReceipt("example", f.receipt("prepared"));
    const first = ui.pluginCard("example", f.card, signal);
    f.replace = () => { f.second = ui.pluginCard("example", f.card, signal); };
    await first;
    const answer = await f.second; f.answers.push(answer);
    ui.operationReceipt("example", f.receipt(answer === "approve" ? "succeeded" : "cancelled"));
    return { answer };
  };
  await f.prepare(); const original = await f.wait();
  let entered, release;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  f.releases.push(release);
  const resolve = f.resolveProject; let once = true;
  f.resolveProject = async (...args) => { if (once) { once = false; entered(); await gate; } return resolve(...args); };
  const staleRead = f.get(); await started;
  f.replace(); release();
  const current = await staleRead;
  assert.ok(current.card); assert.deepEqual(current.card, original.card);
  assert.notEqual(current.acknowledgment.cardDigest, original.acknowledgment.cardDigest);
  assert.equal(current.acknowledgment.accepted, undefined);
  await assert.rejects(f.decide("approve", envelope(original)), /current exact card/);
  await f.decide("approve", envelope(current));
  assert.equal((await f.wait(terminal)).state, "succeeded"); assert.deepEqual(f.answers, ["approve"]);
});

test("restart records preserve descriptors read-only, allow prepared-before-descriptor metadata and never replay", async (t) => {
  const f = await fixture(t); await f.prepare(); const review = await f.wait(), unfinished = f.saved(review.id);
  await f.decide("reject"); await f.wait(terminal);
  globalThis[liveKey].delete(review.id);
  writeFileSync(f.recordPath(review.id), JSON.stringify(unfinished));
  const historical = await f.get();
  assert.equal(historical.state, "outcome-unknown"); assert.equal(historical.card, undefined);
  assert.deepEqual(historical.acknowledgment, review.acknowledgment);
  assert.equal((await f.prepare()).state, "outcome-unknown");
  await assert.rejects(f.decide("approve", envelope(review)), /Historical/);
  assert.equal(f.preparations, 1);
  const preparedOnly = { ...unfinished, state: "preparing" }; delete preparedOnly.acknowledgment;
  writeFileSync(f.recordPath(review.id), JSON.stringify(preparedOnly));
  assert.equal((await f.get()).state, "outcome-unknown", "prepared receipt may precede creation of the live descriptor");
  for (const acknowledgment of [null, { ...review.acknowledgment, accepted: false }, { ...review.acknowledgment, accepted: true }]) {
    writeFileSync(f.recordPath(review.id), JSON.stringify({ ...unfinished, acknowledgment }));
    await assert.rejects(f.get(), /Invalid operation record/);
  }
});

test("Stop after approval retains accepted evidence and original acceptance time", async (t) => {
  const f = await fixture(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  f.releases.push(release);
  f.adapter.execute = async (_cwd, _action, _payload, ui, signal) => {
    ui.operationReceipt("example", f.receipt("prepared"));
    const answer = await ui.pluginCard("example", f.card, signal);
    f.answers.push(answer); await gate;
    ui.operationReceipt("example", f.receipt("cancelled")); return { answer };
  };
  await f.prepare(); const review = await f.wait();
  const approved = await f.decide("approve", envelope(review));
  const stopped = await f.decide("stop");
  assert.equal(stopped.card, undefined); assert.equal(stopped.acknowledgment.accepted, true);
  assert.equal(stopped.acknowledgment.acceptedAt, approved.acknowledgment.acceptedAt);
  release(); await f.wait(terminal);
  globalThis[liveKey].delete(review.id);
  const saved = await f.get(); assert.equal(saved.decision, "stop"); assert.equal(saved.acknowledgment.accepted, true);
});

test("decision HTTP boundary rejects malformed/non-approve envelopes without consuming review", async (t) => {
  const f = await fixture(t); await f.prepare(); const review = await f.wait(), route = await f.route();
  const post = (data) => route.POST(new Request("http://example.invalid/operation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    { params: Promise.resolve({ id: "example", operationId: review.id }) });
  for (const data of [null, [], "approve", { cwd: f.cwd, decision: "approve", acknowledgment: null },
    { cwd: f.cwd, decision: "approve", acknowledgment: { ...envelope(review), accepted: "true" } },
    { cwd: f.cwd, decision: "reject", acknowledgment: envelope(review) }, { cwd: f.cwd, decision: "stop", acknowledgment: envelope(review) },
    { cwd: f.cwd, decision: "approve", acknowledgment: { ...envelope(review), extra: true } },
    { cwd: f.cwd, decision: "approve", extra: true }, { cwd: f.cwd, decision: "approve" }]) {
    const response = await post(data); assert.equal(response.status, 409); assert.ok((await response.json()).error);
  }
  assert.ok((await f.get()).card); assert.deepEqual(f.answers, []);
  assert.equal((await post({ cwd: f.cwd, decision: "approve", acknowledgment: envelope(review) })).status, 200);
  assert.equal((await f.wait(terminal)).state, "succeeded");
});
