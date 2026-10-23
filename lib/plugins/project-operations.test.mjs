import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";

// Import the real leaf host once. No registry, SDK, Git, observer services, builtin
// patches, test globals or uncached transitive reimports are needed for host rules.
const jiti = createJiti(import.meta.url);
const { createProjectOperationHost } = await jiti.import("./project-operation-host.ts");
const { createFileProjectOperationStore } = await jiti.import("./project-operation-store.ts");
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function clock() {
  let now = Date.parse("2026-10-22T00:00:00.000Z");
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, ms) { const timer = { unref() {} }; timers.set(timer, { at: now + ms, callback }); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    get pending() { return timers.size; },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback();
      }
      now = end;
    },
  };
}
async function fixture(t, required = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-project-host-"))), cwd = join(root, "cwd");
  mkdirSync(cwd);
  const f = { root, cwd, enabled: true, admitted: true, preparations: 0, answers: [], releases: [], owned: [], writes: [],
    scheduler: clock(), pending: [], failWrite: () => false,
    card: { title: "Exact generic review", fields: [{ label: "Resource", value: "resource-1" }],
      ...(required ? { requiredAcknowledgment: "I accept the listed loss." } : {}),
      actions: [{ id: "approve", label: "Approve", primary: true }, { id: "reject", label: "Keep" }] } };
  t.after(async () => {
    f.failWrite = () => false;
    for (const { host, id } of f.owned) host.abort(id);
    for (const release of f.releases) release();
    // Join every started run, including error reporting, before private-file removal.
    const results = await Promise.allSettled(f.owned.map(({ done }) => done.fullySettled).concat(f.pending));
    const errors = results.filter((item) => item.status === "rejected").map((item) => item.reason);
    try { rmSync(root, { recursive: true, force: true }); } catch (error) { errors.push(error); }
    try { assert.equal(f.scheduler.pending, 0, "no owned review timer survives teardown"); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "Owned project-host cleanup failed");
  });
  f.resolveProject = async () => ({ identity: root, anchor: cwd, relatedDirectories: [] });
  f.recordPath = (id) => join(root, "records", `${id}.json`);
  f.saved = (id) => JSON.parse(readFileSync(f.recordPath(id), "utf8"));
  const files = createFileProjectOperationStore(() => join(root, "records"));
  f.store = { ...files, save(record) {
    f.writes.push(structuredClone(record));
    if (f.failWrite(record)) throw new Error("fixture write failure");
    files.save(record);
  } };
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
  f.createHost = (live) => createProjectOperationHost({
    store: f.store, scheduler: f.scheduler,
    capability(id) { if (id !== "example") throw new Error("Unknown fixture plugin"); return { plugin: f.plugin, adapter: f.adapter }; },
    enabled: () => f.enabled,
    admission: {
      async allowed(path) { if (!f.admitted || path !== cwd) throw new Error("Access denied"); },
      assertInvocation(path) { if (!f.admitted || path !== cwd) throw new Error("Invocation directory access changed"); },
      admitRelated(paths) { f.admitRelated?.(paths); },
    },
    observers: async () => { await f.loadObservers?.(); return () => false; },
    reserveDirectory: () => () => {}, prepareReview: () => { throw new Error("Unexpected review build"); },
  }, live);
  f.host = f.createHost();
  f.input = { cwd, requestId: randomUUID(), action: "example-action", payload: { resource: "resource-1" } };
  f.prepare = async (input = f.input) => {
    f.operationId = input.requestId;
    const op = await f.host.prepareProjectAction("example", input);
    if (!f.owned.some((item) => item.host === f.host && item.id === op.id)) {
      f.owned.push({ host: f.host, id: op.id, done: f.host.completion(op.id) });
    }
    return op;
  };
  f.own = (promise) => { promise.catch(() => {}); f.pending.push(promise); return promise; };
  f.get = () => f.host.getProjectOperation("example", f.input.requestId);
  f.wait = async () => { await f.host.completion(f.input.requestId).reviewReady; return f.get(); };
  f.settle = async () => { await f.host.completion(f.input.requestId).fullySettled; return f.get(); };
  f.decide = (decision, acknowledgment) => f.host.decideProjectOperation("example", f.input.requestId, cwd, decision, acknowledgment);
  f.route = async () => {
    // Only the route's imported API is bound here; no production global/test hook.
    const path = join(root, "route-host.cjs");
    writeFileSync(path, `let host, allowed = true; exports.bind = (value) => { host = value; };
exports.setAllowed = (value) => { allowed = value; };
exports.isApiRequestAllowed = () => allowed;
exports.getProjectOperation = (...args) => host.getProjectOperation(...args);
exports.decideProjectOperation = (...args) => host.decideProjectOperation(...args);`);
    const loader = createJiti(import.meta.url, { alias: {
      "@/lib/request-security": path, "@/lib/plugins/project-operations": path,
      "@/lib/plugins/project-acknowledgment": fileURLToPath(new URL("./project-acknowledgment.ts", import.meta.url)),
    } });
    f.routeBridge = await loader.import(path); f.routeBridge.bind(f.host);
    return loader.import("../../app/api/plugins/bundled/[id]/project-actions/[operationId]/route.ts");
  };
  return f;
}

const envelope = (op) => ({ cardDigest: op.acknowledgment.cardDigest, accepted: true });

test("host binds manual acknowledgment, persists before release, and checks duplicate approval envelopes", async (t) => {
  const f = await fixture(t); const first = await f.prepare(), review = await f.wait();
  assert.equal(first.id, f.input.requestId);
  assert.equal(review.acknowledgment.label, f.card.requiredAcknowledgment);
  assert.equal(review.acknowledgment.accepted, undefined);
  assert.deepEqual((await f.get()).acknowledgment, review.acknowledgment, "status identity is stable");
  assert.deepEqual((await f.prepare()).acknowledgment, review.acknowledgment);
  assert.equal(f.preparations, 1, "UUID recovery does not reprepare");
  await assert.rejects(f.prepare({ ...f.input, payload: { resource: "resource-2" } }), /different preparation/);
  for (const answer of [undefined, { ...envelope(review), accepted: false }, { ...envelope(review), accepted: "true" },
    { ...envelope(review), cardDigest: "b".repeat(64) }, { ...envelope(review), extra: true }])
    await assert.rejects(f.decide("approve", answer), /acknowledgment/);
  assert.deepEqual(f.answers, []);
  const proof = envelope(review);
  await Promise.all([f.decide("approve", proof), f.decide("approve", proof)]);
  const result = await f.settle();
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
  // A regression could publish controls instead of failing. Observe that named
  // boundary first so the test fails promptly rather than joining an unanswered card.
  await f.prepare(); const result = await f.wait();
  assert.equal(result.state, "failed"); assert.equal(result.card, undefined);
  assert.equal(result.acknowledgment, undefined); assert.deepEqual(f.answers, []);
  assert.equal(f.saved(result.id).acknowledgment, undefined);
  assert.equal(result.receipt.card.requiredAcknowledgment, f.card.requiredAcknowledgment);
  await f.settle();
});

test("legacy review remains compatible with four-argument callers and rejects invented acknowledgment", async (t) => {
  const f = await fixture(t, false); await f.prepare(); const review = await f.wait();
  assert.equal(review.acknowledgment, undefined);
  await assert.rejects(f.decide("approve", { cardDigest: "a".repeat(64), accepted: true }), /does not accept/);
  await f.host.decideProjectOperation("example", f.input.requestId, f.cwd, "approve");
  assert.equal((await f.settle()).state, "succeeded");
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
      assert.equal((await f.settle()).state, "succeeded");
    } else {
      const response = await f.decide(decision);
      assert.equal(response.card, undefined); assert.match(response.persistenceError, /Authority revoked/);
      await assert.rejects(f.decide("approve", envelope(review)), /already claimed/);
      const result = await f.settle();
      assert.equal(result.state, "outcome-unknown"); assert.match(result.persistenceError, /write failure/);
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
  const staleRead = f.own(f.get()); await started;
  f.replace(); release();
  const current = await staleRead;
  assert.ok(current.card); assert.deepEqual(current.card, original.card);
  assert.notEqual(current.acknowledgment.cardDigest, original.acknowledgment.cardDigest);
  assert.equal(current.acknowledgment.accepted, undefined);
  await assert.rejects(f.decide("approve", envelope(original)), /current exact card/);
  await f.decide("approve", envelope(current));
  assert.equal((await f.settle()).state, "succeeded"); assert.deepEqual(f.answers, ["approve"]);
});

test("restart records preserve descriptors read-only, allow prepared-before-descriptor metadata and never replay", async (t) => {
  const f = await fixture(t); await f.prepare(); const review = await f.wait(), unfinished = f.saved(review.id);
  await f.decide("reject"); await f.settle();
  f.host = f.createHost();
  writeFileSync(f.recordPath(review.id), JSON.stringify(unfinished));
  const historical = await f.get();
  assert.equal(historical.state, "outcome-unknown"); assert.equal(historical.card, undefined);
  assert.deepEqual(historical.acknowledgment, review.acknowledgment);
  assert.equal((await f.host.prepareProjectAction("example", f.input)).state, "outcome-unknown");
  await assert.rejects(f.decide("approve", envelope(review)), /Historical/);
  assert.equal(f.preparations, 1);
  const dispatched = { ...unfinished, state: "dispatched", receipt: { ...unfinished.receipt, phase: "executing" } };
  writeFileSync(f.recordPath(review.id), JSON.stringify(dispatched));
  assert.equal((await f.get()).state, "outcome-unknown"); assert.equal((await f.get()).card, undefined);
  assert.equal((await f.host.prepareProjectAction("example", f.input)).state, "outcome-unknown");
  await assert.rejects(f.decide("approve", envelope(review)), /Historical/);
  assert.equal(f.preparations, 1, "saved dispatch intent cannot replay");
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
  f.scheduler.advance(1000);
  const stopped = await f.decide("stop");
  assert.notEqual(stopped.decisionAt, approved.decisionAt);
  assert.equal(stopped.card, undefined); assert.equal(stopped.acknowledgment.accepted, true);
  assert.equal(stopped.acknowledgment.acceptedAt, approved.acknowledgment.acceptedAt);
  release(); await f.settle();
  f.host = f.createHost();
  const saved = await f.get(); assert.equal(saved.decision, "stop"); assert.equal(saved.acknowledgment.accepted, true);
  assert.equal((await f.host.prepareProjectAction("example", f.input)).state, "cancelled");
  await assert.rejects(f.decide("approve", envelope(review)), /Historical/);
  assert.throws(() => f.host.completion(review.id), /no owned completion/, "saved consent cannot reconstruct a run");
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
  f.routeBridge.setAllowed(false);
  const denied = await post({ cwd: f.cwd, decision: "approve", acknowledgment: envelope(review) });
  assert.equal(denied.status, 403); assert.match((await denied.json()).error, /Untrusted/);
  assert.ok((await f.get()).card, "untrusted HTTP approval did not consume authority");
  f.routeBridge.setAllowed(true);
  const approved = await post({ cwd: f.cwd, decision: "approve", acknowledgment: envelope(review) });
  assert.equal(approved.status, 200); await approved.json();
  assert.equal((await f.settle()).state, "succeeded");
});

test("reviewReady waits for observer loading; abort joins loading and failed error persistence", async (t) => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  f.releases.push(release.resolve);
  f.loadObservers = async () => { entered.resolve(); await release.promise; throw new Error("observer load failed"); };
  await f.prepare(); await entered.promise;
  const done = f.host.completion(f.input.requestId);
  let reviewReady = false, fullySettled = false;
  done.reviewReady.then(() => { reviewReady = true; }); done.fullySettled.then(() => { fullySettled = true; });
  f.host.abort(f.input.requestId);
  assert.equal((await f.get()).card, undefined);
  assert.equal(f.preparations, 0); assert.equal(reviewReady, false); assert.equal(fullySettled, false);
  let failedReport = false;
  f.failWrite = (record) => { if (record.state === "cancelled") { failedReport = true; return true; } return false; };
  release.resolve(); await done.fullySettled; await done.reviewReady;
  const result = await f.get();
  assert.equal(failedReport, true); assert.equal(result.state, "outcome-unknown");
  assert.match(result.persistenceError, /write failure/); assert.equal(f.preparations, 0);
  assert.equal(result.card, undefined); assert.equal(f.scheduler.pending, 0);
});

test("fullySettled joins adapter finally and both terminal persistence failure handlers", async (t) => {
  const f = await fixture(t), inFinally = deferred(), release = deferred();
  f.releases.push(release.resolve);
  const execute = f.adapter.execute;
  f.adapter.execute = async (...args) => {
    try { return await execute(...args); }
    finally { inFinally.resolve(); await release.promise; }
  };
  await f.prepare(); const review = await f.wait();
  const done = f.host.completion(review.id); let settled = false;
  done.fullySettled.then(() => { settled = true; });
  await f.decide("approve", envelope(review)); await inFinally.promise;
  assert.equal((await f.get()).receipt.phase, "succeeded", "result receipt is not executor closure");
  assert.equal(settled, false);
  const failures = [];
  f.failWrite = (record) => { if (["succeeded", "failed"].includes(record.state)) { failures.push(record.state); return true; } return false; };
  release.resolve(); await done.fullySettled;
  assert.deepEqual(failures, ["succeeded", "failed"], "success reporting AND its failure handler ran");
  const result = await f.get(); assert.equal(result.state, "outcome-unknown");
  assert.equal(result.receipt.phase, "succeeded"); assert.match(result.persistenceError, /write failure/);
  assert.equal(result.card, undefined); assert.equal(f.scheduler.pending, 0);
});

test("review expires at exactly fifteen scheduled minutes, revoking controls without effects", { timeout: 5000 }, async (t) => {
  const f = await fixture(t); await f.prepare(); const review = await f.wait();
  assert.equal(review.expiresAt, new Date(f.scheduler.now() + 15 * 60_000).toISOString());
  assert.equal(f.scheduler.pending, 1);
  f.scheduler.advance(15 * 60_000 - 1);
  assert.ok((await f.get()).card); assert.deepEqual(f.answers, []);
  f.scheduler.advance(1);
  // No intervening status poll or real timer is needed for expiry delivery.
  const result = await f.settle();
  assert.equal(result.state, "cancelled"); assert.equal(result.card, undefined);
  assert.equal(result.expiresAt, undefined); assert.deepEqual(f.answers, [null]);
  assert.equal(result.acknowledgment.accepted, undefined); assert.equal(f.scheduler.pending, 0);
  await assert.rejects(f.decide("approve", envelope(review)), /current exact card/);
});

test("replacement expiry starts anew and approval one millisecond before expiry clears its timer", { timeout: 5000 }, async (t) => {
  const f = await fixture(t), replacement = deferred(); f.releases.push(replacement.resolve);
  f.adapter.execute = async (_cwd, _action, _payload, ui, signal) => {
    ui.operationReceipt("example", f.receipt("prepared"));
    const first = ui.pluginCard("example", f.card, signal);
    f.replace = () => replacement.resolve(ui.pluginCard("example", f.card, signal));
    await first;
    const answer = await replacement.promise; f.answers.push(answer);
    ui.operationReceipt("example", f.receipt(answer === "approve" ? "succeeded" : "cancelled"));
    return { answer };
  };
  await f.prepare(); const original = await f.wait();
  f.scheduler.advance(1000); f.replace(); const current = await f.get();
  assert.notEqual(current.acknowledgment.cardDigest, original.acknowledgment.cardDigest);
  assert.equal(f.scheduler.pending, 1, "replacement cleared the old timer");
  f.scheduler.advance(15 * 60_000 - 1);
  await f.decide("approve", envelope(current));
  assert.equal((await f.settle()).state, "succeeded"); assert.deepEqual(f.answers, ["approve"]);
  assert.equal(f.scheduler.pending, 0); f.scheduler.advance(1);
  assert.equal((await f.get()).state, "succeeded");
});

test("related-root admission rejects after claim, joins reporting and never replays the UUID", async (t) => {
  for (const failReport of [false, true]) await t.test(`failure reporting ${failReport ? "fails" : "succeeds"}`, async (st) => {
    const f = await fixture(st), admissionError = new Error("fixture related-root admission failure");
    const id = f.input.requestId; let admissions = 0, observers = 0;
    f.loadObservers = () => { observers++; };
    f.admitRelated = () => {
      admissions++;
      assert.equal(f.saved(id).state, "preparing", "durable UUID claim precedes related-root admission");
      throw admissionError;
    };
    f.failWrite = (record) => failReport && record.state === "failed";
    let done;
    try {
      await assert.rejects(f.host.prepareProjectAction("example", f.input), (error) => error === admissionError,
        "preparation/HTTP caller still receives the original admission error, not an operation response or a reporting error");
    } finally {
      // Rejection after claim still creates an owned reporting lifetime. Register
      // it even if the rejection assertion fails; teardown must join it too.
      done = f.host.completion(id); f.owned.push({ host: f.host, id, done });
    }
    await done.fullySettled; await done.reviewReady;
    const result = await f.get();
    assert.equal(result.state, failReport ? "outcome-unknown" : "failed");
    assert.equal(result.error, admissionError.message);
    if (failReport) assert.match(result.persistenceError, /write failure/);
    assert.equal(f.saved(id).state, failReport ? "preparing" : "failed");
    assert.equal(result.card, undefined); assert.equal(result.receipt, undefined);
    assert.equal(f.ui, undefined); assert.deepEqual(f.answers, []);
    assert.equal(f.scheduler.pending, 0); assert.equal(observers, 0); assert.equal(f.preparations, 0);
    assert.equal(f.host.completion(id).fullySettled, done.fullySettled);
    assert.equal((await f.host.prepareProjectAction("example", f.input)).state, result.state);
    await assert.rejects(f.host.prepareProjectAction("example", { ...f.input, payload: { changed: true } }), /different preparation/);
    assert.equal(admissions, 1, "a rejected preparation does not free its claimed UUID");

    f.host = f.createHost();
    const historical = await f.get();
    assert.equal(historical.state, failReport ? "outcome-unknown" : "failed");
    assert.equal(historical.card, undefined);
    assert.equal((await f.host.prepareProjectAction("example", f.input)).state, historical.state);
    await assert.rejects(f.decide("approve"), /Historical/);
    assert.throws(() => f.host.completion(id), /no owned completion/, "history cannot fabricate executor work");
    assert.equal(admissions, 1); assert.equal(observers, 0); assert.equal(f.preparations, 0);
  });
});

test("initial persistence failure admits no executor or completion", async (t) => {
  const f = await fixture(t); f.failWrite = () => true;
  await assert.rejects(f.prepare(), /write failure/);
  assert.equal(f.preparations, 0); assert.equal(existsSync(f.recordPath(f.input.requestId)), false);
  assert.throws(() => f.host.completion(f.input.requestId), /no owned completion/);
});

test("HMR owners share a live decision and completion, but separate instances remain isolated", async (t) => {
  const f = await fixture(t), other = await fixture(t), shared = new Map();
  f.host = f.createHost(shared); await f.prepare(); const review = await f.wait();
  const original = f.host.completion(review.id); f.host = f.createHost(shared);
  assert.equal(f.host.completion(review.id).fullySettled, original.fullySettled);
  assert.equal((await f.prepare()).id, review.id); assert.equal(f.preparations, 1);
  await other.prepare(); const otherReview = await other.wait();
  await f.decide("reject"); await original.fullySettled;
  assert.ok((await other.get()).card, "rejecting one owner cannot abort another instance");
  await other.decide("approve", envelope(otherReview)); assert.equal((await other.settle()).state, "succeeded");
});

test("host ports retain ownership, invocation admission and plugin identity guards", async (t) => {
  const f = await fixture(t); f.admitted = false;
  await assert.rejects(f.prepare(), /Access denied/); assert.equal(f.preparations, 0);
  f.admitted = true; await f.prepare(); await f.wait();
  await assert.rejects(f.host.getProjectOperation("foreign", f.input.requestId), /not found/);
  const resolve = f.resolveProject; f.resolveProject = async () => ({ identity: "changed", anchor: f.cwd, relatedDirectories: [] });
  await assert.rejects(f.get(), /identity changed/); f.resolveProject = resolve;
  assert.throws(() => f.ui.operationReceipt("foreign", f.receipt("executing")), /owner mismatch/);
  await assert.rejects(f.ui.pluginCard("foreign", f.card), /owner mismatch/);
  f.admitted = false;
  assert.throws(() => f.ui.operationReceipt("example", f.receipt("executing")), /access changed/);
  f.admitted = true; await f.decide("reject"); await f.settle();
});


test("fixture disposal releases and joins a held loader before removing private files", async (t) => {
  let f, loaded = false, settledWhileFilesExist = false;
  await t.test("leave preparation held for the owner", async (st) => {
    f = await fixture(st); const entered = deferred(), release = deferred();
    f.releases.push(release.resolve);
    f.loadObservers = async () => {
      entered.resolve(); await release.promise;
      assert.ok(existsSync(f.root), "observer completion still owns the fixture files"); loaded = true;
    };
    await f.prepare(); await entered.promise;
    f.own(f.host.completion(f.input.requestId).fullySettled.then(() => {
      assert.ok(existsSync(f.root), "error/terminal reporting finished before file removal");
      settledWhileFilesExist = true;
    }));
    // Deliberately return with loading held. The registered owner must abort,
    // release and join; no timer or terminal-state poll can satisfy this proof.
  });
  assert.equal(loaded, true); assert.equal(settledWhileFilesExist, true);
  assert.equal(f.preparations, 0); assert.equal(existsSync(f.root), false);
});
