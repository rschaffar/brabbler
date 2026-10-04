import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { checkGitTaskBinding } from "./git-task-binding.mjs";
import { checkRecipeControls, reviewCommitChecks, runRequiredIntegrationChecks, checkRetiredRecovery, rejectMovedIntegrationTarget } from "./git-policy-operations.mjs";

/** Real scoped settings, local Git objects and a persisted chat; no model or mocked settings endpoint. */
export async function checkGitWorkflow(page, { base, api, artifacts, sessionId, cwd, targetWorktree, otherProject, checkContainmentSupported }) {
  const gitAt = (path, ...args) => execFileSync("git", ["-C", path, ...args], { encoding: "utf8" }).trim();
  const git = (...args) => gitAt(cwd, ...args);
  const settingsPath = "/api/git/workflow/settings";
  const readSettings = (target = { sessionId }) => api(`${settingsPath}?${new URLSearchParams(target)}`);
  const workflow = page.locator("#workflow-panel");
  const trigger = page.getByRole("button", { name: "Workflow", exact: true });
  const scopes = workflow.getByRole("group", { name: "Edit scope" });
  const task = workflow.getByRole("region", { name: "Current task", exact: true });
  const saveLabels = { global: "Save global defaults", project: "Save project defaults", session: "Save session settings" };
  const creations = [];
  const mutations = [];
  const observeRequest = (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/agent/new") creations.push(request.method());
    if (request.method() !== "GET" && ["/api/git/commit", "/api/git/integration", "/api/git/verification", "/api/git/cleanup", "/api/git/preparation", "/api/git/workspace", "/api/worktrees", `/api/sessions/${sessionId}/move`].includes(path)) {
      mutations.push({ path, body: request.postDataJSON() });
    }
  };
  page.on("request", observeRequest);
  let navigations = 0;
  const observeLoad = () => { navigations++; };
  const originalViewport = page.viewportSize();
  const control = (field) => workflow.locator(`#workflow-${field}`);
  const field = (name) => control(name).locator("..");
  const origin = async (name, expected) => assert.equal(
    await field(name).locator(":scope > label > small").innerText(), expected, `${name} origin`);
  const chooseScope = async (scope) => {
    const button = scopes.getByRole("button", { name: new RegExp(`^${scope[0].toUpperCase()}${scope.slice(1)}`) });
    await button.click();
    assert.equal(await button.getAttribute("aria-pressed"), "true");
  };
  const expand = async (stage) => {
    const button = workflow.locator(`[aria-controls="workflow-stage-${stage}"]`);
    if (await button.getAttribute("aria-expanded") !== "true") await button.click();
    await workflow.locator(`#workflow-stage-${stage}`).waitFor({ state: "visible" });
  };
  async function openWorkflow() {
    if (await trigger.getAttribute("aria-expanded") !== "true") {
      const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === settingsPath && response.request().method() === "GET");
      await trigger.click();
      assert.equal((await loaded).status(), 200, "Workflow reads real settings");
    }
    await workflow.waitFor({ state: "visible" });
    // Policy buttons are intentionally disabled while a chat runs; the
    // Close control remains available when the panel has mounted.
    await workflow.getByRole("button", { name: "Close Workflow", exact: true }).waitFor({ state: "visible" });
  }
  async function closeWorkflow() {
    await workflow.getByRole("button", { name: "Close Workflow", exact: true }).click();
    await workflow.waitFor({ state: "hidden" });
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  }
  async function home() {
    await openWorkflow();
    const back = workflow.getByRole("button", { name: "← Back to workflow", exact: true });
    if (await back.isVisible()) await back.click();
    await scopes.waitFor({ state: "visible" });
    const legacy = workflow.locator("details.workflow-legacy");
    if (!await legacy.evaluate((element) => element.open)) await legacy.locator(":scope > summary").click();
  }
  async function writeSettings(scope, button) {
    const saved = page.waitForResponse((response) => new URL(response.url()).pathname === settingsPath
      && response.request().method() === "PUT" && response.request().postDataJSON().scope === scope);
    await button.click();
    const response = await saved;
    const body = await response.json();
    assert.equal(response.status(), 200, `Save ${scope}: ${JSON.stringify(body)}`);
    assert.equal(typeof response.request().postDataJSON().revision, "string");
    return body;
  }
  async function save(scope) {
    const button = workflow.getByRole("button", { name: saveLabels[scope], exact: true });
    const result = await writeSettings(scope, button);
    await button.waitFor({ state: "detached" });
    return result;
  }
  async function apply() {
    const details = task.locator("details").first();
    if (!await details.evaluate((element) => element.open)) await details.locator("summary").click();
    return writeSettings("task", task.getByRole("button", { name: "Apply saved settings to this task", exact: true }));
  }
  async function chooseLegacyContinuation(value) {
    await expand("workspace");
    const legacy = workflow.locator("#workflow-stage-workspace details").filter({ hasText: "Legacy chat continuation" });
    if (!await legacy.evaluate((element) => element.open)) await legacy.locator(":scope > summary").click();
    await control("onCreate").selectOption(value);
  }
  async function addCheck(label) {
    await expand("checks");
    await workflow.getByRole("button", { name: "Add check", exact: true }).click();
    const recipe = workflow.locator(".workflow-recipe").last();
    await recipe.locator("summary").click();
    await recipe.getByLabel("Label", { exact: true }).fill(label);
    await recipe.getByLabel("Executable", { exact: true }).fill(process.execPath);
    await recipe.getByLabel("Arguments · one literal argument per line", { exact: true }).fill("-e\nprocess.exit(0)");
  }
  async function openDetail(action, regionName) {
    await home();
    await task.getByRole("button", { name: action, exact: true }).click();
    const region = workflow.getByRole("region", { name: regionName, exact: true });
    await region.waitFor({ state: "visible" });
    return region;
  }
  async function contained(label) {
    const width = page.viewportSize().width;
    // The bordered container owns the resizer width; its inner region is one pixel narrower.
    const bounds = await workflow.locator("..").boundingBox();
    assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `${label}: Workflow inside viewport`);
    assert.ok(width === 390 ? bounds.width >= 388 : bounds.width >= 480 && bounds.width <= 520,
      `${label}: expected full mobile width or ~500px desktop panel, got ${bounds.width}`);
    const overflow = await workflow.evaluate((element) => {
      const candidates = [element, ...element.querySelectorAll(".workflow-home-scroll, .workflow-detail-host, .workflow-stage-editor, .workflow-footer")];
      return candidates.filter((node) => node.getClientRects().length && node.scrollWidth > node.clientWidth + 1)
        .map((node) => ({ className: node.className, client: node.clientWidth, scroll: node.scrollWidth }));
    });
    assert.deepEqual(overflow, [], `${label}: no clipped horizontal content`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no page overflow`);
  }
  const screenshot = async (name) => { if (artifacts) await page.screenshot({ path: join(artifacts, name) }); };

  try {
    // Only this runner's throwaway browser context; no persistent browser profile is touched.
    await page.addInitScript(() => localStorage.setItem("pi-sound-enabled", "false"));
    await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "load" });
    page.on("load", observeLoad);
    await page.getByText("Ready to review Git workflow", { exact: true }).waitFor();
    assert.equal(await trigger.count(), 1, "One Workflow entry point");
    const bounds = await trigger.boundingBox();
    assert.ok(bounds && bounds.y < 80, "Workflow belongs beside Activity, not near the composer");
    for (const name of ["Workspace workflow", "Review & commit", "Local integration review"]) {
      assert.equal(await page.getByRole("button", { name, exact: true }).count(), 0, `${name} is no longer a toolbar button`);
    }
    // Explicit project settings work from the same chat, without opening legacy
    // task/source controls, moving it, or creating another agent/session.
    await openWorkflow();
    assert.equal(await workflow.locator("details.workflow-legacy").evaluate((element) => element.open), false);
    const beforeScopes = [git("rev-parse", "HEAD"), gitAt(otherProject, "rev-parse", "HEAD")];
    const selectProject = async (projectPath) => {
      await workflow.getByLabel("Configuration project", { exact: true }).fill(projectPath);
      const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === settingsPath
        && response.request().method() === "GET" && new URL(response.url()).searchParams.get("projectPath") === projectPath);
      await workflow.getByRole("button", { name: "Use project", exact: true }).click();
      const response = await loaded;
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    };
    await selectProject(otherProject);
    await chooseScope("project"); await expand("integration");
    await control("targetBranch").fill("other-main");
    assert.equal((await save("project")).projectRoot, otherProject);
    const authorization = workflow.getByRole("region", { name: "Saved action authorization" });
    await authorization.locator("#workflow-auth-commit").selectOption("allow");
    const allowSave = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/authorizations"
      && response.request().method() === "PUT" && response.request().postDataJSON().scope === "project");
    await authorization.getByRole("button", { name: /Save Selected commits allow for project/ }).click();
    const allowResponse = await allowSave;
    assert.equal(allowResponse.status(), 200, allowResponse.status() === 200 ? "" : await allowResponse.text());
    const allowResult = await allowResponse.json();
    assert.equal(allowResult.actions.commit.effective, "allow");
    assert.equal(allowResult.approvalToken, false, "saved authorization is not a candidate approval token");
    await chooseScope("session");
    assert.equal(await control("targetBranch").isDisabled(), true, "project-specific branches stay in Project");
    await control("delivery").selectOption("leave");
    const bSaved = await save("session");
    assert.equal(bSaved.sessionScope, "project");
    assert.deepEqual(bSaved.session, { delivery: "leave" });
    await authorization.locator("#workflow-auth-commit").selectOption("deny");
    const denySave = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/authorizations"
      && response.request().method() === "PUT" && response.request().postDataJSON().scope === "session");
    await authorization.getByRole("button", { name: /Save Selected commits deny for this chat/ }).click();
    const denyResponse = await denySave;
    assert.equal(denyResponse.status(), 200, denyResponse.status() === 200 ? "" : await denyResponse.text());
    assert.equal((await denyResponse.json()).actions.commit.effective, "deny", "chat restriction overrides a Project Allow");
    await authorization.locator("#workflow-auth-commit").selectOption("inherit");
    const resetSave = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/authorizations"
      && response.request().method() === "PUT" && response.request().postDataJSON().decision === "inherit");
    await authorization.getByRole("button", { name: /Save Selected commits inherit for this chat/ }).click();
    const resetResponse = await resetSave;
    assert.equal(resetResponse.status(), 200, resetResponse.status() === 200 ? "" : await resetResponse.text());
    assert.equal((await resetResponse.json()).actions.commit.effective, "allow");
    assert.equal(await workflow.getByRole("button", { name: "Apply saved settings to this task", exact: true }).count(), 0);
    await selectProject(cwd); await expand("integration");
    assert.equal(await control("targetBranch").inputValue(), "");
    await control("delivery").selectOption("pr");
    await selectProject(otherProject); await expand("integration");
    assert.equal(await control("delivery").inputValue(), "leave");
    await control("delivery").selectOption("local");
    await selectProject(cwd); await expand("integration");
    assert.equal(await control("delivery").inputValue(), "pr");
    await save("session");
    await closeWorkflow(); await openWorkflow();
    await selectProject(otherProject); await expand("integration");
    assert.equal(await control("delivery").inputValue(), "local", "A save/close must not erase B's draft");
    await workflow.getByRole("button", { name: "Discard", exact: true }).click();
    assert.equal(await control("delivery").inputValue(), "leave");
    await field("delivery").getByRole("button", { name: "Use Project value", exact: true }).click();
    assert.equal((await save("session")).resolved.session.values.targetBranch, "other-main");
    await selectProject(cwd); await expand("integration");
    assert.equal(await control("delivery").inputValue(), "pr");
    await field("delivery").getByRole("button", { name: "Use Project value", exact: true }).click();
    await save("session");
    assert.equal(await control("managedGitToolsOnly").getAttribute("aria-checked"), "true");
    await selectProject(otherProject); await chooseScope("project");
    await control("managedGitToolsOnly").click();
    assert.equal(await control("managedGitToolsOnly").getAttribute("aria-checked"), "false");
    assert.equal(await workflow.getByRole("button", { name: "Save project defaults", exact: true }).isEnabled(), true, "project guidance override has an enabled Save");
    assert.equal((await save("project")).project.managedGitToolsOnly, false);
    await chooseScope("session");
    assert.equal(await control("managedGitToolsOnly").getAttribute("aria-checked"), "false");
    await control("managedGitToolsOnly").click();
    assert.equal((await save("session")).session.managedGitToolsOnly, true);
    await selectProject(cwd); await chooseScope("global");
    await control("managedGitToolsOnly").click();
    assert.equal((await save("global")).global.managedGitToolsOnly, false);
    await chooseScope("session");
    assert.equal(await control("managedGitToolsOnly").getAttribute("aria-checked"), "false", "A inherits Global, not B's chat override");
    await chooseScope("global");
    await field("managedGitToolsOnly").getByRole("button", { name: "Restore built-in default", exact: true }).click();
    assert.equal((await save("global")).resolved.global.values.managedGitToolsOnly, true);
    await chooseScope("session");
    const legacyLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === settingsPath
      && response.request().method() === "GET" && new URL(response.url()).searchParams.get("sessionId") === sessionId
      && !new URL(response.url()).searchParams.has("projectPath"));
    await workflow.getByRole("button", { name: "Back to chat defaults", exact: true }).click();
    assert.equal((await legacyLoaded).status(), 200);
    assert.equal((await readSettings()).cwd, cwd);
    assert.deepEqual([git("rev-parse", "HEAD"), gitAt(otherProject, "rev-parse", "HEAD")], beforeScopes);
    assert.deepEqual(creations, []);
    assert.deepEqual(mutations, []);
    assert.equal(await workflow.locator("details.workflow-legacy").evaluate((element) => element.open), false);
    await closeWorkflow();
    console.log("PASS: one unchanged chat edits project B and A, preserves Chat×Project drafts, saves/resets independently, and starts no Git action or adoption");

    const initial = await readSettings();
    const sessionIds = (await api("/api/sessions?force=1")).sessions.map((session) => session.id).sort();
    const featureBeforeSettings = git("rev-parse", "HEAD");
    const targetBeforeSettings = gitAt(targetWorktree, "rev-parse", "HEAD");

    // A new composer is not an initialized agent. Global and Project are independent configuration destinations.
    const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await showSidebar.isVisible()) await showSidebar.click();
    await page.getByRole("button", { name: "New", exact: true }).click();
    await home();
    await task.getByText("No active task", { exact: true }).waitFor();
    assert.equal(await scopes.getByRole("button", { name: /^Session/ }).isDisabled(), true);
    const projectPicker = workflow.getByLabel("Configuration project", { exact: true });
    if (await projectPicker.inputValue() !== cwd) {
      await projectPicker.fill(cwd);
      const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === settingsPath
        && [new URL(response.url()).searchParams.get("cwd"), new URL(response.url()).searchParams.get("projectPath")].includes(cwd));
      await workflow.getByRole("button", { name: "Use project", exact: true }).click();
      assert.equal((await loaded).status(), 200);
    }
    await chooseScope("global");
    await origin("enabled", "Built-in default");
    await control("enabled").click();
    await expand("commits");
    await control("commits").selectOption("manual");
    await expand("checks");
    assert.equal(await workflow.getByRole("button", { name: "Add check", exact: true }).isDisabled(), true);
    await control("checkConfirmation").selectOption("none");
    const globalSaved = await save("global");
    assert.equal(globalSaved.global.enabled, false, "Off is a persisted false, not inheritance");
    assert.equal(globalSaved.resolved.global.origins.enabled, "global");
    assert.equal(globalSaved.global.checkConfirmation, "none");
    assert.equal(Object.hasOwn(globalSaved.global, "checks"), false, "recipes are project-specific");
    await origin("enabled", "Set here");
    await closeWorkflow();
    await home();
    assert.equal(await control("enabled").getAttribute("aria-checked"), "false", "Disabled workflow settings remain reachable");

    await chooseScope("project");
    await origin("enabled", "From Global");
    await control("enabled").click();
    await expand("workspace");
    await control("branch").fill("feature");
    await expand("integration");
    await control("targetBranch").fill("target");
    await expand("commits");
    assert.equal(await control("commits").inputValue(), "inherit");
    await origin("commits", "From Global");
    await control("commits").selectOption("off");
    await expand("checks");
    await addCheck("Project fixture check");
    const projectRecipe = await save("project");
    assert.deepEqual(projectRecipe.project.checks, [{ label: "Project fixture check", argv: [process.execPath, "-e", "process.exit(0)"] }]);
    await checkRecipeControls(page, { workflow, cwd, otherProject, chooseScope, expand, selectProject, save, closeWorkflow, home, readSettings });
    // Saving cleanup preferences never invokes the separately authorized deletion operation.
    await expand("cleanup");
    assert.equal(await control("cleanup").inputValue(), "inherit");
    assert.match(await workflow.locator("#workflow-stage-cleanup").innerText(), /Saving settings grants no cleanup permission and removes nothing[\s\S]*Never automatic or scheduled[\s\S]*Selected public cleanup is supported on eligible Linux paths[\s\S]*Unknown usage or native evidence fails closed/);
    await control("cleanup").selectOption("worktree-and-branch");
    await control("cleanupConfirmation").selectOption("none");
    const cleanupEligible = await save("project");
    assert.equal(cleanupEligible.project.cleanup, "worktree-and-branch");
    assert.equal(cleanupEligible.project.cleanupConfirmation, "none");
    assert.deepEqual(cleanupEligible.task, projectRecipe.task);
    await control("cleanup").selectOption("retain");
    const retained = await save("project");
    assert.equal(retained.project.cleanup, "retain", "Retain is saved explicitly, not treated as inheritance");
    assert.match(await workflow.locator('[aria-controls="workflow-stage-cleanup"]').innerText(), /Retain.*cleanup blocked/s);
    assert.equal(await workflow.getByRole("button", { name: /^(Delete|Remove worktree|Clean up|Confirm cleanup)/ }).count(), 0);
    await field("cleanup").getByRole("button", { name: "Use Global value", exact: true }).click();
    await field("cleanupConfirmation").getByRole("button", { name: "Use Global value", exact: true }).click();
    const cleanupReset = await save("project");
    assert.equal(Object.hasOwn(cleanupReset.project, "cleanup"), false);
    assert.equal(Object.hasOwn(cleanupReset.project, "cleanupConfirmation"), false);
    assert.deepEqual(mutations, [], "Recipe/cleanup saves are preference-only, with no check or deletion dispatch");
    await expand("checks");
    await workflow.getByRole("button", { name: "No checks at this scope", exact: true }).click();
    const projectSaved = await save("project");
    assert.equal(projectSaved.projectRoot, cwd);
    assert.deepEqual(projectSaved.project, { enabled: true, branch: "feature", commits: "off", checks: [], targetBranch: "target" });
    assert.equal(projectSaved.resolved.project.origins.checks, "project");
    assert.deepEqual((await readSettings({ cwd })).project, projectSaved.project, "Project values are server-persisted");
    await origin("checks", "Set here");

    // Reset removes just the override: [] and Off must not have been mistaken for absence on save.
    await field("checks").getByRole("button", { name: "Use Global value", exact: true }).click();
    await origin("checks", "Built-in default");
    assert.equal(await workflow.locator(".workflow-recipe summary").count(), 0);
    await expand("commits");
    await field("commits").getByRole("button", { name: "Use Global value", exact: true }).click();
    await origin("commits", "From Global");
    const projectReset = await save("project");
    assert.equal(Object.hasOwn(projectReset.project, "checks"), false);
    assert.equal(Object.hasOwn(projectReset.project, "commits"), false);
    assert.deepEqual(projectReset.resolved.project.values.checks, []);
    assert.equal(projectReset.resolved.project.values.commits, "manual");
    await chooseScope("global");
    await field("enabled").getByRole("button", { name: "Restore built-in default", exact: true }).click();
    const globalReset = await save("global");
    assert.equal(Object.hasOwn(globalReset.global, "enabled"), false);
    assert.equal(globalReset.resolved.global.values.enabled, true);
    await origin("enabled", "Built-in default");

    // A child resolves SAVED parents only. Closing, switching scope and discarding one draft must not erase another.
    await expand("workspace");
    assert.equal(await control("branch").isDisabled(), true, "Global cannot define a named project branch");
    await control("workspace").selectOption("worktree");
    await chooseScope("project");
    assert.equal(await control("branch").inputValue(), "feature");
    await origin("workspace", "Built-in default");
    await control("branch").fill("project-unsaved");
    await closeWorkflow();
    await home();
    assert.equal(await control("branch").inputValue(), "project-unsaved", "Project draft survives close/reopen");
    await chooseScope("global");
    assert.equal(await control("workspace").inputValue(), "worktree", "Global draft survives scope changes");
    const beforeDiscard = await readSettings({ cwd });
    assert.equal(Object.hasOwn(beforeDiscard.global, "workspace"), false);
    assert.equal(beforeDiscard.project.branch, "feature");
    await workflow.getByRole("button", { name: "Discard", exact: true }).click();
    await chooseScope("project");
    assert.equal(await control("branch").inputValue(), "project-unsaved", "Discard affects only the selected scope");
    await workflow.getByRole("button", { name: "Discard", exact: true }).click();
    assert.equal(await control("branch").inputValue(), "feature");
    assert.deepEqual((await readSettings()).task, initial.task, "Editing defaults does not silently adopt an existing task");
    assert.equal(navigations, 0, "No-chat settings and drafts must not reload the document");
    assert.deepEqual(creations, [], "No-chat editing must not call /api/agent/new");
    assert.deepEqual((await api("/api/sessions?force=1")).sessions.map((session) => session.id).sort(), sessionIds);
    console.log("PASS: no-chat real Global/Project saves, Off/[] overrides, origins, resets and isolated persistent drafts");

    await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "load" });
    navigations = 0;
    await page.getByText("Ready to review Git workflow", { exact: true }).waitFor();
    await home();
    await chooseScope("session");
    await origin("enabled", "From Project");
    await expand("workspace");
    assert.equal(await control("branch").inputValue(), "feature");
    await origin("branch", "From Project");
    await expand("commits");
    await origin("commits", "From Global");
    await control("commits").selectOption("off");
    await expand("checks");
    assert.equal(await workflow.getByRole("button", { name: "No checks at this scope", exact: true }).isDisabled(), true);
    await control("checkConfirmation").selectOption("ask");
    const sessionSaved = await save("session");
    assert.deepEqual(sessionSaved.session, { commits: "off", checkConfirmation: "ask" });
    assert.deepEqual(sessionSaved.task, initial.task, "Session save alone must not adopt or rewrite this task");
    await origin("checkConfirmation", "Set here");
    await field("checkConfirmation").getByRole("button", { name: "Use Project value", exact: true }).click();
    await origin("checkConfirmation", "From Global");
    await expand("commits");
    await field("commits").getByRole("button", { name: "Use Project value", exact: true }).click();
    await origin("commits", "From Global");
    const sessionReset = await save("session");
    assert.deepEqual(sessionReset.session, {});
    const adopted = await apply();
    assert.equal(adopted.task.kind, "managed");
    assert.equal(adopted.task.settings.targetBranch, "target");
    assert.equal(adopted.task.settings.branch, "feature");
    assert.equal(adopted.task.settings.commits, "manual");
    assert.deepEqual(adopted.task.settings.checks, []);
    const permissions = task.locator('details[aria-label="Current task permissions"]');
    await permissions.locator("summary").click();
    const commitPermissions = permissions.locator(".workflow-comparison > div").filter({ has: page.locator("dt", { hasText: /^Commits$/ }) });
    assert.ok((await commitPermissions.innerText()).includes(adopted.permissions.agent.commit.reason));
    assert.ok((await commitPermissions.innerText()).includes(adopted.permissions.human.commit.reason));
    assert.equal(adopted.permissions.human.commit.kind, "confirmation-required");
    const permissionText = await commitPermissions.innerText();
    await expand("commits");
    assert.equal(await control("commits").locator('option[value="automatic"]').isDisabled(), true);
    assert.match(await workflow.locator("#workflow-stage-commits").innerText(), /scoped authorization and operation-level recovery admission/);
    await workflow.getByRole("button", { name: "Draft new agent commits: Ask + no-confirm preference" }).click();
    assert.equal(await control("commits").inputValue(), "ask");
    assert.equal(await control("commitConfirmation").inputValue(), "none");
    assert.equal((await readSettings()).task.settings.commits, "manual", "The new draft cannot silently adopt or authorize the current task");
    assert.equal(await commitPermissions.innerText(), permissionText, "Unsaved preferences never change task permission facts");
    await workflow.getByRole("button", { name: "Discard", exact: true }).click();
    await permissions.locator("summary").click();

    // Every defaults scope can change without changing the captured task. Explicit Apply ignores unsaved drafts.
    await chooseScope("global");
    await chooseLegacyContinuation("stay");
    assert.deepEqual((await save("global")).task, adopted.task);
    await chooseScope("project");
    await chooseLegacyContinuation("fork");
    assert.deepEqual((await save("project")).task, adopted.task);
    await chooseScope("session");
    await chooseLegacyContinuation("stay");
    const laterTasks = await save("session");
    assert.deepEqual(laterTasks.task, adopted.task);
    assert.equal(laterTasks.resolved.session.values.onCreate, "stay");
    await task.getByText("Task details · Defaults differ — compare", { exact: true }).waitFor();
    await chooseLegacyContinuation("continue");
    await chooseScope("global");
    assert.equal(await control("onCreate").inputValue(), "stay", "A child override/draft must not appear in Global");
    await chooseScope("project");
    assert.equal(await control("onCreate").inputValue(), "fork", "A child override/draft must not appear in Project");
    await chooseScope("session");
    await closeWorkflow();
    await home();
    assert.equal(await control("onCreate").inputValue(), "continue", "Session draft survives close/reopen");
    const applied = await apply();
    assert.equal(applied.task.settings.onCreate, "stay", "Apply takes saved settings, not the visible draft");
    assert.equal(await control("onCreate").inputValue(), "continue", "Apply must not discard the draft");
    await workflow.getByRole("button", { name: "Discard", exact: true }).click();
    assert.deepEqual((await readSettings()).task, applied.task);
    console.log("PASS: Session origins/reset, task pinning across all default saves, explicit saved-only Apply");

    const paused = await writeSettings("pause", workflow.getByRole("button", { name: "Pause all", exact: true }));
    assert.equal(paused.permissions.human.commit.code, "paused");
    await workflow.getByText("All managed Git actions are paused, at every scope.", { exact: true }).waitFor();
    await closeWorkflow();
    await home();
    for (const scope of ["global", "project", "session"]) {
      await chooseScope(scope);
      assert.equal(await control("enabled").isEnabled(), true, `${scope} settings remain editable while paused`);
    }
    await control("enabled").click();
    const disabled = await save("session");
    assert.equal(disabled.paused, true);
    assert.equal(disabled.session.enabled, false);
    assert.deepEqual(disabled.task, applied.task, "Enablement is a live gate, not an implicit task rewrite");
    const resumed = await writeSettings("pause", workflow.getByRole("button", { name: "Resume all", exact: true }));
    assert.equal(resumed.paused, false);
    assert.equal(resumed.resolved.session.values.enabled, false, "Resuming does not silently enable an Off scope");
    await closeWorkflow();
    await home();
    assert.equal(await control("enabled").getAttribute("aria-checked"), "false");
    await expand("integration");
    assert.equal(await control("integrateConfirmation").isEnabled(), true, "Off does not lock the configuration editor");
    await field("enabled").getByRole("button", { name: "Use Project value", exact: true }).click();
    const enabled = await save("session");
    assert.equal(Object.hasOwn(enabled.session, "enabled"), false);
    assert.equal(enabled.resolved.session.values.enabled, true);
    assert.deepEqual(enabled.task, applied.task);
    assert.deepEqual(mutations, [], "Saving, applying and pausing settings must never run a Git action");
    assert.equal(git("rev-parse", "HEAD"), featureBeforeSettings);
    assert.equal(gitAt(targetWorktree, "rev-parse", "HEAD"), targetBeforeSettings);
    assert.equal(navigations, 0, "Session settings update without a browser reload");
    console.log("PASS: paused and disabled workflows retain accessible, editable settings without starting Git actions");

    const checkoutBeforeTaskReview = git("status", "--porcelain");
    await checkGitTaskBinding(page, { cwd, task, home, contained, screenshot });
    assert.equal(git("status", "--porcelain"), checkoutBeforeTaskReview);
    assert.equal(git("rev-parse", "HEAD"), featureBeforeSettings);
    assert.equal(gitAt(targetWorktree, "rev-parse", "HEAD"), targetBeforeSettings);
    assert.deepEqual(mutations, [], "Task/source metadata must not execute Git actions");

    const review = await openDetail("Integration review", "Local integration review");
    await review.getByText("Feature branch", { exact: true }).waitFor();
    assert.match(await review.innerText(), /feature[\s\S]*Target branch[\s\S]*target/);
    const commits = review.getByRole("button", { name: /^Commit \d+:/ });
    await commits.nth(1).waitFor();
    assert.equal(await commits.count(), 2);
    const patch = review.locator('[aria-label="Read-only patch"]');
    const patchResponse = () => page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/review" && response.request().method() === "POST");
    const wholeResponse = patchResponse();
    await review.getByRole("button", { name: "Show read-only patch" }).click();
    const wholeHttp = await wholeResponse;
    assert.equal(wholeHttp.status(), 200);
    assert.deepEqual(wholeHttp.request().postDataJSON().selection, { kind: "merge" });
    const whole = await wholeHttp.json();
    assert.ok(whole.diff?.patch?.includes("First feature patch"), JSON.stringify(whole));
    await patch.locator("pre").waitFor();
    assert.match(await patch.locator("pre").innerText(), /First feature patch/);
    assert.match(await patch.locator("pre").innerText(), /Second feature patch/);
    await commits.first().click();
    const singleResponse = patchResponse();
    await review.getByRole("button", { name: "Show read-only patch" }).click();
    const singleHttp = await singleResponse;
    assert.equal(singleHttp.status(), 200);
    const firstOid = (await commits.first().innerText()).match(/Commit 1: ([a-f0-9]+)/)?.[1];
    assert.deepEqual(singleHttp.request().postDataJSON().selection, { kind: "commits", commitOids: [firstOid] });
    const single = await singleHttp.json();
    assert.notEqual(single.diff.toTreeOid, whole.diff.toTreeOid);
    await patch.locator("pre").filter({ hasText: "First feature patch" }).waitFor();
    assert.equal((await patch.innerText()).includes("Second feature patch"), false, "Single commit must not include the next commit");
    await review.getByRole("combobox").nth(1).selectOption("1");
    const rangeResponse = patchResponse();
    await review.getByRole("button", { name: "Show read-only patch" }).click();
    const rangeHttp = await rangeResponse;
    assert.equal(rangeHttp.status(), 200);
    const secondOid = (await commits.nth(1).innerText()).match(/Commit 2: ([a-f0-9]+)/)?.[1];
    assert.deepEqual(rangeHttp.request().postDataJSON().selection, { kind: "commits", commitOids: [firstOid, secondOid] });
    const range = await rangeHttp.json();
    assert.equal(range.diff.toTreeOid, whole.diff.toTreeOid);
    await patch.locator("pre").filter({ hasText: "Second feature patch" }).waitFor();
    assert.match(await patch.innerText(), /First feature patch/, "Consecutive range contains both commits");
    console.log("PASS: current-task detail opens whole/single/range read-only merge review");

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await home();
      assert.equal(await workflow.getAttribute("role"), width === 390 ? "dialog" : "region");
      if (width === 390) assert.equal(await workflow.getAttribute("aria-modal"), "true");
      const taskDetails = task.locator("details").first();
      if (await taskDetails.evaluate((element) => element.open)) await taskDetails.locator("summary").click();
      const expandedStage = workflow.locator(".workflow-stage-heading[aria-expanded=true]");
      if (await expandedStage.count()) await expandedStage.click();
      await workflow.locator(".workflow-home-scroll").evaluate((element) => { element.scrollTop = 0; });
      await contained(`${width}px overview`);
      await screenshot(`workflow-overview-${width}.png`);
      await permissions.locator("summary").focus();
      await page.keyboard.press("Enter");
      assert.equal(await permissions.evaluate((element) => element.open), true);
      await contained(`${width}px permission reasons`);
      assert.match(await permissions.innerText(), /do not approve an action or inspect Git state/);
      await screenshot(`workflow-permissions-${width}.png`);
      await permissions.locator("summary").click();
      for (const stage of ["workspace", "commits", "checks", "integration", "cleanup"]) {
        await expand(stage);
        await contained(`${width}px ${stage} settings`);
      }
      // Named branch drafts belong to Project and must fit the dirty footer.
      await chooseScope("project");
      await expand("workspace");
      await control("branch").fill("e2e-long-draft-branch-for-workflow-containment");
      await contained(`${width}px dirty footer`);
      await screenshot(`workflow-settings-${width}.png`);
      await closeWorkflow();
      const triggerBounds = await trigger.boundingBox();
      assert.ok(triggerBounds && triggerBounds.x >= 0 && triggerBounds.x + triggerBounds.width <= width && triggerBounds.y < 80,
        `${width}px Workflow button remains reachable`);
      await home();
      assert.equal(await control("branch").inputValue(), "e2e-long-draft-branch-for-workflow-containment");
      await workflow.getByRole("button", { name: "Discard", exact: true }).click();
      await chooseScope("session");
      for (const [action, regionName, content] of [
        ["Workspace details", "Continue session in another worktree", "Actual chat checkout"],
        ["Review & commit", "Review & commit panel", "Session checkout"],
        ["Integration review", "Local integration review", "Session checkout"],
      ]) {
        const region = await openDetail(action, regionName);
        await region.getByText(content, { exact: false }).first().waitFor();
        await contained(`${width}px ${action}`);
        await closeWorkflow();
        await openWorkflow();
        await region.waitFor({ state: "visible" });
      }
      await screenshot(`workflow-review-${width}.png`);
    }
    if (originalViewport) await page.setViewportSize(originalViewport);
    console.log("PASS: ~500px desktop and 390px Workflow settings, dirty footer and task-detail containment");

    // The disposable whole-file candidate also supplies a tracked file with
    // distant lines for the staged partial-hunk scenario below.
    assert.equal(git("rev-parse", "--show-toplevel"), cwd);
    assert.match(basename(dirname(cwd)), /^pi-web-e2e-/, "Only edit the disposable E2E fixture");
    const draftBaseline = ["Manual commit fixture", ...Array.from({ length: 20 }, (_, i) => `Unchanged context ${i + 1}`),
      "Unstaged hunk anchor"].join("\n") + "\n";
    writeFileSync(join(cwd, "draft.txt"), draftBaseline);
    const commitPanel = await openDetail("Review & commit", "Review & commit panel");
    await commitPanel.getByText(/^draft\.txt\s+\(/).waitFor();
    const source = commitPanel.getByLabel("Commit source");
    assert.equal(await source.inputValue(), "whole-file", "Whole working-tree files remain the default");
    await commitPanel.getByText("No verification recipes are defined (no-defined). This is not a waiver of project instructions.", { exact: true }).waitFor();
    for (const checkbox of await commitPanel.locator("form").getByRole("checkbox").all()) await checkbox.check();
    await commitPanel.getByLabel("Commit message").fill("E2E manual commit");
    const before = git("rev-parse", "HEAD");
    const previewResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/commit"
      && response.request().postDataJSON()?.operation === "preview");
    await commitPanel.getByRole("button", { name: "Preview", exact: true }).click();
    const manualPreviewHttp = await previewResponse;
    assert.equal(manualPreviewHttp.status(), 200, manualPreviewHttp.status() === 200 ? "" : await manualPreviewHttp.text());
    const savedPreview = await manualPreviewHttp.json();
    assert.equal(manualPreviewHttp.request().postDataJSON().mode, "whole-file");
    assert.equal(savedPreview.preview.mode, "whole-file");
    assert.match(savedPreview.candidateDiff.patch, /Unstaged hunk anchor/, "Whole-file default includes the entire selected file");
    assert.equal(typeof savedPreview.actionId, "string");
    const pendingHistory = await api(`/api/git/actions/${savedPreview.actionId}?sessionId=${sessionId}`);
    assert.equal(pendingHistory.record.state, "awaiting-decision", "Live journal ownership is shared across Next route modules");
    assert.equal(pendingHistory.candidate, undefined, "Collapsed history does not transfer patch bytes");
    const candidate = commitPanel.locator('[aria-label="Commit preview"]');
    await candidate.getByText("Review exact commit candidate").waitFor();
    assert.equal(git("rev-parse", "HEAD"), before, "Preview must not commit");
    assert.match(await candidate.innerText(), /draft\.txt/);
    const confirmed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/commit"
      && response.request().postDataJSON()?.operation === "confirm");
    await candidate.getByRole("button", { name: "Confirm commit" }).click();
    const confirmResult = await confirmed;
    assert.equal(confirmResult.status(), 200, confirmResult.status() === 200 ? "" : await confirmResult.text());
    await commitPanel.getByText("Last commit created").waitFor();
    assert.notEqual(git("rev-parse", "HEAD"), before);
    assert.equal(git("show", "--format=", "--name-only", "HEAD"), "draft.txt\nsecond-draft.txt");
    assert.equal(execFileSync("git", ["-C", cwd, "show", "HEAD:draft.txt"], { encoding: "utf8" }), draftBaseline);
    assert.equal(git("show", "-s", "--format=%ae", "HEAD"), "e2e@example.invalid", "Commit uses the throwaway HOME identity");
    const manualCommit = git("rev-parse", "HEAD");
    await closeWorkflow();
    const commitCard = page.locator(`[data-git-action-id="${savedPreview.actionId}"]`);
    await commitCard.getByRole("heading", { name: /Commit.*Succeeded/ }).waitFor();
    assert.equal(await commitCard.count(), 1, "Manual metadata append appears without SSE or duplicate cards");
    assert.match(await commitCard.innerText(), new RegExp(manualCommit));
    assert.match(await commitCard.innerText(), /e2e@example\.invalid/);
    const sessionHistory = await api(`/api/sessions/${sessionId}?tail=100`);
    assert.doesNotMatch(JSON.stringify(sessionHistory.context), /Manual commit fixture|Second captured commit file/);
    const anchorIndex = sessionHistory.context.messages.findIndex((message) => message.customType === "pi-web:git-action" && message.details?.actionId === savedPreview.actionId);
    assert.ok(anchorIndex >= 0 && sessionHistory.context.entryIds[anchorIndex]);
    await commitCard.getByRole("button", { name: /^Captured candidate/ }).click();
    await commitCard.getByRole("region", { name: "Side-by-side diff" }).getByText("Manual commit fixture", { exact: true }).waitFor();
    await commitCard.locator("summary").filter({ hasText: /^second-draft\.txt$/ }).click();
    await commitCard.getByRole("region", { name: "Side-by-side diff" }).getByText("Second captured commit file", { exact: true }).waitFor();
    await page.reload({ waitUntil: "load" });
    await commitCard.getByRole("heading", { name: /Commit.*Succeeded/ }).waitFor();
    assert.equal(await commitCard.count(), 1);
    assert.equal(await commitCard.getByRole("button", { name: /^Confirm/ }).count(), 0, "History cannot approve an old commit");
    console.log("PASS: real manual commit coalesces into one durable card with actual identity, lazy multi-file diff and reload persistence");

    // Stage one of two distant edits on the same tracked file; keep an unrelated
    // staged entry to prove selection is from the index, not the whole index or
    // the visible working-tree diff. All writes are inside the throwaway fixture.
    assert.equal(git("status", "--porcelain"), "", "Start staged review from a clean fixture");
    const selectedDraft = draftBaseline.replace("Manual commit fixture", "Selected staged hunk");
    const workingDraft = selectedDraft.replace("Unstaged hunk anchor", "Unstaged worktree hunk");
    const unrelatedIndex = "Unrelated staged entry\n";
    writeFileSync(join(cwd, "draft.txt"), selectedDraft);
    git("add", "--", "draft.txt");
    writeFileSync(join(cwd, "draft.txt"), workingDraft);
    writeFileSync(join(cwd, "second-draft.txt"), unrelatedIndex);
    git("add", "--", "second-draft.txt");
    const stagedHunks = git("diff", "HEAD", "--", "draft.txt");
    assert.equal((stagedHunks.match(/^@@/gm) ?? []).length, 2, "Fixture must contain separate selected and unstaged hunks");
    const indexEntry = git("ls-files", "--stage", "--", "draft.txt");
    const stagedBlob = indexEntry.match(/^100644 ([a-f0-9]{40,64}) 0\tdraft\.txt$/)?.[1];
    assert.ok(stagedBlob, `Expected an ordinary staged blob: ${indexEntry}`);
    const originalEntries = git("ls-files", "--stage");
    const headBeforeStaged = git("rev-parse", "HEAD");
    const rawGit = (...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
    assert.equal(rawGit("show", ":draft.txt"), selectedDraft);
    assert.equal(rawGit("show", ":second-draft.txt"), unrelatedIndex);
    assert.equal(readFileSync(join(cwd, "draft.txt"), "utf8"), workingDraft);
    // Independently build HEAD + just the selected index blob in a separate
    // index outside the checkout (never alter the real index to predict a tree).
    const expectedIndex = join(dirname(cwd), "expected-staged-commit.index");
    const expectedGit = (...args) => execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8", env: { ...process.env, GIT_INDEX_FILE: expectedIndex },
    }).trim();
    expectedGit("read-tree", headBeforeStaged);
    expectedGit("update-index", "--add", "--cacheinfo", "100644", stagedBlob, "draft.txt");
    const expectedTree = expectedGit("write-tree");
    assert.notEqual(expectedTree, git("write-tree"), "The real index includes the unrelated staged entry");

    // Source Project definitions are authoritative even without task adoption.
    // This command reads the ACTUAL workspace fix; the selected index still has
    // the old unstaged anchor. A pass must never be described as a staged-tree pass.
    await home(); await chooseScope("project"); await expand("checks");
    await addCheck("Read actual working workspace fix");
    const commitRecipe = workflow.locator(".workflow-recipe").last();
    await commitRecipe.getByLabel("Arguments · one literal argument per line", { exact: true }).fill(
      "-e\nif(!require('node:fs').readFileSync('draft.txt','utf8').includes('Unstaged worktree hunk'))process.exit(1)");
    await commitRecipe.getByLabel("Required stage · recipe prerequisite", { exact: true }).selectOption("commit");
    const requiredSaved = await save("project");
    assert.deepEqual(requiredSaved.task, applied.task, "Project prerequisite saves do not adopt or execute a task");
    assert.equal(requiredSaved.project.checks[0].requiredStage, "commit");
    const stagedPanel = await openDetail("Review & commit", "Review & commit panel");
    const refreshedStatus = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/status"
      && new URL(response.url()).searchParams.get("cwd") === cwd);
    await stagedPanel.getByRole("button", { name: "Refresh changed files" }).click();
    assert.equal((await refreshedStatus).status(), 200);
    await stagedPanel.getByText(/^draft\.txt\s+\(/).waitFor();
    assert.equal(await stagedPanel.getByLabel("Commit source").inputValue(), "whole-file");
    await stagedPanel.getByLabel("Commit source").selectOption("staged");
    assert.match(await stagedPanel.innerText(), /Unstaged changes and unrelated staged entries remain/);
    const stagedRow = stagedPanel.getByText(/^draft\.txt\s+\(/).locator("xpath=ancestor::li[1]");
    assert.match(await stagedRow.innerText(), /index M, worktree M/, "Same path has both staged and unstaged edits");
    await stagedRow.getByRole("checkbox").check();
    assert.equal(await stagedPanel.locator("form").getByRole("checkbox", { checked: true }).count(), 1, "Do not select the unrelated staged entry");
    await stagedPanel.getByLabel("Commit message").fill("E2E staged partial-hunk commit");
    const stagedReceiptIds = await reviewCommitChecks(page, { panel: stagedPanel, sessionId, cwd, git, checkContainmentSupported,
      changeSource: () => writeFileSync(join(cwd, "draft.txt"), workingDraft.replace("Unstaged worktree hunk", "Unstaged worktree hunk changed")),
      restoreSource: () => writeFileSync(join(cwd, "draft.txt"), workingDraft) });
    if (!checkContainmentSupported) {
      // Never invent a passing receipt on an unsupported host. Real preview and
      // decline were covered above; remove only this disposable fixture policy
      // so the pre-existing staged commit acceptance still runs without checks.
      await home(); await chooseScope("project"); await expand("checks");
      await workflow.getByRole("button", { name: "No checks at this scope", exact: true }).click();
      await save("project");
      await openDetail("Review & commit", "Review & commit panel");
      const reloaded = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/verification" && response.request().method() === "GET");
      await stagedPanel.getByRole("button", { name: "Refresh changed files" }).click();
      assert.equal((await reloaded).status(), 200);
      await stagedPanel.getByText("No verification recipes are defined (no-defined). This is not a waiver of project instructions.", { exact: true }).waitFor();
      await stagedRow.getByRole("checkbox").check();
    }
    const indexBeforePreview = readFileSync(git("rev-parse", "--path-format=absolute", "--git-path", "index"));
    const stagedPreviewResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/commit"
      && response.request().postDataJSON()?.operation === "preview");
    await stagedPanel.getByRole("button", { name: "Preview", exact: true }).click();
    const stagedHttp = await stagedPreviewResponse;
    assert.equal(stagedHttp.status(), 200, stagedHttp.status() === 200 ? "" : await stagedHttp.text());
    assert.deepEqual(stagedHttp.request().postDataJSON(), {
      operation: "preview", sessionId, paths: ["draft.txt"], mode: "staged", message: "E2E staged partial-hunk commit", receiptIds: stagedReceiptIds,
    });
    const stagedCandidate = await stagedHttp.json();
    assert.equal(stagedCandidate.preview.mode, "staged");
    assert.deepEqual(stagedCandidate.verification.receiptIds, stagedReceiptIds);
    assert.equal(stagedCandidate.verification.evidenceScope, "working-workspace");
    assert.equal(stagedCandidate.verification.candidateTreeVerified, false, "Never promote a workspace pass to candidate-tree evidence");
    assert.equal(stagedCandidate.verification.repositoryChecksWaived, false);
    assert.deepEqual(stagedCandidate.preview.paths, ["draft.txt"]);
    assert.equal(stagedCandidate.preview.head, headBeforeStaged);
    assert.equal(stagedCandidate.preview.tree, expectedTree);
    assert.equal(stagedCandidate.candidateDiff.fromTreeOid, git("rev-parse", `${headBeforeStaged}^{tree}`));
    assert.equal(stagedCandidate.candidateDiff.toTreeOid, expectedTree);
    assert.match(stagedCandidate.candidateDiff.patch, /Selected staged hunk/);
    assert.doesNotMatch(stagedCandidate.candidateDiff.patch, /Unstaged worktree hunk|Unrelated staged entry/);
    const stagedPreview = stagedPanel.locator('[aria-label="Commit preview"]');
    await stagedPreview.getByText("Review exact commit candidate").waitFor();
    assert.match(await stagedPreview.innerText(), /Only the selected index entries will be committed; other staged and unstaged changes remain/);
    assert.equal(await stagedPreview.locator("dt", { hasText: "Mode" }).locator("xpath=following-sibling::dd[1]").innerText(), "staged");
    assert.equal(await stagedPreview.locator("dt", { hasText: "Candidate tree" }).locator("xpath=following-sibling::dd[1]").innerText(), expectedTree);
    const candidatePatch = stagedPreview.getByLabel("Authoritative candidate patch");
    assert.match(await candidatePatch.innerText(), /Selected staged hunk/);
    assert.doesNotMatch(await candidatePatch.innerText(), /Unstaged worktree hunk|Unrelated staged entry/);
    assert.equal(git("rev-parse", "HEAD"), headBeforeStaged, "Staged preview is read-only");
    assert.deepEqual(readFileSync(git("rev-parse", "--path-format=absolute", "--git-path", "index")), indexBeforePreview);
    assert.equal(readFileSync(join(cwd, "draft.txt"), "utf8"), workingDraft);

    // Genuine native capture/apply took 31.4s on this host; wait for its real
    // response without changing candidate, receipt or authorization expiry.
    const stagedConfirmResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/commit"
      && response.request().postDataJSON()?.operation === "confirm", { timeout: 120_000 });
    await stagedPreview.getByRole("button", { name: "Confirm commit" }).click();
    const stagedConfirmed = await stagedConfirmResponse;
    assert.equal(stagedConfirmed.status(), 200, stagedConfirmed.status() === 200 ? "" : await stagedConfirmed.text());
    const stagedApproval = stagedConfirmed.request().postDataJSON();
    assert.equal(stagedApproval.actionId, stagedCandidate.actionId);
    assert.deepEqual(stagedApproval.receiptIds, stagedReceiptIds, "Final commit approval independently binds the actual evidence IDs");
    assert.equal(stagedApproval.message, "E2E staged partial-hunk commit");
    assert.deepEqual(stagedApproval.preview, stagedCandidate.preview, "Approval binds the exact staged candidate");
    const stagedResult = await stagedConfirmed.json();
    assert.equal(stagedResult.status, "committed");
    assert.equal(stagedResult.tree, expectedTree);
    assert.deepEqual(stagedResult.parents, [headBeforeStaged]);
    const stagedCommit = git("rev-parse", "HEAD");
    assert.equal(stagedResult.commit, stagedCommit);
    assert.equal(git("show", "-s", "--format=%B", "HEAD"), stagedApproval.message);
    assert.equal(git("show", "-s", "--format=%ae", "HEAD"), "e2e@example.invalid");
    assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
    assert.equal(git("show", "--format=", "--name-only", "HEAD"), "draft.txt");
    assert.equal(rawGit("show", "HEAD:draft.txt"), selectedDraft);
    assert.equal(rawGit("show", "HEAD:second-draft.txt"), "Second captured commit file\n");
    assert.equal(git("ls-files", "--stage"), originalEntries, "Confirm must preserve the original index entries");
    assert.equal(rawGit("show", ":draft.txt"), selectedDraft);
    assert.equal(rawGit("show", ":second-draft.txt"), unrelatedIndex);
    assert.equal(readFileSync(join(cwd, "second-draft.txt"), "utf8"), unrelatedIndex);
    assert.equal(git("diff", "--cached", "--name-only"), "second-draft.txt");
    assert.equal(readFileSync(join(cwd, "draft.txt"), "utf8"), workingDraft, "Unstaged hunk remains in the worktree");
    assert.equal(git("diff", "--name-only"), "draft.txt");
    assert.match(git("diff", "--", "draft.txt"), /Unstaged worktree hunk/);
    assert.doesNotMatch(git("diff", "--", "draft.txt"), /Selected staged hunk/);
    await stagedPanel.getByText("Last commit created").waitFor();
    await closeWorkflow();
    const stagedCard = page.locator(`[data-git-action-id="${stagedCandidate.actionId}"]`);
    await stagedCard.getByRole("heading", { name: /Commit.*Succeeded/ }).waitFor();
    await stagedCard.getByRole("button", { name: /^Captured candidate/ }).click();
    await stagedCard.getByText("Selected staged index paths").waitFor();
    assert.equal(await stagedCard.getByRole("button", { name: /^Confirm/ }).count(), 0, "History cannot reapprove a staged commit");
    console.log("PASS: real browser staged partial-hunk commit approves only the selected index tree; unrelated staged and unstaged edits survive");

    // Verification/integration needs a clean checkout. Restore only the two
    // fixture edits AFTER proving their survival; do not undo the new commit.
    assert.equal(git("rev-parse", "--show-toplevel"), cwd);
    git("restore", "--staged", "--worktree", "--", "draft.txt", "second-draft.txt");
    assert.equal(git("status", "--porcelain"), "", "Fixture cleanup leaves the new feature commit intact");
    assert.equal(git("rev-parse", "HEAD"), stagedCommit);

    // Remove the new commit-stage fixture before exercising the unchanged paired
    // FF/non-FF checks below. They must retain their legacy omitted-field recipe.
    await home(); await chooseScope("project"); await expand("checks");
    if (checkContainmentSupported) {
      await workflow.getByRole("button", { name: "No checks at this scope", exact: true }).click();
      await save("project");
    }
    // Project-owned checks neither run nor grant approval on Save; the captured task must be explicitly updated first.
    await home();
    await chooseScope("project");
    await expand("checks");
    await addCheck("Fixture verification");
    await addCheck("Second required verification");
    const checksSaved = await save("project");
    assert.deepEqual(checksSaved.task, applied.task);
    assert.deepEqual(checksSaved.project.checks, ["Fixture verification", "Second required verification"].map(label => ({ label, argv: [process.execPath, "-e", "process.exit(0)"] })),
      "Both legacy paired FF/non-FF flows retain an omitted-field recipe, not a relabelled working-workspace receipt");
    const checksApplied = await apply();
    assert.equal(checksApplied.task.settings.checks[0].label, "Fixture verification");
    assert.equal(mutations.filter((entry) => entry.path === "/api/git/integration").length, 0, "Saving/applying checks must not run them");
    // Use the fixture's disposable target for FF, then restore it for the separate non-FF test.
    // A saved method is not approval: this needs its own browser check, plan and confirmation.
    let ffPlanId;
    if (checkContainmentSupported) {
      assert.equal(dirname(cwd), dirname(targetWorktree));
      assert.match(basename(dirname(cwd)), /^pi-web-e2e-/, "FF may touch only the temporary E2E fixture");
      assert.equal(gitAt(targetWorktree, "status", "--porcelain"), "", "Fixture target must start clean");
      const originalTarget = gitAt(targetWorktree, "rev-parse", "HEAD");
      const featureTip = git("rev-parse", "HEAD");
      const featureTree = git("rev-parse", "HEAD^{tree}");
      const featureParents = git("show", "-s", "--format=%P", "HEAD").split(" ");
      await chooseScope("project"); await expand("integration");
      await control("method").selectOption("ff");
      assert.equal((await save("project")).project.method, "ff");
      assert.equal((await apply()).task.settings.method, "ff");
      await openDetail("Integration review", "Local integration review");
      await review.getByRole("button", { name: "Run required checks" }).waitFor();
      await rejectMovedIntegrationTarget(page, { panel: review, sessionId,
        advanceTarget: () => gitAt(targetWorktree, "reset", "--hard", featureTip),
        restoreTarget: () => gitAt(targetWorktree, "reset", "--hard", originalTarget),
        targetHead: () => gitAt(targetWorktree, "rev-parse", "HEAD") });
      await runRequiredIntegrationChecks(page, { panel: review, sessionId });
      assert.equal(gitAt(targetWorktree, "rev-parse", "HEAD"), originalTarget, "FF verification does not update target");
      const ffPlanResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/integration"
        && response.request().postDataJSON()?.operation === "plan");
      await review.getByRole("button", { name: "Prepare exact integration proposal" }).click();
      const ffHttp = await ffPlanResponse;
      assert.equal(ffHttp.status(), 200, ffHttp.status() === 200 ? "" : await ffHttp.text());
      const ffPlan = (await ffHttp.json()).plan;
      ffPlanId = ffPlan.planId;
      assert.equal(ffPlan.method, "ff");
      assert.equal(ffPlan.review.targetOid, originalTarget);
      assert.equal(ffPlan.review.featureOid, featureTip);
      assert.equal(ffPlan.featureOid, featureTip);
      assert.equal(ffPlan.treeOid, featureTree);
      assert.equal(ffPlan.diff.toTreeOid, featureTree);
      assert.deepEqual(ffPlan.parents, featureParents);
      assert.equal(ffPlan.mergeOid, undefined, "FF must not propose a synthetic merge commit");
      const ffProposal = review.getByLabel("Exact integration proposal");
      await ffProposal.getByText("Review exact integration proposal — not yet applied").waitFor();
      assert.match(await ffProposal.innerText(), /Fast-forward to existing feature commit \(no new merge commit\)/);
      assert.equal(await ffProposal.locator("dt", { hasText: "Exact resulting target OID" }).locator("xpath=following-sibling::dd[1]").innerText(), featureTip);
      assert.equal(await ffProposal.locator("dt", { hasText: "Existing tip parents" }).locator("xpath=following-sibling::dd[1]").innerText(), featureParents.join(", "));
      assert.equal(await ffProposal.getByText("Exact merge commit OID").count(), 0);
      assert.equal(gitAt(targetWorktree, "rev-parse", "HEAD"), originalTarget, "FF proposal does not update target");
      const ffConfirmResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/integration"
        && response.request().postDataJSON()?.operation === "confirm");
      await ffProposal.getByRole("button", { name: /^Confirm exact plan/ }).click();
      const ffConfirmed = await ffConfirmResponse;
      assert.equal(ffConfirmed.status(), 200, ffConfirmed.status() === 200 ? "" : await ffConfirmed.text());
      assert.equal(ffConfirmed.request().postDataJSON().planId, ffPlanId);
      assert.equal(ffConfirmed.request().postDataJSON().approvePlanId, ffPlanId);
      const ffResult = await ffConfirmed.json();
      assert.equal(ffResult.status, "integrated");
      assert.equal(ffResult.method, "ff");
      assert.equal(ffResult.featureOid, featureTip);
      assert.equal(ffResult.treeOid, featureTree);
      assert.deepEqual(ffResult.parents, featureParents);
      assert.equal(ffResult.mergeOid, undefined);
      await review.getByText("Local integration completed").waitFor();
      assert.match(await review.innerText(), /fast-forwarded to existing feature tip/);
      assert.equal(gitAt(targetWorktree, "rev-parse", "refs/heads/target"), featureTip, "FF moves target to the existing feature object");
      assert.equal(gitAt(targetWorktree, "rev-parse", "HEAD^{tree}"), featureTree);
      assert.deepEqual(gitAt(targetWorktree, "show", "-s", "--format=%P", "HEAD").split(" "), featureParents);
      assert.equal(git("rev-parse", "HEAD"), featureTip, "FF does not change the feature ref");
      console.log("PASS: browser FF check, exact plan and separate approval move target to the existing feature tip without a merge commit");

      assert.equal(gitAt(targetWorktree, "rev-parse", "--show-toplevel"), targetWorktree, "Reset only the disposable fixture checkout");
      assert.equal(gitAt(targetWorktree, "status", "--porcelain"), "", "Do not discard work while restoring the fixture");
      gitAt(targetWorktree, "reset", "--hard", originalTarget);
      assert.equal(gitAt(targetWorktree, "rev-parse", "HEAD"), originalTarget);
      assert.equal(gitAt(targetWorktree, "status", "--porcelain"), "");
      await home(); await chooseScope("project"); await expand("integration");
      await control("method").selectOption("merge");
      assert.equal((await save("project")).project.method, "merge");
      assert.equal((await apply()).task.settings.method, "merge");
      // A completed result intentionally disables another action in the same panel instance.
      // Reload the persisted chat to start a fresh, separately reviewed non-FF attempt.
      await page.reload({ waitUntil: "load" });
    }
    await openDetail("Integration review", "Local integration review");
    await review.getByRole("button", { name: "Refresh review" }).click();
    await review.getByRole("button", { name: "Run required checks" }).waitFor();
    await checkRetiredRecovery(page, { panel: review, sessionId });
    const targetBeforeVerification = gitAt(targetWorktree, "rev-parse", "HEAD");
    assert.deepEqual((await api(`/api/git/integration?sessionId=${sessionId}`)).receipts, []);
    if (!checkContainmentSupported) {
      const refused = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/integration"
        && response.request().method() === "POST" && response.request().postDataJSON()?.operation === "verify");
      await review.getByRole("button", { name: "Run required checks" }).click();
      const denied = await refused;
      assert.equal(denied.status(), 409, "a host without verified containment must refuse checks");
      assert.deepEqual((await api(`/api/git/integration?sessionId=${sessionId}`)).receipts, []);
      assert.equal(gitAt(targetWorktree, "rev-parse", "HEAD"), targetBeforeVerification);
      console.log("PASS: unavailable Linux check containment refuses verification before any integration");
    } else {
    await runRequiredIntegrationChecks(page, { panel: review, sessionId });
    assert.equal(gitAt(targetWorktree, "rev-parse", "HEAD"), targetBeforeVerification, "Verification must not integrate");
    const mergePlanResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/integration"
      && response.request().postDataJSON()?.operation === "plan");
    await review.getByRole("button", { name: "Prepare exact integration proposal" }).click();
    const mergePlan = await mergePlanResponse;
    assert.equal(mergePlan.status(), 200, mergePlan.status() === 200 ? "" : await mergePlan.text());
    assert.notEqual((await mergePlan.json()).plan.planId, ffPlanId, "Non-FF needs a new exact plan, not FF approval");
    const proposal = review.getByLabel("Exact integration proposal");
    await proposal.getByText("Review exact integration proposal — not yet applied").waitFor();
    const expectedMerge = await proposal.locator("dt", { hasText: "Exact merge commit OID" }).locator("xpath=following-sibling::dd[1]").innerText();
    await proposal.getByText(/draft\.txt/).waitFor();
    assert.equal(gitAt(targetWorktree, "rev-parse", "HEAD"), targetBeforeVerification, "Proposal must not integrate");
    assert.equal(await proposal.getByRole("checkbox").count(), 0);
    assert.equal(await proposal.getByRole("button", { name: /I have reviewed/ }).count(), 0, "One exact confirmation button, no extra acknowledgement gate");
    await proposal.getByRole("button", { name: /^Confirm exact plan/ }).click();
    await review.getByText("Local integration completed").waitFor();
    assert.equal(gitAt(targetWorktree, "rev-parse", "HEAD"), expectedMerge);
    assert.deepEqual(gitAt(targetWorktree, "show", "-s", "--format=%P", "HEAD").split(" "), [targetBeforeVerification, git("rev-parse", "HEAD")]);
    assert.equal(gitAt(targetWorktree, "show", "-s", "--format=%G?", "HEAD"), "N", "Local merge remains unsigned");
    console.log("PASS: explicit check, exact proposal, separately approved unsigned local non-FF merge");
    }

    const continuation = await openDetail("Workspace details", "Continue session in another worktree");
    await continuation.getByLabel("Destination worktree").selectOption(targetWorktree);
    assert.equal(await continuation.getByRole("button", { name: "Continue here…" }).count(), 1);
    assert.equal(await continuation.getByRole("button", { name: "Fork chat here…" }).count(), 1);
    await continuation.getByRole("button", { name: "Continue here…" }).click();
    await continuation.getByRole("button", { name: "Confirm continuation" }).waitFor();
    await continuation.getByLabel("Destination worktree").selectOption("");
    assert.equal(await continuation.getByRole("button", { name: "Confirm continuation" }).count(), 0, "Changing destination cancels the pending approval");
    await continuation.getByLabel("Destination worktree").selectOption(targetWorktree);
    await continuation.getByRole("button", { name: "Continue here…" }).click();
    await continuation.getByRole("button", { name: "Confirm continuation" }).click();
    await page.waitForFunction((id) => document.querySelector(`[data-session-id="${id}"]`)?.textContent?.includes("target"), sessionId);
    await page.getByText("Ready to review Git workflow", { exact: true }).waitFor();
    await openDetail("Workspace details", "Continue session in another worktree");
    await continuation.getByText(`Actual chat checkout: ${targetWorktree}`, { exact: true }).waitFor();
    const moved = await readSettings();
    assert.equal(moved.cwd, targetWorktree);
    assert.equal(moved.projectRoot, cwd, "Linked worktrees share canonical project defaults");
    assert.equal((await api("/api/sessions?force=1")).sessions.find((session) => session.id === sessionId)?.cwd, targetWorktree);
    assert.deepEqual(creations, [], "The complete Workflow flow must not create an agent/chat");
    await closeWorkflow();
    await commitCard.getByRole("heading", { name: /Commit.*Succeeded/ }).waitFor();
    await commitCard.getByRole("button", { name: /^Captured candidate/ }).click();
    await commitCard.getByRole("region", { name: "Side-by-side diff" }).getByText("Manual commit fixture", { exact: true }).waitFor();
    assert.match(await commitCard.innerText(), new RegExp(manualCommit));
    console.log("PASS: same chat continues in a registered target worktree and retains its original captured Git history");

    // Reproduce a live blocking ask_user with no captured worktree base. The
    // editor must not promise an impossible Save/Apply while the run is held.
    await home();
    await chooseScope("session");
    await expand("workspace");
    await control("workspace").selectOption("worktree");
    assert.equal(await control("baseBranch").isDisabled(), true, "the base is project-owned");
    await chooseLegacyContinuation("continue");
    await save("session");
    const pendingBase = await apply();
    assert.equal(pendingBase.task.settings.workspace, "worktree");
    assert.equal(pendingBase.task.settings.baseBranch, null);
    await closeWorkflow();
    await page.locator("[data-minimap-preview-box]").waitFor({ state: "hidden" });
    await page.locator("textarea").last().fill("/e2e-ask-user single");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const question = page.getByRole("group", { name: "E2E browser question" });
    await question.waitFor();
    const originalQuestion = await question.elementHandle();
    await openWorkflow();
    await workflow.getByText(/Session Save and Apply are unavailable/).waitFor();
    assert.match(await workflow.innerText(), /one new worktree only/);
    const sessionSave = workflow.getByRole("button", { name: "Save session settings", exact: true });
    if (await sessionSave.count()) assert.equal(await sessionSave.isDisabled(), true);
    else {
      // Authorization revocation stays reachable during a run; editing the
      // captured session policy itself still requires an idle chat.
      await scopes.getByRole("button", { name: /^Session/ }).click();
      // Save lives in the dirty-draft footer; with no unsaved Session change it
      // remains absent rather than rendering a disabled button.
      if (await sessionSave.count()) assert.equal(await sessionSave.isDisabled(), true);
      else assert.match(await workflow.innerText(), /Session settings unavailable/);
    }
    assert.equal(await task.getByRole("button", { name: "Apply saved settings to this task", exact: true }).isDisabled(), true);
    await selectProject(cwd);
    // Keep the original server-owned AgentDialog question pending. Editing a
    // Project draft must neither answer it nor remount focused recipe inputs.
    await chooseScope("project"); await expand("checks");
    const pendingRecipe = workflow.locator(".workflow-recipe").first();
    if (!await pendingRecipe.evaluate((element) => element.open)) await pendingRecipe.locator("summary").click();
    const pendingLabel = pendingRecipe.getByLabel("Label", { exact: true });
    const pendingNode = await pendingLabel.elementHandle();
    await pendingLabel.fill(""); await pendingLabel.focus();
    await page.keyboard.type("Pending question preserves this draft");
    assert.equal(await pendingNode.evaluate((node) => node.isConnected && document.activeElement === node), true);
    assert.equal(await question.count(), 1, "Editing does not resolve the original question");
    assert.equal(await originalQuestion.evaluate((node) => node.isConnected), true, "Workflow editing retains the original server question DOM");
    await chooseScope("global"); await chooseScope("project"); await expand("checks");
    if (!await pendingRecipe.evaluate((element) => element.open)) await pendingRecipe.locator("summary").click();
    assert.equal(await pendingLabel.inputValue(), "Pending question preserves this draft");
    await closeWorkflow(); await openWorkflow();
    assert.equal(await pendingLabel.inputValue(), "Pending question preserves this draft");
    await workflow.getByRole("button", { name: "Discard", exact: true }).click();
    await pendingNode.dispose();
    assert.equal(await originalQuestion.evaluate((node) => node.isConnected), true, "Scope/close navigation never replaces the pending question");
    await originalQuestion.dispose();
    await chooseScope("session");
    const liveAuth = workflow.getByRole("region", { name: "Saved action authorization" });
    await liveAuth.locator("#workflow-auth-commit").selectOption("deny");
    const liveDeny = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/authorizations"
      && response.request().method() === "PUT" && response.request().postDataJSON().scope === "session");
    await liveAuth.getByRole("button", { name: /Save Selected commits deny for this chat/ }).click();
    const liveDenyResult = await liveDeny;
    assert.equal(liveDenyResult.status(), 200, liveDenyResult.status() === 200 ? "" : await liveDenyResult.text());
    assert.equal((await liveDenyResult.json()).actions.commit.effective, "deny", "live revocation cannot require an idle chat");
    assert.equal(git("rev-parse", "HEAD"), stagedCommit, "waiting question must not create/commit a worktree");
    await closeWorkflow();
    await question.getByRole("button", { name: "Cancel" }).click();
    await question.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Stop agent", exact: true }).waitFor({ state: "hidden" });
    console.log("PASS: pending question explains idle-only settings and one-off base without creating a workspace");
  } finally {
    page.off("load", observeLoad);
    page.off("request", observeRequest);
  }
}
