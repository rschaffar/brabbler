import assert from "node:assert/strict";
import test from "node:test";

import { openFileTab, saveFileViewerState, setFileSaving } from "./file-tab-state.ts";

const tabA = {
  id: "file:/repo/a.ts",
  label: "a.ts",
  filePath: "/repo/a.ts",
  viewerRevision: 0,
  viewerState: {
    displayMode: "source",
    wrapLines: true,
    scrollTop: 240,
    scrollLeft: 16,
  },
};

const tabB = {
  id: "file:/repo/b.ts",
  label: "b.ts",
  filePath: "/repo/b.ts",
  viewerRevision: 0,
};

const openA = {
  fileName: "a.ts",
  filePath: "/repo/a.ts",
  tabId: "file:/repo/a.ts",
};

test("saving viewer state updates only the matching revision", () => {
  const tabs = [tabA, tabB];
  const nextState = { ...tabA.viewerState, scrollTop: 480 };
  const saved = saveFileViewerState(tabs, tabA.id, 0, nextState);

  assert.notStrictEqual(saved, tabs);
  assert.deepEqual(saved[0].viewerState, nextState);
  assert.strictEqual(saved[1], tabB);

  const stale = saveFileViewerState(saved, tabA.id, 9, tabA.viewerState);
  assert.strictEqual(stale, saved);
});

test("opening an existing tab normally preserves its state and revision", () => {
  const tabs = [tabA, tabB];
  assert.strictEqual(openFileTab(tabs, openA), tabs);
});

test("changing the source session remounts the viewer without losing its state", () => {
  const [next] = openFileTab([tabA], { ...openA, sourceSessionId: "session-2" });
  assert.equal(next.sourceSessionId, "session-2");
  assert.equal(next.viewerRevision, 1);
  assert.strictEqual(next.viewerState, tabA.viewerState);
});

test("opening from the same source session preserves the viewer revision", () => {
  const tab = { ...tabA, sourceSessionId: "session-1" };
  const tabs = [tab];
  assert.strictEqual(
    openFileTab(tabs, { ...openA, sourceSessionId: "session-1" }),
    tabs,
  );
});

test("changing source while forcing diff increments the revision once", () => {
  const [next] = openFileTab([tabA], {
    ...openA,
    sourceSessionId: "session-2",
    modeHint: "diff",
  });
  assert.equal(next.sourceSessionId, "session-2");
  assert.equal(next.viewerRevision, 1);
  assert.equal(next.viewerState.displayMode, "diff");
});

test("every explicit diff activation resets the mode and increments the revision", () => {
  const first = openFileTab([tabA, tabB], { ...openA, modeHint: "diff" });
  assert.equal(first[0].viewerRevision, 1);
  assert.deepEqual(first[0].viewerState, {
    displayMode: "diff",
    wrapLines: true,
    scrollTop: 0,
    scrollLeft: 0,
  });

  const returnedToSource = saveFileViewerState(first, tabA.id, 1, tabA.viewerState);
  const second = openFileTab(returnedToSource, { ...openA, modeHint: "diff" });
  assert.equal(second[0].viewerRevision, 2);
  assert.equal(second[0].viewerState.displayMode, "diff");
});

test("a remounted viewer ignores the previous revision's late cleanup", () => {
  const reopened = openFileTab([tabA], { ...openA, modeHint: "diff" });
  const stale = saveFileViewerState(reopened, tabA.id, 0, tabA.viewerState);
  assert.strictEqual(stale, reopened);
  assert.equal(stale[0].viewerState.displayMode, "diff");
});

test("a PDF page link remounts the viewer so the document jumps", () => {
  const [next] = openFileTab([tabA], { ...openA, page: 12 });
  assert.equal(next.page, 12);
  assert.equal(next.viewerRevision, 1);
  assert.strictEqual(next.viewerState, tabA.viewerState);
});

test("reopening the same PDF page keeps the viewer mounted", () => {
  const tabs = [{ ...tabA, page: 12 }];
  assert.strictEqual(openFileTab(tabs, { ...openA, page: 12 }), tabs);
});

test("opening another page of the same PDF increments the revision", () => {
  const [next] = openFileTab([{ ...tabA, page: 12 }], { ...openA, page: 13 });
  assert.equal(next.page, 13);
  assert.equal(next.viewerRevision, 1);
});

test("line links replace restored scroll without losing tab preferences or drafts", () => {
  const draft = { content: "dirty", baseline: "old", revision: "rev" };
  const tabs = openFileTab([{ ...tabA, draft }], { ...openA, lineTarget: { line: 36, endLine: 48 } });
  assert.deepEqual(tabs[0].lineTarget, { line: 36, endLine: 48 });
  assert.equal(tabs[0].viewerRevision, 1);
  assert.strictEqual(tabs[0].draft, draft);
  assert.strictEqual(tabs[0].viewerState, tabA.viewerState);
  const repeated = openFileTab(tabs, { ...openA, lineTarget: { line: 36, endLine: 48 } });
  assert.equal(repeated[0].viewerRevision, 2);
  assert.strictEqual(saveFileViewerState(repeated, tabA.id, 1, tabA.viewerState), repeated);
  const pending = saveFileViewerState(repeated, tabA.id, 2, tabA.viewerState);
  assert.deepEqual(pending[0].lineTarget, { line: 36, endLine: 48 }, "cleanup during loading retains pending navigation");
  const saved = saveFileViewerState(repeated, tabA.id, 2, { ...tabA.viewerState, scrollTop: 700 }, true);
  assert.equal(saved[0].lineTarget, undefined);
  assert.equal(saved[0].viewerState.scrollTop, 700);
  assert.strictEqual(openFileTab(saved, openA), saved);
});

test("line navigation waits for an in-flight save and stale saving callbacks cannot affect a new viewer", () => {
  const saving = [{ ...tabA, saving: true }];
  const queued = openFileTab(saving, { ...openA, lineTarget: { line: 36 } });
  assert.equal(queued[0].viewerRevision, 0);
  assert.equal(queued[0].lineTarget, undefined);
  assert.deepEqual(queued[0].pendingOpen.lineTarget, { line: 36 });
  const latest = openFileTab(queued, { ...openA, lineTarget: { line: 48 } });
  const settled = setFileSaving(latest, tabA.id, 0, false);
  assert.equal(settled[0].saving, false);
  assert.equal(settled[0].pendingOpen, undefined);
  assert.equal(settled[0].viewerRevision, 1);
  assert.deepEqual(settled[0].lineTarget, { line: 48 });
  assert.strictEqual(setFileSaving(settled, tabA.id, 0, true), settled);
});

test("new line-linked tabs carry the pending jump", () => {
  const [tab] = openFileTab([], { ...openA, lineTarget: { line: 36 } });
  assert.deepEqual(tab.lineTarget, { line: 36 });
});

test("opening a PDF without a page fragment clears a previous jump", () => {
  const [next] = openFileTab([{ ...tabA, page: 12 }], openA);
  assert.equal(next.page, undefined);
  assert.equal(next.viewerRevision, 1);
});
