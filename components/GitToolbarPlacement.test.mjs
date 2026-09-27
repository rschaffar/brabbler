import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("one icon beside Activity owns the on-demand Git controls, not the composer", () => {
  const activity = shell.indexOf('className="activity-top-button"');
  const git = shell.indexOf('aria-label="Git & workspace"');
  const chatMount = shell.indexOf("<ChatWindow");
  assert.ok(activity >= 0 && activity < git && git < chatMount);
  assert.match(shell, /aria-controls="chat-git-controls" aria-expanded=\{activeTopPanel === "git"\}/);
  assert.match(shell, /gitControlsOpen=\{activeTopPanel === "git"\}/);
  assert.match(chat, /messageCwd && gitControlsOpen && <div id="chat-git-controls"/);
  assert.doesNotMatch(chat, /<button[^>]*>\s*Git &amp; workspace\s*<\/button>/);
});
