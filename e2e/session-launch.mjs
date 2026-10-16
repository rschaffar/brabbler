import assert from "node:assert/strict";
import { waitForAsyncCondition } from "./async-condition.mjs";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { checkBlockingCard } from "./blocking-card.mjs";
import { MODEL_SPEED_IDS } from "./model-speed.mjs";

export async function sessionLaunchIdle(sessionId) {
  const response = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`);
  if (!response.ok) throw new Error(`Session launch readiness HTTP ${response.status}`);
  const snapshot = await response.json();
  return snapshot.running === true && snapshot.state?.isStreaming === false && snapshot.state?.isPromptRunning === false;
}

/** Real production launch service and SDK wrappers with deterministic faux-provider turns. */
export function sessionLaunchFixtureSource(root) {
  return `import { executeSessionLaunch } from ${JSON.stringify(join(root, "plugins/session-launch/server.ts"))};
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from ${JSON.stringify(join(root, "node_modules/@earendil-works/pi-ai/dist/providers/faux.js"))};
import { join } from "node:path";
export default function (pi) {
  const faux = fauxProvider({ provider: "e2e-session-launch", api: "e2e-session-launch" });
  pi.registerProvider(faux.provider);
  pi.on("before_agent_start", (_event, ctx) => {
    if (ctx.model?.provider !== "e2e-session-launch") return;
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("ask_user", { question: "Independent child input", allowFreeform: true, options: [] }, { id: "e2e-child-input" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Independent child completed"),
    ]);
  });
  pi.registerCommand("e2e-launch-session", { handler: async (mode, ctx) => {
    const result = await executeSessionLaunch({ prompt: "Do the independent child task", cwd: join(ctx.cwd, "..", "other-project", "session-launch-destination"),
      provider: "e2e-session-launch", modelId: faux.getModel().id, thinkingLevel: "off", modelSpeed: "standard" },
      { id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd }, ctx.ui);
    pi.appendEntry("e2e:launch-result", { mode, ...result.details });
    ctx.ui.notify("Launch " + mode + ": " + JSON.stringify(result.details));
  } });
}`;
}
export async function checkSessionLaunch(page, { base, api, post, project, agentDir, artifacts, width }) {
  const parentId = MODEL_SPEED_IDS[width > 600 ? 0 : 1];
  // Keep the independent destination outside the private project's path prefix.
  // Project concealment uses exact workspace identity, not ordinary creator ancestry.
  const destination = join(project, "..", "other-project", "session-launch-destination");
  mkdirSync(destination, { recursive: true });
  // Controlled global fixture scope, not an implicit trust grant for local settings.
  const settingsPath = join(agentDir, "settings.json"), modelSettings = JSON.parse(readFileSync(settingsPath, "utf8"));
  if (!modelSettings.enabledModels.includes("e2e-session-launch/**")) {
    modelSettings.enabledModels.push("e2e-session-launch/**");
    writeFileSync(settingsPath, JSON.stringify(modelSettings));
  }
  const patch = async (set, scope = "session", reset = [], cwd = project) => {
    const response = await page.request.patch(`${base}/api/plugins/bundled`, { data: {
      pluginId: "session-launch", cwd, sessionId: parentId, scope, set, reset,
    } });
    assert.ok(response.ok(), await response.text()); return (await response.json()).settings;
  };
  await patch({ enabled: true }, "global"); await patch({ launch: "ask" });
  await patch({ launch: "ask" }, "project", [], destination);
  await page.goto(`${base}/?session=${parentId}`, { waitUntil: "domcontentloaded" });
  await page.locator("textarea").last().waitFor();
  assert.ok((await post(`/api/agent/${parentId}`, { type: "get_tools" })).data.some((tool) => tool.name === "start_session" && tool.active));

  // Real settings controls and provenance, including reset to inheritance.
  if (width <= 600) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  if (width <= 600) await settings.getByRole("combobox", { name: "Settings", exact: true }).selectOption("plugins");
  else await settings.getByRole("button", { name: "Plugins", exact: true }).click();
  await settings.getByRole("button", { name: "Session Launch", exact: true }).click();
  const panel = settings.getByRole("region", { name: "Session Launch settings" });
  await panel.getByLabel("Plugin settings scope").selectOption("session");
  await panel.getByLabel("Start a session", { exact: true }).selectOption("allow");
  await panel.getByText(/Effective: "allow" · Source: session/).waitFor();
  await panel.getByLabel("Start a session", { exact: true }).locator("..").getByRole("button", { name: "Use project default", exact: true }).click();
  await panel.getByText(/Effective: "ask" · Source: builtin/).waitFor();
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  if (width <= 600) await page.locator(".sidebar-overlay-backdrop").click({ position: { x: width - 10, y: 200 } });

  const start = async (mode) => {
    await page.locator("textarea").last().fill(`/e2e-launch-session ${mode}`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
  };
  const finish = async (mode) => {
    const notice = page.getByText(new RegExp(`^Launch ${mode}: `)); await notice.waitFor();
    const content = await notice.innerText();
    await waitForAsyncCondition(page, sessionLaunchIdle, parentId);
    return JSON.parse(content.slice(content.indexOf(": ") + 2));
  };
  const sessionsBefore = (await api("/api/sessions?includeArchived=1")).sessions.map((session) => session.id);
  await start("changes");
  let card = page.getByRole("group", { name: "Start a new session", exact: true }).filter({ has: page.getByRole("button", { name: "Approve & start", exact: true }) });
  await card.waitFor(); await checkBlockingCard(card);
  await card.getByLabel("Additional details", { exact: true }).fill("Please change the task before launching.");
  await card.getByRole("button", { name: "Collapse", exact: true }).click();
  await page.getByRole("button", { name: /Awaiting response.*Start a new session/ }).click();
  assert.equal(await card.getByLabel("Additional details", { exact: true }).inputValue(), "Please change the task before launching.");
  await card.getByRole("button", { name: "Request changes", exact: true }).click();
  const changes = await finish("changes"); assert.equal(changes.requestChanges, true); assert.equal(changes.feedback, "Please change the task before launching.");
  assert.deepEqual((await api("/api/sessions?includeArchived=1")).sessions.map((session) => session.id).sort(), sessionsBefore.sort(), "feedback never creates a session");

  await start("reject"); await card.waitFor(); await card.getByRole("button", { name: "Reject", exact: true }).click();
  assert.equal((await finish("reject")).accepted, false);

  await start("ask"); await card.waitFor();
  await page.reload({ waitUntil: "domcontentloaded" }); await card.waitFor();
  await card.getByText("Do the independent child task", { exact: true }).waitFor(); await checkBlockingCard(card);
  await page.screenshot({ path: join(artifacts, `session-launch-approval-${width}.png`) });
  await card.getByRole("button", { name: "Approve & start", exact: true }).click();
  const launched = await finish("ask"); assert.equal(launched.accepted, true);
  const childId = launched.sessionId;
  const child = (await api("/api/sessions?includeArchived=1")).sessions.find((session) => session.id === childId);
  assert.equal(child.spawnedBy, parentId); assert.equal(child.relation, undefined); assert.equal(child.parentSessionId, undefined);
  assert.ok((await api("/api/agent/running")).runningSessionIds.includes(childId));
  assert.equal((await post(`/api/agent/${parentId}`, { type: "get_state" })).data.isPromptRunning, false);

  const receipt = page.locator("[data-operation-receipt]").last();
  await receipt.getByRole("button", { name: /Succeeded.*Start a new session|Start a new session.*Succeeded/ }).click();
  const open = receipt.getByRole("link", { name: "Open started session", exact: true }); await open.waitFor();
  assert.equal(await open.getAttribute("href"), `/?session=${childId}`);
  await open.click();
  await page.getByRole("link", { name: "Started by…", exact: true }).waitFor();
  const input = page.getByRole("group", { name: "Independent child input", exact: true }).filter({ has: page.getByRole("button", { name: "Submit", exact: true }) });
  await input.waitFor(); await page.reload({ waitUntil: "domcontentloaded" }); await input.waitFor();
  assert.equal(await page.getByRole("link", { name: "Started by…", exact: true }).getAttribute("href"), `/?session=${parentId}`);
  await input.getByRole("textbox").first().fill("Independent child completed");
  await input.getByRole("button", { name: "Submit", exact: true }).click();
  await page.getByText("Independent child completed", { exact: true }).first().waitFor();
  await page.getByRole("link", { name: "Started by…", exact: true }).click();
  await page.locator("textarea").last().waitFor();

  await patch({ launch: "allow" }); await patch({ launch: "allow" }, "project", [], destination); await start("allow");
  const allowed = await finish("allow"); assert.equal(allowed.accepted, true); assert.notEqual(allowed.sessionId, childId);
  assert.equal(await page.getByRole("button", { name: "Approve & start", exact: true }).count(), 0);
  const destinationPolicy = await api(`/api/plugins/bundled?${new URLSearchParams({ cwd: project, sessionId: allowed.sessionId })}`);
  assert.equal(destinationPolicy.plugins.find((plugin) => plugin.manifest.id === "session-launch").settings.effective.launch, "ask");
  await patch({ launch: "ask" }, "project", [], destination);
  await post(`/api/agent/${allowed.sessionId}`, { type: "abort" });
  await patch({}, "session", ["launch"]);
  console.log(`PASS: ${width}px session launch settings, exact Ask, feedback/reject, Allow, durable links/reload and independent child input`);
}
