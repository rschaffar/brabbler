import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";

// Execute the real probe callbacks and watcher effect, not copied lifecycle logic.
const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("FileViewer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const viewer = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "TextFileViewer");
const definitions = viewer.body.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ["fetchEditable", "fetchGitDiff"].includes(d.name.getText(file))));
const watcher = viewer.body.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(file) === "useEffect" && n.getText(file).includes('es.addEventListener("change", synchronize)'));
assert.equal(definitions.length, 2);
assert.ok(watcher);
const script = new Script(ts.transpileModule(`exports.probes = (() => { ${definitions.map(n => n.getText(file)).join("\n")} ${watcher.getText(file)}; return { fetchEditable, fetchGitDiff }; })();`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

for (const nextCwd of ["/new-checkout", "/old-checkout"]) test(`disposed watcher cannot stale current probes (${nextCwd})`, async () => {
  const oldRead = deferred();
  const edit = deferred(), git = deferred();
  const refs = { savingRef: { current: false }, editRequestRef: { current: 0 }, gitDiffRequestRef: { current: 0 }, probeEligibilityRef: { current: null }, draftRef: { current: null }, esRef: { current: null } };
  const state = {};
  function mount(cwd, fetchContent) {
    let cleanup;
    const sources = [];
    const exports = {};
    const scope = { ...refs, exports, cwd, filePath: "/file.txt", sourceSessionId: "session", watchEnabled: true, fetchContent,
      useCallback: fn => fn, useEffect: effect => { cleanup = effect(); }, URLSearchParams,
      getFileApiUrl: () => "/file", bindEditIdentity: () => true, setFileDraft() {}, setExternalChange() {}, setEditing() {}, setWatching() {},
      setEditSnapshot: v => { state.edit = v; }, setGitDiff: v => { state.git = v; },
      setGitDiffLoading: v => { state.loading = v; }, setGitDiffResolved: v => { state.resolved = v; },
      fetch: url => url.startsWith("/api/git/diff") ? git.promise : edit.promise,
      EventSource: class { constructor() { this.listeners = new Map(); sources.push(this); } addEventListener(type, fn) { this.listeners.set(type, fn); } close() {} },
    };
    script.runInNewContext(scope);
    return { cleanup, events: sources[0], ...exports.probes };
  }
  const old = mount("/old-checkout", () => oldRead.promise);
  old.events.listeners.get("connected")();
  old.cleanup();
  const current = mount(nextCwd, async () => {});
  refs.probeEligibilityRef.current = { path: "/file.txt", cwd: nextCwd, sessionId: "session", edit: true, gitDiff: true };
  const pending = [current.fetchEditable("/file.txt"), current.fetchGitDiff("/file.txt")];
  oldRead.resolve();
  await setImmediate();
  assert.equal(refs.editRequestRef.current, 1);
  assert.equal(refs.gitDiffRequestRef.current, 1);
  if (nextCwd !== "/old-checkout") {
    await old.fetchEditable("/file.txt"); await old.fetchGitDiff("/file.txt");
    assert.equal(refs.editRequestRef.current, 1, "reject old identity before advancing generation");
    assert.equal(refs.gitDiffRequestRef.current, 1);
  }
  edit.resolve(Response.json({ content: "saved", revision: "revision", writable: true, editIdentity: "a".repeat(64) }));
  git.resolve(Response.json({ supported: true, patch: "patch" }));
  await Promise.all(pending);
  assert.equal(state.edit.revision, "revision");
  assert.equal(state.git.patch, "patch");
  assert.equal(state.loading, false);
  assert.equal(state.resolved, true);
  current.cleanup();
});
