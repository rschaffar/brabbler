import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";
const { ExplorerUpload } = await createJiti(import.meta.url).import("../lib/explorer-upload.ts");
const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("FileExplorer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find(node => node.name.getText(ast) === "FileExplorer");
const body = declaration.initializer.arguments[0].body;
const callbacks = body.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ["prepareUpload", "openUploadHere", "handleFileDrop", "handleUploadInput"].includes(d.name.getText(ast))));
const ownerEffect = body.statements.find(node => ts.isExpressionStatement(node) && node.getText(ast).includes("const owner = new ExplorerUpload"));
assert.equal(callbacks.length, 4);
assert.ok(ownerEffect);
const script = new Script(ts.transpileModule(`${ownerEffect.getText(ast)}\n${callbacks.map(node => node.getText(ast)).join("\n")}\nexports.handlers = {prepareUpload, openUploadHere, handleFileDrop, handleUploadInput};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const files = [new File(["body"], "note.txt")];
function mount(cwd, transport) {
  const states = [], completed = [], clicks = [];
  const exports = {};
  let cleanup;
  const owner = { current: null }, picker = { current: cwd };
  class Owned extends ExplorerUpload { constructor(changed, done) { super(changed, done, transport); } }
  script.runInNewContext({ exports, cwd, ExplorerUpload: Owned, uploadOwner: owner, pickerDirectory: picker,
    idleUploadState: () => ({ phase: "idle", conflict: null }),
    setUploadState: state => states.push(state), setHighlightedPaths() {}, setTreeRefreshKey: () => completed.push("complete"),
    setFolderNotice() {}, setDropTarget() {}, uploadInputRef: { current: { click: () => clicks.push(picker.current) } },
    useEffect: effect => { cleanup = effect(); }, useCallback: fn => fn,
    joinFilePath: (dir, name) => `${dir}/${name}`, hasFileDrag: () => true,
    readDroppedFiles: () => ({ files, folders: [], unsupported: false }), t: value => value,
  });
  return { ...exports.handlers, states, completed, clicks, cleanup, owner };
}

test("Explorer React identity includes both selected checkout and chat, not project grouping", () => {
  assert.match(sidebar, /<FileExplorer\s+key=\{JSON\.stringify\(\[selectedCwd \?\? selectedCwdProp, selectedSessionId\]\)\}/);
});

for (const phase of ["check", "upload", "conflict", "picker"]) test(`actual Explorer callbacks discard the old ${phase} owner across a keyed context switch`, async () => {
  const gate = deferred();
  let signal, sends = 0, checks = 0;
  const transport = {
    check: async (_dir, _files, s) => { checks++; signal = s; return phase === "check" ? gate.promise : phase === "conflict" ? { conflicts: ["note.txt"] } : {}; },
    upload: async (_dir, _files, _strategy, s) => { sends++; signal = s; return gate.promise; },
  };
  const old = mount("/old-checkout", transport);
  if (phase === "picker") old.openUploadHere("/old-checkout/nested");
  else { old.prepareUpload(files, "/old-checkout/nested"); await setImmediate(); }
  if (phase !== "picker") {
    old.openUploadHere("/wrong-target");
    assert.deepEqual(old.clicks, [], "picker stays locked during checking, uploading and conflict review");
    old.handleFileDrop({ dataTransfer: {}, preventDefault() {}, stopPropagation() {} }, "/wrong-target");
    assert.equal(checks, 1, "competing drops cannot replace the active batch");
  }
  old.cleanup();
  if (signal) assert.equal(signal.aborted, true);
  const settledStates = old.states.length;
  const current = mount("/new-checkout", {
    check: async () => ({}), upload: async () => ({ status: 200, data: { uploaded: ["note.txt"] } }),
  });
  // Even a late filechooser change from a detached old input cannot use the new
  // component's refs or write to its current directory.
  old.handleUploadInput({ target: { files, value: "selection" } });
  gate.resolve(phase === "check" ? {} : { status: 200, data: { uploaded: ["note.txt"] } });
  await setImmediate();
  assert.equal(old.states.length, settledStates);
  assert.equal(old.completed.length, 0);
  assert.equal(sends, phase === "upload" ? 1 : 0);
  current.openUploadHere("/new-checkout/deep");
  current.handleUploadInput({ target: { files, value: "selection" } });
  await setImmediate();
  assert.equal(current.states.at(-1).summary.directory, "/new-checkout/deep");
  assert.equal(current.completed.length, 1);
  current.cleanup();
});

const tree = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TreeNode");
const refreshEffect = tree.body.statements.find(node => ts.isExpressionStatement(node) && node.getText(ast).includes("if (!projection && node.isDir)"));
const refreshScript = new Script(ts.transpileModule(refreshEffect.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);

test("closed-folder refresh clears loading and invalidates stale child requests without listing search projections", () => {
  for (const projection of [false, true]) {
    let cleanup, lists = 0;
    const values = {}, childRequest = { current: 4 };
    refreshScript.runInNewContext({ projection, node: { isDir: true }, open: false, refreshToken: "refresh", childRequest,
      setLoaded: value => { values.loaded = value; }, setLoading: value => { values.loading = value; }, setLoadError: value => { values.error = value; },
      loadChildren: () => { lists++; }, useEffect: effect => { cleanup = effect(); },
    });
    assert.equal(lists, 0);
    assert.deepEqual(values, projection ? {} : { loaded: false, loading: false, error: null });
    cleanup();
    assert.equal(childRequest.current, 5);
  }
});
