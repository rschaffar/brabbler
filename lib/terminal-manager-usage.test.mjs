import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";
import { seedRetiredGitBookkeeping } from "./retired-git-bookkeeping-fixture.mjs";

const jiti = createJiti(import.meta.url);
const paths = await jiti.import("./paths.ts");
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./terminal-manager.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });

test("retired bookkeeping cannot block terminal startup; failures reap only owned PTY", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-terminal-usage-"));
  const child = join(root, "child"); mkdirSync(child);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let loads = 0, spawns = 0, kills = 0, failSpawn = false, failSubscribe = false, exit;
  const exports = {};
  const fakePty = { pid: 42, onData() { if (failSubscribe) throw new Error("fixture failed subscription"); },
    onExit(callback) { exit = callback; }, kill() { kills++; }, write() {}, resize() {} };
  const context = { exports, process: { platform: "linux", env: { SHELL: "/fixture-shell" }, once() {} }, setTimeout, clearTimeout, require(id) {
    if (id === "./paths") return paths;
    if (id === "node-pty") {
      loads++;
      return { spawn(_shell, _args, options) {
        spawns++;
        assert.equal(options.cwd, child);
        if (failSpawn) throw new Error("fixture failed spawn");
        return fakePty;
      } };
    }
    return require(id);
  } };
  const restore = seedRetiredGitBookkeeping([root, child], context);
  runInNewContext(outputText, context);
  try {
    const id = exports.createTerminal(child, 80, 24);
    assert.equal(loads, 1); assert.equal(spawns, 1);
    assert.equal(exports.hasTerminal(id), true);
    assert.equal(exports.createTerminal(child, 100, 30, id), id);
    assert.throws(() => exports.createTerminal(root, 80, 24, id), /different workspace/);
    assert.equal(spawns, 1);
    assert.equal(exports.readTerminalWorkspaceUsage, undefined, "unused inventory admission API is deleted");
    exit({ exitCode: 0 });
    exports.killTerminal(id);
    const priorKills = kills;
    failSpawn = true;
    assert.throws(() => exports.createTerminal(child, 80, 24, "spawn-failed"), /fixture failed spawn/);
    assert.equal(exports.hasTerminal("spawn-failed"), false);
    assert.equal(kills, priorKills);
    failSpawn = false; failSubscribe = true;
    assert.throws(() => exports.createTerminal(child, 80, 24, "setup-failed"), /fixture failed subscription/);
    assert.equal(exports.hasTerminal("setup-failed"), false);
    assert.equal(kills, priorKills + 1);
  } finally { restore(); }
});
