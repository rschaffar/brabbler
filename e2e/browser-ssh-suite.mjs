import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { applyFixtureEnvironment, createHarness } from "./harness.mjs";
import { browserInputs, createCoverage } from "./scenarios.mjs";

function signWithAgent(publicKeyFile, socketPath, message) {
  const child = spawn("ssh-keygen", ["-Y", "sign", "-n", "git", "-f", publicKeyFile], { env: { ...process.env, SSH_AUTH_SOCK: socketPath }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  const result = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", code => resolve({ code, stdout, stderr })); });
  child.stdin.on("error", () => {}); child.stdin.end(message);
  return { child, result };
}

export async function runBrowserSshSuite() {
  const root = process.env.E2E_PACKAGE_ROOT;
  assert.match(root ?? "", /^\/nix\/store\//);
  const harness = createHarness(root, "browser");
  const { env, agentDir, fixtureRoot, artifacts } = harness;
  const coverage = createCoverage("ssh-agent", artifacts);
  env.PI_WEB_PASSWORD = "synthetic-browser-ssh-password";
  applyFixtureEnvironment(env);
  const project = join(fixtureRoot, "project"); mkdirSync(project);
  const sessionRoot = join(agentDir, "sessions", "ssh-test"); mkdirSync(sessionRoot, { recursive: true });
  const timestamp = "2026-10-21T00:00:00.000Z";
  for (const id of ["ssh-desktop", "ssh-mobile"]) writeFileSync(join(sessionRoot, `${id}.jsonl`), [
    { type: "session", version: 3, id, timestamp, cwd: project },
    { type: "session_info", id: "name", parentId: null, timestamp, name: id },
    { type: "message", id: "prompt", parentId: "name", timestamp, message: { role: "user", content: "Synthetic SSH fixture" } },
  ].map(entry => JSON.stringify(entry)).join("\n") + "\n");
  const children = new Set();
  try {
    const server = await harness.startService();
    const base = harness.baseURL;
    const uiBase = `http://localhost:${new URL(base).port}`;
    const deadline = Date.now() + 120_000;
    for (;;) {
      await server.check();
      const response = await fetch(`${base}/api/web-auth`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (response?.ok) break;
      assert.ok(Date.now() < deadline, "SSH test service readiness"); await delay(250);
    }
    const browser = await harness.launchBrowser(chromium, { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
    for (const inputId of ["en-desktop", "en-mobile-tall"]) await coverage.run(`ssh-agent/webauthn-openssh@${inputId}`, async () => {
      const sessionId = inputId === "en-desktop" ? "ssh-desktop" : "ssh-mobile";
      const context = await harness.newContext(browser, browserInputs[inputId].options, uiBase);
      const errors = harness.errorsFor(context);
      await context.addInitScript((skew) => { const now = Date.now.bind(Date); Date.now = () => now() + skew; }, inputId === "en-desktop" ? 120_000 : -120_000);
      const page = await context.newPage(); page.setDefaultTimeout(30_000);
      const cdp = await context.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "usb", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
      await page.goto(`${uiBase}/login?next=${encodeURIComponent(`/?session=${sessionId}`)}`);
      await page.getByLabel("Password", { exact: true }).fill(env.PI_WEB_PASSWORD);
      await page.locator('button[type="submit"]').click();
      await page.getByText("Synthetic SSH fixture", { exact: true }).waitFor();
      const sidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await sidebar.isVisible()) await sidebar.click();
      await page.getByRole("button", { name: "Browser SSH agent", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Browser SSH agent", exact: true });
      await dialog.getByRole("button", { name: "Enroll security key", exact: true }).click();
      await dialog.getByRole("button", { name: "Connect security key", exact: true }).waitFor();
      const createResponse = page.waitForResponse(response => response.url().endsWith("/api/ssh-agent") && response.request().postDataJSON()?.action === "create");
      await dialog.getByRole("button", { name: "Connect security key", exact: true }).click();
      const { token } = await (await createResponse).json();
      await dialog.getByLabel("SSH public key", { exact: true }).waitFor();
      const publicKey = await dialog.getByLabel("SSH public key", { exact: true }).inputValue();
      const exportCommand = await dialog.getByLabel("Terminal export command", { exact: true }).inputValue();
      const socketPath = /^export SSH_AUTH_SOCK='([^']+)'$/.exec(exportCommand)?.[1];
      assert.ok(socketPath); assert.ok(existsSync(socketPath)); assert.match(publicKey, /^sk-ecdsa-sha2-nistp256@openssh.com /);
      const publicFile = join(project, `${sessionId}.pub`); writeFileSync(publicFile, publicKey + "\n");
      const allowedFile = join(project, `${sessionId}.allowed`); writeFileSync(allowedFile, `fixture ${publicKey}\n`);
      const message = "Signed by virtual browser security key\n";
      const sign = signWithAgent(publicFile, socketPath, message); children.add(sign.child);
      await dialog.getByRole("region", { name: "SSH signing request" }).waitFor();
      await dialog.getByRole("button", { name: "Approve with security key", exact: true }).click();
      const signed = await sign.result; children.delete(sign.child);
      assert.equal(signed.code, 0, signed.stderr);
      const signatureFile = join(project, `${sessionId}.sig`); writeFileSync(signatureFile, signed.stdout);
      assert.match(execFileSync("ssh-keygen", ["-Y", "verify", "-I", "fixture", "-f", allowedFile, "-n", "git", "-s", signatureFile], { input: message, encoding: "utf8" }), /Good "git" signature/);
      await dialog.getByRole("region", { name: "SSH signing request" }).waitFor({ state: "detached" });
      const denied = signWithAgent(publicFile, socketPath, message); children.add(denied.child);
      await dialog.getByRole("button", { name: "Deny signature", exact: true }).click();
      assert.notEqual((await denied.result).code, 0); children.delete(denied.child);
      await dialog.getByRole("region", { name: "SSH signing request" }).waitFor({ state: "detached" });
      // Keep the native WebAuthn request pending, then close its SSH client.
      // Poll settlement must abort the actual browser ceremony, not submit a stale assertion.
      await page.evaluate(() => {
        const get = navigator.credentials.get.bind(navigator.credentials);
        navigator.credentials.get = (options) => {
          options.signal.addEventListener("abort", () => { window.__sshPromptAborted = true; }, { once: true });
          return get(options);
        };
      });
      await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: false });
      const cancelled = signWithAgent(publicFile, socketPath, message); children.add(cancelled.child);
      await dialog.getByRole("button", { name: "Approve with security key", exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent === "Approve with security key" && button.disabled));
      cancelled.child.kill("SIGKILL"); await cancelled.result; children.delete(cancelled.child);
      await page.waitForFunction(() => window.__sshPromptAborted === true);
      await dialog.getByRole("region", { name: "SSH signing request" }).waitFor({ state: "detached" });
      await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: true });
      await dialog.getByRole("button", { name: "Use for selected session Bash", exact: true }).click();
      await dialog.getByRole("button", { name: "Clear selected session binding", exact: true }).waitFor();
      // Native HTTP negatives avoid manufacturing browser-console exceptions.
      const cookies = await context.cookies(uiBase);
      const cookie = cookies.map(item => `${item.name}=${item.value}`).join("; ");
      const request = (body, extra = {}) => fetch(`${uiBase}/api/ssh-agent`, { method: "POST", headers: { "Content-Type": "application/json", Origin: uiBase, Cookie: cookie, ...extra }, body: JSON.stringify(body) });
      assert.equal((await request({ action: "poll", token: "0".repeat(64) })).status, 400);
      const otherLogin = await fetch(`${uiBase}/api/web-auth`, { method: "POST", headers: { "Content-Type": "application/json", Origin: uiBase }, body: JSON.stringify({ password: env.PI_WEB_PASSWORD }) });
      assert.equal(otherLogin.status, 200);
      const otherCookie = otherLogin.headers.get("set-cookie").split(";", 1)[0];
      assert.equal((await request({ action: "poll", token }, { Cookie: otherCookie })).status, 400);
      assert.equal((await request({ action: "unbind", sessionId, token }, { Cookie: otherCookie })).status, 400);
      assert.equal((await request({ action: "poll", token }, { Origin: "https://untrusted.example.test" })).status, 403);
      assert.equal((await request({ action: "status" }, { Cookie: "", Authorization: `Basic ${Buffer.from(`pi:${env.PI_WEB_PASSWORD}`).toString("base64")}` })).status, 403);
      await dialog.getByRole("button", { name: "Disconnect / cancel", exact: true }).click();
      await dialog.getByRole("button", { name: "Connect security key", exact: true }).waitFor();
      for (let i = 0; existsSync(socketPath) && i < 100; i++) await delay(10);
      assert.equal(existsSync(socketPath), false);
      assert.equal((await request({ action: "poll", token })).status, 400);
      // Reload preserves only public metadata; a new proof is needed for a new socket.
      await page.reload();
      const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await showSidebar.isVisible()) await showSidebar.click();
      await page.getByRole("button", { name: "Browser SSH agent", exact: true }).click();
      await dialog.getByRole("button", { name: "Connect security key", exact: true }).click();
      await dialog.getByLabel("SSH public key", { exact: true }).waitFor();
      assert.equal(await dialog.getByLabel("SSH public key", { exact: true }).inputValue(), publicKey);
      assert.notEqual(await dialog.getByLabel("Terminal export command", { exact: true }).inputValue(), exportCommand);
      await dialog.getByRole("button", { name: "Use for selected session Bash", exact: true }).click();
      await dialog.getByRole("button", { name: "Clear selected session binding", exact: true }).click();
      await dialog.getByRole("button", { name: "Clear selected session binding", exact: true }).waitFor({ state: "detached" });
      await dialog.getByRole("button", { name: "Disconnect / cancel", exact: true }).click();
      assert.deepEqual(errors, [], `Browser SSH errors (${inputId})`);
      await harness.closeContext(context);
    });
    coverage.finish();
  } catch (error) {
    console.error(error); process.exitCode = 1; coverage.fail(error); await harness.fail(error);
  } finally {
    for (const child of children) { child.kill("SIGKILL"); await new Promise(resolve => child.once("close", resolve)); }
    await harness.finish();
  }
}
