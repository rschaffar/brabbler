import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const home = await readFile(new URL("./GitWorkflowHome.tsx", import.meta.url), "utf8");

test("unified checks editor preserves literal argv, explicit empty list and ordering", () => {
  assert.match(home, /value === "" \? \[\] : value\.split\("\\n"\)/);
  assert.match(home, /check\.argv\.slice\(1\)\.join\("\\n"\)/);
  assert.match(home, /update\("checks", \[\]\)/);
  assert.match(home, /values\.checks\.length >= MAX_GIT_WORKFLOW_CHECKS/);
  assert.match(home, /Move up/);
  assert.match(home, /Move down/);
  assert.match(home, /values\.checks\.filter\(\(_, i\) => i !== index\)/);
  assert.match(home, /<details className="workflow-recipe"/);
});

test("check definitions cannot imply run-on-save or unavailable execution controls", () => {
  assert.match(home, /Ordered recipes replace the inherited list\. Saving does not run them/);
  assert.match(home, /no shell parsing/);
  assert.match(home, /execute project code, change files, and access networks/);
  assert.match(home, /Do not include URLs or credentials/);
  assert.match(home, /Per-recipe directory, environment and timeout editing is not supported yet/);
  assert.match(home, /value="ask" disabled aria-label="Check execution"/);
  assert.match(home, /AUTOMATIC_WORKFLOW_UNAVAILABLE/);
  assert.doesNotMatch(home, /exec\(|spawn\(|shell: true|\/api\/git\/integration/);
});
