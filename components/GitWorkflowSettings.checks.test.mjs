import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Module, { createRequire } from "node:module";
import ts from "typescript";
import { createJiti } from "jiti";

const home = await readFile(new URL("./GitWorkflowHome.tsx", import.meta.url), "utf8");
const drafts = await readFile(new URL("./git-workflow-drafts.ts", import.meta.url), "utf8");
const legacy = await readFile(new URL("./GitWorkflowSettings.tsx", import.meta.url), "utf8");
const policyModule = await createJiti(import.meta.url).import("../lib/git-workflow-policy.ts");
const component = new Module(new URL("./GitWorkflowSettings.tsx", import.meta.url).pathname);
component.filename = new URL("./GitWorkflowSettings.tsx", import.meta.url).pathname;
const realRequire = createRequire(import.meta.url);
component.require = (id) => id === "@/lib/git-workflow-policy" ? policyModule
  : id === "@/lib/agent-client" ? {} : realRequire(id);
component._compile(ts.transpileModule(legacy, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, component.filename);
const { toDraft, toPolicy } = component.exports;

test("unified checks editor preserves literal argv, explicit empty list and ordering", () => {
  assert.match(drafts, /value === "" \? \[\] : value\.split\("\\n"\)/);
  assert.match(home, /check\.argv\.slice\(1\)\.join\("\\n"\)/);
  assert.match(home, /update\("checks", \[\]\)/);
  assert.match(home, /values\.checks\.length >= MAX_GIT_WORKFLOW_CHECKS/);
  assert.match(home, /Move up/);
  assert.match(home, /Move down/);
  assert.match(home, /values\.checks\.filter\(\(_, i\) => i !== index\)/);
  assert.match(home, /<details className="workflow-recipe"/);
});

test("legacy editor roundtrips extended fields and exact omission on label/executable/argv edits", () => {
  const base = { mode: "current", onCreate: "stay", commits: "manual" };
  const old = { label: "Old", argv: ["npm", "test"] };
  const extended = { label: "Extended", argv: ["node", "check.mjs"], cwd: "packages/web", env: { CI: "1" }, requiredStage: "handoff" };
  for (const policy of [base, { ...base, checks: [] }, { ...base, checks: [old] }, { ...base, checks: [extended] },
    { ...base, checks: [{ ...old, cwd: ".", env: {}, requiredStage: "integration" }] }]) {
    assert.equal(JSON.stringify(toPolicy(toDraft(policy))), JSON.stringify(policy));
  }
  for (const [field, value, expected] of [["label", "Renamed", { ...extended, label: "Renamed" }],
    ["executable", "npm", { ...extended, argv: ["npm", "check.mjs"] }],
    ["argumentsText", "run\ntest", { ...extended, argv: ["node", "run", "test"] }],
    ["argumentsText", "", { ...extended, argv: ["node"] }]]) {
    const draft = toDraft({ ...base, checks: [old, extended] });
    draft.checks[1] = { ...draft.checks[1], [field]: value };
    const saved = toPolicy(draft);
    assert.deepEqual(saved.checks, [old, expected]);
    assert.deepEqual(Object.keys(saved.checks[0]), ["label", "argv"]);
    draft.checks[1].env.CI = "draft-only";
    assert.equal(extended.env.CI, "1");
    assert.equal(saved.checks[1].env.CI, "1");
  }
  const draft = toDraft({ ...base, checks: [extended] });
  draft.checks[0].executable = "";
  assert.throws(() => toPolicy(draft), /Invalid Git workflow check/);
  assert.match(legacy, /Extended recipe directory, environment and required-stage fields are retained/);
  assert.match(legacy, /their execution is not supported yet/);
});

test("check definitions cannot imply run-on-save or unavailable execution controls", () => {
  assert.match(home, /Ordered recipes replace the inherited list\. Saving does not run them/);
  assert.match(home, /no shell parsing/);
  assert.match(home, /execute project code, change files, and access networks/);
  assert.match(home, /Do not include URLs or credentials/);
  assert.match(home, /directory, environment and required-stage fields are preserved/);
  assert.match(home, /their editing and execution are not supported yet/);
  assert.match(home, /confirmation\("checkConfirmation"\)/);
  assert.match(home, /scope !== "project" \|\| values\.checks\.length/);
  assert.match(home, /confirmation choices are preferences for future scoped tools, not standing authorization/);
  assert.match(home, /AUTOMATIC_WORKFLOW_UNAVAILABLE/);
  assert.doesNotMatch(home, /exec\(|spawn\(|shell: true|\/api\/git\/integration/);
});
