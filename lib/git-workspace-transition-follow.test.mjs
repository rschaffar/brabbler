import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { shouldFollowWorkspaceTransition } = await jiti.import("./git-workspace-transition-follow.ts");

const destinationPath = "/worktrees/feature";

test("a completed continue receipt is followed once, not again after the chat remounts", () => {
  const receipt = { action: "continue", destinationPath };
  assert.equal(shouldFollowWorkspaceTransition(receipt, "/repo"), true);
  assert.equal(shouldFollowWorkspaceTransition(receipt, destinationPath), false);
  // Reloading the destination chat must not replay the durable receipt either.
  assert.equal(shouldFollowWorkspaceTransition(receipt, destinationPath), false);
});

test("a fork receipt still selects its new chat even when source and destination paths coincide", () => {
  assert.equal(shouldFollowWorkspaceTransition({ action: "fork", destinationPath }, destinationPath), true);
});

test("the chat checks the current persisted cwd before following a successful receipt", async () => {
  const source = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!shouldFollowWorkspaceTransition\(transition, session\.cwd\)\) return;[\s\S]*?onSessionMoved\?\.\(id, transition\.destinationPath\)/);
  assert.match(source, /\[session\?\.id, session\?\.cwd, session\?\.relation\?\.kind\]/);
});
