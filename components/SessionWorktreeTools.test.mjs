import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const source = name => readFile(new URL(name, import.meta.url), "utf8");

test("worktree filtering does not select cwd and scopes bulk selection and search", async () => {
  const sidebar = await source("./SessionSidebar.tsx");
  const choose = sidebar.slice(sidebar.indexOf("const chooseSessionWorktree"), sidebar.indexOf("const showWorktreeSwitcher"));
  assert.match(choose, /setSessionFilter/); assert.match(choose, /setBulkSelectedIds\(new Set\(\)\)/);
  assert.doesNotMatch(choose, /setSelectedCwd|onCwdChange|allowFileRoot|fetch/);
  assert.match(sidebar, /bulkScope = JSON.stringify\(\[selectedProject\?\.key \?\? "", showArchived, sessionWorktreeCwd\]\)/);
  assert.match(sidebar, /worktreeCwd=\{sessionWorktreeCwd\}/);
  assert.match(sidebar, /sessionWorktreeCwd = sessionFilter && sessionFilter.project === selectedProject\?\.key \? sessionFilter.cwd : null/);
  assert.match(sidebar, /sessionFamiliesForWorktree\(allSessions, selectedProject\?\.key/);
  assert.match(sidebar, /entry.state !== "present"[\s\S]*?chooseSessionWorktree\(entry.path\)/);
  assert.match(sidebar, /archiveDisabled=\{family.archiveOwnerId !== family.root.id\}/);
  assert.match(sidebar, /action !== "delete" && bulkArchiveBlocked/);
  assert.match(sidebar, /if \(!refreshed\) throw new Error/);
});

test("history inventory has request ownership, no cwd effects or new grants", async () => {
  const hook = await source("../hooks/useSessionWorktrees.ts");
  assert.match(hook, /signal: controller.signal/);
  assert.match(hook, /if \(!controller.signal.aborted\) setState/);
  assert.match(hook, /return \(\) => controller.abort\(\)/);
  assert.match(hook, /state.key === key \? state.inventory : undefined/);
  assert.doesNotMatch(hook, /localStorage|allowFileRoot|setSelectedCwd|\/api\/cwd\/validate/);
});

test("bulk dialog separates review from effects, owns dispatch through refresh, and does not automatically retry", async () => {
  const dialog = await source("./SessionBulkMoveDialog.tsx");
  assert.match(dialog, /element.showModal\(\)/);
  assert.match(dialog, /mode: "preview"/); assert.match(dialog, /runSessionMoveBatches\(plan, setProgress\)/);
  assert.match(dialog, /observedDestinationIds/);
  assert.match(dialog, /let movedIds: string\[\] = \[\]/, "an unknown response must not close every reviewed chat as if moved");
  assert.match(dialog, /if \(!plan \|\| operation.current\) return/);
  assert.match(dialog, /operation.current = true/);
  assert.match(dialog, /finally[\s\S]*await onSettled\(movedIds, failedIds, invalidatedIds, plan.cwd\)/);
  const sidebar = await source("./SessionSidebar.tsx");
  assert.match(sidebar, /\[\.\.\.movedIds, \.\.\.invalidatedIds\]\.includes\(selectedSessionIdRef.current\)/);
  assert.match(sidebar, /onSessionDeleted\?\.\(selectedSessionId, moveDestination, false\)/);
  assert.match(sidebar, /setSelectedCwd\(moveDestination\)/);
  const shell = await source("./AppShell.tsx");
  assert.match(shell, /const cwd = replacementCwd \?\? selectedSession.cwd/);
  assert.match(shell, /setActiveCwd\(replacementCwd\)/);
  assert.match(sidebar, /confirmedDestination \?\? null, false/);
  assert.match(shell, /if \(refreshCatalogue\) setRefreshKey/);
  assert.match(sidebar, /directoryUnavailable = cwdPropPending \|\|/);
  const uncertain = shell.slice(shell.indexOf('replacementCwd === null'), shell.indexOf('clearTabOpenSession(sessionId)'));
  assert.match(uncertain, /cwdState: "unavailable"/);
  assert.doesNotMatch(uncertain, /setSelectedSession\(null\)|setNewSessionCwd|setNewSessionDraftId/);
  assert.match(dialog, /if \(!operation.current\) onClose\(\)/);
  assert.match(dialog, /unknownOutcome/);
  assert.match(dialog, /currentCwd=""/);
  assert.match(dialog, /DirectoryPickerPortalContext.Provider value=\{dialog\}/);
  const picker = await source("./DirectoryPicker.tsx");
  assert.match(picker, /setPortalTarget\(portalRoot\?\.current \?\? document.body\)/);
  assert.match(picker, /event.preventDefault\(\); event.stopPropagation\(\)/);
  assert.match(dialog, /setDestination\(value\); setPlan\(null\)/);
  assert.doesNotMatch(dialog, /setInterval|Promise.race|localStorage|\/api\/agent\/|\/api\/worktrees.*POST/);
});
