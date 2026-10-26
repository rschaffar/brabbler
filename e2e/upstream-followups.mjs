import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkInstalledModelContext } from "./model-context-bridge.mjs";

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
  await openSettings(page, "Skills");
  await page.getByRole("button", { name: "followup-instructions", exact: true }).click();
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
