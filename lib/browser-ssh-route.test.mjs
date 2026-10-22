import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSshAgentRouter } from "../bin/ssh-agent-router.js";
import { fixture } from "./browser-ssh.fixture.mjs";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { POST } = await jiti.import("../app/api/ssh-agent/route.ts");
const { createWebSessionToken } = await jiti.import("./web-auth.ts");
const { ManagedSshAgent } = await jiti.import("./managed-ssh-agent.ts");
const { SshKeyRegistry } = await jiti.import("./ssh-key-registry.ts");
const password = "synthetic-ssh-route-password";
const cookie = `pi_web_session=${createWebSessionToken(password)}`;
function request(body, headers = {}, url = "http://localhost/api/ssh-agent") {
  return new NextRequest(url, { method: "POST", headers: { Host: "localhost", Origin: "http://localhost", "Content-Type": "application/json", Cookie: cookie, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

test("managed SSH requires signed web login, exact secure Origin/Host and owner-bound fresh proof", async t => {
  const root = mkdtempSync(join(tmpdir(), "ssh-route-"));
  const router = await createSshAgentRouter({ instance: "route:30141", tempDir: root, environment: { PI_CODING_AGENT_DIR: join(root, "agent"), PATH: "/nonexistent" } });
  const registry = new SshKeyRegistry({ root: join(root, "keys") });
  const pool = new ManagedSshAgent({ registry, rpc: body => router.rpc(body) });
  const symbol = Symbol.for("pi-desk:managed-ssh-agent"), previous = globalThis[symbol]; globalThis[symbol] = pool;
  const original = process.env.PI_WEB_PASSWORD;
  t.after(async () => {
    if (original === undefined) delete process.env.PI_WEB_PASSWORD; else process.env.PI_WEB_PASSWORD = original;
    if (previous) globalThis[symbol] = previous; else delete globalThis[symbol];
    await pool.dispose(); await router.close(); rmSync(root, { recursive: true, force: true });
  });
  delete process.env.PI_WEB_PASSWORD;
  assert.equal((await POST(request({ action: "status" }))).status, 403);
  process.env.PI_WEB_PASSWORD = password;
  assert.equal((await POST(request({ action: "status" }, { Cookie: "" }))).status, 403);
  assert.equal((await POST(request({ action: "status" }, { Cookie: "", Authorization: `Basic ${Buffer.from(`pi:${password}`).toString("base64")}` }))).status, 403);
  for (const headers of [{ Origin: "" }, { Origin: "https://other.example.test" }, { "sec-fetch-site": "cross-site" }]) assert.equal((await POST(request({ action: "status" }, headers))).status, 403);
  const initial = await POST(request({ action: "status" })); assert.equal(initial.status, 200); assert.equal(initial.headers.get("cache-control"), "no-store");
  const status = await initial.json(); assert.equal(status.runtime.selected.type, "none"); assert.equal(status.runtime.setupNeeded, true); assert.equal(status.runtime.browserSocket, undefined); assert.deepEqual(status.connections, []);
  // Public HTTPS behind an HTTP reverse proxy preserving Host and Origin.
  const oldHosts = process.env.PI_WEB_ALLOWED_HOSTS; process.env.PI_WEB_ALLOWED_HOSTS = "ssh.example.test";
  try {
    assert.equal((await POST(request({ action: "status" }, { Host: "ssh.example.test", Origin: "https://ssh.example.test", "x-forwarded-proto": "https", "sec-fetch-site": "same-origin" }))).status, 200);
    assert.equal((await POST(request({ action: "status" }, { Host: "ssh.example.test", Origin: "http://ssh.example.test" }))).status, 400);
  } finally { if (oldHosts === undefined) delete process.env.PI_WEB_ALLOWED_HOSTS; else process.env.PI_WEB_ALLOWED_HOSTS = oldHosts; }
  assert.equal((await POST(request({ action: "status" }, { Host: "127.0.0.1", Origin: "http://127.0.0.1" }, "http://127.0.0.1/api/ssh-agent"))).status, 200);
  assert.equal((await POST(request({ action: "begin-import", name: "Not an IP RP" }, { Host: "127.0.0.1", Origin: "http://127.0.0.1" }, "http://127.0.0.1/api/ssh-agent"))).status, 400);
  assert.equal((await POST(request({ action: "status" }, { Host: "localhost", Origin: "http://localhost:99", "x-forwarded-proto": "https", "sec-fetch-site": "same-origin" }))).status, 403);
  for (const body of ["{", "[]", '"not an object"', JSON.stringify({ action: "create", credential: null }), JSON.stringify({ action: "bind", sessionId: "old" }), JSON.stringify({ action: "unbind", sessionId: "old" }), JSON.stringify({ action: "unknown" }), " ".repeat(17000)]) assert.equal((await POST(request(body))).status, 400);
  assert.equal((await POST(request({ action: "status" }, { "Content-Type": "text/plain" }))).status, 400);
  const f = fixture("http://localhost");
  const imported = await (await POST(request({ action: "begin-import", name: "Legacy", credential: f.credential, applicationOnly: true }))).json();
  const saved = await POST(request({ action: "finish-enroll", token: imported.token, assertion: f.assertion(Buffer.from(imported.challenge, "base64url")) })); assert.equal(saved.status, 200);
  const record = (await saved.json()).record;
  const createdResponse = await POST(request({ action: "connect", keyId: record.id, device: "Desktop", makeActive: true })); assert.equal(createdResponse.status, 200);
  const created = await createdResponse.json(); assert.match(created.token, /^[a-f0-9]{64}$/);
  const other = `pi_web_session=${createWebSessionToken(password)}`;
  assert.equal((await POST(request({ action: "activate", token: created.token, assertion: f.assertion(Buffer.from(created.challenge, "base64url")) }, { Cookie: other }))).status, 400);
  const assertion = f.assertion(Buffer.from(created.challenge, "base64url"));
  const activated = await POST(request({ action: "activate", token: created.token, assertion })); assert.equal(activated.status, 200); assert.equal(activated.headers.get("cache-control"), "no-store");
  assert.equal((await POST(request({ action: "activate", token: created.token, assertion }))).status, 400);
  assert.equal((await POST(request({ action: "poll", token: created.token }, { Cookie: other }))).status, 400);
  assert.equal((await POST(request({ action: "respond", token: created.token, requestId: "stale" }))).status, 400);
  const selected = await POST(request({ action: "use", revision: router.status().revision, backend: { type: "browser" }, sessionId: "ignored-not-a-scope" })); assert.equal(selected.status, 200); assert.equal(router.status().selected.type, "browser");
  const publicStatus = await (await POST(request({ action: "status" }))).json(); assert.equal(JSON.stringify(publicStatus).includes(created.token), false); assert.equal(publicStatus.activeId, created.id);
  assert.equal((await POST(request({ action: "disconnect", token: created.token }))).status, 200);
  assert.equal((await POST(request({ action: "poll", token: created.token }))).status, 400);
});
