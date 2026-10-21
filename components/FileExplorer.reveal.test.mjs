import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";
const helpers = await createJiti(import.meta.url).import("../lib/explorer-reveal.ts");
const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("FileExplorer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find(node => node.name.getText(ast) === "FileExplorer");
const effect = declaration.initializer.arguments[0].body.statements.find(node => ts.isExpressionStatement(node) && node.getText(ast).includes("const root = explorerRevealRoot"));
assert.ok(effect, "execute the real reveal effect, not a copied algorithm");
const script = new Script(ts.transpileModule(effect.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
const entry = (fullPath, isDir = false) => ({ fullPath, isDir });
const request = (filePath, id = 1) => ({ filePath, id });
function mount(revealRequest, listings, options = {}) {
  const state = { expanded: new Set(["/repo/retained"]) }, reads = [], settled = [];
  const revealGeneration = { current: 0 };
  let cleanup;
  script.runInNewContext({ ...helpers, revealRequest, cwd: options.cwd ?? "/repo", browseRootRef: { current: options.root ?? "/repo" },
    fileSearchOpen: options.search ?? false, t: key => key, revealGeneration,
    onRevealSettled: id => settled.push(id),
    setBrowseRoot: value => { state.root = value; },
    setRevealSelection: value => { state.selection = value; },
    setRevealNotice: value => { state.notice = value; },
    setExpandedPaths: update => { state.expanded = update(state.expanded); },
    fetchEntries: async path => { reads.push(path); if (!(path in listings)) throw new Error("Forbidden"); return listings[path]; },
    useEffect: fn => { cleanup = fn(); },
  });
  return { state, reads, cleanup, settled, revealGeneration };
}

test("sidebar commands open Explorer and leave both search and Changes without replaying a settled ID", async () => {
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("SessionSidebar.tsx", sidebar, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const shell = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "SessionSidebar");
  const command = shell.body.statements.find(node => ts.isExpressionStatement(node) && node.getText(parsed).includes("consumedReveal.current === fileRevealRequest.id"));
  const execute = new Script(ts.transpileModule(command.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
  const consumedReveal = { current: undefined }, changes = [];
  for (const id of [1, 1, 2]) execute.runInNewContext({ consumedReveal, fileRevealRequest: request("/repo/file", id), revealContext: "checkout-and-chat",
    setPendingReveal: value => { assert.equal(value.context, "checkout-and-chat"); changes.push(value.request.id); },
    setExplorerOpen: value => assert.equal(value, true), setFileSearchOpen: value => assert.equal(value, false),
    setChangesCollapsed: value => assert.equal(value, true), useEffect: fn => fn(),
  });
  assert.deepEqual(changes, [1, 2]);
});

test("nested reveal expands canonical listed ancestors and retains other expanded folders", async () => {
  const run = mount(request("/repo/nested/deeper/file"), { "/repo": [entry("/repo/nested", true)], "/repo/nested": [entry("/repo/nested/deeper", true)], "/repo/nested/deeper": [entry("/repo/nested/deeper/file")] });
  await setImmediate();
  assert.deepEqual(run.reads, ["/repo", "/repo/nested", "/repo/nested/deeper"]);
  assert.deepEqual([...run.state.expanded], ["/repo/retained", "/repo/nested", "/repo/nested/deeper"]);
  assert.equal(run.state.selection.path, "/repo/nested/deeper/file");
  assert.equal(run.state.notice, undefined);
  assert.deepEqual(run.settled, [1], "consume the command separately from its persistent selection");
});

test("Windows reveal uses canonical listing spelling for expansion", async () => {
  const run = mount(request("c:\\repo\\nested\\FILE"), { "C:/Repo": [entry("C:/Repo/Nested", true)], "C:/Repo/Nested": [entry("C:/Repo/Nested/File")] }, { cwd: "C:/Repo", root: "C:/Repo" });
  await setImmediate();
  assert.equal(run.state.selection.path, "C:/Repo/Nested/File");
  assert.ok(run.state.expanded.has("C:/Repo/Nested"));
});

test("a later same-file command has a fresh selection ID and re-expands folders", async () => {
  for (const id of [1, 2]) {
    const run = mount(request("/repo/nested/file", id), { "/repo": [entry("/repo/nested", true)], "/repo/nested": [entry("/repo/nested/file")] });
    await setImmediate();
    assert.equal(run.state.selection.id, id);
    assert.ok(run.state.expanded.has("/repo/nested"));
  }
});

test("superseded/unmounted requests cannot select a stale result", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const old = mount(request("/repo/old"), { "/repo": gate });
  old.cleanup();
  const snapshot = JSON.stringify(old.state);
  const next = mount(request("/other/file", 2), { "/other": [entry("/other/file")] });
  release([entry("/repo/old")]);
  await setImmediate();
  assert.equal(JSON.stringify(old.state), snapshot);
  assert.equal(next.state.root, "/other");
  assert.equal(next.state.selection.path, "/other/file");
});

test("explicit Return navigation invalidates a pending request before its response", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const run = mount(request("/other/file"), { "/other": gate });
  run.revealGeneration.current++;
  const snapshot = JSON.stringify(run.state);
  release([entry("/other/file")]);
  await setImmediate();
  assert.equal(JSON.stringify(run.state), snapshot);
  assert.deepEqual(run.settled, []);
});

test("selection focuses once, scrolls only Explorer and stays highlighted on remount", () => {
  const tree = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TreeNode");
  const focusEffect = tree.body.statements.find(node => ts.isExpressionStatement(node) && node.getText(ast).includes("row.focus({ preventScroll: true })"));
  const focusScript = new Script(ts.transpileModule(focusEffect.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
  const scroller = { scrollTop: 40, getBoundingClientRect: () => ({ top: 100, bottom: 200 }) };
  let focused = 0, claimed = 0;
  const row = { focus: options => { assert.equal(options.preventScroll, true); focused++; }, closest: () => scroller, getBoundingClientRect: () => ({ top: 220, bottom: 244 }) };
  for (const focus of [true, false]) focusScript.runInNewContext({ rowRef: { current: row }, revealed: true,
    revealSelection: { path: "/repo/file", id: 1, focus }, onRevealFocus: id => { assert.equal(id, 1); claimed++; }, useEffect: fn => fn(),
  });
  assert.equal(focused, 1);
  assert.equal(claimed, 1);
  assert.equal(scroller.scrollTop, 84);
});

test("denied folder and missing/excluded files remain unselected with visible feedback", async () => {
  for (const listings of [{}, { "/other": [] }]) {
    const run = mount(request("/other/file"), listings);
    await setImmediate();
    assert.equal(run.state.selection, undefined);
    assert.equal(run.state.notice, "files.revealUnavailable");
    assert.deepEqual(run.reads, ["/other"], "no cwd validation or root grant fallback");
  }
  const search = mount(request("/repo/file"), {}, { search: true });
  assert.deepEqual(search.reads, [], "wait for the sidebar to close its search projection");
});
