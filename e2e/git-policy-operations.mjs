import assert from "node:assert/strict";

// These helpers use the real private E2E server and saved Project settings.
// No successful receipts, staged trees, journal records or policy grants are mocked.
export async function checkRecipeControls(page, { workflow, cwd, otherProject, chooseScope, expand, selectProject, save, closeWorkflow, home, readSettings }) {
  const recipes = workflow.locator(".workflow-recipe");
  const recipe = recipes.first();
  const openRecipe = async () => {
    await expand("checks");
    if (!await recipe.evaluate((element) => element.open)) await recipe.locator("summary").click();
  };
  const directory = () => recipe.getByLabel("Checkout-relative directory · optional", { exact: true });
  const stage = () => recipe.getByLabel("Required stage · recipe prerequisite", { exact: true });
  const names = () => recipe.getByLabel("Environment name", { exact: true });
  const values = () => recipe.getByLabel("Literal value", { exact: true });
  const saveButton = () => workflow.getByRole("button", { name: "Save project defaults", exact: true });
  const literal = '$HOME $(echo untouched) ; "quoted" = spaced';
  await openRecipe();
  assert.equal(await directory().inputValue(), "");
  assert.equal(await stage().inputValue(), "");
  assert.equal(await names().count(), 0);
  await recipe.getByLabel("Label", { exact: true }).fill("Omitted recipe fields stay omitted");
  const omitted = (await save("project")).project.checks[0];
  assert.deepEqual(Object.keys(omitted).sort(), ["argv", "label"], "Editing a legacy label must not insert defaults");
  await openRecipe();
  await directory().fill("packages/web");
  await stage().selectOption("commit");
  await recipe.getByRole("button", { name: "Add environment row", exact: true }).click();
  // Real DOM typing, not just fill: a recipe/row remount loses focus and truncates typing.
  const nameNode = await names().first().elementHandle();
  await names().first().focus();
  await page.keyboard.type("FIXTURE_LITERAL");
  assert.equal(await nameNode.evaluate((node) => node.isConnected && document.activeElement === node), true);
  const valueNode = await values().first().elementHandle();
  await values().first().focus();
  await page.keyboard.type(literal);
  assert.equal(await valueNode.evaluate((node) => node.isConnected && document.activeElement === node), true);
  assert.equal(await values().first().inputValue(), literal);
  await recipe.getByRole("button", { name: "Add environment row", exact: true }).click();
  await names().nth(1).fill("FIXTURE_EMPTY");
  const extended = (await save("project")).project.checks[0];
  assert.deepEqual(extended, { ...omitted, cwd: "packages/web", requiredStage: "commit",
    env: { FIXTURE_LITERAL: literal, FIXTURE_EMPTY: "" } });
  await openRecipe();
  let edited = extended;
  for (const [label, value, patch] of [
    ["Label", "Edited extended recipe", { label: "Edited extended recipe" }],
    ["Executable", "node", { argv: ["node", ...extended.argv.slice(1)] }],
    ["Arguments · one literal argument per line", '-e\nprocess.exit(0)\nliteral $NAME with "quotes"',
      { argv: ["node", "-e", "process.exit(0)", 'literal $NAME with "quotes"'] }],
  ]) {
    await recipe.getByLabel(label, { exact: true }).fill(value);
    edited = { ...edited, ...patch };
    assert.deepEqual((await save("project")).project.checks[0], edited, `${label} editing preserves cwd/env/stage and literal argv`);
    await openRecipe();
  }
  await recipe.getByLabel("Label", { exact: true }).fill(omitted.label);
  await recipe.getByLabel("Executable", { exact: true }).fill(omitted.argv[0]);
  await recipe.getByLabel("Arguments · one literal argument per line", { exact: true }).fill(omitted.argv.slice(1).join("\n"));
  assert.deepEqual((await save("project")).project.checks[0], extended);
  await openRecipe();
  for (const requiredStage of ["handoff", "none", "integration", ""]) {
    await stage().selectOption(requiredStage);
    const saved = (await save("project")).project.checks[0];
    assert.equal(Object.hasOwn(saved, "requiredStage"), requiredStage !== "");
    if (requiredStage) assert.equal(saved.requiredStage, requiredStage);
    assert.deepEqual(saved.env, extended.env);
    assert.equal(saved.cwd, extended.cwd);
    await openRecipe();
  }
  // Invalid raw drafts stay editable, never hit PUT, and survive Project×scope navigation.
  const writes = [];
  const observe = (request) => {
    if (new URL(request.url()).pathname === "/api/git/workflow/settings" && request.method() === "PUT") writes.push(request.postDataJSON());
  };
  page.on("request", observe);
  try {
    await directory().fill("../outside");
    assert.equal(await saveButton().isDisabled(), true);
    await names().nth(1).fill("fixture_literal"); // case-insensitive duplicate
    await values().nth(1).fill("unfinished duplicate draft");
    await chooseScope("global"); await chooseScope("project"); await openRecipe();
    assert.equal(await directory().inputValue(), "../outside");
    assert.equal(await names().nth(1).inputValue(), "fixture_literal");
    assert.equal(await values().nth(1).inputValue(), "unfinished duplicate draft");
    await closeWorkflow(); await home(); await openRecipe();
    assert.equal(await saveButton().isDisabled(), true);
    await selectProject(otherProject); await chooseScope("project");
    await selectProject(cwd); await chooseScope("project"); await openRecipe();
    assert.equal(await directory().inputValue(), "../outside");
    assert.equal(await values().nth(1).inputValue(), "unfinished duplicate draft");
    await directory().fill(".");
    assert.equal(await saveButton().isDisabled(), true, "Fixing cwd cannot silently drop invalid duplicate env rows");
    for (const invalidName of ["GIT_INDEX_FILE", "NEXT_PORT", "NOT A NAME"]) {
      await names().nth(1).fill(invalidName);
      assert.equal(await saveButton().isDisabled(), true, invalidName);
      assert.equal(await names().nth(1).inputValue(), invalidName);
    }
    await names().nth(1).fill("FIXTURE_EMPTY");
    await values().nth(1).fill("https://example.invalid/not-executed");
    assert.equal(await saveButton().isDisabled(), true, "URLs are not saved as literal overrides");
    assert.deepEqual(writes, [], "Invalid drafts never write policy");
    assert.deepEqual((await readSettings({ cwd })).project.checks[0].env, extended.env, "Invalid typing cannot overwrite saved values");
    await values().nth(1).fill("");
  } finally {
    page.off("request", observe);
    await nameNode.dispose(); await valueNode.dispose();
  }
  const explicitRoot = (await save("project")).project.checks[0];
  assert.equal(explicitRoot.cwd, ".", "An explicit root stays distinct from omitted cwd");
  assert.deepEqual(explicitRoot.env, extended.env);
  assert.equal(Object.hasOwn(explicitRoot, "requiredStage"), false);
  await openRecipe();
  await directory().fill("");
  await recipe.getByRole("button", { name: "Remove environment overrides", exact: true }).click();
  const reset = (await save("project")).project.checks[0];
  assert.deepEqual(reset, omitted, "Explicit removal restores omission, not cwd '.', env {} or default stage");
  console.log("PASS: real Project recipe cwd/stage/literal env controls, lossless omission, invalid draft navigation and stable typing focus");
}

export async function runRequiredIntegrationChecks(page, { panel, sessionId, checkIndexes = [0, 1] }) {
  const response = page.waitForResponse(http => new URL(http.url()).pathname === "/api/git/integration"
    && http.request().method() === "POST" && http.request().postDataJSON()?.operation === "verify", { timeout: 180_000 });
  await panel.getByRole("button", { name: "Run required checks", exact: true }).click();
  const http = await response;
  assert.equal(http.status(), 200, await http.text());
  assert.deepEqual(http.request().postDataJSON(), { sessionId, operation: "verify", checkIndexes });
  const body = await http.json();
  assert.equal(body.receipts.length, checkIndexes.length);
  assert.equal(body.actionIds.length, checkIndexes.length);
  assert.deepEqual(body.receipts.map(r => r.checkIndex), checkIndexes);
  for (const receipt of body.receipts) {
    assert.deepEqual(receipt.batch, body.receipts[0].batch, "real returned siblings share original-cohort display metadata");
    assert.deepEqual(receipt.batch.checkIndexes, checkIndexes);
    await panel.getByText(`Passed: receipt ${receipt.id};`, { exact: false }).waitFor();
  }
  assert.equal(await panel.getByRole("button", { name: "Prepare exact integration proposal", exact: true }).isEnabled(), true,
    "optional diagnostics warnings must not block genuine successful batch evidence");
  if (body.diagnostics) await panel.getByText(/Optional action history or output is unavailable/).waitFor();
  return body;
}

export async function checkRetiredRecovery(page, { panel, sessionId }) {
  const requests = [], observe = request => { if (new URL(request.url()).pathname === "/api/git/check-recovery") requests.push(request.method()); };
  page.on("request", observe);
  try {
    const information = panel.getByRole("region", { name: "Check outcome information" });
    await information.getByText(/Failed or uncertain checks produce no passing receipt/).waitFor();
    assert.match(await information.innerText(), /history does not block other invocations/);
    assert.equal(await information.locator("button,input,form").count(), 0, "no approval, release, rerun or cleanup controls");
    await panel.getByRole("button", { name: "Refresh review", exact: true }).click();
    await panel.getByRole("button", { name: "Run required checks", exact: true }).waitFor();
    assert.deepEqual(requests, [], "static information never requests recovery on mount/refresh");
    const endpoint = new URL("/api/git/check-recovery", page.url());
    const get = await page.request.get(`${endpoint}?sessionId=${encodeURIComponent(sessionId)}`);
    assert.equal(get.status(), 200); const info = await get.json();
    assert.deepEqual(Object.keys(info).sort(), ["diagnosticOnly", "reason", "retired"]);
    assert.equal(info.diagnosticOnly, true); assert.equal(info.retired, true);
    const post = await page.request.post(endpoint.href, { data: { sessionId,
      actionId: "00000000-0000-4000-8000-000000000001", revision: "00000000-0000-4000-8000-000000000002", acknowledged: true } });
    assert.equal(post.status(), 410); assert.deepEqual(await post.json(), info);
  } finally { page.off("request", observe); }
}

/** A separately approved stale attempt fails once. Fixture movement/restoration
 * is explicit test setup, never application retry, rebasing or approval transfer.
 */
export async function rejectMovedIntegrationTarget(page, { panel, sessionId, advanceTarget, restoreTarget, targetHead }) {
  await runRequiredIntegrationChecks(page, { panel, sessionId });
  const planned = page.waitForResponse(http => new URL(http.url()).pathname === "/api/git/integration"
    && http.request().method() === "POST" && http.request().postDataJSON()?.operation === "plan");
  await panel.getByRole("button", { name: "Prepare exact integration proposal", exact: true }).click();
  const prepared = await planned; assert.equal(prepared.status(), 200, await prepared.text());
  const original = await prepared.json();
  const calls = [], observe = request => {
    if (new URL(request.url()).pathname === "/api/git/integration" && request.method() === "POST") calls.push(request.postDataJSON());
  };
  advanceTarget(); const moved = targetHead();
  page.on("request", observe);
  try {
    const confirmed = page.waitForResponse(http => new URL(http.url()).pathname === "/api/git/integration"
      && http.request().method() === "POST" && http.request().postDataJSON()?.operation === "confirm");
    await panel.getByRole("button", { name: /^Confirm exact plan/ }).click();
    const refused = await confirmed;
    assert.equal(refused.status(), 409, "moved target must not trigger rebaseline or automatic retry");
    assert.equal(refused.request().postDataJSON().planId, original.plan.planId);
    await panel.getByRole("alert").filter({ hasText: /stale|revoked|contended|inspect/i }).waitFor();
    assert.equal(targetHead(), moved, "failed original attempt cannot rewrite the concurrent target");
    assert.equal(await panel.getByRole("button", { name: /^Confirm exact plan/ }).count(), 0);
    assert.deepEqual(calls.map(call => call.operation), ["confirm"], "no automatic plan, check or confirm after stale failure");
  } finally { page.off("request", observe); restoreTarget(); }
  // Start another explicit invocation, never reuse the original approval.
  await panel.getByRole("button", { name: "Refresh review", exact: true }).click();
  await panel.getByRole("button", { name: "Run required checks", exact: true }).waitFor();
}

export async function reviewCommitChecks(page, { panel, sessionId, cwd, git, checkContainmentSupported, changeSource, restoreSource }) {
  const endpoint = "/api/git/verification";
  const responseFor = (operation) => page.waitForResponse((response) => new URL(response.url()).pathname === endpoint
    && response.request().method() === "POST" && response.request().postDataJSON()?.operation === operation,
    { timeout: 120_000 });
  const preview = panel.getByLabel("Check execution preview", { exact: true });
  const candidate = panel.getByLabel("Commit preview", { exact: true });
  const review = async () => {
    const response = responseFor("preview");
    await panel.getByRole("button", { name: "Review required check run", exact: true }).click();
    const http = await response;
    assert.equal(http.status(), 200, await http.text());
    const body = await http.json();
    assert.deepEqual(http.request().postDataJSON(), { sessionId, operation: "preview", checkIndexes: [0] });
    assert.equal(body.source, cwd);
    assert.equal(body.evidenceScope, "working-workspace");
    assert.equal(body.candidateTreeVerified, false);
    await preview.waitFor();
    assert.match(await preview.innerText(), /Commands may modify files.*does not approve or perform a commit/s);
    assert.equal(await preview.getByRole("checkbox").count(), 0, "One check-run approval, no extra reviewed checkbox");
    return body;
  };
  const run = async () => {
    await review();
    const response = responseFor("run");
    await preview.getByRole("button", { name: "Run selected required checks", exact: true }).click();
    const http = await response;
    assert.equal(http.status(), 200, await http.text());
    const body = await http.json();
    assert.equal(body.status, "passed");
    assert.equal(body.candidateTreeVerified, false);
    assert.equal(body.repositoryChecksWaived, false);
    assert.equal(body.receipts.length, 1);
    assert.equal(body.receipts[0].checkIndex, 0);
    await panel.getByText(/Current evidence; expires/).waitFor();
    return body.receipts[0];
  };
  const freshness = async () => {
    const response = page.waitForResponse((http) => new URL(http.url()).pathname === endpoint && http.request().method() === "GET");
    await panel.getByRole("button", { name: "Check evidence freshness", exact: true }).click();
    const http = await response;
    assert.equal(http.status(), 200, await http.text());
    return http.json();
  };
  await panel.getByText("Required commit-stage checks", { exact: true }).waitFor();
  assert.match(await panel.getByLabel("Commit prerequisites").innerText(), /working-workspace[\s\S]*NOT the selected commit tree[\s\S]*candidateTreeVerified: false[\s\S]*repositoryChecksWaived: false/);
  await panel.getByText(/Missing or stale evidence/).waitFor();
  assert.equal(await panel.getByRole("button", { name: "Preview", exact: true }).isDisabled(), true);
  const head = git("rev-parse", "HEAD");
  const commitInput = { sessionId, operation: "preview", mode: "staged", paths: ["draft.txt"],
    message: await panel.getByLabel("Commit message", { exact: true }).inputValue(), receiptIds: [] };
  const refused = await page.request.post(new URL("/api/git/commit", page.url()).href, { data: commitInput });
  assert.equal(refused.status(), 409, "Real route cannot bypass required checks even if the disabled form is bypassed");
  assert.match((await refused.json()).error, /working-workspace verification|missing-receipts/);
  assert.equal(git("rev-parse", "HEAD"), head);
  await review();
  const declined = responseFor("decline");
  await preview.getByRole("button", { name: "Decline check run", exact: true }).click();
  assert.equal((await declined).status(), 200);
  await preview.waitFor({ state: "detached" });
  assert.equal(await panel.getByRole("button", { name: "Preview", exact: true }).isDisabled(), true);
  assert.equal(git("rev-parse", "HEAD"), head);
  if (!checkContainmentSupported) {
    console.log("PASS: real required-check requirements, exact process preview and decline; live execution awaits supported containment");
    return [];
  }
  const receipt = await run();
  assert.equal(git("rev-parse", "HEAD"), head, "Approving checks does not approve a commit");
  assert.equal(await candidate.count(), 0);
  assert.equal(await panel.getByRole("button", { name: "Preview", exact: true }).isEnabled(), true);
  const captured = page.waitForResponse((http) => new URL(http.url()).pathname === "/api/git/commit"
    && http.request().method() === "POST" && http.request().postDataJSON()?.operation === "preview");
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
  const capturedHttp = await captured;
  assert.equal(capturedHttp.status(), 200, await capturedHttp.text());
  const exact = await capturedHttp.json();
  assert.deepEqual(exact.verification.receiptIds, [receipt.id]);
  assert.equal(exact.verification.candidateTreeVerified, false);
  await candidate.waitFor();
  assert.equal(await candidate.getByRole("checkbox").count(), 0);
  assert.equal(await candidate.getByRole("button", { name: "Confirm commit", exact: true }).isEnabled(), true);
  assert.equal(git("rev-parse", "HEAD"), head, "Neither check-run consent nor candidate preview is final approval");
  // Advance only the ephemeral page clock past an ACTUAL receipt's deadline.
  // Server/native expiry is covered by native tests; no fabricated passing evidence.
  await page.clock.setFixedTime(new Date(receipt.expiresAt + 1));
  try {
    await panel.getByText(/Missing or stale evidence/).waitFor();
    assert.equal(await panel.getByRole("button", { name: "Preview", exact: true }).isDisabled(), true);
    assert.equal(await candidate.count(), 0, "Expired evidence removes the pending final-commit control");
  } finally {
    // Restore advancing browser time; a fixed "now" makes later genuine
    // server receipts appear to have finished in the future.
    await page.clock.setSystemTime(new Date());
  }
  assert.equal((await freshness()).receipts[0].id, receipt.id, "Server still owns the authentic unexpired receipt");
  assert.equal(await candidate.count(), 0, "Refreshing evidence never resurrects an expired candidate approval");
  changeSource();
  try {
    // Replay only the ACTUAL server-derived preview/IDs after changing source
    // bytes. The native route must refuse before mutation, not trust UI gating.
    const stale = await page.request.post(new URL("/api/git/commit", page.url()).href, { data: {
      operation: "confirm", sessionId, actionId: exact.actionId, preview: exact.preview,
      message: commitInput.message, receiptIds: exact.verification.receiptIds,
    } });
    assert.equal(stale.status(), 409, "Authentic candidate plus stale workspace evidence is not approval to mutate");
    assert.equal(git("rev-parse", "HEAD"), head);
    assert.deepEqual((await freshness()).receipts, [], "Changed working bytes invalidate real source evidence");
    await panel.getByText(/Missing or stale evidence/).waitFor();
    assert.equal(await panel.getByRole("button", { name: "Preview", exact: true }).isDisabled(), true);
  } finally { restoreSource(); }
  const status = page.waitForResponse((http) => new URL(http.url()).pathname === "/api/git/status" && http.request().method() === "GET");
  await panel.getByRole("button", { name: "Refresh changed files", exact: true }).click();
  assert.equal((await status).status(), 200);
  assert.equal(await candidate.count(), 0);
  assert.equal(await panel.locator("form").getByRole("checkbox", { checked: true }).count(), 0);
  const row = panel.getByText(/^draft\.txt\s+\(/).locator("xpath=ancestor::li[1]");
  await row.getByRole("checkbox").check();
  const fresh = await run();
  assert.notEqual(fresh.id, receipt.id, "Refresh needs a new real check run, not old source evidence");
  assert.equal(git("rev-parse", "HEAD"), head);
  console.log("PASS: real working-workspace check execution is independent of commit approval; client expiry and source refresh invalidate evidence");
  return [fresh.id];
}
