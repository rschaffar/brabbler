import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import * as api from "./git-invocation.ts";

const { captureGitInvocation: capture, assertGitInvocationCurrentSync: current,
  consumeGitInvocationSync: consume, retireGitInvocation: retire } = api;
const clone = (value) => structuredClone(value);
function resource(name = "source") {
  const identity = () => ({ device: "1", inode: "2", birthtime: "3" });
  return { projectRoot: resolve("/repo"), cwd: resolve(`/repo/${name}`), branch: name,
    commonDir: resolve("/repo/.git"), gitDir: resolve(`/repo/.git/worktrees/${name}`),
    identities: { project: identity(), checkout: identity(), common: identity(), git: identity(),
      marker: { ...identity(), changed: "4", size: "50" } } };
}
function binding() {
  return { kind: "integrate", source: resource(), target: resource("target"), candidateSha256: "a".repeat(64),
    owner: { sessionId: "session-A", sessionFile: resolve("/sessions/a.jsonl"), generation: "instance-A" } };
}
function fixture() {
  let epoch = 0, authorized = true, callback = () => {}, reader = () => String(epoch);
  const guards = { readAuthorityRevisionSync: () => reader(), assertCurrentSync: (data) => {
    assert.equal(authorized, true, "actual caller revoked");
    return callback(data);
  } };
  const data = binding();
  return { data, guards, capture: () => capture(data, guards), advance: () => { epoch++; },
    authorize: (value) => { authorized = value; }, callback: (fn) => { callback = fn; }, reader: (fn) => { reader = fn; } };
}
function frozenRecursively(value) {
  if (!value || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) frozenRecursively(child);
}

test("validated copy is deeply frozen; input and callback container cannot replace captured data/guards", () => {
  const f = fixture(), expected = clone(f.data);
  let observed;
  f.callback((data) => { observed = data; frozenRecursively(data); });
  const handle = f.capture();
  assert.notEqual(observed, f.data);
  assert.notEqual(observed.source.identities.checkout, f.data.source.identities.checkout);
  assert.equal(Object.getPrototypeOf(handle), null);
  assert.ok(Object.isFrozen(handle));
  assert.deepEqual(Reflect.ownKeys(handle), []);
  f.data.owner.generation = "replacement";
  f.data.source.identities.checkout.inode = "99";
  f.guards.assertCurrentSync = () => { throw new Error("replaced"); };
  f.guards.readAuthorityRevisionSync = () => "replacement";
  current(handle, expected);
  consume(handle, expected);
  current(handle, expected);
  assert.throws(() => { observed.owner.generation = "changed"; }, TypeError);
  retire(handle);
  retire(handle);
  assert.throws(() => current(handle, expected), /retired/);
});

test("every kind and optional target can be captured, without source object identity requirements", () => {
  for (const kind of ["verify", "commit", "prepare", "integrate", "workspace", "cleanup", "reconcile"]) {
    const f = fixture(); f.data.kind = kind; delete f.data.target;
    const handle = f.capture();
    consume(handle, clone(f.data));
    current(handle, clone(f.data));
  }
  const f = fixture();
  Object.setPrototypeOf(f.data, null);
  Object.setPrototypeOf(f.data.owner, null);
  consume(f.capture(), f.data);
});

test("reject malformed, unknown, accessor, inherited and exotic binding fields without invoking getters/traps", () => {
  let getters = 0;
  const mutations = [
    (b) => { b.extra = true; },
    (b) => { b[Symbol("extra")] = true; },
    (b) => { b.kind = "push"; },
    (b) => { b.candidateSha256 = "a".repeat(40); },
    (b) => { b.candidateSha256 = "A".repeat(64); },
    (b) => { b.owner.sessionId = ""; },
    (b) => { b.owner.sessionFile = "relative.jsonl"; },
    (b) => { b.owner.generation = undefined; },
    (b) => { b.owner.generation = 1; },
    (b) => { delete b.owner.generation; },
    (b) => { b.owner.extra = true; },
    (b) => { b.target = undefined; },
    (b) => { b.source.cwd = "/repo/../repo"; },
    (b) => { b.source.branch = "bad..branch"; },
    (b) => { b.source.identities.checkout.inode = "02"; },
    (b) => { b.source.identities.checkout.birthtime = "-1"; },
    (b) => { b.source.identities.checkout.extra = true; },
    (b) => { b.source.identities.marker.changed = undefined; },
    (b) => { b.source.identities = []; },
    (b) => { b.owner = new Date(); },
    (b) => { b.owner = Object.create(b.owner); },
    (b) => { const generation = b.owner.generation; delete b.owner.generation; Object.setPrototypeOf(b.owner, { generation }); },
    (b) => { Object.defineProperty(b, "source", { get() { getters++; return resource(); } }); },
    (b) => { Object.defineProperty(b.owner, "generation", { get() { getters++; return "instance-A"; } }); },
    (b) => { Object.defineProperty(b, "candidateSha256", { enumerable: false }); },
    (b) => { b.source = new Proxy(b.source, { getPrototypeOf() { getters++; return Object.prototype; } }); },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f.data);
    assert.throws(() => f.capture(), /Invalid Git invocation/);
  }
  assert.equal(getters, 0);
});

test("expected bindings independently compare every physical, candidate, kind and owner field; mismatch retires", () => {
  const mutations = [
    (b) => { b.kind = "commit"; }, (b) => { b.candidateSha256 = "b".repeat(64); },
    (b) => { b.owner.sessionId = "session-B"; }, (b) => { b.owner.sessionFile = resolve("/sessions/b.jsonl"); },
    (b) => { b.owner.generation = "instance-B"; }, (b) => { delete b.target; },
  ];
  for (const side of ["source", "target"]) {
    for (const field of ["projectRoot", "cwd", "commonDir", "gitDir", "branch"]) {
      mutations.push((b) => { b[side][field] += "-new"; });
    }
    for (const identity of ["project", "checkout", "common", "git", "marker"]) {
      for (const field of ["device", "inode", "birthtime"]) mutations.push((b) => { b[side].identities[identity][field] = "90"; });
    }
    for (const field of ["changed", "size"]) mutations.push((b) => { b[side].identities.marker[field] = "90"; });
  }
  for (const mutate of mutations) {
    const f = fixture(), handle = f.capture(), wrong = clone(f.data); mutate(wrong);
    assert.throws(() => consume(handle, wrong), /binding mismatch/);
    assert.throws(() => current(handle, f.data), /retired/);
  }
  const f = fixture(), handle = f.capture(), wrong = clone(f.data);
  Object.defineProperty(wrong.owner, "generation", { get() { throw new Error("must not execute"); } });
  assert.throws(() => current(handle, wrong), /data fields/);
  assert.throws(() => consume(handle, f.data), /retired/);
});

test("copies, frozen lookalikes, JSON, proxies and fresh-module handles never confer authority", async () => {
  const f = fixture(), handle = f.capture();
  for (const fake of [{ ...handle }, clone(handle), Object.freeze(Object.create(null)), JSON.parse(JSON.stringify(handle)),
    new Proxy(handle, {}), null, undefined, "session-A", 1]) {
    for (const operation of [current, consume, retire]) assert.throws(() => operation(fake, f.data), /unknown handle/);
  }
  const fresh = await import(`./git-invocation.ts?fresh=${Date.now()}`);
  assert.throws(() => fresh.consumeGitInvocationSync(handle, f.data), /unknown handle/);
  const freshHandle = fresh.captureGitInvocation(f.data, f.guards);
  assert.throws(() => consume(freshHandle, f.data), /unknown handle/);
  consume(handle, f.data);
});

test("one consumption, later fences allowed, duplicate consumption and explicit retirement are terminal", () => {
  const f = fixture(), handle = f.capture();
  current(handle, f.data); consume(handle, f.data); current(handle, f.data);
  assert.throws(() => consume(handle, f.data), /already consumed/);
  assert.throws(() => current(handle, f.data), /retired/);
  const other = f.capture(); retire(other); retire(other);
  assert.throws(() => consume(other, f.data), /retired/);
});

test("guard and both revision boundaries cannot recursively consume/assert or revive retirement, even if caught", () => {
  for (const boundary of ["guard", "first-read", "second-read"]) {
    for (const action of [consume, current, retire]) {
      const f = fixture(), handle = f.capture();
      const attack = () => { try { action(handle, f.data); } catch {} };
      if (boundary === "guard") f.callback(attack);
      else {
        let reads = 0;
        f.reader(() => { if (++reads === (boundary === "first-read" ? 1 : 2)) attack(); return "0"; });
      }
      assert.throws(() => consume(handle, f.data), /retired/);
      f.callback(() => {}); f.reader(() => "0");
      assert.throws(() => current(handle, f.data), /retired/);
    }
  }
});

test("capture and validation fence original revision before and after guards", () => {
  const capturing = fixture(); capturing.callback(() => { capturing.advance(); });
  assert.throws(() => capturing.capture(), /changed during capture/);
  for (const operation of [current, consume]) {
    const f = fixture(), handle = f.capture(); let calls = 0;
    f.callback(() => { calls++; }); f.advance();
    assert.throws(() => operation(handle, f.data), /revoked/);
    assert.equal(calls, 0);
    f.reader(() => "0");
    assert.throws(() => current(handle, f.data), /retired/);
    const g = fixture(), second = g.capture();
    g.callback(() => { g.advance(); });
    assert.throws(() => operation(second, g.data), /changed during validation/);
    g.callback(() => {}); g.reader(() => "0");
    assert.throws(() => current(second, g.data), /retired/);
  }
});

test("revocation across await and change-and-restore with monotonic epochs, including after consume", async () => {
  for (const consumed of [false, true]) {
    const f = fixture(), handle = f.capture();
    if (consumed) consume(handle, f.data);
    await Promise.resolve();
    f.advance(); f.authorize(false); f.advance(); f.authorize(true);
    assert.throws(() => current(handle, f.data), /revoked/);
  }
  const f = fixture(), handle = f.capture();
  f.authorize(false);
  assert.throws(() => consume(handle, f.data), /actual caller revoked/);
  f.authorize(true);
  assert.throws(() => consume(handle, f.data), /retired/);
});

test("trusted owner rejects copied history after owner generation replacement, even with the same session ID", () => {
  const data = binding(), history = clone(data);
  let actualGeneration = data.owner.generation;
  const guards = { readAuthorityRevisionSync: () => "0", assertCurrentSync: (captured) => {
    assert.equal(captured.owner.generation, actualGeneration, "owner instance replaced");
  } };
  const handle = capture(data, guards);
  actualGeneration = "replacement-instance";
  assert.throws(() => capture(history, guards), /owner instance replaced/);
  assert.throws(() => consume(handle, history), /owner instance replaced/);
  actualGeneration = data.owner.generation;
  assert.throws(() => current(handle, history), /retired/);
});

test("consumer consumes synchronously before effect and fences subsequent effects after awaits", async () => {
  const f = fixture(), handle = f.capture();
  let effects = 0;
  consume(handle, f.data);
  effects++;
  await Promise.resolve();
  f.advance();
  assert.throws(() => {
    current(handle, f.data);
    effects++;
  }, /revoked/);
  assert.equal(effects, 1); // A fence cannot undo, or attest success of, the first effect.
});

test("strict guards reject missing, malformed, async, generator, accessor, extra and baseline fields", () => {
  const good = () => ({ readAuthorityRevisionSync: () => "0", assertCurrentSync: () => {} });
  const bad = [undefined, {}, { ...good(), revision: "0" }, { ...good(), assertCurrentSync: undefined },
    { ...good(), readAuthorityRevisionSync: async () => "0" }, { ...good(), assertCurrentSync: async () => {} },
    { ...good(), assertCurrentSync: function* () {} }, { ...good(), assertCurrentSync: new Proxy(() => {}, {}) },
    Object.create(good())];
  let accessed = false;
  bad.push(Object.defineProperty(good(), "assertCurrentSync", { get() { accessed = true; return () => {}; } }));
  for (const guards of bad) assert.throws(() => capture(binding(), guards), /Invalid Git invocation/);
  assert.equal(accessed, false);
});

test("invalid/throwing/nonvoid readers and guards retire after capture; rejected promises/thenables are drained", async () => {
  const returns = [false, true, 0, "yes", null, {},
    () => Promise.reject(new Error("returned rejection")),
    () => ({ then(_resolve, reject) { reject(new Error("thenable rejection")); } }),
    () => Object.defineProperty({}, "then", { get() { throw new Error("throwing then getter"); } })];
  for (const boundary of ["guard", "reader"]) {
    for (const value of returns) {
      // A string is valid for a reader, but differs from the original revision.
      const result = () => typeof value === "function" ? value() : value;
      const f = fixture(), handle = f.capture();
      if (boundary === "guard") f.callback(result); else f.reader(result);
      assert.throws(() => consume(handle, f.data));
      f.callback(() => {}); f.reader(() => "0");
      assert.throws(() => current(handle, f.data), /retired/);
    }
    for (const cause of [() => new Error("guard threw"), () => Promise.reject(new Error("thrown rejection"))]) {
      const f = fixture(), handle = f.capture();
      const fail = () => { throw cause(); };
      if (boundary === "guard") f.callback(fail); else f.reader(fail);
      assert.throws(() => current(handle, f.data));
      f.callback(() => {}); f.reader(() => "0");
      assert.throws(() => current(handle, f.data), /retired/);
    }
  }
  for (const value of ["", "x".repeat(513), "newline\n", undefined, 1]) {
    assert.throws(() => capture(binding(), { readAuthorityRevisionSync: () => value, assertCurrentSync() {} }));
  }
  assert.throws(() => capture(binding(), { readAuthorityRevisionSync: () => Promise.reject(new Error("capture reader")), assertCurrentSync() {} }));
  assert.throws(() => capture(binding(), { readAuthorityRevisionSync: () => "0", assertCurrentSync: () => Promise.reject(new Error("capture guard")) }));
  // node:test also fails on unhandled rejections after a test completes.
  await new Promise((resolve) => setImmediate(resolve));
});

test("overlapping same-resource handles are independent, even inside another invocation guard", async () => {
  const a = fixture(), b = fixture();
  b.data.owner = { ...a.data.owner, sessionId: "session-B", generation: "instance-B" };
  const first = a.capture(), second = b.capture();
  a.callback(() => { consume(second, b.data); });
  consume(first, a.data);
  await Promise.resolve();
  retire(first);
  current(second, b.data);
  const third = b.capture();
  b.advance();
  assert.throws(() => current(third, b.data), /revoked/);
  const c = fixture(), independent = c.capture();
  consume(independent, c.data);
  current(independent, c.data);
});

test("diagnostic write failure and restored history neither block peers nor resurrect handles", () => {
  const f = fixture(), first = f.capture(), second = f.capture();
  consume(first, f.data);
  const history = JSON.stringify({ handle: first, binding: f.data, status: "success" });
  assert.throws(() => { throw new Error("optional diagnostics unavailable"); }, /unavailable/);
  retire(first);
  consume(second, f.data);
  current(second, f.data);
  assert.throws(() => consume(JSON.parse(history).handle, JSON.parse(history).binding), /unknown handle/);
  assert.throws(() => current(first, f.data), /retired/);
  // Old copied binding/session IDs still require a genuine current owner guard.
  f.authorize(false);
  assert.throws(() => capture(JSON.parse(history).binding, f.guards), /actual caller revoked/);
});
