import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  // Genuine installed-package requests: settings reuse registrations and skill
  // reads/content do not execute factories. No provider calls or mocked routes.
  const urls = ["/api/auth/providers", `/api/models/enabled?cwd=${encodeURIComponent(fixture.project)}`,
    `/api/skills?cwd=${encodeURIComponent(fixture.project)}`,
    `/api/skills/content?${new URLSearchParams({ cwd: fixture.project, filePath: fixture.skillPath })}`];
  const readListings = () => Promise.all(urls.map(async (url) => {
    const response = await fetch(`${base}${url}`);
    assert.equal(response.status, 200, url);
    return response.json();
  }));
  const first = await readListings();
  const before = readFileSync(fixture.factoryLog, "utf8");
  const second = await readListings();
  assert.deepEqual(second, first, "unchanged concurrent listings retain their payloads");
  assert.equal(readFileSync(fixture.factoryLog, "utf8"), before, "repeated listings never execute extension factories");
  await page.keyboard.press("Escape");
  console.log(`PASS: ${page.viewportSize().width}px loaded-skill instructions, keyboard/nested/heading/footnote navigation and no new file roots`);
}

export async function checkBlockedPreferences(page, base, sessionId) {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    const blocked = new Set(["pi-sound-enabled", "pi-thinking-expanded"]);
    Storage.prototype.getItem = function(key) { if (blocked.has(key)) throw new DOMException("Storage blocked", "SecurityError"); return get.call(this, key); };
    Storage.prototype.setItem = function(key, value) { if (blocked.has(key)) throw new DOMException("Storage blocked", "SecurityError"); return set.call(this, key, value); };
  });
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  await page.getByText("E2E final answer", { exact: true }).waitFor();
  const disable = page.getByRole("button", { name: "Disable completion sound", exact: true });
  if (!await disable.isVisible()) await page.getByRole("button", { name: "More controls", exact: true }).click();
  await disable.click();
  await page.getByRole("button", { name: "Enable completion sound", exact: true }).click();
  const collapse = page.getByRole("button", { name: "Collapse controls", exact: true });
  if (await collapse.isVisible()) await collapse.click();
  await openSettings(page, "General");
  const thinking = page.getByRole("switch", { name: "Expand thinking blocks by default", exact: true });
  assert.equal(await thinking.getAttribute("aria-checked"), "false");
  await thinking.click();
  assert.equal(await thinking.getAttribute("aria-checked"), "true");
  await page.keyboard.press("Escape");
  if (page.viewportSize().width < 768) await page.locator(`#session-sidebar [data-session-id="${sessionId}"]`).click();
  await page.getByRole("button", { name: /^Process details/ }).click();
  await page.getByText("Final thinking details.", { exact: false }).waitFor();
  console.log(`PASS: ${page.viewportSize().width}px completion sound and thinking defaults remain usable with blocked preference storage`);
}

export async function checkModelOverrides(page, base) {
  await openSettings(page, "Models");
  await page.getByText("e2e-followups", { exact: true }).click();
  await page.getByText("adaptive-fixture", { exact: true }).click();
  await page.getByRole("button", { name: /Advanced settings/ }).click();
  const field = label => page.locator(".config-field").filter({ has: page.getByText(label, { exact: true }) });
  const endpoint = field("Base URL override").getByRole("textbox");
  const adaptive = page.getByRole("checkbox", { name: "Claude adaptive thinking", exact: true });
  assert.equal(await adaptive.isChecked(), true, "inherit provider true");
  await adaptive.uncheck();
  await endpoint.fill("http://127.0.0.1:9/model-override");
  const save = async () => {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/models-config" && r.request().method() === "PUT");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    assert.equal((await response).status(), 200);
    return (await (await fetch(`${base}/api/models-config`)).json()).providers["e2e-followups"];
  };
  let saved = await save();
  assert.equal(saved.models[0].baseUrl, "http://127.0.0.1:9/model-override");
  assert.equal(saved.models[0].compat.forceAdaptiveThinking, false);
  assert.equal(saved.models[0].reasoning, true);
  assert.equal(saved.compat.forceAdaptiveThinking, true);
  assert.equal(saved.models[1].baseUrl, undefined);
  await endpoint.fill("");
  await adaptive.check();
  saved = await save();
  assert.equal(saved.models[0].baseUrl, undefined);
  assert.equal(saved.models[0].compat?.forceAdaptiveThinking, undefined);
  const api = field("API override").getByRole("combobox");
  await api.selectOption("openai-completions");
  assert.equal(await adaptive.count(), 0, "unsupported APIs do not offer adaptive thinking");
  await api.selectOption("");
  await adaptive.waitFor();
  // A synthetic browser response, never a provider request: prove stale test
  // success cannot attach to an edited endpoint or a different model.
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const seen = new Promise(resolve => { started = resolve; });
  const route = async handler => { started(); await gate; await handler.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, responseText: "STALE_CONNECTION_SENTINEL" }) }); };
  await page.route("**/api/models-config/test", route);
  try {
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await seen;
    await endpoint.fill("http://127.0.0.1:9/changed-after-test");
    const done = page.waitForResponse(r => new URL(r.url()).pathname === "/api/models-config/test");
    release();
    await (await done).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByText(/STALE_CONNECTION_SENTINEL/).count(), 0);
  } finally { release(); await page.unroute("**/api/models-config/test", route); }
  await page.keyboard.press("Escape");
  console.log(`PASS: ${page.viewportSize().width}px model endpoint/adaptive inheritance, real save/read, sibling isolation and stale-test refusal`);
}
