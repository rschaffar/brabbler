import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContext } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/compat";

test("SDK 1.3 constructs adaptive effort versus budget thinking without sending HTTP", async () => {
  const context = normalizeContext({ messages: [{ role: "user", content: "Synthetic fixture", timestamp: 1 }] });
  for (const adaptive of [false, true]) {
    const model = { id: "synthetic-claude", name: "Synthetic Claude", provider: "fixture-no-provider", api: "anthropic-messages", baseUrl: "https://fixture.invalid", reasoning: true, thinkingLevelMap: { medium: "low" }, compat: { forceAdaptiveThinking: adaptive }, input: ["text"], contextWindow: 128000, maxTokens: 32768, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    let payload, fetchCalls = 0;
    const stream = anthropicMessagesApi().streamSimple(model, context, {
      apiKey: "synthetic-not-a-real-key", env: {}, reasoning: "medium", thinkingBudgets: { medium: 2048 }, cacheRetention: "none", maxRetries: 0,
      fetch: async () => { fetchCalls++; throw new Error("Unexpected HTTP request"); },
      onPayload(body) { payload = structuredClone(body); throw new Error("fixture-stop-before-http"); },
    });
    const result = await stream.result();
    assert.equal(result.stopReason, "error");
    assert.equal(result.errorMessage, "fixture-stop-before-http");
    assert.equal(fetchCalls, 0);
    assert.ok(payload);
    if (adaptive) {
      assert.deepEqual(payload.thinking, { type: "adaptive", display: "summarized" });
      assert.equal(payload.output_config.effort, "low");
      assert.equal(Object.hasOwn(payload.thinking, "budget_tokens"), false);
    } else {
      assert.deepEqual(payload.thinking, { type: "enabled", budget_tokens: 2048, display: "summarized" });
      assert.equal(payload.output_config?.effort, undefined);
    }
  }
});
