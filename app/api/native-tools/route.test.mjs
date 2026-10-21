import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./route.ts");
const { POST: create } = await jiti.import("../agent/new/route.ts");
const { POST: command, GET: liveState } = await jiti.import("../agent/[id]/route.ts");
const rpc = await jiti.import("../../../lib/rpc-manager.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const off = { version: 1, codeMode: false, mcpServers: [] }, on = { ...off, codeMode: true };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "native-tools-api-")), agent = join(root, "agent"), cwd = join(root, "project");
  await mkdir(agent, { mode: 0o700 }); await mkdir(cwd);
  const previous = { dir: process.env.PI_CODING_AGENT_DIR, offline: process.env.PI_OFFLINE, fetch: globalThis.fetch };
  process.env.PI_CODING_AGENT_DIR = agent; process.env.PI_OFFLINE = "1";
  globalThis.fetch = async () => { throw new Error("No providers or MCP network in API metadata fixtures"); };
  await writeFile(join(agent, "settings.json"), JSON.stringify({ cacheWarming: "off", enableInstallTelemetry: false }));
  const ids = new Set();
  t.after(async () => {
    for (const id of ids) await rpc.getRpcSession(id)?.shutdown();
    if (previous.dir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous.dir;
    if (previous.offline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previous.offline;
    globalThis.fetch = previous.fetch;
    await rm(root, { recursive: true, force: true });
  });
  allowFileRoot(cwd);
  const start = async tools => {
    const response = await create(new Request("http://fixture.invalid/api/agent/new", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, type: "ensure_session", toolNames: tools }) }));
    assert.equal(response.status, 200); const result = await response.json(); ids.add(result.sessionId); return result.sessionId;
  };
  return { root, agent, cwd, ids, start };
}
test("catalogue GET is inert, private-value-free and path-authorized", async t => {
  const f = await fixture(t), before = globalThis.__piSessions?.size ?? 0;
  await writeFile(join(f.agent, "mcp.json"), JSON.stringify({ mcpServers: { configured: {
    command: "SYNTHETIC_NEVER_RUN", env: { TOKEN: "${SYNTHETIC_MISSING}" },
  } } }));
  await writeFile(join(f.agent, "mcp-auth.json"), "SYNTHETIC_UNUSED_OAUTH_STATE");
  const response = await GET(new Request(`http://fixture.invalid/api/native-tools?${new URLSearchParams({ cwd: f.cwd, sessionId: "unknown" })}`));
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.configuration.ok, true); assert.equal(result.live, undefined);
  assert.equal(result.configuration.servers[0].name, "configured");
  assert.equal(JSON.stringify(result).includes("SYNTHETIC"), false);
  const cold = await liveState(new Request("http://fixture.invalid/api/agent/unknown?tools=1"), { params: Promise.resolve({ id: "unknown" }) });
  assert.deepEqual(await cold.json(), { running: false });
  assert.equal(globalThis.__piSessions?.size ?? 0, before); assert.equal(existsSync(join(f.agent, "mcp.log")), false);
  const outside = join(f.root, "outside"); await mkdir(outside);
  assert.equal((await GET(new Request(`http://fixture.invalid/api/native-tools?${new URLSearchParams({ cwd: outside })}`))).status, 403);
});
test("agent API applies and reloads one stable session ID without accepting a prompt", async t => {
  const f = await fixture(t), id = await f.start(["read"]);
  const send = async body => {
    const response = await command(new Request(`http://fixture.invalid/api/agent/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ id }) });
    assert.equal(response.status, 200); return (await response.json()).data;
  };
  const first = rpc.getRpcSession(id);
  assert.equal((await send({ type: "set_native_resources", nativeResources: on })).sessionId, id);
  const active = rpc.getRpcSession(id); assert.notEqual(active, first); await active.waitUntilReady();
  const metadata = await (await GET(new Request(`http://fixture.invalid/api/native-tools?${new URLSearchParams({ cwd: f.cwd, sessionId: id })}`))).json();
  assert.deepEqual(metadata.live.nativeResources, on); assert.deepEqual(metadata.live.effectiveNativeResources, on);
  const projection = await (await liveState(new Request(`http://fixture.invalid/api/agent/${id}?tools=1`), { params: Promise.resolve({ id }) })).json();
  assert.ok(projection.tools.some(tool => tool.name === "codemode"));
  assert.equal((await send({ type: "reload" })).recreated, true); assert.notEqual(rpc.getRpcSession(id), active);
  assert.equal(rpc.getRpcSession(id).inner.sessionManager.getEntries().some(entry => entry.type === "message" && entry.message.role === "user"), false);
  await send({ type: "set_native_resources", nativeResources: off });
  assert.equal(rpc.getRpcSession(id).hasNativeSessionTools(), false);
  const repaired = await (await liveState(new Request(`http://fixture.invalid/api/agent/${id}?tools=1`), { params: Promise.resolve({ id }) })).json();
  assert.equal(repaired.tools.some(tool => tool.name === "codemode"), false);
});
