import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { isFilePathReferencedByEntries: admitted } = await createJiti(import.meta.url).import("./session-file-references-core.ts");
const target = "/outside-project/SAFE_REFERENCE_SENTINEL.txt";
const text = [{ type: "text", text: `See [file](${target}#L12)` }];
let sequence = 0;
const message = (role, content = text, extra = {}, parentId = null) => ({ type: "message", id: `entry-${++sequence}`, parentId, timestamp: "2026-01-01T00:00:00Z", message: { role, content, ...extra } });
const call = (name, args = { path: "/other/benign.txt" }) => ({ type: "toolCall", id: "call", name, arguments: args });
const result = (name, extra = {}, parentId = null) => message("toolResult", text, { toolCallId: "call", ...(name === undefined ? {} : { toolName: name }), ...extra }, parentId);

for (const role of ["user", "assistant"]) test(`${role} text retains exact intentional links, not metadata`, () => {
  assert.equal(admitted(target, [message(role)]), true);
  assert.equal(admitted(target, [message(role, `See file://${target}:12`)]), true);
  assert.equal(admitted(target, [message(role, [{ type: "text", text: encodeURIComponent(target) }])]), true);
  assert.equal(admitted(target + ".bak", [message(role)]), false);
  assert.equal(admitted(target, [message(role, [], { errorMessage: target, provider: target, model: target, details: { path: target } })]), false);
  assert.equal(admitted(target, [message(role, [{ type: "image", source: { url: target, data: target } }, { type: "thinking", thinking: target }])]), false);
});

test("system, context, summaries, custom stores and receipt fields never grant file access", () => {
  const entries = [
    message("system", text, { sections: { base: target }, toolsAdded: [{ description: target }] }),
    { type: "context_edit", replacement: { content: text } },
    { type: "compaction", summary: target }, { type: "branch_summary", summary: target },
    { type: "custom", customType: "codemode-store", data: { value: target } },
    { type: "custom", customType: "brabbler:operation-receipt", data: { title: target, fields: [{ value: target }], patch: target, status: "succeeded" } },
    { type: "custom", customType: "brabbler:interaction-receipt", data: { request: { title: target }, response: { answer: target } } },
    { type: "custom_message", customType: "third-party", content: text, display: true },
    message("custom", text, { customType: "third-party", display: true }),
    { type: "label", label: target }, { type: "session_info", name: target },
  ];
  for (const entry of entries) assert.equal(admitted(target, [entry]), false, JSON.stringify(entry));
});

for (const name of ["read", "functions.read", "bash", "powershell", "write", "edit", "grep", "find", "ls", "apply_patch", "Agent", "get_subagent_result", "steer_subagent"]) {
  test(`${name} result text retains supported path reporting without scanning opaque details`, () => {
    assert.equal(admitted(target, [result(name)]), true);
    assert.equal(admitted(target, [result(name, { content: [], details: { receipt: { fullOutputPath: target }, file: target }, usage: { model: target } })]), false);
  });
}
for (const name of [undefined, "remote_search", "mcp.read", "evil.read", "read_secret", "functions.remote.read"]) {
  test(`${name ?? "unnamed"} result text and output-looking metadata are not authority`, () => {
    assert.equal(admitted(target, [result(name, { details: { fullOutputPath: target, nestedCalls: { calls: [call("read", { path: target })] } } })]), false);
  });
}

test("only schema-known coding arguments count, in raw and normalized calls", () => {
  for (const block of [call("read", { path: target }), { type: "toolCall", toolCallId: "call", toolName: "functions.read", input: { path: target } }, call("bash", { command: `printf '%s' '${target}'` })]) {
    assert.equal(admitted(target, [message("assistant", [block])]), true);
  }
  for (const block of [call("remote_search", { path: target }), call("write", { path: "/other/file.txt", content: target }), { ...call("read", { path: "/other/file.txt" }), rawInput: target }]) {
    assert.equal(admitted(target, [message("assistant", [block])]), false);
  }
  assert.equal(admitted(target, [message("assistant", [call("apply_patch", { input: `*** Begin Patch\n*** Add File: /other/file.txt\n+${target}\n*** End Patch` })])]), false);
  assert.equal(admitted(target, [message("assistant", [call("apply_patch", { input: `*** Begin Patch\n*** Update File: /other/file.txt\n*** Move to: ${target}\n*** End Patch` })])]), true);
});

test("legacy result identity comes only from a matching ancestor, never a sibling", () => {
  const ancestor = message("assistant", [call("read")]);
  const legacy = result(undefined, {}, ancestor.id);
  assert.equal(admitted(target, [ancestor, legacy]), true);
  assert.equal(admitted(target, [ancestor, result(undefined)]), false);
  const unknown = message("assistant", [call("remote_search")]);
  assert.equal(admitted(target, [unknown, result("read", {}, unknown.id)]), false);
  assert.equal(admitted(target, [ancestor, result("remote_search", {}, ancestor.id)]), false);
});

test("SDK nested coding-call arguments count, but remote nested text/error/data do not", () => {
  assert.equal(admitted(target, [result("codemode", { content: [], nestedCalls: { complete: true, calls: [{ name: "read", arguments: { path: target }, status: "ok" }] } })]), true);
  for (const nested of [{ name: "mcp.read", arguments: { path: target } }, { name: "read", arguments: { path: "/other/file.txt" }, error: target }, { recipient_name: "read", arguments: { path: target } }]) {
    assert.equal(admitted(target, [result("codemode", { content: [], nestedCalls: { calls: [nested] } })]), false);
  }
});

test("literal tool/output paths never decode URLs or strip fragments and source suffixes", () => {
  for (const literal of [target + "#other", target + "?other", target + ":12", encodeURIComponent(target)]) {
    assert.equal(admitted(target, [message("assistant", [call("read", { path: literal })])]), false, literal);
    assert.equal(admitted(target, [result("bash", { content: [], details: { fullOutputPath: literal } })]), false, literal);
    assert.equal(admitted(target, [message("assistant", [call("Agent", { input_files: [literal] })])]), false, literal);
    assert.equal(admitted(target, [result("codemode", { content: [], nestedCalls: { calls: [{ name: "read", arguments: { path: literal } }] } })]), false, literal);
  }
  assert.equal(admitted(target, [message("assistant", [call("read", { path: target })])]), true);
  assert.equal(admitted(target, [result("bash", { content: [], details: { fullOutputPath: target } })]), true);
  assert.equal(admitted(target, [message("assistant", `See ${target}:12`)]), true);
  assert.equal(admitted(target, [message("assistant", `See [file](${target}#L12)`)]), true);
});

test("explicit shell output files and host background reports remain usable", () => {
  assert.equal(admitted(target, [message("bashExecution", [], { command: "true", output: "", fullOutputPath: target })]), true);
  assert.equal(admitted(target, [result("bash", { content: [], details: { fullOutputPath: target } })]), true);
  const notification = { type: "custom_message", customType: "brabbler:subagent-notification", display: true, content: text,
    details: { kind: "brabbler-subagent", sessionId: "550e8400-e29b-41d4-a716-446655440000", profile: "explore", runInBackground: true, status: "completed", worktreePath: "/other/worktree" } };
  assert.equal(admitted(target, [notification]), true);
  assert.equal(admitted(target, [{ ...notification, content: [], details: { ...notification.details, worktreePath: target } }]), false);
  assert.equal(admitted(target, [{ ...notification, details: { kind: "third-party" } }]), false);
});
