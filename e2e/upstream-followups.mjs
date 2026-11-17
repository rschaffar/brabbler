import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkInstalledModelContext } from "./model-context-bridge.mjs";
import { waitForAsyncCondition } from "./async-condition.mjs";
import { sessionLaunchIdle } from "./session-launch.mjs";

export function seedFollowupSettings({ agentDir, project }) {
  const factoryLog = join(agentDir, "listing-factories.log");
  writeFileSync(factoryLog, "");
  writeFileSync(join(agentDir, "extensions", "listing-probe.ts"), `import { appendFileSync } from "node:fs";
export default function () { appendFileSync(${JSON.stringify(factoryLog)}, "factory\\n"); }`);
  const skill = join(agentDir, "skills", "followup-instructions");
  mkdirSync(join(skill, "refs"), { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: followup-instructions\ndescription: Followup reader fixture\n---\n\n# Full instructions\n\n[Read the guide](refs/guide.md#details)\n\n[Local heading](#full-instructions)\n");
  writeFileSync(join(skill, "refs", "guide.md"), "# Guide\n\n" + "Reader paragraph.\n\n".repeat(40) + "## Details\n\nNested reference sentinel.\n\n[Root instructions](../SKILL.md#full-instructions)\n\n[Next document](next.md)\n\n<a id=\"raw\"></a>\n\n[Raw anchor](#raw)\n\nNote[^1]\n\n[^1]: Reader footnote sentinel.\n");
  writeFileSync(join(skill, "refs", "next.md"), "# Next\n\nSecond nested document sentinel.\n");
  // The hierarchy's real inventory requires producer metadata; the old native
  // reader fixture supplied only a skill. Content/general-file admission stays
  // independent, including the existing 403 assertion below.
  const catalogPath = join(agentDir, "resource-catalog.json");
  assert.equal(existsSync(catalogPath), false, "do not replace another fixture's catalog");
  writeFileSync(catalogPath, JSON.stringify({ version: 1, groups: [], packages: [],
    resources: [{ kind: "skill", package: null, path: join(skill, "SKILL.md"), group: null, managedBy: "nix" }] }));
  const file = join(agentDir, "models.json");
  const config = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  config.providers ??= {};
  config.providers["e2e-followups"] = { baseUrl: "http://127.0.0.1:9/provider", api: "anthropic-messages", apiKey: "synthetic-not-a-provider-key", compat: { forceAdaptiveThinking: true }, models: [
    { id: "adaptive-fixture", name: "Adaptive fixture", reasoning: true }, { id: "sibling-fixture", name: "Sibling fixture" },
  ] };
  writeFileSync(file, JSON.stringify(config));
  return { skillPath: join(skill, "SKILL.md"), factoryLog, project };
}

async function openSettings(page, section) {
  const show = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await show.isVisible()) await show.click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const picker = page.getByRole("combobox", { name: "Settings", exact: true });
  if (await picker.isVisible()) await picker.selectOption({ label: section });
  else await page.getByRole("navigation", { name: "Settings", exact: true }).getByRole("button", { name: section, exact: true }).click();
}

export async function checkSkillInstructions(page, base, fixture) {
  await openSettings(page, "Skills & extensions");
  await page.locator(".config-sidebar-item").filter({ has: page.getByText("followup-instructions", { exact: true }) }).click();
  const reader = page.getByRole("region", { name: "Instructions", exact: true });
  await reader.getByRole("heading", { name: "Full instructions", exact: true }).waitFor();
  const guide = reader.getByRole("link", { name: "Read the guide", exact: true });
  assert.equal(await guide.getAttribute("href"), null, "reader-local links never navigate the app URL");
  const originalUrl = page.url();
  await guide.focus();
  await page.keyboard.press("Enter");
  await page.getByText("Nested reference sentinel.", { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const h = document.querySelector('.skill-instructions [data-heading-anchor="details"]');
    const box = h?.getBoundingClientRect();
    return box && box.top >= 0 && box.bottom <= innerHeight;
  });
  await page.getByRole("link", { name: "Raw anchor", exact: true }).click();
  await page.getByRole("link", { name: "1", exact: true }).click();
  await reader.getByText("Reader footnote sentinel.", { exact: false }).waitFor();
  await page.getByRole("link", { name: "Next document", exact: true }).click();
  await page.getByText("Second nested document sentinel.", { exact: true }).waitFor();
  assert.ok((await reader.locator(".config-detail-header").boundingBox()).height <= 44, "document Back row remains compact");
  await reader.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByText("Nested reference sentinel.", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Root instructions", exact: true }).click();
  await page.getByRole("heading", { name: "Full instructions", exact: true }).waitFor();
  assert.equal(page.url(), originalUrl);
  const denied = await fetch(`${base}/api/files/${fixture.skillPath.split("/").filter(Boolean).map(encodeURIComponent).join("/")}?type=read`);
  assert.equal(denied.status, 403, "reading a loaded skill must not admit its folder as a general file root");
  await denied.arrayBuffer();
  // Exact four-way listing/factory matrix moves to the real native route graph
  // only after its positive/fault/default gates close. Keep this actual skill
  // reader's keyboard/heading/footnote/Back geometry and root denial at BOTH inputs.
  await page.keyboard.press("Escape");
  console.log(`PASS: ${page.viewportSize().width}px loaded-skill instructions, keyboard/nested/heading/footnote navigation and no new file roots`);
}

// The installed resource bridge uses the ordinary native package registration
// plus producer v1 metadata. Neither metadata nor the request capture is authority.
export function seedResourceApplyFixture({ agentDir, artifacts }) {
  const pkg = join(agentDir, "managed", "browser-package");
  mkdirSync(join(pkg, "extensions"), { recursive: true });
  mkdirSync(join(pkg, "skills", "guide"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "resource-browser-package", type: "module",
    pi: { extensions: ["extensions/probe.js"], skills: ["skills/guide"] } }));
  writeFileSync(join(pkg, "extensions", "probe.js"), `export default pi => {
    pi.registerTool({ name: "resource_browser_probe", label: "Resource browser probe", description: "RESOURCE_BROWSER_TOOL_DESCRIPTION",
      promptSnippet: "RESOURCE_BROWSER_SNIPPET", promptGuidelines: ["RESOURCE_BROWSER_GUIDELINE"],
      parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "probe" }] }) });
    pi.on("before_agent_start", event => { event.systemPromptOptions.promptGuidelines.push("RESOURCE_BROWSER_INSTRUCTION"); });
  };`);
  writeFileSync(join(pkg, "skills", "guide", "SKILL.md"), "---\nname: resource-browser-guide\ndescription: RESOURCE_BROWSER_SKILL_DESCRIPTION\n---\nRESOURCE_BROWSER_SKILL_BODY\n");
  const settingsPath = join(agentDir, "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  settings.packages = [...(settings.packages ?? []), pkg];
  settings.enabledModels = [...(settings.enabledModels ?? []), "e2e-session-launch/**"];
  writeFileSync(settingsPath, JSON.stringify(settings));
  const catalogPath = join(agentDir, "resource-catalog.json");
  assert.equal(existsSync(catalogPath), false, "do not replace another fixture's catalog");
  writeFileSync(catalogPath, JSON.stringify({ version: 1, groups: [],
    packages: [{ source: pkg, name: "Resource browser package", group: null, managedBy: "nix" }],
    resources: [{ kind: "extension", package: pkg, path: "extensions/probe.js", managedBy: "nix" },
      { kind: "skill", package: pkg, path: "skills/guide/SKILL.md", managedBy: "nix" }] }));
  const capturePath = join(artifacts, "resource-model-requests.jsonl");
  writeFileSync(capturePath, "", { flag: "wx", mode: 0o600 });
  return { pkg, capturePath };
}

export async function checkResourceApply(page, { post, project, sessionId, fixture }) {
  const reads = [], mutations = [];
  const onRequest = request => {
    if (request.method() === "PATCH" && new URL(request.url()).pathname === "/api/agent-resources") mutations.push(request.postDataJSON());
  };
  // Register complete body consumers before each real UI action. Even a failed
  // click/assertion cannot abandon an admitted waiter/body rejection.
  const responseFor = predicate => {
    const work = page.waitForResponse(predicate).then(async response => ({ response, data: await response.json() }));
    void work.catch(() => {});
    reads.push(work);
    return work;
  };
  const consume = async work => {
    const result = await work;
    assert.equal(result.response.status(), 200, JSON.stringify(result.data).slice(0, 1000));
    return result;
  };
  const snapshot = () => readFileSync(fixture.capturePath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const prompt = async text => {
    const before = snapshot().length;
    const completed = responseFor(response => new URL(response.url()).pathname === `/api/agent/${sessionId}`
      && response.request().method() === "POST" && response.request().postDataJSON()?.type === "prompt"
      && response.request().postDataJSON()?.message === text);
    await page.locator(".chat-input-textarea").fill(text);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await consume(completed);
    await waitForAsyncCondition(page, sessionLaunchIdle, sessionId);
    const requests = snapshot();
    assert.equal(requests.length, before + 1, "one real SDK request for this browser prompt");
    const request = requests.at(-1);
    assert.equal(request.sessionId, sessionId);
    assert.equal(request.tools.some(tool => tool.name === "resource_browser_control"), true, "ungated control survives");
    return request;
  };
  const included = (request, expected) => {
    assert.equal(request.tools.some(tool => tool.name === "resource_browser_probe"), expected, "current tool identity");
    assert.equal(request.tools.some(tool => tool.description.includes("RESOURCE_BROWSER_TOOL_DESCRIPTION")), expected, "current tool description");
    for (const marker of ["RESOURCE_BROWSER_SNIPPET", "RESOURCE_BROWSER_GUIDELINE", "RESOURCE_BROWSER_INSTRUCTION", "RESOURCE_BROWSER_SKILL_DESCRIPTION", "resource-browser-guide"])
      assert.equal(request.system.includes(marker), expected, marker);
  };
  const open = async () => {
    const loaded = responseFor(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/agent-resources" && response.request().method() === "GET"
        && url.searchParams.get("cwd") === project && url.searchParams.get("sessionId") === sessionId;
    });
    await openSettings(page, "Skills & extensions");
    const { data } = await consume(loaded);
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await settings.locator(".config-sidebar-item").filter({ has: page.getByText("Resource browser package", { exact: true }) }).click();
    await settings.getByRole("heading", { name: "Resource browser package", exact: true }).waitFor();
    return { data, settings };
  };
  let primary;
  page.on("request", onRequest);
  try {
    await waitForAsyncCondition(page, sessionLaunchIdle, sessionId);
    await post(`/api/agent/${sessionId}`, { type: "set_model", provider: "e2e-session-launch", modelId: "faux-1" });
    const baseline = await prompt("/skill:resource-browser-guide E2E_RESOURCE_BASELINE");
    included(baseline, true);
    assert.ok(baseline.userText.includes("RESOURCE_BROWSER_SKILL_BODY"), "enabled explicit skill really expands");
    const { data: before, settings } = await open();
    const pkg = before.catalog.rows.find(row => row.kind === "package" && row.path === fixture.pkg);
    assert.ok(pkg?.selectionKey);
    const saved = responseFor(response => new URL(response.url()).pathname === "/api/agent-resources" && response.request().method() === "PATCH");
    await settings.getByRole("group", { name: "Session", exact: true }).getByRole("radio", { name: "Disabled", exact: true }).click();
    const savedResult = await consume(saved);
    assert.deepEqual(savedResult.response.request().postDataJSON(), { cwd: project, sessionId,
      selectionKey: pkg.selectionKey, scope: "session", choice: "disabled", revision: before.scopes.session.revision, contextToken: before.contextToken });
    assert.equal(savedResult.data.runtime.state, "saved");
    assert.notEqual(savedResult.data.runtime.savedRevision, savedResult.data.runtime.appliedRevision);
    await settings.getByText("Saved; apply to use in this conversation", { exact: true }).waitFor();
    assert.equal(await settings.getByRole("group", { name: "Session", exact: true }).getByRole("radio", { name: "Disabled", exact: true }).isChecked(), true, "only confirmed saved choice is checked");
    assert.equal(mutations.length, 1, "save issues no automatic Apply");
    await page.keyboard.press("Escape");
    included(await prompt("E2E_RESOURCE_SAVED_NOT_APPLIED"), true);
    const reopened = await open();
    assert.equal(reopened.data.runtime.state, "saved");
    const applied = responseFor(response => new URL(response.url()).pathname === "/api/agent-resources" && response.request().method() === "PATCH");
    await reopened.settings.getByRole("button", { name: "Apply saved changes", exact: true }).click();
    const appliedResult = await consume(applied);
    assert.deepEqual(appliedResult.response.request().postDataJSON(), { cwd: project, sessionId, action: "apply" });
    assert.equal(appliedResult.data.runtime.state, "applied");
    assert.equal(appliedResult.data.runtime.appliedRevision, appliedResult.data.runtime.savedRevision);
    await reopened.settings.getByText("Saved selection applied to this conversation", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    included(await prompt("E2E_RESOURCE_APPLIED_OFF"), false);
    const explicit = "/skill:resource-browser-guide E2E_RESOURCE_EXPLICIT_OFF";
    const off = await prompt(explicit);
    included(off, false);
    assert.equal(off.userText, explicit, "Off skill is not expanded; historical consumed instructions may remain");
    assert.deepEqual(mutations.map(body => body.action ?? body.choice), ["disabled", "apply"], "no hidden retry/reload/application");
    console.log("PASS: installed hierarchy Session save → saved old runtime → explicit Apply → actual SDK current resource/skill exclusion with retained control");
  } catch (error) { primary = error; }
  finally {
    const settled = await Promise.allSettled(reads);
    page.off("request", onRequest);
    const errors = [...(primary ? [primary] : []), ...settled.filter(result => result.status === "rejected").map(result => result.reason)];
    if (errors.length) throw new AggregateError(errors, "Installed resource Apply bridge failed");
  }
}

// One ordinary AppShell sound/General/Process-details bridge; compact input
// retains the distinct More/sound/collapse gestures, not a second store matrix.
export async function checkPreferenceWiring(page, base, sessionId) {
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  await page.getByText("E2E final answer", { exact: true }).waitFor();
  const disable = page.getByRole("button", { name: "Disable completion sound", exact: true });
  if (!await disable.isVisible()) await page.getByRole("button", { name: "More controls", exact: true }).click();
  await disable.click();
  await page.getByRole("button", { name: "Enable completion sound", exact: true }).click();
  const collapse = page.getByRole("button", { name: "Collapse controls", exact: true });
  if (await collapse.isVisible()) await collapse.click();
  if (page.viewportSize().width < 768) {
    console.log(`PASS: ${page.viewportSize().width}px compact installed More/sound/collapse wiring`);
    return;
  }
  await openSettings(page, "General");
  const thinking = page.getByRole("switch", { name: "Expand thinking blocks by default", exact: true });
  assert.equal(await thinking.getAttribute("aria-checked"), "false");
  await thinking.click();
  assert.equal(await thinking.getAttribute("aria-checked"), "true");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Process details/ }).click();
  await page.getByText("Final thinking details.", { exact: false }).waitFor();
  console.log(`PASS: ${page.viewportSize().width}px ordinary installed sound/General/thinking Process-details wiring`);
}

// Desktop retains the exact installed high/map/off/header/capability sequence.
// Compact keeps its real Settings field/active chooser/title connection, not a
// second config-mutation/reselection matrix. Requires fresh parent definitions.
export async function checkModelOverrides(page, base, sessionId, cwd) {
  const api = async path => {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200); return response.json();
  };
  const post = async (path, body) => {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 200); return response.json();
  };
  // This transcript/cwd is seeded directly, not selected through the normal
  // workspace owner. Settings remembers Skills and mounts its real inventory
  // before we select Models; do not borrow the five-second catalogue root cache.
  const admitted = await post("/api/cwd/validate", { cwd });
  assert.equal(admitted.success, true);
  assert.equal(admitted.cwd, cwd, "model bridge selects its own canonical fixture workspace");
  const installed = await checkInstalledModelContext(page, { base, api, post, sessionId, project: cwd });
  if (page.viewportSize().width < 768) {
    console.log(`PASS: ${page.viewportSize().width}px installed model field/active chooser/current title wiring`);
    return;
  }
  const { config, command, reselect } = installed;
  // Logical high is the real native precondition for the mapped-label bridge.
  // The unchanged-definition reselection/unmapped-high control matrix now has an
  // exact actual ChatInput owner, so do not replay that transaction before mapping.
  await command({ type: "set_thinking_level", level: "high" });
  const thinking = page.getByRole("button", { name: "Change reasoning level", exact: true });
  const showThinking = async () => {
    if (!await thinking.isVisible()) await page.getByRole("button", { name: "More controls", exact: true }).click();
  };
  config.providers["e2e-followups"].models[0].thinkingLevelMap = { high: "low" };
  const mapped = await fetch(`${base}/api/models-config`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
  const mappedBody = await mapped.json();
  assert.equal(mapped.status, 200);
  assert.equal(mappedBody.success, true);
  await reselect(true);
  // Native high-retention and clamp policy have real SDK owners below. This
  // remaining step is the exact installed metadata→mapped-label connection.
  await showThinking();
  await page.waitForFunction(() => document.querySelector('button[aria-label="Change reasoning level"]')?.title.endsWith("low"));
  config.providers["e2e-followups"].models[0].reasoning = false;
  const clamped = await fetch(`${base}/api/models-config`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
  const clampedBody = await clamped.json();
  assert.equal(clamped.status, 200);
  assert.equal(clampedBody.success, true);
  await reselect(true);
  // Keep the distinct installed off-only menu handoff, not another native-state
  // diagnostic for the already-owned clamp truth table.
  await showThinking();
  await page.waitForFunction(() => document.querySelector('button[aria-label="Change reasoning level"]')?.title.endsWith("off"));
  assert.match(await thinking.getAttribute("title"), /off$/);
  await thinking.click();
  assert.equal(await thinking.locator("..").getByRole("button").count(), 3, "refreshed capability list offers only auto/off plus its trigger");
  await thinking.click();
  config.providers["e2e-followups"].models[0].reasoning = true;
  delete config.providers["e2e-followups"].models[0].thinkingLevelMap;
  const restored = await fetch(`${base}/api/models-config`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
  const restoredBody = await restored.json();
  assert.equal(restored.status, 200);
  assert.equal(restoredBody.success, true);
  await reselect(true);
  const collapse = page.getByRole("button", { name: "Collapse controls", exact: true });
  if (await collapse.isVisible()) await collapse.click();
  console.log(`PASS: ${page.viewportSize().width}px installed model save/reopen/chooser/reload and retained high/map/off capability UI`);
}
