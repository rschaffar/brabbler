import { test } from "node:test";
import assert from "node:assert/strict";
import { createFileWorkspace, openWorkspaceFile, splitFileGroup, patchFileView, groupIds, fileGeometry, minimumFileSize,
  closeFileGroup, moveFileView, navigateFileHistory, resizeFileSplit } from "./file-workspace.ts";
import { FileEditSessions } from "./file-edit-sessions.ts";
import { FileWorkspaceStore } from "./file-workspace-store.ts";
const location = (name, extra = {}) => ({ filePath: `/project/${name}`, label: name, cwd: "/project", sourceSessionId: "session-a", ...extra });
const guide = () => openWorkspaceFile(createFileWorkspace(), location("guide.md"));
const active = (state, group = "pane-1") => state.groups[group].active;

test("opt-in guide links reuse one preview without multiplying groups or tabs", () => {
  let state = guide(), origin = active(state);
  state = splitFileGroup(state, "pane-1", "right", false);
  const destination = groupIds(state.tree)[1];
  state = patchFileView(state, origin, { route: destination });
  for (let i = 0; i < 20; i++) state = openWorkspaceFile(state, location(`source-${i}.ts`, { lineTarget: { line: i + 1 } }), origin);
  assert.equal(Object.keys(state.groups).length, 2);
  assert.equal(Object.keys(state.views).length, 2);
  assert.equal(active(state), origin);
  assert.equal(state.activeGroup, "pane-1");
  assert.equal(state.views[active(state, destination)].filePath, "/project/source-19.ts");
});
test("ordinary opens stay ordinary and routes do not affect other documents", () => {
  let state = guide(), origin = active(state);
  state = splitFileGroup(state, "pane-1", "right", false);
  const destination = groupIds(state.tree)[1];
  state = patchFileView(state, origin, { route: destination });
  state = openWorkspaceFile(state, location("chapter.md"), origin, { kind: "here" });
  const chapter = active(state);
  assert.equal(state.views[chapter].route, undefined);
  state = openWorkspaceFile(state, location("a.ts"), chapter);
  assert.equal(state.groups[destination].views.length, 0);
  assert.equal(state.groups["pane-1"].views.length, 3);
});
test("three and four groups support nested axes with stable existing IDs", () => {
  let state = guide(); const view = active(state);
  state = splitFileGroup(state, "pane-1", "right");
  const second = groupIds(state.tree)[1];
  state = splitFileGroup(state, second, "below");
  state = splitFileGroup(state, "pane-1", "below");
  assert.equal(groupIds(state.tree).length, 4);
  assert.ok(state.views[view]);
  assert.equal(new Set(Object.keys(state.views)).size, 4);
  const minimum = minimumFileSize(state.tree);
  const geometry = fileGeometry(state.tree, { x: 0, y: 0, width: minimum.width + 600, height: minimum.height + 300 });
  assert.equal(Object.keys(geometry.groups).length, 4);
  assert.equal(geometry.dividers.length, 3);
  for (const rect of Object.values(geometry.groups)) { assert.ok(rect.width >= 320); assert.ok(rect.height >= 276); }
});
test("closing a destination never falls back to replacing the guide", () => {
  let state = guide(); const origin = active(state);
  state = splitFileGroup(state, "pane-1", "right", false);
  const destination = groupIds(state.tree)[1];
  state = patchFileView(state, origin, { route: destination });
  state = closeFileGroup(state, destination);
  assert.strictEqual(openWorkspaceFile(state, location("a.ts"), origin), state);
  assert.equal(active(state), origin);
  assert.equal(state.views[origin].route, destination);
});
test("kept and dirty tabs cannot be replaced by following links", () => {
  let state = guide(); const origin = active(state);
  state = openWorkspaceFile(state, location("a.ts"), origin, { kind: "split", axis: "right" });
  const destination = groupIds(state.tree)[1], first = active(state, destination);
  state = patchFileView(state, first, { draft: { content: "changed", baseline: "old", revision: "r" } });
  assert.equal(state.views[first].preview, false);
  state = openWorkspaceFile(state, location("b.ts"), origin, { kind: "group", id: destination });
  assert.equal(state.groups[destination].views.length, 2);
  assert.ok(state.views[first].draft);
});
test("explicit repeat jumps use new navigation generations, not new views", () => {
  let state = guide(); const id = active(state);
  state = openWorkspaceFile(state, location("guide.md", { lineTarget: { line: 12 } }), id);
  const revision = state.views[id].viewerRevision;
  state = openWorkspaceFile(state, location("guide.md", { lineTarget: { line: 12 } }), id);
  assert.equal(active(state), id);
  assert.equal(state.views[id].viewerRevision, revision + 1);
});
test("same-document locations ignore a cross-pane route", () => {
  let state = guide(); const id = active(state);
  state = splitFileGroup(state, "pane-1", "right", false);
  state = patchFileView(state, id, { route: groupIds(state.tree)[1] });
  state = openWorkspaceFile(state, location("guide.md", { lineTarget: { line: 99 } }), id);
  assert.equal(state.views[id].lineTarget.line, 99);
  assert.equal(Object.keys(state.views).length, 1);
  assert.equal(state.lastOpen.group, "pane-1");
});
test("routed pending saves retain source focus and expose the exact destination", () => {
  let state = guide(); const origin = active(state);
  state = splitFileGroup(state, "pane-1", "right", false);
  const destination = groupIds(state.tree)[1];
  state = patchFileView(state, origin, { route: destination });
  state = openWorkspaceFile(state, location("a.ts"), origin);
  const owner = active(state, destination);
  state = patchFileView(state, owner, { saving: true });
  state = openWorkspaceFile(state, location("a.ts", { lineTarget: { line: 50 } }), origin);
  assert.equal(state.activeGroup, "pane-1");
  assert.deepEqual(state.lastOpen, { group: destination, view: owner });
  assert.equal(state.views[owner].pendingOpen.lineTarget.line, 50);
});
test("move/join retain duplicate view identities and invalidate self routes", () => {
  let state = guide(); const first = active(state);
  state = splitFileGroup(state, "pane-1", "right");
  const secondGroup = groupIds(state.tree)[1], second = active(state, secondGroup);
  state = patchFileView(state, first, { route: secondGroup });
  state = moveFileView(state, first, secondGroup);
  assert.equal(Object.keys(state.groups).length, 1);
  assert.deepEqual(new Set(state.groups[secondGroup].views), new Set([first, second]));
  assert.equal(state.views[first].route, "closed");
});
test("history retains replaced previews, source context and saved position", () => {
  let state = guide();
  state = openWorkspaceFile(state, location("one.ts", { viewerState: { displayMode: "source", wrapLines: true, scrollTop: 400, scrollLeft: 0 } }), undefined, { kind: "group", id: "pane-1" });
  state = openWorkspaceFile(state, location("two.ts"), undefined, { kind: "group", id: "pane-1" });
  state = navigateFileHistory(state, "pane-1", "back");
  assert.equal(state.views[active(state)].filePath, "/project/one.ts");
  assert.equal(state.views[active(state)].viewerState.scrollTop, 400);
  state = navigateFileHistory(state, "pane-1", "forward");
  assert.equal(state.views[active(state)].filePath, "/project/two.ts");
});
test("source context separates resources and saves cannot be navigated away", () => {
  let state = guide(); const origin = active(state);
  state = patchFileView(state, origin, { saving: true });
  state = openWorkspaceFile(state, location("guide.md", { lineTarget: { line: 20 } }), origin);
  assert.equal(state.views[origin].pendingOpen.lineTarget.line, 20);
  assert.equal(state.views[origin].lineTarget, undefined);
  const next = openWorkspaceFile(state, location("guide.md", { sourceSessionId: "session-b" }), origin);
  assert.equal(Object.keys(next.views).length, 2);
});
test("invalid split ratio updates are refused and subtree minima constrain geometry", () => {
  let state = splitFileGroup(guide(), "pane-1", "right");
  assert.strictEqual(resizeFileSplit(state.tree, state.tree.id, NaN), state.tree);
  state = { ...state, tree: resizeFileSplit(state.tree, state.tree.id, 0.99) };
  const geometry = fileGeometry(state.tree, { x: 0, y: 0, width: 800, height: 600 });
  assert.equal(Object.values(geometry.groups).at(-1).width, 320);
});
test("silent reading reports remain visible to later workspace renders without shell notifications", () => {
  const store = new FileWorkspaceStore();
  let notifications = 0;
  store.subscribe(() => notifications++);
  let first = guide(); const id = active(first);
  store.set("session-a", first);
  first = patchFileView(first, id, { viewerState: { displayMode: "source", wrapLines: false, scrollTop: 450, scrollLeft: 0 } });
  store.set("session-a", first, true);
  store.set("session-b", guide());
  assert.equal(store.snapshot()["session-a"].views[id].viewerState.scrollTop, 450);
  assert.equal(notifications, 2, "scroll reports do not trigger shell-level rendering");
});

test("edit sessions arbitrate aliases without granting identity-less editing", () => {
  const store = new FileEditSessions();
  assert.equal(store.claim("unadmitted"), false);
  store.bind("first", "server-identity"); store.bind("second", "server-identity");
  assert.equal(store.claim("first"), true);
  assert.equal(store.claim("second"), false);
  store.draft("first", { content: "new", baseline: "old", revision: "r" });
  store.draft("second", { content: "bad", baseline: "old", revision: "r" });
  assert.equal(store.snapshot("first").draft.content, "new");
  assert.equal(store.dirty, true);
  store.saving("first", true);
  assert.equal(store.close("first"), false);
  store.bind("first", "different");
  assert.equal(store.snapshot("first").saving, true);
  store.saving("first", false);
  assert.equal(store.close("first"), true);
  assert.equal(store.claim("second"), true);
});
