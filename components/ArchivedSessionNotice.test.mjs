import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("the archived chat offers an inline restore without closing the conversation", () => {
  assert.match(chat, /<ArchivedSessionNotice\b[\s\S]*?rootSessionId=\{archivedRootSessionId\}/);
  assert.match(shell, /archivedRootSessionId=\{activeSessionFamily\?\.root\.archived \? activeSessionFamily\.root\.id : null\}/);
  assert.match(shell, /const handleSessionRestored =[\s\S]*?setRefreshKey\(\(key\) => key \+ 1\);/);
  assert.doesNotMatch(shell.slice(shell.indexOf("const handleSessionRestored"), shell.indexOf("const handleSessionDeleted")), /setSelectedSession\(null\)/);
});
