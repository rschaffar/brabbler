import assert from "node:assert/strict";
import { test } from "node:test";
import { createGitWorkflowExtension } from "./git-workflow-extension.ts";

test("project workflow is evaluated for each new run, not captured at resource load", async () => {
  let policy;
  let handler;
  createGitWorkflowExtension(() => policy).factory({ on: (event, callback) => {
    assert.equal(event, "before_agent_start");
    handler = callback;
  } });
  assert.equal(await handler(), undefined);
  policy = { mode: "worktree", baseBranch: "rst-main", onCreate: "continue", commits: "agent", integration: { targetBranch: "rst-main", method: "merge" } };
  const result = await handler();
  assert.equal(result.message.display, false);
  assert.match(result.message.content, /continue this chat/);
  assert.match(result.message.content, /request approval for the specific integration/);
  assert.match(result.message.content, /stricter repository instructions/);
  policy = null;
  assert.equal(await handler(), undefined);
});
