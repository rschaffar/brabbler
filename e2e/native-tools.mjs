import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MODEL_SPEED_IDS } from "./model-speed.mjs";
import { waitForAsyncCondition } from "./async-condition.mjs";

const PROVIDER = "e2e-native-tools";
const selection = { version: 1, codeMode: true, mcpServers: [{ scope: "global", name: "selected" }] };
const off = { version: 1, codeMode: false, mcpServers: [] };
export function seedNativeToolsFixtures({ root, agentDir, project, env, writeSession, message, timestamp }) {
  const starts = join(agentDir, "native-starts.jsonl"), forbidden = join(agentDir, "native-unselected"), release = join(agentDir, "native-release");
  const program = join(agentDir, "native-stdio.mjs");
  writeFileSync(program, `import {createInterface} from "node:readline";
import {appendFileSync,existsSync} from "node:fs";
appendFileSync(process.argv[2],JSON.stringify({pid:process.pid,explicit:process.env.EXPLICIT,ambient:Object.hasOwn(process.env,"UNDECLARED_NATIVE_FIXTURE")})+"\\n");
const input=createInterface({input:process.stdin});input.on("close",()=>process.exit(0));
input.on("line",async line=>{const request=JSON.parse(line);if(request.id===undefined)return;
let result={};if(request.method==="initialize")result={protocolVersion:"2025-11-25",capabilities:{tools:{}},serverInfo:{name:"synthetic-native",version:"1"}};
if(request.method==="tools/list")result={tools:[{name:"echo",description:"Synthetic echo",inputSchema:{type:"object",properties:{value:{type:"string"}},required:["value"]}}]};
if(request.method==="tools/call"){while(!existsSync(process.argv[3]))await new Promise(resolve=>setTimeout(resolve,25));result={content:[{type:"text",text:request.params.arguments.value}]};}
process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:request.id,result})+"\\n");});`);
  env.DECLARED_NATIVE_FIXTURE = "synthetic-explicit"; env.UNDECLARED_NATIVE_FIXTURE = "synthetic-not-inherited";
  writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: {
    selected: { command: process.execPath, args: [program, starts, release], env: { EXPLICIT: "${DECLARED_NATIVE_FIXTURE}" }, exposure: "deferred", timeout: 10 },
    unselected: { command: process.execPath, args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(forbidden)},'must not run')`] },
    oauth: { url: "https://synthetic.invalid/mcp", oauth: { clientId: "synthetic" } },
  } }));
  const script = 'let denied=false;try{await tools.write({path:"native-not-admitted.txt",content:"must not appear"})}catch{denied=true}if(!denied)throw new Error("write escaped readonly preset");const echo=await tools.mcp__selected__echo({value:"NATIVE_BROWSER_ECHO"});try{await tools.read({path:"missing-native-file.txt"})}catch{}return {echo:echo.content[0].text,file:await tools.read({path:"native-fixture.txt"})}';
  writeFileSync(join(project, "native-fixture.txt"), "NATIVE_BROWSER_FILE\n");
  writeFileSync(join(agentDir, "extensions/e2e-native-tools.js"), `import {fauxProvider,fauxAssistantMessage,fauxToolCall} from ${JSON.stringify(join(root, "node_modules/@earendil-works/pi-ai/dist/providers/faux.js"))};
export default function(pi){const faux=fauxProvider({provider:${JSON.stringify(PROVIDER)},api:${JSON.stringify(PROVIDER)}});pi.registerProvider(faux.provider);
pi.on("before_agent_start",(event,ctx)=>{if(ctx.model?.provider!==${JSON.stringify(PROVIDER)})return;
const busy=event.prompt.includes("native busy sentinel");
faux.setResponses([fauxAssistantMessage([fauxToolCall(busy?"ask_user":"codemode",busy?{question:"Native unrelated session busy",options:[],allowFreeform:true}:{code:${JSON.stringify(script)}},{id:"native-"+ctx.sessionManager.getSessionId()+"-"+Date.now()})],{stopReason:"toolUse"}),fauxAssistantMessage(busy?"Unrelated native fixture settled":"Native browser completed")]);});}`);
  const settingsPath = join(agentDir, "settings.json"), settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  settings.enabledModels.push(`${PROVIDER}/**`); writeFileSync(settingsPath, JSON.stringify(settings));
  for (const [index, id] of MODEL_SPEED_IDS.slice(0, 2).entries()) writeSession(id, [
    { type: "model_change", id: "native-model", parentId: null, timestamp, provider: PROVIDER, modelId: "faux-1" },
    { type: "custom", id: "native-tools", parentId: "native-model", timestamp, customType: "pi-web:tool-selection", data: { version: 1, tools: ["read", "grep", "find", "ls"] } },
    { type: "session_info", id: "native-title", parentId: "native-tools", timestamp, name: `Native tools fixture ${index + 1}` },
    message("native-user", "native-title", "user", [{ type: "text", text: `Native fixture ${index + 1}` }]),
    message("native-answer", "native-user", "assistant", [{ type: "text", text: "Native engines initially off." }]),
  ], project);
  return { starts, forbidden, release, deniedWrite: join(project, "native-not-admitted.txt") };
}
const records = path => existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
async function idle(id) {
  const response = await fetch(`/api/agent/${encodeURIComponent(id)}`); if (!response.ok) throw new Error(`Native state HTTP ${response.status}`);
  const data = await response.json(); return data.running && !data.state.isStreaming && !data.state.isPromptRunning;
}
export async function checkNativeTools(page, { base, api, post, fixture, artifacts, width }) {
  const id = MODEL_SPEED_IDS[width > 600 ? 0 : 1], other = MODEL_SPEED_IDS[width > 600 ? 1 : 0];
  const before = records(fixture.starts).length;
  const beforeMessages = (await api(`/api/sessions/${id}`)).stats.userMessages;
  if (existsSync(fixture.release)) rmSync(fixture.release);
  await page.goto(`${base}/?session=${id}`, { waitUntil: "domcontentloaded" });
  const input = page.locator("textarea").last(); await input.waitFor(); await input.fill("Unsent native draft");
  const button = page.getByRole("button", { name: "Session tools", exact: true });
  if (!await button.isVisible()) await page.getByRole("button", { name: "More controls", exact: true }).click();
  const showCard = async () => {
    const card = page.locator("[data-tool-call-id]").filter({ has: page.getByRole("button", { name: /^codemode/ }) }).last();
    // Completed process groups intentionally collapse when the final answer arrives.
    if (!await card.isVisible()) await page.getByRole("button", { name: /^Process details/ }).last().click();
    const header = card.getByRole("button", { name: /^codemode/ });
    if (await header.getAttribute("aria-expanded") !== "true") await header.click();
    return card;
  };
  const show = async (allowBusy = false) => {
    if (!await button.isVisible()) await page.getByRole("button", { name: "More controls", exact: true }).click();
    await button.click(); const dialog = page.getByRole("dialog", { name: "Session tools", exact: true });
    await dialog.getByRole("checkbox", { name: "Code-mode", exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Apply", exact: true }).waitFor();
    await dialog.getByText("oauth", { exact: true }).waitFor();
    if (!allowBusy) await page.waitForFunction(() => !document.querySelector('dialog[open] fieldset')?.disabled);
    return dialog;
  };
  let dialog = await show();
  assert.equal(await dialog.getByRole("checkbox", { name: "Code-mode", exact: true }).isChecked(), false);
  assert.equal(records(fixture.starts).length, before, "opening metadata never connects a configured server");
  const row = name => dialog.locator("label").filter({ has: page.getByText(name, { exact: true }) });
  assert.equal(await row("oauth").getByRole("checkbox").isDisabled(), true);
  await dialog.getByRole("checkbox", { name: "Code-mode", exact: true }).check(); await row("selected").getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
  assert.equal(await input.inputValue(), "Unsent native draft");
  const saved = await api(`/api/sessions/${id}`); assert.deepEqual(saved.nativeResources, selection);
  assert.equal(saved.stats.userMessages, beforeMessages, "apply creates no prompt, including after the other viewport's busy-session chain");
  dialog = await show();
  await dialog.getByRole("button", { name: "Refresh status", exact: true }).click();
  await waitForAsyncCondition(page, async id => {
    const response = await fetch(`/api/agent/${id}`); if (!response.ok) throw new Error("Native status failed");
    return (await response.json()).state?.mcpServers?.[0]?.state === "connected";
  }, id);
  await dialog.getByRole("button", { name: "Refresh status", exact: true }).click();
  await row("selected").getByText(/Connected/).waitFor();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(records(fixture.starts).length, before + 1); assert.equal(existsSync(fixture.forbidden), false);
  const observed = records(fixture.starts).at(-1); assert.equal(observed.explicit, "synthetic-explicit"); assert.equal(observed.ambient, false);

  await input.fill("Exercise native tools"); await page.getByRole("button", { name: "Send", exact: true }).click();
  const card = page.locator("[data-tool-call-id]").filter({ has: page.getByRole("button", { name: /^codemode/ }) }).last();
  await card.getByRole("button", { name: /^codemode/ }).click();
  const nested = card.getByRole("region", { name: "Nested calls", exact: true }); await nested.waitFor();
  await nested.locator('[data-native-call-status="running"]').waitFor();
  dialog = await show(true); assert.equal(await dialog.getByRole("button", { name: "Apply", exact: true }).isDisabled(), true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  writeFileSync(fixture.release, "release synthetic MCP");
  await page.getByText("Native browser completed", { exact: true }).waitFor(); await waitForAsyncCondition(page, idle, id);
  await showCard();
  await nested.locator('[data-native-call-status="error"]').waitFor();
  assert.ok((await card.innerText()).includes("Script completed"), "a caught child error does not fail the parent");
  assert.ok((await card.innerText()).includes("NATIVE_BROWSER_ECHO")); assert.ok((await card.innerText()).includes("NATIVE_BROWSER_FILE"));
  assert.equal(existsSync(fixture.deniedWrite), false, "Code-mode cannot widen the selected built-in preset");
  await page.reload({ waitUntil: "domcontentloaded" }); await page.locator("textarea").last().waitFor();
  const restored = await showCard();
  await restored.getByRole("region", { name: "Nested calls", exact: true }).getByText("Failed", { exact: true }).waitFor();

  // Another real SDK session waits for user input; this idle session can still apply.
  await post(`/api/agent/${other}`, { type: "prompt", message: "native busy sentinel" });
  await waitForAsyncCondition(page, async other => (await (await fetch(`/api/agent/${other}`)).json()).state?.isStreaming === true, other);
  dialog = await show(); await dialog.getByRole("checkbox", { name: "Code-mode", exact: true }).uncheck(); await row("selected").getByRole("checkbox").uncheck();
  const routePattern = `**/api/agent/${id}`; let dispatched = 0;
  const ambiguous = async route => {
    if (route.request().method() !== "POST" || route.request().postDataJSON()?.type !== "set_native_resources") return route.continue();
    dispatched++; const response = await route.fetch(); assert.equal(response.status(), 200);
    await route.fulfill({ status: 200, json: { success: false, error: "Synthetic acknowledgement unavailable" } });
  };
  await page.route(routePattern, ambiguous);
  try {
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await dialog.getByText("Synthetic acknowledgement unavailable", { exact: true }).waitFor();
    assert.equal(dispatched, 1); assert.equal(await dialog.getByRole("button", { name: "Apply", exact: true }).isDisabled(), true);
    await dialog.getByRole("button", { name: "Refresh status", exact: true }).click();
    await dialog.getByText(/The change could not be confirmed/).waitFor({ state: "hidden" });
    await page.waitForFunction(() => !document.querySelector('dialog[open] fieldset')?.disabled);
    assert.equal(await dialog.getByRole("checkbox", { name: "Code-mode", exact: true }).isChecked(), false);
    assert.deepEqual((await api(`/api/sessions/${id}`)).nativeResources, off);
    assert.equal((await api(`/api/agent/${other}`)).state.isStreaming, true, "unrelated busy runtime was not waited on or stopped");
  } finally { await page.unroute(routePattern, ambiguous); await post(`/api/agent/${other}`, { type: "abort" }); }
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.throws(() => process.kill(observed.pid, 0), { code: "ESRCH" });
  await page.screenshot({ path: join(artifacts, `native-tools-${width}.png`) });
}
