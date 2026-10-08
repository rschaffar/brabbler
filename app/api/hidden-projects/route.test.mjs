import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const original = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-privacy-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET, POST } = await jiti.import("./route.ts");
const file = join(agentDir, "pi-web", "hidden-projects.json");
after(async () => {
  if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = original;
  await rm(agentDir, { recursive: true, force: true });
});
const post = (body, headers = { "Content-Type": "application/json", Host: "localhost" }) => POST(new Request("http://localhost/api/hidden-projects", {
  method: "POST", headers, body: JSON.stringify(body),
}));

test("missing settings mean no hidden projects; per-key concurrent saves persist without lost updates", async () => {
  const first = await GET();
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.deepEqual(await first.json(), { keys: [] });
  const results = await Promise.all([
    post({ key: "/private/a", hidden: true }), post({ key: "/private/b", hidden: true }),
    post({ key: "/private/a", hidden: true }),
  ]);
  assert.ok(results.every((response) => response.status === 200));
  assert.deepEqual(await (await GET()).json(), { keys: ["/private/a", "/private/b"] });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1, keys: ["/private/a", "/private/b"] });
  if (process.platform !== "win32") {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(join(agentDir, "pi-web"))).mode & 0o777, 0o700);
  }
  const reloaded = await createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false }).import("./route.ts");
  assert.deepEqual(await (await reloaded.GET()).json(), { keys: ["/private/a", "/private/b"] });
  assert.deepEqual(await (await post({ key: "/private/a", hidden: false })).json(), { keys: ["/private/b"] });
  assert.deepEqual(await (await post({ key: "/private/a", hidden: false })).json(), { keys: ["/private/b"] });
});

test("rejects invalid and cross-origin changes without touching saved settings", async () => {
  const previous = await readFile(file, "utf8");
  for (const body of [null, [], 4, "string", {}, { key: "", hidden: true }, { key: "/a", hidden: "yes" },
    { key: "x".repeat(16_385), hidden: true }, { key: "a\0b", hidden: false }]) {
    assert.equal((await post(body)).status, 400);
  }
  assert.equal((await post({ key: "/a", hidden: true }, { "Content-Type": "text/plain", Host: "localhost" })).status, 415);
  assert.equal((await post({ key: "/a", hidden: true }, { "Content-Type": "application/json", Host: "localhost", Origin: "https://evil.example" })).status, 403);
  assert.equal((await POST(new Request("http://localhost/api/hidden-projects", { method: "POST", headers: { "Content-Type": "application/json", Host: "localhost" }, body: "{" }))).status, 400);
  assert.equal(await readFile(file, "utf8"), previous);
});

test("malformed or unsupported storage fails closed and is never silently replaced", async () => {
  for (const text of ["{invalid", '{"version":2,"keys":[]}', '{"version":1,"keys":[1]}', '{"version":1}', 'null']) {
    await writeFile(file, text);
    const response = await GET();
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Project privacy settings unavailable" });
    assert.equal((await post({ key: "/private/a", hidden: true })).status, 500);
    assert.equal(await readFile(file, "utf8"), text);
  }
});
