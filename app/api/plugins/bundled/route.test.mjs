import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";
const root = mkdtempSync(join(tmpdir(), "pi-plugin-scope-route-"));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR);
after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(root, { recursive: true, force: true }); });
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { cacheSessionPath } = await jiti.import("../../../../lib/session-reader.ts");
const { GET, PATCH } = await jiti.import("./route.ts");
const repo = join(root, "own"), other = join(root, "foreign");
for (const cwd of [repo, other]) { execFileSync("git", ["init", "-b", "main", cwd], { stdio: "ignore" }); allowFileRoot(cwd); }
const sessionId = "33333333-3333-4333-8333-333333333333", sessionPath = join(root, "session.jsonl");
function header(cwd = repo, id = sessionId) { writeFileSync(sessionPath, JSON.stringify({ type: "session", version: 3, id, cwd, timestamp: new Date().toISOString() }) + "\n"); cacheSessionPath(sessionId, sessionPath); }
header();
const patch = (body, headers = {}) => PATCH(new Request("http://localhost/api/plugins/bundled", { method: "PATCH", headers: { Host: "localhost", "Content-Type": "application/json", ...headers }, body: JSON.stringify({ pluginId: "git-workflow", cwd: repo, ...body }) }));
const get = (cwd = repo) => GET(new Request(`http://localhost/api/plugins/bundled?${new URLSearchParams({ cwd, sessionId })}`, { headers: { Host: "localhost" } }));
test("bundled settings route inherits origin protection and validates schema without an execution route", async () => {
  const response = await GET(new Request("http://localhost/api/plugins/bundled", { headers: { Host: "localhost" } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).plugins[0].settings.enabled, false);
  const change = { scope: "global", set: { commit: "deny" } };
  assert.equal((await patch(change, { Origin: "https://evil.invalid", "Sec-Fetch-Site": "cross-site" })).status, 403);
  const changed = await patch(change);
  assert.equal(changed.status, 200); assert.equal((await changed.json()).settings.sources.commit, "global");
  for (const invalid of [{ ...change, set: { commit: "confirm" } }, { ...change, pluginId: "unregistered" }, { ...change, scope: "chat" }, { ...change, cwd: "/outside-allowed-roots" }]) {
    assert.equal((await patch(invalid)).status, 400);
  }
  assert.equal((await (await patch({ scope: "global", reset: ["commit"] })).json()).settings.sources.commit, "builtin");
});
test("trusted saved session controls own-project overlay; foreign routes exclude every session override", async () => {
  assert.equal((await patch({ scope: "global", set: { enabled: true } })).status, 200);
  assert.equal((await patch({ scope: "project", cwd: other, set: { commit: "deny", targetBranch: "foreign" } })).status, 200);
  assert.equal((await patch({ scope: "session", sessionId, set: { commit: "allow", workspace: "current-branch", targetBranch: "own" } })).status, 200);
  const own = (await (await get()).json()).plugins[0].settings;
  assert.equal(own.sources.commit, "session"); assert.equal(own.effective.commit, "allow");
  const foreign = (await (await get(other)).json()).plugins[0].settings;
  assert.equal(foreign.sources.commit, "project"); assert.equal(foreign.effective.commit, "deny");
  assert.equal(foreign.effective.targetBranch, "foreign"); assert.equal(foreign.effective.workspace, "ask");
  assert.equal((await patch({ scope: "session", sessionId, cwd: other, sessionCwd: other, set: { commit: "allow" } })).status, 400);
});
test("session writes require identity, refuse global-only fields and revalidate the saved header", async () => {
  assert.equal((await patch({ scope: "session", set: { commit: "allow" } })).status, 400);
  assert.equal((await patch({ scope: "session", sessionId, set: { enabled: true } })).status, 400);
  assert.equal((await patch({ scope: "session", sessionId: "bad", set: { commit: "allow" } })).status, 400);
  header(repo, "44444444-4444-4444-8444-444444444444");
  assert.equal((await get()).status, 400);
  header(other);
  const moved = (await (await get(other)).json()).plugins[0].settings;
  assert.equal(moved.sources.commit, "project"); assert.equal(moved.effective.commit, "deny");
  header();
});
test("settings mutations retain origin and content-type boundaries", async () => {
  assert.equal((await patch({ scope: "global", set: { enabled: true } }, { Origin: "https://untrusted.invalid" })).status, 403);
  assert.equal((await patch({ scope: "global", set: { enabled: true } }, { "Content-Type": "text/plain" })).status, 415);
});
