import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settings = await readFile(new URL("./GitWorkflowSettings.tsx", import.meta.url), "utf8");

test("checks are optional, retain argv boundaries and survive mode changes", () => {
  assert.match(settings, /checks: \[\]/);
  assert.match(settings, /policy\.checks\?\.map\(\(\{ label, argv \}\) => \(\{ label, executable: argv\[0\], argumentsText: argv\.slice\(1\)\.join\("\\n"\) \}\)\)/);
  assert.match(settings, /argumentsText === "" \? \[\] : argumentsText\.split\("\\n"\)/);
  assert.match(settings, /\.\.\.\(draft\.checks\.length \? \{ checks:/);
  assert.match(settings, /onChange=\{\(e\) => update\("mode", e\.target\.value as Draft\["mode"\]\)\}/);
  assert.match(settings, /const update = <K extends keyof Draft>\(key: K, next: Draft\[K\]\) => setDraft\(\(current\) => \(\{ \.\.\.current, \[key\]: next \}\)\)/);
});

test("explicit check editor has add/remove, separate executable and literal argument lines, no run-on-save", () => {
  assert.match(settings, /Verification checks \(optional\)/);
  assert.match(settings, /No checks are configured by default\. Saving does not run them\. Checks run only after explicit selection/);
  assert.match(settings, /can execute project code/);
  assert.match(settings, /no shell quoting, expansion, or command string is parsed/);
  assert.match(settings, /Do not include URLs or credentials/);
  assert.match(settings, /value=\{check\.executable\}/);
  assert.match(settings, /value=\{check\.argumentsText\}/);
  assert.match(settings, /checks: current\.checks\.filter\(\(_, i\) => i !== index\)/);
  assert.match(settings, /draft\.checks\.length >= MAX_GIT_WORKFLOW_CHECKS/);
  assert.match(settings, /checks: \[\.\.\.current\.checks, \{ label: "", executable: "", argumentsText: "" \}\]/);
  assert.match(settings, /try \{ policy = choice === "off" \? null : toPolicy\(draft\); \}/);
  assert.doesNotMatch(settings, /exec\(|spawn\(|shell: true/);
});
