import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const original = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-starred-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET, POST } = await jiti.import("./route.ts");
const file = join(agentDir, "pi-web", "starred-sessions.json");

after(async () => {
  if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = original;
  await rm(agentDir, { recursive: true, force: true });
});

function post(body, headers = { "Content-Type": "application/json", Host: "localhost" }) {
  return POST(new Request("http://localhost/api/starred-sessions", {
    method: "POST", headers, body: JSON.stringify(body),
  }));
}

test("stars persist as server-owned JSON; concurrent set/import operations do not lose updates", async () => {
  assert.deepEqual(await (await GET()).json(), { ids: [], projectKeys: [] });
  const results = await Promise.all([
    post({ op: "set", id: "one", starred: true }),
    post({ op: "set", id: "two", starred: true }),
    post({ op: "import", ids: ["legacy", "one", "legacy"] }),
  ]);
  assert.ok(results.every((response) => response.status === 200));
  assert.deepEqual(await (await GET()).json(), { ids: ["legacy", "one", "two"], projectKeys: [] });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1, ids: ["legacy", "one", "two"], projectKeys: [] });
  assert.deepEqual(await (await post({ op: "set", id: "one", starred: false })).json(), { ids: ["legacy", "two"], projectKeys: [] });
  assert.deepEqual(await (await post({ op: "import", ids: ["legacy"] })).json(), { ids: ["legacy", "two"], projectKeys: [] });
});

test("reads existing session-only star files as having no project stars", async () => {
  await writeFile(file, JSON.stringify({ version: 1, ids: ["legacy", "two"] }));
  assert.deepEqual(await (await GET()).json(), { ids: ["legacy", "two"], projectKeys: [] });
  assert.deepEqual(await (await post({ op: "set", id: "legacy", starred: true })).json(), {
    ids: ["legacy", "two"], projectKeys: [],
  });
});

test("project stars persist independently from session stars", async () => {
  const key = "project:/workspaces/example";
  const response = await post({ op: "set-project", key, starred: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ids: ["legacy", "two"], projectKeys: [key] });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
    version: 1, ids: ["legacy", "two"], projectKeys: [key],
  });
  assert.deepEqual(await (await post({ op: "set-project", key, starred: false })).json(), {
    ids: ["legacy", "two"], projectKeys: [],
  });
});

test("rejects malformed mutations without changing the file", async () => {
  const previous = await readFile(file, "utf8");
  for (const body of [
    { op: "set", id: "", starred: true }, { op: "set", id: "one", starred: "yes" },
    { op: "import", ids: [1] }, { op: "import", ids: ["x".repeat(257)] },
    { op: "set-project", key: "", starred: true }, { op: "set-project", key: "project", starred: "yes" },
    { op: "unknown" },
  ]) {
    assert.equal((await post(body)).status, 400);
  }
  assert.equal((await post({ op: "set", id: "x", starred: true }, { "Content-Type": "text/plain", Host: "localhost" })).status, 415);
  assert.equal((await post({ op: "set", id: "x", starred: true }, { "Content-Type": "application/json", Host: "untrusted.example" })).status, 403);
  assert.equal(await readFile(file, "utf8"), previous);
});

test("corrupt server state is reported, not replaced with an empty set", async () => {
  await writeFile(file, "{invalid");
  assert.equal((await GET()).status, 500);
  assert.equal((await post({ op: "set", id: "one", starred: true })).status, 500);
  assert.equal(await readFile(file, "utf8"), "{invalid");
});
