import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../e2e/git-workflow-plugin.mjs", import.meta.url), "utf8");
const begin = source.indexOf("  const command =", source.indexOf("export async function checkGitWorkflowPlugin"));
const end = source.indexOf("  const tip =", begin);
assert.ok(begin >= 0 && end > begin);
const bind = new Function("page", "base", "sessionId", "repo", "assert",
  source.slice(begin, end) + "\nreturn { command, patch };");

function harness(response) {
  const calls = [];
  const request = Object.fromEntries(["post", "patch"].map((method) => [method, async (url, options) => {
    calls.push({ method, url, options });
    if (response instanceof Error) throw response;
    return response;
  }]));
  return { ...bind({ request }, "http://fixture.invalid", "session", "/fixture/repo", assert), calls };
}
const success = { ok: () => true, text: async () => "", json: async () => ({ data: "command-result", settings: "settings-result" }) };

test("one-shot plugin command probes close their API-test socket and preserve the exact payload", async () => {
  const fixture = harness(success);
  const body = { type: "get_tools" };
  assert.equal(await fixture.command(body), "command-result");
  assert.deepEqual(fixture.calls, [{ method: "post", url: "http://fixture.invalid/api/agent/session",
    options: { data: body, headers: { Connection: "close" } } }]);
});

test("one-shot plugin settings writes close their API-test socket and retain scope and target selection", async () => {
  const fixture = harness(success);
  assert.equal(await fixture.patch({ commit: "allow" }, "project", ["commitChecks"], "/fixture/foreign"), "settings-result");
  assert.deepEqual(fixture.calls, [{ method: "patch", url: "http://fixture.invalid/api/plugins/bundled",
    options: { data: { pluginId: "git-workflow", cwd: "/fixture/foreign", sessionId: "session", scope: "project",
      set: { commit: "allow" }, reset: ["commitChecks"] }, headers: { Connection: "close" } } }]);
});

test("fixture probes still propagate HTTP and transport failures without retries", async () => {
  for (const method of ["command", "patch"]) {
    const refused = harness({ ok: () => false, text: async () => "expected HTTP refusal" });
    await assert.rejects(refused[method]({}), /expected HTTP refusal/);
    assert.equal(refused.calls.length, 1);
    const reset = new Error("read ECONNRESET");
    const disconnected = harness(reset);
    await assert.rejects(disconnected[method]({}), (error) => error === reset);
    assert.equal(disconnected.calls.length, 1);
  }
});
