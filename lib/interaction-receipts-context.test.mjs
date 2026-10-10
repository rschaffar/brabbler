import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildSessionContext, sliceActiveBranch } = await jiti.import("./session-reader.ts");
const route = readFileSync(new URL("../app/api/sessions/[id]/context/route.ts", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replace("export async function GET", "async function GET");
const javascript = ts.transpileModule(route + "\nreturn GET;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const message = (id, parentId) => ({ type: "message", id, parentId, timestamp: "2026-10-06T10:00:00.000Z",
  message: { role: "user", content: id } });

function setup({ diskAhead = false, running = false } = {}) {
  const entries = [message("root", null), message("a", "root")];
  for (let i = 0; i < 55; i++) entries.push(message(`a-${i}`, i === 0 ? "a" : `a-${i - 1}`));
  entries.push(message("b", "root"));
  let leaf = "a-54";
  const sm = { getEntries: () => entries, getLeafId: () => leaf,
    getEntry: (id) => entries.find((entry) => entry.id === id),
    getBranch: (id) => sliceActiveBranch(entries, id, entries.length) };
  const diskEntries = [...entries, { type: "custom", id: "restore-marker", parentId: "a-54",
    timestamp: "2026-10-06T10:01:00.000Z", customType: "pi-web:archive", data: { archived: false } }];
  const disk = { getEntries: () => diskEntries, getLeafId: () => "restore-marker",
    getBranch: (id) => sliceActiveBranch(diskEntries, id, diskEntries.length) };
  let probes = 0;
  let opens = 0;
  const bindings = {
    getRpcSession: () => ({ isAlive: () => true, inner: { sessionManager: sm },
      evictIfDiskAhead: () => { probes++; return diskAhead && !running; } }),
    resolveSessionPath: () => {
      assert.ok(diskAhead && !running, "only an evicted idle wrapper may fall back to disk");
      return "/session.jsonl";
    },
    openSessionManager: () => { opens++; return disk; },
    buildSessionContext,
    NextResponse: { json: (body, options) => ({ status: options?.status ?? 200, body }) },
  };
  const GET = new Function(...Object.keys(bindings), javascript)(...Object.values(bindings));
  return { read: (query) => GET(new Request(`http://localhost/api/sessions/session/context?${query}`),
    { params: Promise.resolve({ id: "session" }) }), setLeaf: (id) => { leaf = id; },
    get probes() { return probes; }, get opens() { return opens; } };
}

test("receipt reconnect follows a growing branch using full ancestry even beyond the visible tail", async () => {
  const harness = setup();
  const response = await harness.read("ancestorId=a&tail=2");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.context.entryIds, ["a-53", "a-54"],
    "current leaf, not the last entry on the sibling branch, owns this read");
});

test("another browser's sibling navigation cannot supply receipt history for the old branch", async () => {
  const harness = setup();
  harness.setLeaf("b");
  const response = await harness.read("ancestorId=a");
  assert.equal(response.status, 409);
  assert.equal(response.body.context, undefined);
  assert.equal(harness.probes, 0, "a known sibling anchor must not trigger disk recovery");
});

test("live receipt checks reject an explicit sibling entry even before the local canonical leaf refreshes", async () => {
  const response = await setup().read("leafId=b&ancestorId=a");
  assert.equal(response.status, 409);
});

test("ordinary explicit-leaf history reads keep their existing behavior", async () => {
  const harness = setup({ diskAhead: true });
  const response = await harness.read("leafId=b");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.context.entryIds, ["root", "b"]);
  assert.equal(harness.probes, 0, "ordinary history must not scan disk or evict its wrapper");
});

test("reconnect recovers a persisted restore anchor missing from an idle startup snapshot", async () => {
  const harness = setup({ diskAhead: true });
  const response = await harness.read("ancestorId=restore-marker&tail=2");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.context.entryIds, ["a-53", "a-54"]);
  assert.equal(harness.probes, 1);
  assert.equal(harness.opens, 1);
});

test("a missing anchor cannot evict a running wrapper even when disk is ahead", async () => {
  const harness = setup({ diskAhead: true, running: true });
  const response = await harness.read("ancestorId=restore-marker");
  assert.equal(response.status, 409);
  assert.equal(harness.probes, 1);
  assert.equal(harness.opens, 0);
});

test("unknown ancestry still fails closed when the idle wrapper matches disk", async () => {
  const harness = setup();
  assert.equal((await harness.read("ancestorId=unknown")).status, 409);
  assert.equal(harness.probes, 1);
  assert.equal(harness.opens, 0);
});

test("disk recovery still rejects an existing sibling leaf", async () => {
  const harness = setup({ diskAhead: true });
  const response = await harness.read("leafId=b&ancestorId=restore-marker");
  assert.equal(response.status, 409);
  assert.equal(harness.opens, 1);
});

test("disk recovery rechecks ancestry instead of accepting an unrelated anchor", async () => {
  const harness = setup({ diskAhead: true });
  const response = await harness.read("ancestorId=unknown");
  assert.equal(response.status, 409);
  assert.equal(harness.probes, 1);
  assert.equal(harness.opens, 1);
});
