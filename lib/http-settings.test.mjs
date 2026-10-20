import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { defaultAgentDir, readHttpIdleTimeoutMs } = await jiti.import("./http-dispatcher.ts");

// All settings are disposable fixtures, never the operator's settings/auth files.
test("global HTTP idle settings preserve CLI parsing, including zero and BOM", t => {
  const dir = mkdtempSync(join(tmpdir(), "http-settings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(readHttpIdleTimeoutMs(dir), undefined);
  for (const [value, expected] of [[0, 0], [123.8, 123], [" 456 ", 456], ["disabled", 0], [" DISABLED ", 0], [-1, undefined], ["", undefined], [null, undefined], [true, undefined], ["nonsense", undefined]]) {
    writeFileSync(join(dir, "settings.json"), "\ufeff" + JSON.stringify({ httpIdleTimeoutMs: value }));
    assert.equal(readHttpIdleTimeoutMs(dir), expected, String(value));
  }
  for (const text of ["{", "null", "[]", "{}", '"disabled"']) {
    writeFileSync(join(dir, "settings.json"), text);
    assert.equal(readHttpIdleTimeoutMs(dir), undefined);
  }
});

test("non-regular settings do not block startup; regular-file links remain supported", t => {
  const dir = mkdtempSync(join(tmpdir(), "http-settings-file-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const settings = join(dir, "settings.json");
  mkdirSync(settings);
  assert.equal(readHttpIdleTimeoutMs(dir), undefined);
  rmSync(settings, { recursive: true });
  if (process.platform !== "win32") {
    execFileSync("mkfifo", [settings]);
    assert.equal(readHttpIdleTimeoutMs(dir), undefined);
    rmSync(settings);
  }
  const target = join(dir, "synthetic-settings.json");
  writeFileSync(target, JSON.stringify({ httpIdleTimeoutMs: 0 }));
  symlinkSync(target, settings);
  assert.equal(readHttpIdleTimeoutMs(dir), 0);
});

test("agent directory agrees with the pinned SDK, without trimming authored values", async t => {
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  const original = process.env.PI_CODING_AGENT_DIR;
  t.after(() => { if (original === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = original; });
  for (const value of [undefined, "", "~", "~/agent-test", "relative-agent", "  authored spaces  ", pathToFileURL(join(tmpdir(), "agent-url")).href]) {
    if (value === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = value;
    assert.equal(defaultAgentDir(), getAgentDir(), String(value));
  }
});
