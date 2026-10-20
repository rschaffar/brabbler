import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { getSessionListIndices, updateSessionArchiveState } = await jiti.import("./SessionSidebar.tsx");

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const globalStyles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("session search inherits the selected project and archive view unless widened explicitly", async () => {
  const searchSource = await readFile(new URL("./SessionSearch.tsx", import.meta.url), "utf8");
  assert.match(source, /projectKey=\{searchAllProjects \? null : selectedProject\?\.key \?\? null\}/);
  assert.match(source, /status=\{searchBothStatuses \? "both" : showArchived \? "archived" : "active"\}/);
  assert.match(source, /setSearchAllProjects\(false\);\s*setSearchBothStatuses\(false\)/);
  assert.match(source, /checked=\{searchAllProjects\}/);
  assert.match(source, /checked=\{searchBothStatuses\}/);
  assert.match(source, /checked=\{searchTitlesOnly\}/);
  assert.match(source, /titlesOnly=\{searchTitlesOnly\}/);
  assert.match(source, /setSearchBothStatuses\(false\);\s*setSearchTitlesOnly\(false\)/);
  assert.match(searchSource, /field: titlesOnly \? "title" : "all"/);
  assert.match(searchSource, /titlesOnly && ` · \$\{t\("sidebar.searchTitlesOnly"\)\}`/);
  assert.match(searchSource, /if \(allProjects\) params\.set\("scope", "all"\);\s*else if \(projectKey\) params\.set\("projectKey", projectKey\)/);
  assert.match(searchSource, /if \(!open \|\| !search \|\| !canSearch\) return/);
  assert.match(searchSource, /const response = state\.key === requestKey \? state\.response : undefined/);
  assert.match(searchSource, /controller\.abort\(\)/);
});

test("scrolling keeps the focused session and the viewport mounted without expanding the whole window", () => {
  for (const [scrollTop, focusedIndex] of [[0, 1999], [10000, 0]]) {
    const indices = getSessionListIndices(2000, scrollTop, 335, focusedIndex);
    const firstVisible = Math.floor(scrollTop / 54);
    const lastVisible = Math.ceil((scrollTop + 335) / 54) - 1;
    for (let index = firstVisible; index <= lastVisible; index++) assert.ok(indices.includes(index));
    assert.ok(indices.includes(focusedIndex));
    assert.equal(indices.length, 24);
    assert.equal(new Set(indices).size, indices.length);
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  }
  assert.equal(getSessionListIndices(2000, 0, 335, 3).length, 23);
  const blurred = getSessionListIndices(2000, 10000, 335);
  assert.equal(blurred.length, 23);
  assert.ok(!blurred.includes(0));
});

test("session windows stay valid after a project shrinks and before the viewport is measured", () => {
  assert.deepEqual(getSessionListIndices(5, 80000, 335, 1999), [0, 1, 2, 3, 4]);
  assert.deepEqual(getSessionListIndices(0, 80000, 335, 1999), []);
  assert.equal(getSessionListIndices(2000, 0, 0).length, 28);
});

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setActionsOpen\(false\);\s*setConfirmDelete\(true\);/,
  );
});

test("every persisted session row copies its deep link without selecting the row", () => {
  assert.match(sessionItemSource, /handleCopyLink[\s\S]*?e\.stopPropagation\(\);[\s\S]*?copyText\(sessionDeepLink\(window\.location\.origin, session\.id\)\)/);
  assert.match(sessionItemSource, /onClick=\{handleCopyLink\}[\s\S]*?aria-label=\{t\("sidebar\.copySessionLink"\)\}/);
  assert.match(sessionItemSource, /\{!session\.transient && !bulkSelecting && \([\s\S]*?onClick=\{handleCopyLink\}/);
});

test("move action keeps explicit confirmation and includes touch rows", () => {
  assert.match(sessionItemSource, /onMove\?\.\(\)/);
  assert.match(sessionItemSource, /disabled=\{isRunning\}[\s\S]*?sidebar\.moveSession/);
  assert.match(source, /<SessionMoveDestinationPicker projects=\{recentProjects\} currentProject=\{movingSession\.projectRoot \?\? movingSession\.cwd\} currentCwd=\{movingSession\.cwd\}/);
  assert.match(source, /disabled=\{moveBusy \|\| !moveDestination\}/);
  assert.match(source, /\/move`, \{[\s\S]*?method: "POST"/);
  assert.match(source, /data\.movedIds\?\.includes\(selectedSessionId\)/);
});

test("persists and exposes a vertical session/explorer resize handle", () => {
  assert.match(source, /axis: "vertical"/);
  assert.match(source, /storageKey: "pi-web:sidebar-session-pane-height"/);
  assert.match(source, /Math\.round\(\(paneHeight \+ explorerHeight\) \/ 2\)/);
  assert.match(source, /ref=\{sessionPaneRef\}[\s\S]*?<SessionSearch/);
  assert.match(source, /data-resize-handle="sidebar-sections"/);
  assert.match(source, /sidebar-section-resize-handle/);
  assert.match(globalStyles, /\.sidebar-section-resize-handle:focus-visible::after/);
  assert.doesNotMatch(globalStyles, /\.sidebar-section-resize-handle:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/);
  assert.match(globalStyles, /\.sidebar-section-resize-handle::after[\s\S]*?background: transparent/);
  assert.match(source, /borderTop: "1px solid var\(--border\)"/);
  assert.match(source, /var\(--sidebar-session-pane-height, 320px\)/);
  assert.match(source, /minHeight: explorerOpen \? EXPLORER_PANE_MIN_HEIGHT : 0/);
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("exposes the polled running-session set to the shell", () => {
  assert.match(source, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("exposes the loaded session catalog to the shell", () => {
  assert.match(source, /onSessionsChange\?: \(sessions: SessionInfo\[\]\) => void/);
  assert.match(source, /onSessionsChange\?\.\(allSessions\)/);
});

test("server review snapshot includes subagents in Activity without adding subagent sounds", () => {
  assert.match(source, /completionNotificationSuppressedSessionIds\?: string\[\]/);
  assert.match(source, /reviewedRuns\?: SessionCompletion\[\]/);
  assert.match(source, /setSubagentReviewIds\(\(prev\) => sameIdSet\(prev, reviewed\.subagentReady\) \? prev : reviewed\.subagentReady\)/);
  assert.match(source, /setUnreadSessionIds\(\(prev\) => sameIdSet\(prev, reviewed\.rootReady\) \? prev : reviewed\.rootReady\)/);
  assert.match(source, /completedWithNotifications = completedInBackground\.filter\([\s\S]*?!previousSuppressedCompletionSessionIdsRef\.current\.has\(id\)[\s\S]*?!knownSubagentIds\.has\(id\)/);
  assert.match(source, /if \(completedWithNotifications\.length > 0\) \{\s*onBackgroundTaskDone\?\.\(\)/);
  assert.match(source, /onActivityChange\?\.\(attention, new Set\(\[\.\.\.unreadSessionIds, \.\.\.subagentReviewIds\]\), activityAvailable, laterSessionIds, laterAttentionSessionIds\)/);
});

test("Later validates the displayed request token instead of substituting a replacement question", () => {
  assert.match(source, /markReviewLater = useCallback\(\(id: string, requestId\?: string\)/);
  assert.match(source, /const receipt = \{ sessionId: id, requestId \};\s*if \(!isCurrentActivityRequest\(attention, receipt\)\) return;/);
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("formats session timestamps with the active locale", () => {
  assert.match(source, /import \{ formatRelativeTime \} from "@\/lib\/i18n\/format"/);
  assert.match(sessionItemSource, /const \{ locale, t \} = useI18n\(\)/);
  assert.match(sessionItemSource, /formatRelativeTime\(session\.modified, locale\)/);
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});

test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItemSource, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItemSource,
    /onContextMenu=\{bulkSelecting \|\| confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});

test("lifecycle refreshes bypass the cache while cross-window polling reuses it", () => {
  assert.match(source, /function sessionListUrl\(summary: boolean, force: boolean\)/);
  assert.match(source, /if \(summary\) return "\/api\/sessions\?summary=1"/);
  assert.match(source, /if \(force\) return "\/api\/sessions\?force=1"/);
  assert.match(source, /cache: "no-store"/);
  // First paint uses the cheap summary listing, then hydrates after a delay.
  assert.match(source, /loadSessions\(true, false, true\)/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*?void loadSessions\(false, true\)/);
  assert.match(source, /data\.sessionListVersion !== sessionListVersionRef\.current[\s\S]*?await loadSessions\(\)/);
  assert.doesNotMatch(source, /sessionRefreshDone|sessionRefreshTimerRef|title=\{t\("sidebar\.refresh"\)\}/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  assert.match(sessionItemSource, /\{!session\.transient && !bulkSelecting && \(/);
});

test("groups session families with independent worktree and archive scope", () => {
  assert.match(source, /sessionFamiliesForWorktree\(allSessions, selectedProject\?\.key \?\? null, sessionWorktreeCwd, showArchived \? "archived" : "active"\)/);
  assert.match(source, /familySessions\.some\(\(session\) => session\.id === selectedSessionId\)/);
  assert.match(source, /familySessions\.some\(\(session\) => runningSessionIds\.has\(session\.id\) \|\| queuedSessionIds\.has\(session\.id\)\)/);
  assert.doesNotMatch(source, /function SessionTreeItem/);
});

test("offers archive and restore beside permanent deletion", () => {
  assert.match(source, /setShowArchived\(\(value\) => !value\)/);
  assert.match(sessionItemSource, /body: JSON\.stringify\(\{ archived: !archivedView \}\)/);
  assert.match(sessionItemSource, /if \(!response\.ok\) throw new Error/);
  assert.match(sessionItemSource, /onArchived\?\.\(session\.id, !archivedView\)/);
  assert.match(sessionItemSource, /onDeleted\?\.\(session\.id\)/);
});

test("archive and restore immediately update the visible family before a forced refresh", () => {
  const sessions = [{ id: "root", archived: false }, { id: "child" }];
  const archived = updateSessionArchiveState(sessions, "root", true);
  assert.equal(archived[0].archived, true);
  assert.equal(archived[1], sessions[1]);
  assert.equal(sessions[0].archived, false);
  assert.equal(updateSessionArchiveState(archived, "root", false)[0].archived, false);
  assert.match(source, /sessionLoadIdRef\.current \+= 1;[\s\S]*?setAllSessions\(\(current\) => updateSessionArchiveState\(current, id, archived\)\);[\s\S]*?void loadSessions\(false, true\)/);
});

test("bulk selection is opt-in, family-root scoped, and hides row actions", () => {
  assert.match(source, /bulkModeScope === bulkScope && !sessionSearchActive/);
  assert.match(source, /sessionFamilies\.filter\(\(family\) => !family\.root\.transient && bulkSelectedIds\.has\(family\.root\.id\)\)/);
  assert.match(source, /setBulkModeScope\(bulkScope\)/);
  assert.match(source, /if \(bulkSelecting\) exitBulkMode\(\)/);
  assert.match(source, /bulkConfirmDelete && \([\s\S]*?sidebar\.bulkDeleteConfirm[\s\S]*?performBulkAction\("delete"\)/);
  assert.match(source, /setBulkSelectedIds\(new Set\(result\.failed\.map\(\(item\) => item\.id\)\)\)/);
  assert.match(sessionItemSource, /bulkSelecting \? \(bulkBusy \|\| session\.transient \? undefined : onToggleBulk\) :/);
  assert.match(sessionItemSource, /\{bulkSelecting && \(\s*<input type="checkbox"/);
  assert.match(sessionItemSource, /\{!session\.transient && !bulkSelecting && \(/);
});

test("touch rows show one compact toggle and reveal centered actions only after expansion", () => {
  assert.match(sessionItemSource, /className="session-row-actions-toggle"/);
  assert.match(sessionItemSource, /aria-expanded=\{actionsOpen\}/);
  assert.match(sessionItemSource, /className="session-row-actions" data-open=\{actionsOpen\}/);
  assert.match(sessionItemSource, /display: "flex", alignItems: "center", justifyContent: "center", width: 32/);
  assert.match(globalStyles, /@media \(hover: none\), \(pointer: coarse\) \{\s*\.session-row-actions-toggle \{\s*display: flex;\s*\}\s*\.session-row-actions\[data-open="true"\] \{\s*display: flex;/);
  assert.doesNotMatch(globalStyles, /min-width: 40px;/);
});
