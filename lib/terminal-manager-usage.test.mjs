import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const usage = await jiti.import("./git-workspace-usage.ts");
const paths = await jiti.import("./paths.ts");
const require = createRequire(import.meta.url);
const known = () => ({ known: true, entries: [] });
const empty = () => ({ sessions: known(), terminals: known(), checks: known(), inflight: known() });
const source = readFileSync(new URL("./terminal-manager.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });

test("cleanup terminal creation fence precedes native load/spawn, holds during start, releases on failure", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-terminal-usage-"));
  const child = join(root, "child"); mkdirSync(child);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let loads = 0, spawns = 0, placements = 0, fail = false, exit;
  const trusted = usage.createTrustedWorkspaceUsage(empty);
  const exports = {};
  const fakePty = { pid: 42, onData() {}, onExit(callback) { exit = callback; }, kill() {}, write() {}, resize() {} };
  runInNewContext(outputText, { exports, process: { platform: "linux", env: { SHELL: "/fixture-shell" }, once() {} }, setTimeout, clearTimeout, require(id) {
    if (id === "./git-workspace-usage") return { ...usage, beginGitWorkspacePlacement(cwd) {
      placements++;
      return usage.beginGitWorkspacePlacement(cwd);
    } };
    if (id === "./paths") return paths;
    if (id === "node-pty") {
      loads++;
      return { spawn() {
        spawns++;
        assert.throws(() => trusted.acquireLease(root), (error) => error.code === "inflight");
        if (fail) throw new Error("fixture failed spawn");
        return fakePty;
      } };
    }
    return require(id);
  } });
  const lease = trusted.acquireLease(root);
  assert.throws(() => exports.createTerminal(child, 80, 24), (error) => error.code === "leased");
  assert.equal(loads, 0); assert.equal(spawns, 0);
  lease.release();
  const id = exports.createTerminal(child, 80, 24);
  assert.equal(loads, 1); assert.equal(spawns, 1);
  const dangling = join(root, "dangling"); symlinkSync(join(root, "missing"), dangling);
  const beforeReuse = placements;
  const reuseLease = trusted.acquireLease(root);
  try {
    assert.equal(exports.createTerminal(child, 100, 30, id), id, "existing identity reuse is not placement");
    assert.throws(() => exports.createTerminal(dangling, 80, 24, id), /different workspace/);
    assert.equal(placements, beforeReuse, "neither reuse nor identity refusal creates a marker");
    assert.equal(loads, 1); assert.equal(spawns, 1);
  } finally { reuseLease.release(); }
  assert.throws(() => exports.createTerminal(dangling, 80, 24), (error) => error.code === "unknown");
  assert.equal(loads, 1); assert.equal(spawns, 1);
  assert.equal(exports.readTerminalWorkspaceUsage().known, false, "launch cwd is not containment proof");
  exit({ exitCode: 0 });
  assert.equal(exports.readTerminalWorkspaceUsage().known, false, "exit alone does not prove no children");
  exports.killTerminal(id);
  assert.equal(exports.readTerminalWorkspaceUsage().known, false, "empty registry still cannot prove absence of surviving children");
  fail = true;
  assert.throws(() => exports.createTerminal(child, 80, 24), /fixture failed spawn/);
  const afterFailure = trusted.acquireLease(root); afterFailure.release();
});
