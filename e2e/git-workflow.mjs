import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/** Real scoped settings, local Git objects and a persisted chat; no model or mocked settings endpoint. */
export async function checkGitWorkflow(page, { base, api, artifacts, sessionId, cwd, targetWorktree }) {
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
    if (request.method() !== "GET" && ["/api/git/commit", "/api/git/integration", "/api/worktrees", `/api/sessions/${sessionId}/move`].includes(path)) {
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
    await page.waitForFunction(() => {
      const button = document.querySelector("#workflow-panel .workflow-header button");
      return button && !button.disabled;
    });
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
    await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "load" });
    page.on("load", observeLoad);
    await page.getByText("Ready to review Git workflow", { exact: true }).waitFor();
    assert.equal(await trigger.count(), 1, "One Workflow entry point");
    const bounds = await trigger.boundingBox();
    assert.ok(bounds && bounds.y < 80, "Workflow belongs beside Activity, not near the composer");
    for (const name of ["Workspace workflow", "Review & commit", "Local integration review"]) {
      assert.equal(await page.getByRole("button", { name, exact: true }).count(), 0, `${name} is no longer a toolbar button`);
    }
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
        && new URL(response.url()).searchParams.get("cwd") === cwd);
      await workflow.getByRole("button", { name: "Use project", exact: true }).click();
      assert.equal((await loaded).status(), 200);
    }
    await chooseScope("global");
    await origin("enabled", "Built-in default");
    await control("enabled").click();
    await expand("commits");
    await control("commits").selectOption("manual");
    await addCheck("Global fixture check");
    const globalSaved = await save("global");
    assert.equal(globalSaved.global.enabled, false, "Off is a persisted false, not inheritance");
    assert.equal(globalSaved.resolved.global.origins.enabled, "global");
    assert.deepEqual(globalSaved.global.checks, [{ label: "Global fixture check", argv: [process.execPath, "-e", "process.exit(0)"] }]);
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
    await workflow.getByRole("button", { name: "No checks at this scope", exact: true }).click();
    const projectSaved = await save("project");
    assert.equal(projectSaved.projectRoot, cwd);
    assert.deepEqual(projectSaved.project, { enabled: true, branch: "feature", commits: "off", checks: [], targetBranch: "target" });
    assert.equal(projectSaved.resolved.project.origins.checks, "project");
    assert.deepEqual((await readSettings({ cwd })).project, projectSaved.project, "Project values are server-persisted");
    await origin("checks", "Set here");

    // Reset removes just the override: [] and Off must not have been mistaken for absence on save.
    await field("checks").getByRole("button", { name: "Use Global value", exact: true }).click();
    await origin("checks", "From Global");
    await workflow.locator(".workflow-recipe summary").filter({ hasText: "1. Global fixture check" }).waitFor();
    await expand("commits");
    await field("commits").getByRole("button", { name: "Use Global value", exact: true }).click();
    await origin("commits", "From Global");
    const projectReset = await save("project");
    assert.equal(Object.hasOwn(projectReset.project, "checks"), false);
    assert.equal(Object.hasOwn(projectReset.project, "commits"), false);
    assert.deepEqual(projectReset.resolved.project.values.checks, globalSaved.global.checks);
    assert.equal(projectReset.resolved.project.values.commits, "manual");
    await chooseScope("global");
    await field("enabled").getByRole("button", { name: "Restore built-in default", exact: true }).click();
    const globalReset = await save("global");
    assert.equal(Object.hasOwn(globalReset.global, "enabled"), false);
    assert.equal(globalReset.resolved.global.values.enabled, true);
    await origin("enabled", "Built-in default");

    // A child resolves SAVED parents only. Closing, switching scope and discarding one draft must not erase another.
    await expand("workspace");
    await control("branch").fill("global-unsaved");
    await chooseScope("project");
    assert.equal(await control("branch").inputValue(), "feature");
    await field("branch").getByRole("button", { name: "Use Global value", exact: true }).click();
    assert.equal(await control("branch").inputValue(), "", "Unsaved Global branch must not leak into Project inheritance");
    await origin("branch", "Built-in default");
    await control("branch").fill("project-unsaved");
    await closeWorkflow();
    await home();
    assert.equal(await control("branch").inputValue(), "project-unsaved", "Project draft survives close/reopen");
    await chooseScope("global");
    assert.equal(await control("branch").inputValue(), "global-unsaved", "Global draft survives scope changes");
    const beforeDiscard = await readSettings({ cwd });
    assert.equal(Object.hasOwn(beforeDiscard.global, "branch"), false);
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
    await workflow.getByRole("button", { name: "No checks at this scope", exact: true }).click();
    const sessionSaved = await save("session");
    assert.deepEqual(sessionSaved.session, { commits: "off", checks: [] });
    assert.deepEqual(sessionSaved.task, initial.task, "Session save alone must not adopt or rewrite this task");
    await origin("checks", "Set here");
    await field("checks").getByRole("button", { name: "Use Project value", exact: true }).click();
    await origin("checks", "From Global");
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
    assert.deepEqual(adopted.task.settings.checks, globalSaved.global.checks);
    const permissions = task.locator('details[aria-label="Current task permissions"]');
    await permissions.locator("summary").click();
    const commitPermissions = permissions.locator(".workflow-comparison > div").filter({ has: page.locator("dt", { hasText: /^Commits$/ }) });
    assert.ok((await commitPermissions.innerText()).includes(adopted.permissions.agent.commit.reason));
    assert.ok((await commitPermissions.innerText()).includes(adopted.permissions.human.commit.reason));
    assert.equal(adopted.permissions.human.commit.kind, "confirmation-required");
    const permissionText = await commitPermissions.innerText();
    await expand("commits");
    assert.equal(await control("commits").locator('option[value="automatic"]').isDisabled(), true);
    assert.match(await workflow.locator("#workflow-stage-commits").innerText(), /scoped grants, reviewed instruction profiles and task-bound workspace admission/);
    await control("commits").selectOption("ask");
    assert.equal(await commitPermissions.innerText(), permissionText, "Unsaved preferences never change task permission facts");
    await workflow.getByRole("button", { name: "Discard", exact: true }).click();
    await permissions.locator("summary").click();

    // Every defaults scope can change without changing the captured task. Explicit Apply ignores unsaved drafts.
    await chooseScope("global");
    await expand("workspace");
    await control("onCreate").selectOption("stay");
    assert.deepEqual((await save("global")).task, adopted.task);
    await chooseScope("project");
    await control("onCreate").selectOption("fork");
    assert.deepEqual((await save("project")).task, adopted.task);
    await chooseScope("session");
    await control("onCreate").selectOption("stay");
    const laterTasks = await save("session");
    assert.deepEqual(laterTasks.task, adopted.task);
    assert.equal(laterTasks.resolved.session.values.onCreate, "stay");
    await task.getByText("Task details · Defaults differ — compare", { exact: true }).waitFor();
    await control("onCreate").selectOption("continue");
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
    assert.equal(await control("targetBranch").isEnabled(), true, "Off does not lock the configuration editor");
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
      // A dirty save footer and long checkout paths must fit too, not just the collapsed overview.
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

    const commitPanel = await openDetail("Review & commit", "Review & commit panel");
    await commitPanel.getByText(/^draft\.txt\s+\(/).waitFor();
    for (const checkbox of await commitPanel.getByRole("checkbox").all()) await checkbox.check();
    await commitPanel.getByLabel("Commit message").fill("E2E manual commit");
    const before = git("rev-parse", "HEAD");
    const previewResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/commit"
      && response.request().postDataJSON()?.operation === "preview");
    await commitPanel.getByRole("button", { name: "Preview", exact: true }).click();
    const savedPreview = await (await previewResponse).json();
    assert.equal(typeof savedPreview.actionId, "string");
    const pendingHistory = await api(`/api/git/actions/${savedPreview.actionId}?sessionId=${sessionId}`);
    assert.equal(pendingHistory.record.state, "awaiting-decision", "Live journal ownership is shared across Next route modules");
    assert.equal(pendingHistory.candidate, undefined, "Collapsed history does not transfer patch bytes");
    const candidate = commitPanel.locator('[aria-label="Commit preview"]');
    await candidate.getByText("Review exact commit candidate").waitFor();
    assert.equal(git("rev-parse", "HEAD"), before, "Preview must not commit");
    assert.match(await candidate.innerText(), /draft\.txt/);
    await candidate.getByRole("button", { name: "Confirm commit" }).click();
    await commitPanel.getByText("Last commit created").waitFor();
    assert.notEqual(git("rev-parse", "HEAD"), before);
    assert.equal(git("show", "--format=", "--name-only", "HEAD"), "draft.txt\nsecond-draft.txt");
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

    // Saving a check neither runs it nor grants approval; the captured task must be explicitly updated first.
    await home();
    await chooseScope("session");
    await expand("checks");
    await workflow.getByRole("button", { name: "No checks at this scope", exact: true }).click();
    await addCheck("Fixture verification");
    const checksSaved = await save("session");
    assert.deepEqual(checksSaved.task, applied.task);
    assert.equal(checksSaved.session.checks[0].label, "Fixture verification");
    const checksApplied = await apply();
    assert.equal(checksApplied.task.settings.checks[0].label, "Fixture verification");
    assert.equal(mutations.filter((entry) => entry.path === "/api/git/integration").length, 0, "Saving/applying checks must not run them");
    await openDetail("Integration review", "Local integration review");
    await review.getByRole("button", { name: "Refresh review" }).click();
    await review.getByRole("button", { name: "Run check 1" }).waitFor();
    const targetBeforeVerification = gitAt(targetWorktree, "rev-parse", "HEAD");
    assert.deepEqual((await api(`/api/git/integration?sessionId=${sessionId}`)).receipts, []);
    await review.getByRole("button", { name: "Run check 1" }).click();
    await review.getByText(/Passed: receipt/).waitFor();
    assert.equal(gitAt(targetWorktree, "rev-parse", "HEAD"), targetBeforeVerification, "Verification must not integrate");
    await review.getByRole("button", { name: "Prepare exact integration proposal" }).click();
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
  } finally {
    page.off("load", observeLoad);
    page.off("request", observeRequest);
  }
}
