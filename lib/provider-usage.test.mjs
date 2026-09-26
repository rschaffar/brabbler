import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// Isolate the SDK's default auth and model paths; never read an operator's credentials.
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-usage-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { addProviderAccount, accountCredentialStore, removeProviderAccount } = await jiti.import("./provider-accounts.ts");
const { POST } = await jiti.import("../app/api/provider-usage/query/route.ts");

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./provider-usage.ts");
}

const { isOfficialProviderUsageOrigin, isProviderUsageId, normalizeProviderUsagePayload, queryProviderUsage } = await loadSubject();

const request = (body) => new Request("http://localhost/api/provider-usage/query", {
  method: "POST", headers: { host: "localhost", "content-type": "application/json" }, body: JSON.stringify(body),
});
const codexToken = (account, marker) => `x.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account }, marker })).toString("base64url")}.sig`;

async function addAuthorized(provider, type, credential) {
  const account = await addProviderAccount(provider, "Test", type);
  await accountCredentialStore({ [provider]: account.id }).modify(provider, async () => credential);
  return account;
}

test("recognizes only providers with usage adapters", () => {
  assert.equal(isProviderUsageId("openai-codex"), true);
  assert.equal(isProviderUsageId("opencode-go"), true);
  assert.equal(isProviderUsageId("anthropic"), false);
});

test("accepts only the official origin for provider usage credentials", () => {
  assert.equal(isOfficialProviderUsageOrigin("deepseek", "https://api.deepseek.com/v1"), true);
  assert.equal(isOfficialProviderUsageOrigin("deepseek", "https://proxy.example.com/v1"), false);
  assert.equal(isOfficialProviderUsageOrigin("deepseek", "not a URL"), false);
  assert.equal(isOfficialProviderUsageOrigin("opencode-go", "https://opencode.ai/zen/go/v1"), true);
  assert.equal(isOfficialProviderUsageOrigin("opencode-go", "https://proxy.example.com/zen/go/v1"), false);
});

test("account queries use only the selected credential, and omitted/null use Pi default", async () => {
  await writeFile(join(agentDir, "auth.json"), JSON.stringify({ deepseek: { type: "api_key", key: "default-secret" } }));
  const first = await addAuthorized("deepseek", "api_key", { type: "api_key", key: "first-secret" });
  const second = await addAuthorized("deepseek", "api_key", { type: "api_key", key: "second-secret" });
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push([url, options.headers.get("authorization")]);
    return new Response(JSON.stringify({ is_available: true, balance_infos: [{ currency: "USD", total_balance: "10" }] }), { status: 200 });
  };
  try {
    for (const body of [{ providerId: "deepseek", accountId: first.id }, { providerId: "deepseek", accountId: second.id }, { providerId: "deepseek" }, { providerId: "deepseek", accountId: null }]) {
      const response = await POST(request(body));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, "ready");
    }
    assert.deepEqual(seen, [
      ["https://api.deepseek.com/user/balance", "Bearer first-secret"],
      ["https://api.deepseek.com/user/balance", "Bearer second-secret"],
      ["https://api.deepseek.com/user/balance", "Bearer default-secret"],
      ["https://api.deepseek.com/user/balance", "Bearer default-secret"],
    ]);
  } finally { globalThis.fetch = originalFetch; }
});

test("invalid, wrong-provider, deleted and pending IDs fail before any request (including with default auth)", async () => {
  const other = await addAuthorized("openrouter", "api_key", { type: "api_key", key: "other-secret" });
  const pending = await addProviderAccount("deepseek", "Pending", "api_key");
  const deleted = await addAuthorized("deepseek", "api_key", { type: "api_key", key: "deleted-secret" });
  await removeProviderAccount(deleted.id);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected usage request"); };
  try {
    for (const id of ["missing", "", other.id, pending.id, deleted.id]) {
      const response = await POST(request({ providerId: "deepseek", accountId: id }));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "Account is unavailable for this provider" });
      await assert.rejects(queryProviderUsage("deepseek", id), /unavailable/);
    }
    for (const value of [false, 2, {}, []]) {
      assert.equal((await POST(request({ providerId: "deepseek", accountId: value }))).status, 400);
    }
    assert.equal((await POST(request(null))).status, 400);
    assert.equal((await POST(request({ providerId: "anthropic" }))).status, 400);
  } finally { globalThis.fetch = originalFetch; }
});

test("Codex uses the token's account claim, not a local ID or supplied header; failures hide secrets", async () => {
  const token = codexToken("chatgpt-work", "secret-token");
  const account = await addAuthorized("openai-codex", "oauth", { type: "oauth", access: token, refresh: "refresh-secret", expires: Date.now() + 900_000 });
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push({ url, headers: options.headers });
    return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 25 } } }), { status: 200 });
  };
  try {
    const response = await POST(request({ providerId: "openai-codex", accountId: account.id }));
    assert.equal((await response.json()).status, "ready");
    assert.equal(seen[0].headers.get("chatgpt-account-id"), "chatgpt-work");
    assert.equal(seen[0].headers.get("authorization"), `Bearer ${token}`);
    assert.equal(JSON.stringify(await (await POST(request({ providerId: "openai-codex", accountId: "missing" }))).json()).includes(token), false);
    globalThis.fetch = async () => { throw new Error(`Upstream rejected ${token} refresh-secret`); };
    const upstreamFailure = await POST(request({ providerId: "openai-codex", accountId: account.id }));
    assert.deepEqual(await upstreamFailure.json(), { providerId: "openai-codex", status: "query-failed", message: "The provider usage query failed." });
    await accountCredentialStore({ "openai-codex": account.id }).modify("openai-codex", async () => ({ type: "oauth", access: "invalid-token", refresh: "refresh-secret", expires: Date.now() + 900_000 }));
    const failed = await POST(request({ providerId: "openai-codex", accountId: account.id }));
    assert.equal((await failed.json()).status, "query-failed");
    assert.equal(seen.length, 1);
    assert.equal(JSON.stringify(await (await POST(request({ providerId: "openai-codex", accountId: false }))).json()).includes("refresh-secret"), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("legacy default Codex query can still use a token without an account claim", async () => {
  await writeFile(join(agentDir, "auth.json"), JSON.stringify({ "openai-codex": {
    type: "oauth", access: "legacy-token", refresh: "dummy-refresh", expires: Date.now() + 900_000,
  } }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
    assert.equal(options.headers.get("authorization"), "Bearer legacy-token");
    assert.equal(options.headers.get("chatgpt-account-id"), null);
    return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 25 } } }), { status: 200 });
  };
  try {
    assert.equal((await (await POST(request({ providerId: "openai-codex" }))).json()).status, "ready");
  } finally { globalThis.fetch = originalFetch; }
});

test("normalizes Codex windows into remaining percentages and reset times", () => {
  const report = normalizeProviderUsagePayload("openai-codex", {
    rate_limit: {
      primary_window: { used_percent: 12, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
      secondary_window: { used_percent: 40, limit_window_seconds: 604_800 },
    },
    rate_limit_reset_credits: { available_count: 2, applicable_available_count: 1 },
  }, 123);
  assert.deepEqual(report.buckets.map((bucket) => [bucket.label, bucket.groupLabel, bucket.remaining, bucket.resetsAt]), [
    ["5h", undefined, 88, 1_800_000_000],
    ["Weekly", undefined, 60, undefined],
  ]);
  assert.equal(report.bankedResets, 2, "show the total banked count, not the currently applicable count");
});

test("Codex banked resets are optional and never inferred from usage credits or malformed counts", () => {
  const base = { rate_limit: { primary_window: { used_percent: 10 } }, credits: { balance: 5 } };
  assert.equal(normalizeProviderUsagePayload("openai-codex", base).bankedResets, undefined);
  for (const value of [0, 1]) {
    assert.equal(normalizeProviderUsagePayload("openai-codex", { ...base, rate_limit_reset_credits: { available_count: value } }).bankedResets, value);
  }
  for (const value of [-1, 1.5, "2", null, true, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeProviderUsagePayload("openai-codex", { ...base, rate_limit_reset_credits: { available_count: value } }).bankedResets, undefined);
  }
});

test("normalizes MiniMax token-plan counts using the reported remaining percent", () => {
  const report = normalizeProviderUsagePayload("minimax", {
    model_remains: [{
      model_name: "MiniMax-M2",
      current_interval_usage_count: 20,
      current_interval_total_count: 100,
      current_interval_remaining_percent: 80,
      current_interval_status: 1,
      start_time: 1_700_000_000_000,
      end_time: 1_700_360_000_000,
      current_weekly_usage_count: 1,
      current_weekly_total_count: 1,
      current_weekly_remaining_percent: 0,
      current_weekly_status: 3,
      weekly_start_time: 1_700_000_000_000,
      weekly_end_time: 1_706_000_000_000,
    }],
  }, 123);
  assert.equal(report.buckets[0].remaining, 80);
  assert.equal(report.buckets[0].used, 20);
  assert.equal(report.buckets[1].period, "Unlimited");
});

test("normalizes OpenCode Go windows into remaining percentages and reset times", () => {
  const report = normalizeProviderUsagePayload("opencode-go", {
    usage: {
      rolling: { status: "ok", percent: 3, resetsAt: "2026-09-14T05:53:50.774Z" },
      weekly: { status: "ok", percent: 1, resetsAt: "2026-09-21T00:00:00.774Z" },
      monthly: { status: "ok", percent: 98, resetsAt: "2026-09-19T02:38:27.774Z" },
    },
  }, 123);
  assert.deepEqual(report.buckets.map((bucket) => [bucket.label, bucket.remaining, bucket.unit, bucket.resetsAt]), [
    ["Rolling", 97, "percent", Math.floor(Date.parse("2026-09-14T05:53:50.774Z") / 1_000)],
    ["Weekly", 99, "percent", Math.floor(Date.parse("2026-09-21T00:00:00.774Z") / 1_000)],
    ["Monthly", 2, "percent", Math.floor(Date.parse("2026-09-19T02:38:27.774Z") / 1_000)],
  ]);
});
