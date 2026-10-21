import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";
import { fixture } from "./browser-ssh.fixture.mjs";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { POST } = await jiti.import("../app/api/ssh-agent/route.ts");
const { createWebSessionToken } = await jiti.import("./web-auth.ts");
const { browserSshAgent } = await jiti.import("./browser-ssh-agent.ts");
const password = "synthetic-ssh-route-password";
const cookie = `pi_web_session=${createWebSessionToken(password)}`;
function request(body, headers = {}, url = "http://localhost/api/ssh-agent") {
  return new NextRequest(url, { method: "POST", headers: { Host: "localhost", Origin: "http://localhost", "Content-Type": "application/json", Cookie: cookie, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

test("browser SSH requires configured password, signed cookie, exact Origin/Host and secure context", async t => {
  const original = process.env.PI_WEB_PASSWORD;
  t.after(() => { if (original === undefined) delete process.env.PI_WEB_PASSWORD; else process.env.PI_WEB_PASSWORD = original; browserSshAgent().dispose(); });
  delete process.env.PI_WEB_PASSWORD;
  assert.equal((await POST(request({ action: "status" }))).status, 403);
  process.env.PI_WEB_PASSWORD = password;
  assert.equal((await POST(request({ action: "status" }, { Cookie: "" }))).status, 403);
  assert.equal((await POST(request({ action: "status" }, { Cookie: "", Authorization: `Basic ${Buffer.from(`pi:${password}`).toString("base64")}` }))).status, 403);
  for (const headers of [{ Origin: "" }, { Origin: "https://other.example.test" }, { "sec-fetch-site": "cross-site" }]) assert.equal((await POST(request({ action: "status" }, headers))).status, 403);
  assert.equal((await POST(request({ action: "status" }))).status, 200);
  // Public HTTPS behind an HTTP reverse proxy preserving Host and Origin.
  const oldHosts = process.env.PI_WEB_ALLOWED_HOSTS; process.env.PI_WEB_ALLOWED_HOSTS = "ssh.example.test";
  try {
    assert.equal((await POST(request({ action: "status" }, { Host: "ssh.example.test", Origin: "https://ssh.example.test", "x-forwarded-proto": "https", "sec-fetch-site": "same-origin" }))).status, 200);
    assert.equal((await POST(request({ action: "status" }, { Host: "ssh.example.test", Origin: "http://ssh.example.test" }))).status, 400);
  } finally { if (oldHosts === undefined) delete process.env.PI_WEB_ALLOWED_HOSTS; else process.env.PI_WEB_ALLOWED_HOSTS = oldHosts; }
  assert.equal((await POST(request({ action: "status" }, { Host: "localhost", Origin: "http://localhost:99", "x-forwarded-proto": "https", "sec-fetch-site": "same-origin" }))).status, 403);
  for (const body of ["{", "[]", '"not an object"', JSON.stringify({ action: "create", credential: null }), JSON.stringify({ action: "unknown" }), " ".repeat(17000)]) assert.equal((await POST(request(body))).status, 400);
  assert.equal((await POST(request({ action: "status" }, { "Content-Type": "text/plain" }))).status, 400);
  const f = fixture("http://localhost");
  const created = await (await POST(request({ action: "create", credential: f.credential }))).json();
  assert.match(created.token, /^[a-f0-9]{64}$/);
  const other = `pi_web_session=${createWebSessionToken(password)}`;
  assert.equal((await POST(request({ action: "poll", token: created.token }, { Cookie: other }))).status, 400);
  const assertion = f.assertion(Buffer.from(created.challenge, "base64url"));
  const activated = await POST(request({ action: "activate", token: created.token, assertion }));
  assert.equal(activated.status, 200);
  assert.equal(activated.headers.get("cache-control"), "no-store");
  assert.equal((await POST(request({ action: "activate", token: created.token, assertion }))).status, 400);
  assert.equal((await POST(request({ action: "respond", token: created.token, requestId: "stale" }))).status, 400);
  assert.equal((await POST(request({ action: "disconnect", token: created.token }))).status, 200);
  assert.equal((await POST(request({ action: "poll", token: created.token }))).status, 400);
});
