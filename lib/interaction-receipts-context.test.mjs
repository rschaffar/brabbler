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

function setup() {
  const entries = [message("root", null), message("a", "root")];
  for (let i = 0; i < 55; i++) entries.push(message(`a-${i}`, i === 0 ? "a" : `a-${i - 1}`));
  entries.push(message("b", "root"));
  let leaf = "a-54";
  const sm = { getEntries: () => entries, getLeafId: () => leaf,
    getBranch: (id) => sliceActiveBranch(entries, id, entries.length) };
  const bindings = {
    getRpcSession: () => ({ isAlive: () => true, inner: { sessionManager: sm } }),
    resolveSessionPath: () => { throw new Error("must use live manager"); },
    openSessionManager: () => { throw new Error("must use live manager"); },
    buildSessionContext,
    NextResponse: { json: (body, options) => ({ status: options?.status ?? 200, body }) },
  };
  const GET = new Function(...Object.keys(bindings), javascript)(...Object.values(bindings));
  return { read: (query) => GET(new Request(`http://localhost/api/sessions/session/context?${query}`),
    { params: Promise.resolve({ id: "session" }) }), setLeaf: (id) => { leaf = id; } };
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
});

test("live receipt checks reject an explicit sibling entry even before the local canonical leaf refreshes", async () => {
  const response = await setup().read("leafId=b&ancestorId=a");
  assert.equal(response.status, 409);
});

test("ordinary explicit-leaf history reads keep their existing behavior", async () => {
  const response = await setup().read("leafId=b");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.context.entryIds, ["root", "b"]);
});
