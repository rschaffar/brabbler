import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Module, { createRequire } from "node:module";
import ts from "typescript";
import { createJiti } from "jiti";

const home = await readFile(new URL("./GitWorkflowHome.tsx", import.meta.url), "utf8");
const drafts = await readFile(new URL("./git-workflow-drafts.ts", import.meta.url), "utf8");
const legacy = await readFile(new URL("./GitWorkflowSettings.tsx", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url);
const policyModule = await jiti.import("../lib/git-workflow-policy-contract.ts");
const helpers = await jiti.import("./git-workflow-drafts.ts");
const component = new Module(new URL("./GitWorkflowSettings.tsx", import.meta.url).pathname);
component.filename = new URL("./GitWorkflowSettings.tsx", import.meta.url).pathname;
const realRequire = createRequire(import.meta.url);
component.require = (id) => id === "@/lib/git-workflow-policy-contract" ? policyModule
  : id === "@/lib/agent-client" ? {} : realRequire(id);
component._compile(ts.transpileModule(legacy, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, component.filename);
const { toDraft, toPolicy } = component.exports;

test("unified checks editor preserves literal argv, explicit empty list and ordering", () => {
  assert.match(drafts, /value === "" \? \[\] : value\.split\("\\n"\)/);
  assert.match(home, /check\.argv\.slice\(1\)\.join\("\\n"\)/);
  assert.match(home, /updateChecks\(\[\], \[\]\)/);
  assert.match(home, /values\.checks\.length >= MAX_GIT_WORKFLOW_CHECKS/);
  assert.match(home, /Move up/);
  assert.match(home, /Move down/);
  assert.match(home, /values\.checks\.filter\(\(_, i\) => i !== index\)/);
  assert.match(home, /<details className="workflow-recipe" key=\{recipeEditors\[index\]\.id\}/);
  const old = { label: "Old", argv: ["npm", "test"] };
  const extended = { label: "Extended", argv: ["node", "check.mjs"], cwd: "packages/web", env: { CI: "1" }, requiredStage: "handoff" };
  const data = { revision: "r1", global: {}, projectRoot: "/repo", project: { checks: [old, extended] }, session: {} };
  const entry = helpers.receiveWorkflowSettings({}, data, "chat")["project:/repo"];
  const edited = helpers.editWorkflowCheck(old, "arguments", "literal $VALUE\nwith spaces=kept");
  assert.deepEqual(edited.argv, ["npm", "literal $VALUE", "with spaces=kept"]);
  assert.deepEqual(Object.keys(edited), ["label", "argv"], "editing does not manufacture optional fields");
  assert.deepEqual(helpers.editWorkflowCheck(extended, "arguments", "").argv, ["node"]);
  const reordered = { ...entry, overrides: { checks: [extended, edited] }, recipeEditors: [...entry.recipeEditors].reverse() };
  assert.equal(reordered.recipeEditors[0].id, entry.recipeEditors[1].id);
  assert.deepEqual(helpers.workflowDraftOverrides(reordered).checks, [extended, edited]);
  assert.equal(helpers.resolveWorkflowDraft(data, "project", reordered.overrides, reordered.recipeEditors).validationError, undefined);
  const cleared = { ...entry, overrides: { checks: [] }, recipeEditors: [] };
  assert.deepEqual(helpers.workflowDraftOverrides(cleared), { checks: [] });
  assert.deepEqual(helpers.resolveWorkflowDraft(data, "project", cleared.overrides, cleared.recipeEditors).values.checks, []);
  assert.deepEqual(data.project.checks, [old, extended], "editing, reordering and clearing leave saved ancestors untouched");
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

test("functional optional recipe controls remain Project-only definitions, never run-on-save or authorization", () => {
  assert.match(home, /Ordered recipes replace the inherited list\. Saving does not run them/);
  assert.match(home, /no shell parsing/);
  assert.match(home, /execute project code, change files, and access networks/);
  assert.match(home, /Do not include URLs or credentials/);
  assert.match(home, /Checkout-relative directory · optional/);
  assert.match(home, /Literal environment overrides · optional/);
  assert.match(home, /Required stage · recipe prerequisite/);
  assert.match(home, /Saving does not run checks or grant execution/);
  assert.match(home, /Omitted directory, environment and stage fields remain omitted until explicitly edited/);
  assert.match(home, /An empty list does not waive project-required verification/);
  assert.doesNotMatch(home, /their editing and execution are not supported yet/);
  assert.match(home, /confirmation\("checkConfirmation"\)/);
  assert.match(home, /scope !== "project" \|\| values\.checks\.length/);
  assert.match(home, /confirmation choices are per-action preferences, separate from saved action authorization/);
  assert.match(home, /No Automatic mode, scheduling or chained approvals are enabled/);
  assert.match(home, /overrides: workflowDraftOverrides\(entry!\)/);
  assert.match(home, /destination === scope && \(disabled \|\| entry\?\.conflict \|\| resolution\?\.validationError\)/);
  assert.match(home, /className="workflow-primary" disabled=\{disabled \|\| !!entry\?\.conflict \|\| !!resolution\?\.validationError\}/);
  const invalid = { checks: [{ label: "Invalid", argv: ["true"], cwd: "../outside" }] };
  const data = { global: {}, project: {}, session: {} };
  assert.ok(helpers.resolveWorkflowDraft(data, "project", invalid).validationError, "invalid optional fields still block Save");
  assert.doesNotMatch(home, /exec\(|spawn\(|shell: true|\/api\/git\/integration/);
});
