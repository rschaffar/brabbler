import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settings = await readFile(new URL("./GitWorkflowSettings.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("fork is a separate, confirmed action for a registered checkout and assistant leaf", () => {
  assert.match(settings, /availableTargets\.some\(\(item\) => item\.path === forkTarget\)/);
  assert.match(settings, /forkDisabled = moveDisabled \|\| !assistantLeafId/);
  assert.match(settings, /setForkTarget\(item\.path\)/);
  assert.match(settings, /onClick=\{\(\) => void confirmFork\(\)\}/);
  assert.match(settings, /The original chat stays in/);
  assert.match(settings, /Uncommitted source files stay there and are not copied/);
  assert.match(chat, /session && !session\.transient && session\.relation\?\.kind !== "subagent" && activeLeafId/);
  assert.match(chat, /messages\[entryIds\.indexOf\(activeLeafId\)\]\?\.role === "assistant"/);
  assert.match(chat, /busy=\{sessionBusy \|\| streamState\.isStreaming \|\| isCompacting/);
});

test("clone uses the existing agent command before moving only the new ID", () => {
  const fork = settings.slice(settings.indexOf("async function confirmFork()"), settings.indexOf("const update ="));
  assert.match(fork, /sendAgentCommand<\{ cancelled\?: boolean; newSessionId\?: string \}>\(sessionId, \{ type: "clone", leafId: assistantLeafId \}\)/);
  assert.match(fork, /newSessionId = result\.newSessionId;[\s\S]*?fetch\(`\/api\/sessions\/\$\{encodeURIComponent\(newSessionId\)\}\/move`/);
  assert.match(fork, /method: "POST"[\s\S]*?JSON\.stringify\(\{ cwd: forkTarget \}\)/);
  assert.match(fork, /if \(!response\.ok\) throw[\s\S]*?onSessionForkedToWorktree\?\.\(newSessionId, forkTarget\)/);
  assert.match(fork, /Fork \$\{newSessionId\} was retained \(not deleted\)/);
  assert.doesNotMatch(fork, /method: "DELETE"|removeSession\(|createWorktree\(/i);
});

test("successful fork selects destination cwd and remounts without reusing source context", () => {
  assert.match(chat, /onSessionForkedToWorktree=\{onSessionForkedToWorktree\}/);
  assert.match(shell, /handleSessionForkedToWorktree = useCallback\(\(newSessionId: string, cwd: string\)/);
  assert.match(shell, /pendingMovedCheckoutRef\.current = \{ id: newSessionId, cwd \}/);
  assert.match(shell, /id: newSessionId, cwd, path: "", transient: false/);
  assert.match(shell, /setSessionKey\(\(key\) => key \+ 1\)/);
  assert.match(shell, /onSessionForkedToWorktree=\{handleSessionForkedToWorktree\}/);
  assert.match(shell, /selectedSession\.id === session\.id && sameProject && selectedSession\.cwd === session\.cwd/);
});
