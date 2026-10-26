// Managed process-wide SSH, real Chromium/SDK/OpenSSH only.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { applyFixtureEnvironment, createHarness } from "./harness.mjs";
import { browserInputs, createCoverage } from "./scenarios.mjs";
import { waitForAsyncCondition } from "./async-condition.mjs";
import { sidebarReady } from "./sidebar-readiness.mjs";
import { observeSshCeremonies, seedSshRuntimeFixtures, SSH_PROVIDER, waitForSshReport } from "./ssh-runtime-fixtures.mjs";

const capture = (page, action) => page.waitForResponse(response =>
  new URL(response.url()).pathname === "/api/ssh-agent" && response.request().method() === "POST" && response.request().postDataJSON()?.action === action
).then(async response => { assert.equal(response.status(), 200, await response.text()); return response.json(); });
const ceremonies = page => page.evaluate(() => window.__sshCeremonies);
const cards = page => page.getByRole("complementary", { name: "SSH signature requests", exact: true });
const requestCard = page => cards(page).getByRole("region", { name: "SSH signature requested", exact: true });

async function openSettings(page) {
  await page.bringToFront();
  const sidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await sidebar.isVisible()) await sidebar.click();
  await page.waitForFunction(sidebarReady);
  await page.getByRole("button", { name: "SSH", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("region", { name: "SSH agent selection", exact: true }).waitFor();
  return dialog;
}
async function closeSettings(page, dialog) {
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const backdrop = page.locator(".sidebar-overlay-backdrop");
  // Global cards intentionally sit above ordinary overlays in the upper 40dvh.
  // Close the drawer through its unobscured lower edge, never force a covered click.
  if (await backdrop.isVisible()) await backdrop.click({ position: { x: page.viewportSize().width - 10, y: page.viewportSize().height - 20 } });
}
async function checkClosedDiscovery(page) {
  // Delay the next actual successful status JSON read, not a fabricated response.
  // Gating after native parsing also covers the resolved-read/aborted-signal race:
  // even an already-aborted discover fetch invocation must never be attempted.
  await page.waitForFunction(() => document.querySelector(".ssh-sidebar-status")?.title.includes("No agent"));
  const fetchStart = await page.evaluate(() => {
    window.__sshStatusHeld = false; window.__sshStatusReadReleased = false;
    window.__sshHoldNextStatusRead = true; return window.__sshFetches.length;
  });
  let discovers = 0;
  const observe = req => {
    if (new URL(req.url()).pathname === "/api/ssh-agent" && req.method() === "POST" && req.postDataJSON()?.action === "discover") discovers++;
  };
  page.on("request", observe);
  try {
    const dialog = await openSettings(page);
    await page.waitForFunction(() => window.__sshStatusHeld === true);
    await closeSettings(page, dialog);
    await page.waitForFunction(start => window.__sshFetches.slice(start).some(item => item.action === "status" && item.aborted && item.reason === "settings-closed"), fetchStart);
    await page.evaluate(() => window.__sshReleaseStatusRead());
    await page.waitForFunction(() => window.__sshStatusReadReleased === true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(discovers, 0, "closed Settings must not dispatch discover after a delayed actual status read");
    assert.equal(await page.evaluate(start => window.__sshFetches.slice(start).filter(item => item.action === "discover").length, fetchStart), 0, "even an already-aborted discover fetch invocation is forbidden");
  } finally {
    await page.evaluate(() => { window.__sshHoldNextStatusRead = false; window.__sshReleaseStatusRead?.(); });
    page.off("request", observe);
  }
}
async function useBackend(page, dialog, type, status) {
  await dialog.getByLabel("Choose agent (draft)", { exact: true }).selectOption(type);
  // A dropdown edit alone cannot change routing or revisions.
  const before = await status();
  const changed = capture(page, "use");
  await dialog.getByRole("button", { name: "Use agent", exact: true }).click();
  const after = await changed;
  assert.equal(after.runtime.selected.type, type);
  assert.equal(after.runtime.socketPath, before.runtime.socketPath);
  return after;
}
async function enroll(page, dialog, name, policy, status) {
  const before = await ceremonies(page);
  const details = dialog.locator("details").filter({ has: page.locator("summary", { hasText: /^Enroll security key$/ }) });
  await details.locator("summary").click();
  await details.getByLabel("Key name", { exact: true }).fill(name);
  assert.equal(await details.getByLabel("Verification policy", { exact: true }).inputValue(), "strict");
  if (policy === "session") await details.getByLabel("Verification policy", { exact: true }).selectOption("session");
  // Virtual Chromium does not attest physical protection. Never silently accept
  // unreported credProtect; this is the explicit application-only GUI opt-in.
  await details.getByRole("checkbox", { name: "Explicitly allow application-only enforcement if requested credential protection is not reported", exact: true }).check();
  const begin = capture(page, "begin-enroll"), prepared = capture(page, "prepare-enroll"), finished = capture(page, "finish-enroll");
  await details.getByRole("button", { name: "Enroll security key", exact: true }).click();
  const [creation, proof] = await Promise.all([begin, prepared, finished]).then(([a, b]) => [a, b]);
  await dialog.getByRole("region", { name: "Registered keys", exact: true }).getByText(name, { exact: true }).waitFor();
  const calls = (await ceremonies(page)).slice(before.length);
  assert.deepEqual(calls.map(item => [item.method, item.uv, item.completed]), [["create", "required", true], ["get", "required", true]]);
  assert.equal(calls[0].challenge, creation.challenge);
  assert.equal(calls[1].challenge, proof.challenge);
  assert.notEqual(proof.challenge, creation.challenge, "creation cannot stand in for fresh possession proof");
  assert.equal(Buffer.from(proof.challenge, "base64url").length, 32);
  const key = (await status()).registry.keys.find(item => item.name === name);
  assert.ok(key); assert.equal(key.policy, policy); assert.equal(key.applicationOnly, true);
  assert.match(key.publicKey, /^sk-ecdsa-sha2-nistp256@openssh.com /);
  // Actual public-key details, not an obsolete session/export text field.
  const row = dialog.getByRole("region", { name: "Registered keys", exact: true }).locator("div").filter({ has: page.locator("strong", { hasText: name }) }).filter({ has: page.locator("summary", { hasText: /^Key details$/ }) }).last();
  await row.locator("summary", { hasText: /^Key details$/ }).click();
  assert.equal(await row.getByLabel("SSH public key", { exact: true }).inputValue(), key.publicKey);
  await details.locator("summary").click();
  return key;
}
async function connect(page, dialog, key, device, unlock = false) {
  const before = (await ceremonies(page)).length;
  await dialog.getByLabel("Registered key", { exact: true }).selectOption(key.id);
  await dialog.getByLabel("Device name", { exact: true }).fill(device);
  if (key.policy === "session") await dialog.getByRole("checkbox", { name: "Also start a 30-minute application unlock after verification", exact: true }).setChecked(unlock);
  const begun = capture(page, "connect"), activated = capture(page, "activate");
  await dialog.getByRole("button", { name: "Connect and make this browser active", exact: true }).click();
  const proof = await begun, result = await activated;
  const calls = (await ceremonies(page)).slice(before);
  assert.deepEqual(calls.map(item => [item.method, item.uv, item.challenge, item.completed]), [["get", "required", proof.challenge, true]]);
  assert.equal(result.connection.role, "active");
  assert.equal(result.connection.state, key.policy === "strict" ? "strict" : unlock ? "unlocked" : "locked");
  return { ...proof, ...result.connection };
}
async function disconnect(page, dialog) {
  const done = capture(page, "disconnect");
  await dialog.getByRole("button", { name: "Disconnect / cancel", exact: true }).click();
  await done;
  await dialog.getByRole("button", { name: "Connect and make this browser active", exact: true }).waitFor();
}
async function review(page, unlock = false) {
  await page.bringToFront();
  const card = requestCard(page); await card.waitFor();
  assert.equal(await card.getByRole("button", { name: unlock ? "Unlock and approve" : "Approve with security key", exact: true }).count(), 0, "explicit review precedes approval");
  await card.getByRole("button", { name: "Review", exact: true }).click();
  await card.getByRole("button", { name: unlock ? "Unlock and approve" : "Approve with security key", exact: true }).waitFor();
  return card;
}

export async function runBrowserSshSuite() {
  const root = process.env.E2E_PACKAGE_ROOT; assert.match(root ?? "", /^\/nix\/store\//);
  const harness = createHarness(root, "browser");
  const { env, agentDir, fixtureRoot, artifacts } = harness;
  const coverage = createCoverage("ssh-agent", artifacts);
  env.PI_WEB_PASSWORD = "synthetic-browser-ssh-password";
  applyFixtureEnvironment(env);
  const project = join(fixtureRoot, "project"); mkdirSync(project);
  const fixtures = seedSshRuntimeFixtures({ root, agentDir, project });
  const sessionRoot = join(agentDir, "sessions", "ssh-test"); mkdirSync(sessionRoot, { recursive: true });
  const timestamp = "2026-10-21T00:00:00.000Z";
  for (const id of ["ssh-desktop", "ssh-mobile"]) writeFileSync(join(sessionRoot, `${id}.jsonl`), [
    { type: "session", version: 3, id, timestamp, cwd: project },
    { type: "model_change", id: "model", parentId: null, timestamp, provider: SSH_PROVIDER, modelId: "faux-1" },
    { type: "custom", id: "tools", parentId: "model", timestamp, customType: "pi-web:tool-selection", data: { version: 1, tools: ["bash"] } },
    { type: "session_info", id: "name", parentId: "tools", timestamp, name: id },
    { type: "message", id: "prompt", parentId: "name", timestamp, message: { role: "user", content: "Synthetic SSH fixture" } },
  ].map(entry => JSON.stringify(entry)).join("\n") + "\n");
  // Helper descendants remain service-owned and are drained by harness shutdown.
  // Only the fixture helper may signal its exact owned signing child.
  const terminals = new Set();
  try {
    const server = await harness.startService();
    const base = harness.baseURL, uiBase = `http://localhost:${new URL(base).port}`;
    const deadline = performance.now() + 120_000;
    for (;;) {
      await server.check();
      const response = await fetch(`${base}/api/web-auth`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (response?.ok) break;
      assert.ok(performance.now() < deadline, "SSH test service readiness"); await delay(250);
    }
    const browser = await harness.launchBrowser(chromium, { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
    const login = async (inputId, sessionId, credentials = []) => {
      const context = await harness.newContext(browser, browserInputs[inputId].options, uiBase);
      await context.addInitScript(observeSshCeremonies);
      // Retain the old desktop/mobile wall-clock skew variants. UI deadlines
      // must derive from server remainingMs + performance.now(), never Date.now().
      await context.addInitScript(skew => { const now = Date.now.bind(Date); Date.now = () => now() + skew; }, inputId === "en-desktop" ? 120_000 : -120_000);
      const page = await context.newPage(); page.setDefaultTimeout(30_000);
      const cdp = await context.newCDPSession(page); await cdp.send("WebAuthn.enable");
      const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "usb", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
      // Only virtual credential material moves between two owned synthetic devices.
      for (const credential of credentials) await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
      await page.goto(`${uiBase}/login?next=${encodeURIComponent(`/?session=${sessionId}`)}`);
      await page.getByLabel("Password", { exact: true }).fill(env.PI_WEB_PASSWORD);
      await page.locator('button[type="submit"]').click();
      await page.getByText("Synthetic SSH fixture", { exact: true }).waitFor();
      const cookie = (await context.cookies(uiBase)).map(item => `${item.name}=${item.value}`).join("; ");
      const raw = (path, body, extra = {}) => fetch(`${uiBase}${path}`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: uiBase, Cookie: cookie, Connection: "close", ...extra }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
      });
      const api = async (path, body) => {
        const response = await raw(path, body), text = await response.text();
        assert.equal(response.status, 200, text);
        const result = JSON.parse(text);
        assert.notEqual(result.success, false, text);
        return result;
      };
      const ssh = body => api("/api/ssh-agent", body), status = () => ssh({ action: "status" });
      return { context, page, cdp, authenticatorId, cookie, raw, api, ssh, status };
    };
    let stableSocket;
    for (const inputId of ["en-desktop", "en-mobile-tall"]) await coverage.run(`ssh-agent/${inputId === "en-desktop" ? "native-consumers" : "compact-native"}@${inputId}`, async () => {
      const sessionId = inputId === "en-desktop" ? "ssh-desktop" : "ssh-mobile";
      const a = await login(inputId, sessionId), { page, status, ssh, api, cdp, authenticatorId } = a;
      const errors = harness.errorsFor(a.context);
      const initial = await status();
      assert.equal(initial.runtime.selected.type, "none"); assert.equal(initial.activeId, null);
      stableSocket ??= initial.runtime.socketPath;
      assert.equal(initial.runtime.socketPath, stableSocket); assert.ok(existsSync(stableSocket));
      if (inputId === "en-desktop") assert.equal(initial.runtime.setupNeeded, true);
      assert.equal((await ceremonies(page)).length, 0, "startup performs no enrollment/connect ceremony");
      const consumerEvidence = [];
      const agentPath = `/api/agent/${sessionId}`;
      await api(agentPath, { type: "get_state" }); // Await actual startup/resource binding.
      const start = async (job, transport = "sdk") => {
        // Long Shell requests are observed from creation so rejection is never unhandled.
        let completion = Promise.resolve({ success: true });
        if (transport === "sdk") completion = api(agentPath, { type: "prompt", message: JSON.stringify({ id: job.id, command: job.command }) });
        if (transport === "shell") completion = api(agentPath, { type: "bash", command: job.command, excludeFromContext: true });
        if (transport === "pty") {
          const sidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
          if (await sidebar.isVisible()) await sidebar.click();
          await page.waitForFunction(sidebarReady);
          const created = page.waitForResponse(response => new URL(response.url()).pathname === "/api/terminal" && response.request().method() === "POST");
          await page.getByRole("button", { name: "Open workspace terminal", exact: true }).click();
          const response = await created; assert.equal(response.status(), 200, await response.text());
          const { id } = await response.json(); terminals.add(id); job.terminalId = id;
          await page.locator(".terminal-panel:visible .terminal-status-dot.is-ready").waitFor();
          if (page.viewportSize().width > 640) await page.locator("#file-panel .file-panel-expand-button").click();
          await page.waitForFunction(() => {
            const panel = document.getElementById("file-panel"), rect = panel.getBoundingClientRect();
            return !panel.getAnimations().some(item => item.pending || item.playState === "running") && rect.left >= -1 && rect.width >= innerWidth - 1;
          });
          job.terminalInput = page.locator(".terminal-panel:visible .xterm-helper-textarea");
          await job.terminalInput.focus(); await page.keyboard.type(job.command); await page.keyboard.press("Enter");
        }
        job.completion = completion.then(value => ({ value }), error => ({ error }));
        return job;
      };
      const finish = async (job, signed = true) => {
        const report = await waitForSshReport(job.report);
        if (job.operation === "sign") {
          const started = await waitForSshReport(job.started);
          assert.equal(started.socket, stableSocket);
          assert.equal(started.passwordPresent, false, "project commands do not inherit web login password");
          assert.equal(started.controlPresent, false, "SDK Bash, Shell and PTY inherit only the public socket, not private control metadata");
        }
        consumerEvidence.push({ id: job.id, operation: job.operation, report });
        const completed = await job.completion; assert.equal(completed.error, undefined, String(completed.error));
        assert.equal(report.socket, stableSocket, "SDK Bash/Shell/PTY helper child inherited launcher socket without injection");
        if (signed) {
          assert.equal(report.code, 0, report.stderr); assert.equal(report.verified?.code, 0, report.verified?.stderr);
          assert.match(report.verified.stdout, /Good "git" signature/);
        } else assert.notEqual(report.code, 0, report.stderr);
        if (job.terminalId) {
          // UI closure owns its real PTY; do not leave a stale restored tab.
          const deleted = page.waitForResponse(response => new URL(response.url()).pathname === `/api/terminal/${job.terminalId}` && response.request().method() === "DELETE");
          if (page.viewportSize().width > 640) await page.locator("#file-panel .file-panel-expand-button").click();
          await page.getByRole("button", { name: "Terminate terminal project", exact: true }).click();
          assert.equal((await deleted).status(), 200); terminals.delete(job.terminalId);
          await page.locator(".terminal-panel").waitFor({ state: "detached" });
        } else await waitForAsyncCondition(page, async id => {
          const response = await fetch(`/api/agent/${id}`); if (!response.ok) throw new Error(`SSH SDK idle HTTP ${response.status}`);
          const data = await response.json(); return data.running && !data.state.isStreaming && !data.state.isPromptRunning && !data.state.isBashRunning;
        }, sessionId);
        return report;
      };
      // Conditional compact replacement: fresh real authority, not desktop
      // credential/result reuse. Keep one contextual Shell request for composer
      // focus and one real PTY request for top-layer/tap/focus/clock-skew. The
      // complete SDK Bash/Shell/security/recovery matrix remains desktop once.
      if (inputId === "en-mobile-tall") {
        let dialog = await openSettings(page);
        await useBackend(page, dialog, "browser", status);
        const key = await enroll(page, dialog, `${sessionId} session`, "session", status);
        const own = await connect(page, dialog, key, `${sessionId} compact device`);
        await closeSettings(page, dialog);
        const composer = page.locator("textarea").last();
        await composer.fill("Unsent SSH focus sentinel"); await composer.focus();
        const locked = await start(fixtures.job(`${sessionId}-compact-unlock`, key), "shell");
        await requestCard(page).waitFor();
        assert.equal(await composer.evaluate(node => node === document.activeElement), true);
        assert.equal(await composer.inputValue(), "Unsent SSH focus sentinel");
        assert.equal(await cards(page).evaluate(node => node.closest("dialog") === null && node.getAttribute("aria-modal") !== "true"), true);
        const original = (await ssh({ action: "poll", token: own.token })).requests[0];
        assert.equal(original.unlock, true);
        const beforeUnlock = (await ceremonies(page)).length;
        const unlockCard = requestCard(page);
        await unlockCard.getByRole("button", { name: "Review", exact: true }).tap();
        const begun = capture(page, "begin-request-unlock"), unlocked = capture(page, "finish-request-unlock");
        await unlockCard.getByRole("button", { name: "Unlock and approve", exact: true }).tap();
        const proof = await begun, result = await unlocked;
        await finish(locked);
        const calls = (await ceremonies(page)).slice(beforeUnlock);
        assert.deepEqual(calls.map(item => [item.method, item.uv, item.completed]), [["get", "required", true], ["get", "discouraged", true]]);
        assert.notEqual(proof.challenge, original.challenge);
        assert.equal(calls[0].challenge, proof.challenge); assert.equal(calls[1].challenge, original.challenge);
        assert.equal(result.request.id, original.id); assert.equal(result.newGrant, true);
        const grant = (await status()).connections.find(item => item.id === own.id).remainingMs;
        assert.ok(grant > 29 * 60_000 && grant <= 30 * 60_000, "negative wall-clock skew does not alter remaining lease");
        const beforeTouch = (await ceremonies(page)).length;
        const touch = await start(fixtures.job(`${sessionId}-compact-pty`, key), "pty");
        await requestCard(page).waitFor();
        assert.equal(await touch.terminalInput.evaluate(node => node === document.activeElement), true);
        assert.equal(await page.getByRole("dialog", { name: "Settings", exact: true }).isVisible(), false);
        assert.equal(await page.locator("#file-panel").evaluate(node => getComputedStyle(node).zIndex), "250");
        assert.equal(await cards(page).evaluate(node => getComputedStyle(node).zIndex), "350");
        const reviewButton = requestCard(page).getByRole("button", { name: "Review", exact: true });
        assert.equal(await reviewButton.evaluate(node => {
          const rect = node.getBoundingClientRect();
          return node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
        }), true, "native compact action is above the real terminal overlay");
        await reviewButton.tap();
        await requestCard(page).getByRole("button", { name: "Approve with security key", exact: true }).tap();
        await finish(touch);
        assert.deepEqual((await ceremonies(page)).slice(beforeTouch).map(item => [item.method, item.uv, item.completed]), [["get", "discouraged", true]]);
        assert.ok((await status()).connections.find(item => item.id === own.id).remainingMs <= grant);
        const beforeReloadCeremonies = await ceremonies(page);
        await page.reload();
        await page.getByText("Synthetic SSH fixture", { exact: true }).waitFor();
        const reloaded = await waitForAsyncCondition(page, async id => {
          const response = await fetch("/api/ssh-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status" }) });
          if (!response.ok) throw new Error(`SSH compact reload HTTP ${response.status}`);
          const snapshot = await response.json();
          return snapshot.connections.some(item => item.id === id) ? false : snapshot;
        }, own.id);
        assert.equal(reloaded.activeId, null); assert.equal(reloaded.connections.length, 0);
        assert.equal(reloaded.runtime.socketPath, stableSocket); assert.equal((await ceremonies(page)).length, 0);
        dialog = await openSettings(page);
        await dialog.getByRole("button", { name: "Connect and make this browser active", exact: true }).waitFor();
        await useBackend(page, dialog, "none", status); await closeSettings(page, dialog);
        writeFileSync(join(artifacts, `ssh-compact-${inputId}.json`), JSON.stringify({ socket: stableSocket, publicKey: key.publicKey, consumers: consumerEvidence, ceremonies: beforeReloadCeremonies, afterReloadCeremonies: await ceremonies(page) }, null, 2));
        assert.deepEqual(errors, [], `Browser SSH compact errors (${inputId})`);
        await harness.closeContext(a.context);
        return;
      }

      const empty = await start(fixtures.job(`${sessionId}-empty`, null, "list"));
      const emptyResult = await finish(empty, false); assert.equal(emptyResult.code, 1); assert.equal(emptyResult.stdout.trim(), "The agent has no identities.");
      await checkClosedDiscovery(page);
      let dialog = await openSettings(page);
      await dialog.getByLabel("Choose agent (draft)", { exact: true }).selectOption("browser");
      assert.equal((await status()).runtime.selected.type, "none", "draft selection is inert");
      await useBackend(page, dialog, "browser", status);
      const strict = await enroll(page, dialog, `${sessionId} strict`, "strict", status);
      const strictConnection = await connect(page, dialog, strict, `${sessionId} device A`);
      await closeSettings(page, dialog);
      const composer = page.locator("textarea").last(); await composer.fill("Unsent SSH focus sentinel"); await composer.focus();
      const strictJob = await start(fixtures.job(`${sessionId}-strict`, strict));
      await requestCard(page).waitFor();
      assert.equal(await page.getByRole("dialog", { name: "Settings", exact: true }).isVisible(), false);
      assert.equal(await composer.evaluate(node => document.activeElement === node), true, "global request card must not steal composer focus");
      assert.equal(await composer.inputValue(), "Unsent SSH focus sentinel");
      assert.equal(await cards(page).evaluate(node => node.closest("dialog") === null && node.getAttribute("aria-modal") !== "true"), true);
      const strictBefore = (await ceremonies(page)).length;
      await (await review(page)).getByRole("button", { name: "Approve with security key", exact: true }).click();
      await finish(strictJob);
      assert.deepEqual((await ceremonies(page)).slice(strictBefore).map(item => [item.method, item.uv, item.completed]), [["get", "required", true]]);
      assert.equal((await status()).connections.find(item => item.id === strictConnection.id).remainingMs, 0, "raw strict assertion never creates a grant");
      await requestCard(page).waitFor({ state: "detached" });

      // Deny without review performs zero native ceremonies (real SDK Shell helper).
      const denyBefore = (await ceremonies(page)).length;
      const denied = await start(fixtures.job(`${sessionId}-deny`, strict), "shell");
      await requestCard(page).getByRole("button", { name: "Deny", exact: true }).click();
      await finish(denied, false); assert.equal((await ceremonies(page)).length, denyBefore);
      await requestCard(page).waitFor({ state: "detached" });

      // Cancel actual pending Chromium prompts, first via GUI and then by closing
      // only this job's native SSH client. Neither path may retry or respond late.
      for (const clientClose of [false, true]) {
        await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: false });
        const before = (await ceremonies(page)).length;
        const job = await start(fixtures.job(`${sessionId}-cancel-${clientClose}`, strict), "shell");
        const card = await review(page);
        await card.getByRole("button", { name: "Approve with security key", exact: true }).click();
        await page.waitForFunction(n => window.__sshCeremonies.length === n + 1, before);
        const request = (await ssh({ action: "poll", token: strictConnection.token })).requests[0]; assert.ok(request);
        const responded = [];
        const observe = req => { if (new URL(req.url()).pathname === "/api/ssh-agent" && req.method() === "POST") { const body = req.postDataJSON(); if (body.action === "respond" && body.requestId === request.id) responded.push(body); } };
        page.on("request", observe);
        try {
          if (clientClose) { await waitForSshReport(job.started); writeFileSync(job.cancelFile, "cancel owned SSH child\n"); }
          else await card.getByRole("button", { name: "Cancel prompt and deny", exact: true }).click();
          const cancelled = await finish(job, false); if (clientClose) assert.equal(cancelled.signal, "SIGKILL");
          await page.waitForFunction(n => window.__sshCeremonies[n]?.aborted === true, before);
          await card.waitFor({ state: "detached" });
          // Observe the next real owned poll, not a sleep/retry of the action.
          await capture(page, "poll");
          assert.equal((await ceremonies(page)).length, before + 1);
          assert.equal(responded.some(body => body.assertion), false);
          if (!clientClose) assert.equal(responded.length, 1, "GUI cancellation denies once");
        } finally { page.off("request", observe); }
        await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: true });
      }

      // Exact raw HTTP/token/origin/IP decision rows move to the real native
      // route-actions owner, conditional on its positive + fault review gate.
      dialog = await openSettings(page); await disconnect(page, dialog);
      assert.ok(existsSync(stableSocket), "disconnect does not remove the launcher-owned front socket");

      const sessionKey = await enroll(page, dialog, `${sessionId} session`, "session", status);
      let own = await connect(page, dialog, sessionKey, `${sessionId} device A`);
      await closeSettings(page, dialog);
      const locked = await start(fixtures.job(`${sessionId}-locked`, sessionKey));
      const lockedCard = await review(page, true);
      const original = (await ssh({ action: "poll", token: own.token })).requests[0];
      assert.equal(original.unlock, true); assert.equal(original.userVerification, "required");
      const beforeUnlock = (await ceremonies(page)).length;
      const begun = capture(page, "begin-request-unlock"), unlocked = capture(page, "finish-request-unlock");
      await lockedCard.getByRole("button", { name: "Unlock and approve", exact: true }).click();
      const unlockProof = await begun, unlockResult = await unlocked;
      await finish(locked);
      const two = (await ceremonies(page)).slice(beforeUnlock);
      assert.deepEqual(two.map(item => [item.method, item.uv, item.completed]), [["get", "required", true], ["get", "discouraged", true]]);
      assert.equal(unlockProof.alreadyUnlocked, false); assert.equal(unlockProof.requestId, original.id);
      assert.equal(Buffer.from(unlockProof.challenge, "base64url").length, 32);
      assert.notEqual(unlockProof.challenge, original.challenge);
      assert.equal(two[0].challenge, unlockProof.challenge); assert.equal(two[1].challenge, original.challenge);
      assert.equal(unlockResult.request.challenge, original.challenge); assert.equal(unlockResult.request.fingerprint, original.fingerprint);
      assert.equal(unlockResult.request.description, original.description); assert.equal(unlockResult.newGrant, true);
      let grant = (await status()).connections.find(item => item.id === own.id).remainingMs;
      assert.ok(grant > 29 * 60_000 && grant <= 30 * 60_000);
      const touchBefore = (await ceremonies(page)).length;
      const touch = await start(fixtures.job(`${sessionId}-touch`, sessionKey), "pty");
      await requestCard(page).waitFor();
      assert.equal(await touch.terminalInput.evaluate(node => node === document.activeElement), true, "SSH request must not steal real terminal focus");
      assert.equal(await page.getByRole("dialog", { name: "Settings", exact: true }).isVisible(), false);
      assert.equal(await page.locator("#file-panel").evaluate(node => getComputedStyle(node).zIndex), "250");
      assert.equal(await cards(page).evaluate(node => getComputedStyle(node).zIndex), "350");
      const reviewButton = requestCard(page).getByRole("button", { name: "Review", exact: true });
      assert.equal(await reviewButton.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      }), true, "global SSH action must be hit-testable above compact/full-width terminal/file overlay");
      await (await review(page)).getByRole("button", { name: "Approve with security key", exact: true }).click();
      await finish(touch);
      assert.deepEqual((await ceremonies(page)).slice(touchBefore).map(item => [item.method, item.uv]), [["get", "discouraged"]]);
      assert.ok((await status()).connections.find(item => item.id === own.id).remainingMs <= grant, "raw touch signing cannot renew a grant");

      // Cancellation between the two real ceremonies: preserve the completed
      // application unlock, deny signing exactly once, never replay the raw proof.
      dialog = await openSettings(page);
      const relocked = capture(page, "lock");
      await dialog.getByRole("button", { name: "Lock", exact: true }).click(); await relocked;
      await closeSettings(page, dialog);
      const splitBefore = (await ceremonies(page)).length;
      const pauseSigning = async route => {
        const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
        if (body?.action !== "finish-request-unlock") return route.continue();
        const response = await route.fetch(); assert.equal(response.status(), 200);
        await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: false });
        // Same actual response/status/headers/body. Only virtual user presence
        // changes before the signing ceremony; no synthetic server authority.
        await route.fulfill({ response });
      };
      await page.route("**/api/ssh-agent", pauseSigning);
      try {
        const splitJob = await start(fixtures.job(`${sessionId}-cancel-after-unlock`, sessionKey), "shell");
        const splitCard = await review(page, true);
        const splitRequest = (await ssh({ action: "poll", token: own.token })).requests[0];
        const responses = [];
        const observe = req => {
          if (new URL(req.url()).pathname !== "/api/ssh-agent" || req.method() !== "POST") return;
          const body = req.postDataJSON();
          if (body.action === "respond" && body.requestId === splitRequest.id) responses.push(body);
        };
        page.on("request", observe);
        try {
          await splitCard.getByRole("button", { name: "Unlock and approve", exact: true }).click();
          await page.waitForFunction(n => window.__sshCeremonies.length === n + 2, splitBefore);
          await splitCard.getByRole("button", { name: "Cancel prompt and deny", exact: true }).click();
          await finish(splitJob, false);
          await page.waitForFunction(n => window.__sshCeremonies[n + 1]?.aborted === true, splitBefore);
          await capture(page, "poll");
          const splitCalls = (await ceremonies(page)).slice(splitBefore);
          assert.deepEqual(splitCalls.map(item => [item.uv, item.completed]), [["required", true], ["discouraged", false]]);
          assert.equal(responses.length, 1); assert.equal(responses[0].assertion, undefined);
          const liveGrant = (await status()).connections.find(item => item.id === own.id);
          assert.equal(liveGrant.state, "unlocked", "cancelling signing does not undo an already-completed unlock");
          assert.ok(liveGrant.remainingMs > 0 && liveGrant.remainingMs <= 30 * 60_000);
        } finally { page.off("request", observe); }
      } finally {
        await page.unroute("**/api/ssh-agent", pauseSigning);
        await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: true });
      }

      // Explicit lock, then opt-in connect grant, always with a new UV proof.
      dialog = await openSettings(page);
      const lockedStatus = capture(page, "lock"); await dialog.getByRole("button", { name: "Lock", exact: true }).click();
      assert.equal((await lockedStatus).connections.find(item => item.id === own.id).state, "locked");
      await disconnect(page, dialog);
      own = await connect(page, dialog, sessionKey, `${sessionId} device A`, true);
      grant = (await status()).connections.find(item => item.id === own.id).remainingMs;
      assert.ok(grant > 29 * 60_000 && grant <= 30 * 60_000);
      await closeSettings(page, dialog);

      // Original pending client/key/device remains pinned across explicit takeover.
      const pending = await start(fixtures.job(`${sessionId}-takeover`, sessionKey), "shell");
      await requestCard(page).waitFor();
      const pinned = (await ssh({ action: "poll", token: own.token })).requests[0];
      const virtual = (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials;
      const b = await login(inputId, sessionId, virtual);
      let bDialog = await openSettings(b.page);
      assert.equal(await bDialog.getByRole("region", { name: "Public credential recovery", exact: true }).count(), 0, "new browser discovers central keys without local metadata");
      const other = await connect(b.page, bDialog, strict, `${sessionId} device B`);
      await closeSettings(b.page, bDialog);
      const switched = await status(), standby = switched.connections.find(item => item.id === own.id);
      assert.equal(standby.role, "standby"); assert.ok(standby.remainingMs <= grant);
      assert.equal((await b.ssh({ action: "poll", token: other.token })).requests.length, 0);
      const retained = (await ssh({ action: "poll", token: own.token })).requests[0];
      assert.equal(retained.id, pinned.id); assert.equal(retained.challenge, pinned.challenge); assert.equal(retained.fingerprint, pinned.fingerprint);
      assert.equal(retained.previousSigner, true);
      await (await review(page)).getByRole("button", { name: "Approve with security key", exact: true }).click();
      await finish(pending);
      dialog = await openSettings(page);
      const selected = capture(page, "select");
      const selecting = page.waitForRequest(req => new URL(req.url()).pathname === "/api/ssh-agent" && req.method() === "POST" && req.postDataJSON()?.action === "select");
      await dialog.getByRole("button", { name: "Make this browser active", exact: true }).click();
      const selectedStatus = await selected;
      assert.equal((await selecting).postDataJSON().token, own.token);
      assert.equal(selectedStatus.activeId, own.id, "standby selection uses this page's own token");
      assert.ok(selectedStatus.connections.find(item => item.id === own.id).remainingMs <= grant, "standby selection cannot renew A's grant");
      await closeSettings(page, dialog);

      // Switch backend while reviewed request is pending. Original operation can
      // drain only at A; new identities are empty and cannot fall back to standby B.
      const draining = await start(fixtures.job(`${sessionId}-drain`, sessionKey), "shell");
      const drainCard = await review(page);
      const drainRequest = (await ssh({ action: "poll", token: own.token })).requests[0];
      dialog = await openSettings(page); await useBackend(page, dialog, "none", status); await closeSettings(page, dialog);
      const drainedRequest = (await ssh({ action: "poll", token: own.token })).requests[0];
      assert.equal(drainedRequest.id, drainRequest.id); assert.equal(drainedRequest.challenge, drainRequest.challenge);
      assert.equal(drainedRequest.previousSigner, true);
      await drainCard.getByRole("button", { name: "Approve with security key", exact: true }).click(); await finish(draining);
      const noFallback = await start(fixtures.job(`${sessionId}-no-fallback`, null, "list"));
      const noFallbackResult = await finish(noFallback, false); assert.equal(noFallbackResult.code, 1); assert.equal(noFallbackResult.stdout.trim(), "The agent has no identities.");
      dialog = await openSettings(page); await useBackend(page, dialog, "browser", status); await closeSettings(page, dialog);

      // Reload loses A's connection and grant, leaves B standby, never auto-connects.
      await page.reload();
      await page.getByText("Synthetic SSH fixture", { exact: true }).waitFor();
      const reloaded = await waitForAsyncCondition(page, async id => {
        const response = await fetch("/api/ssh-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status" }) });
        if (!response.ok) throw new Error(`SSH reload status HTTP ${response.status}`);
        const snapshot = await response.json();
        return snapshot.connections.some(item => item.id === id) ? false : snapshot;
      }, own.id);
      assert.equal(reloaded.activeId, null); assert.equal(reloaded.connections.some(item => item.id === own.id), false);
      assert.equal(reloaded.connections.find(item => item.id === other.id).role, "standby");
      assert.equal(reloaded.runtime.socketPath, stableSocket); assert.equal((await ceremonies(page)).length, 0);
      dialog = await openSettings(page);
      assert.equal(await dialog.getByRole("button", { name: "Connect and make this browser active", exact: true }).isVisible(), true);
      assert.equal(reloaded.registry.keys.find(item => item.id === sessionKey.id).publicKey, sessionKey.publicKey);
      const fresh = await connect(page, dialog, sessionKey, `${sessionId} reloaded A`);
      assert.notEqual(fresh.token, own.token); assert.equal(fresh.state, "locked");
      await disconnect(page, dialog);
      bDialog = await openSettings(b.page); await disconnect(b.page, bDialog); await closeSettings(b.page, bDialog);
      assert.deepEqual(harness.errorsFor(b.context), []); await harness.closeContext(b.context);

      // Generic public metadata is inert. Existing registration recovery preserves
      // the immutable session policy; removing that registration then importing
      // the same public identity is a NEW strict registration, never auto-connect.
      const legacy = { ...sessionKey.credential, origin: uiBase };
      await closeSettings(page, dialog);
      await page.evaluate(value => {
        localStorage.setItem("pi-web:browser-ssh-credential:v1", JSON.stringify(value));
        for (const key of Object.keys(localStorage)) if (key.startsWith("pi-web:browser-ssh-ack:v1:")) localStorage.removeItem(key);
      }, legacy);
      await page.reload(); await page.getByText("Synthetic SSH fixture", { exact: true }).waitFor();
      dialog = await openSettings(page);
      let recovery = dialog.getByRole("region", { name: "Public credential recovery", exact: true });
      await recovery.getByRole("checkbox", { name: "I acknowledge the existing server policy remains unchanged; verification does not connect or unlock a signer", exact: true }).check();
      const imported = capture(page, "finish-enroll"), count = (await status()).registry.keys.length;
      await recovery.getByRole("button", { name: "Verify existing registration", exact: true }).click(); await imported;
      await recovery.waitFor({ state: "detached" });
      let recovered = await status();
      assert.equal(recovered.registry.keys.length, count); assert.equal(recovered.registry.keys.find(item => item.id === sessionKey.id).policy, "session");
      assert.equal(recovered.connections.length, 0); assert.equal(recovered.activeId, null);
      // Remove through the actual row UI. Do not edit the central registry file.
      const keyRow = dialog.getByRole("region", { name: "Registered keys", exact: true }).locator("div").filter({ has: page.locator("strong", { hasText: sessionKey.name }) }).filter({ has: page.getByRole("button", { name: "Remove", exact: true }) }).last();
      await keyRow.getByRole("button", { name: "Remove", exact: true }).click();
      const removed = capture(page, "remove"); await keyRow.getByRole("button", { name: "Remove from Pi Web", exact: true }).click(); await removed;
      recovery = dialog.getByRole("region", { name: "Public credential recovery", exact: true });
      await recovery.getByLabel("Key name", { exact: true }).fill(`${sessionId} recovered strict`);
      await recovery.getByRole("checkbox", { name: "I accept application-only strict enforcement with unknown credential protection", exact: true }).check();
      const beforeImport = (await ceremonies(page)).length, importedNew = capture(page, "finish-enroll");
      await recovery.getByRole("button", { name: "Import with strict verification", exact: true }).click(); await importedNew;
      await recovery.waitFor({ state: "detached" }); recovered = await status();
      const newKey = recovered.registry.keys.find(item => item.name === `${sessionId} recovered strict`);
      assert.ok(newKey); assert.notEqual(newKey.id, sessionKey.id); assert.equal(newKey.publicKey, sessionKey.publicKey); assert.equal(newKey.policy, "strict");
      assert.equal(newKey.protection, null); assert.equal(newKey.applicationOnly, true); assert.equal(recovered.connections.length, 0);
      assert.deepEqual((await ceremonies(page)).slice(beforeImport).map(item => [item.method, item.uv, item.completed]), [["get", "required", true]]);
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("pi-web:browser-ssh-credential:v1"))), legacy, "generic recovery original remains untouched");
      await useBackend(page, dialog, "none", status); await closeSettings(page, dialog);
      writeFileSync(join(artifacts, `ssh-managed-${inputId}.json`), JSON.stringify({ socket: stableSocket, strictPublicKey: strict.publicKey, sessionPublicKey: sessionKey.publicKey, recoveredPublicKey: newKey.publicKey, consumers: consumerEvidence, ceremonies: await ceremonies(page) }, null, 2));
      assert.deepEqual(errors, [], `Browser SSH errors (${inputId})`);
      await harness.closeContext(a.context);
    });
    coverage.finish();
  } catch (error) {
    console.error(error); process.exitCode = 1; coverage.fail(error); await harness.fail(error);
  } finally {
    // Success explicitly deleted each PTY. On failure the existing harness owns
    // context closure and exact installed-service/process-group settlement;
    // never discover/signal unrelated processes or retry a failing test action.
    harness.event("ssh-consumers-settling", { terminalIds: [...terminals] });
    await harness.finish();
  }
}
