// Installed CLI authentication and the absence of browser SSH capabilities.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { setupInstalledAuth } from "../nix/auth-setup.fixture.mjs";
import { applyFixtureEnvironment, createHarness } from "./harness.mjs";
import { browserInputs, createCoverage } from "./scenarios.mjs";
import { sidebarReady } from "./sidebar-readiness.mjs";

export async function runAuthSuite() {
  const root = process.env.E2E_PACKAGE_ROOT; assert.match(root ?? "", /^\/nix\/store\//);
  const harness = createHarness(root, "browser");
  const { env, agentDir, fixtureRoot, artifacts } = harness;
  const coverage = createCoverage("auth", artifacts);
  const webPassword = "synthetic-browser-auth-password";
  env.BRABBLER_REQUIRE_AUTH = "1";
  env.BRABBLER_NO_AUTH = "0";
  applyFixtureEnvironment(env);
  const project = join(fixtureRoot, "project"); mkdirSync(project);
  const sessionRoot = join(agentDir, "sessions", "auth-test"); mkdirSync(sessionRoot, { recursive: true });
  const timestamp = "2026-10-31T00:00:00.000Z";
  writeFileSync(join(sessionRoot, "auth-desktop.jsonl"), [
    { type: "session", version: 3, id: "auth-desktop", timestamp, cwd: project },
    { type: "session_info", id: "name", parentId: null, timestamp, name: "Authentication fixture" },
    { type: "message", id: "prompt", parentId: "name", timestamp, message: { role: "user", content: "Synthetic authentication fixture" } },
  ].map(entry => JSON.stringify(entry)).join("\n") + "\n");
  try {
    const server = await harness.startService(), base = harness.baseURL;
    const deadline = performance.now() + 120_000;
    for (;;) {
      await server.check();
      const response = await fetch(`${base}/api/web-auth`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (response) { await response.text(); if (response.status === 503) break; }
      assert.ok(performance.now() < deadline, "Authentication service readiness"); await delay(250);
    }
    await coverage.run("auth/local-cli-login-and-ssh-absence@en-desktop", async () => {
      const raw = async (path, { password, cookie, basic } = {}) => {
        const response = await fetch(`${base}${path}`, { method: password === undefined ? "GET" : "POST",
          headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}),
            ...(basic ? { Authorization: `Basic ${Buffer.from(`pi:${basic}`).toString("base64")}` } : {}) },
          body: password === undefined ? undefined : JSON.stringify({ password }), signal: AbortSignal.timeout(5000) });
        const text = await response.text();
        assert.equal(text.includes(webPassword), false, "auth errors never reflect passphrases");
        return { status: response.status, headers: response.headers, text };
      };
      for (const path of ["/api/sessions", "/api/web-auth", "/api/terminal"]) {
        const response = await raw(path, { basic: webPassword });
        assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store");
      }
      await setupInstalledAuth(root, env, webPassword, { confirmation: "synthetic mismatch passphrase", expectedCode: 1 });
      assert.equal((await raw("/api/sessions")).status, 503);
      await setupInstalledAuth(root, env, webPassword);
      await setupInstalledAuth(root, env, webPassword, { expectedCode: 1 });
      const file = join(agentDir, "brabbler/auth/credentials.json"), bytes = readFileSync(file);
      assert.equal(bytes.includes(Buffer.from(webPassword)), false);
      writeFileSync(file, "{");
      assert.equal((await raw("/api/sessions", { basic: webPassword })).status, 503);
      assert.equal((await raw("/api/web-auth", { password: webPassword })).status, 503);
      writeFileSync(file, bytes);
      const wrong = await raw("/api/web-auth", { password: "synthetic wrong password" });
      assert.equal(wrong.status, 401);
      assert.equal((await raw("/api/sessions", { basic: webPassword })).status, 429);
      await delay(JSON.parse(wrong.text).retryAfterMs + 20); // Observe the real throttle deadline.
      const correct = await raw("/api/web-auth", { password: webPassword });
      assert.equal(correct.status, 200);
      const cookie = correct.headers.get("set-cookie").split(";")[0];
      assert.equal((await raw("/api/sessions", { cookie })).status, 200);
      assert.equal((await raw("/api/sessions", { basic: webPassword })).status, 200);
      await setupInstalledAuth(root, env, webPassword, { replace: true });
      assert.equal((await raw("/api/sessions", { cookie })).status, 401, "rotation revokes existing cookie");

      const browser = await harness.launchBrowser(chromium, { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
      const context = await harness.newContext(browser, browserInputs["en-desktop"].options, base);
      // A retired saved navigation value must not resurrect a removed section.
      await context.addInitScript(origin => {
        // The initial opaque about:blank document has no localStorage access.
        if (location.origin === origin) localStorage.setItem("brabbler:settings-navigation", JSON.stringify({ section: "ssh" }));
      }, base);
      const page = await context.newPage(), sshRequests = [];
      page.setDefaultTimeout(30_000);
      page.on("request", request => { if (new URL(request.url()).pathname === "/api/ssh-agent") sshRequests.push(request.method()); });
      const errors = harness.errorsFor(context);
      await page.goto(`${base}/login?next=${encodeURIComponent("/?session=auth-desktop")}`);
      await page.getByLabel("Password", { exact: true }).fill(webPassword);
      await page.locator('button[type="submit"]').click();
      await page.getByText("Synthetic authentication fixture", { exact: true }).waitFor();
      await page.waitForFunction(sidebarReady);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
      await dialog.getByRole("button", { name: "General", exact: true }).waitFor();
      assert.equal(await dialog.getByRole("button", { name: "SSH", exact: true }).count(), 0);
      assert.equal(await dialog.locator('option[value="ssh"]').count(), 0);
      assert.equal(await page.locator(".ssh-sidebar-status").count(), 0);
      assert.equal(await page.getByRole("complementary", { name: "SSH signature requests", exact: true }).count(), 0);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const liveCookie = (await context.cookies(base)).map(item => `${item.name}=${item.value}`).join("; ");
      // Use Node, not a browser 404, so expected absence is not a console-error exemption.
      for (const method of ["GET", "POST"]) {
        const response = await fetch(`${base}/api/ssh-agent`, { method,
          headers: { Cookie: liveCookie, Origin: base, "Content-Type": "application/json" },
          ...(method === "POST" ? { body: JSON.stringify({ action: "status" }) } : {}), signal: AbortSignal.timeout(5000) });
        await response.text(); assert.equal(response.status, 404, `retired SSH API (${method})`);
      }
      assert.deepEqual(sshRequests, [], "the mounted application never calls the retired SSH API");
      assert.deepEqual(errors, [], "Authentication browser errors");
      await harness.closeContext(context);
    });
    coverage.finish();
  } catch (error) {
    console.error(error); process.exitCode = 1; coverage.fail(error); await harness.fail(error);
  } finally { await harness.finish(); }
}
