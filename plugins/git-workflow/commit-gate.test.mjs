import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeCommitGate } from "./commit-gate.fixture.mjs";

const executable = (name) => execFileSync("which", [name], { encoding: "utf8" }).trim();

test("preflight forwarding never starts Node, preserves stdin/arguments/status, and never signals commit", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-commit-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Quotes and shell-looking path text must be literal, not shell evaluation.
  const dir = join(root, "a space ' $literal"); mkdirSync(dir);
  const marker = join(dir, "started");
  const gitPath = executable("git"), shellPath = executable("sh");
  const shim = writeCommitGate(dir, { gitPath, shellPath, marker, nodePath: join(root, "Node-must-not-run") });
  const args = ["hash-object", "--stdin"];
  const input = "literal argument and stdin\n";
  assert.equal(execFileSync(shim, args, { input, encoding: "utf8" }), execFileSync(gitPath, args, { input, encoding: "utf8" }));
  assert.equal(existsSync(marker), false);
  assert.throws(() => execFileSync(shim, ["not-a-git-command"], { stdio: "ignore" }), (error) => error.status === 1);
  assert.equal(existsSync(marker), false);
});

test("commit enters the original delayed Node gate, forwards the real write, and preserves its failure status", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-commit-gate-native-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const gitPath = executable("git"), shellPath = executable("sh"), marker = join(root, "started");
  const shim = writeCommitGate(root, { gitPath, shellPath, marker, nodePath: process.execPath });
  const git = (...args) => execFileSync(shim, ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-qb", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(root, "a file"), "value\n"); git("add", "--", "a file");
  git("-c", "commit.gpgSign=false", "commit", "-m", "literal $message ' quote");
  assert.equal(readFileSync(marker, "utf8"), "started");
  assert.equal(git("log", "-1", "--format=%s").trim(), "literal $message ' quote");
  rmSync(marker);
  assert.throws(() => git("-c", "commit.gpgSign=false", "commit", "-m", "empty"), (error) => error.status === 1);
  assert.equal(readFileSync(marker, "utf8"), "started", "failed native commit also entered the gate");
});
