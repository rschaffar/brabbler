import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { applyFixtureEnvironment, createHarness } from "./harness.mjs";
import { createCoverage } from "./scenarios.mjs";
import { closeTerminalDisconnect, terminalDisconnectFixture } from "./terminal-disconnect-fixture.mjs";

const root = process.env.E2E_PACKAGE_ROOT;
assert.match(root ?? "", /^\/nix\/store\//, "Nix-built application package required");
const harness = createHarness(root, "terminal");
const { artifacts, agentDir, fixtureRoot, env: fixtureEnv } = harness;
const coverage = createCoverage("terminal", artifacts);
try {
await coverage.run("terminal/full@production-pty", async () => {
applyFixtureEnvironment(fixtureEnv);
const workspace = join(fixtureRoot, "workspace-a");
const otherWorkspace = join(fixtureRoot, "workspace-b");
mkdirSync(join(agentDir, "sessions", "test"), { recursive: true });
mkdirSync(workspace);
mkdirSync(otherWorkspace);
writeFileSync(join(workspace, "note.txt"), "File viewer fixture\n");
// A disposable local history lets Explorer coexist with the real shell without mocked reads.
execFileSync("git", ["init", "-q", "-b", "fixture", workspace]);
execFileSync("git", ["-C", workspace, "add", "note.txt"]);
execFileSync("git", ["-C", workspace, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", "Terminal Explorer fixture"]);
const timestamp = "2026-09-05T00:00:00.000Z";
for (const [id, cwd, name] of [
  ["terminal-a1", workspace, "Terminal session one"],
  ["terminal-a2", workspace, "Terminal session two"],
  ["terminal-b1", otherWorkspace, "Other workspace session"],
]) {
  writeFileSync(join(agentDir, "sessions", "test", `${id}.jsonl`), [
    { type: "session", version: 3, id, timestamp, cwd },
    { type: "session_info", id: "name", parentId: null, timestamp, name },
    { type: "message", id: "message", parentId: "name", timestamp, message: { role: "user", content: `${name} message` } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

const base = process.env.E2E_BASE_URL;
assert.equal(base, harness.baseURL, "Use only this guest lane's loopback service");
assert.equal(new URL(base).hostname, "127.0.0.1");
assert.equal(new URL(base).origin, base);
const ownedServer = await harness.startService();
let browser;
  const deadline = Date.now() + 120_000;
  for (;;) {
    await ownedServer.check();
    const response = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) break;
    assert.ok(Date.now() < deadline, "Service did not become ready; see server.log and events.jsonl");
    await delay(500);
  }
  const chromiumPath = process.env.PI_WEB_TEST_CHROMIUM || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  browser = await harness.launchBrowser(chromium, chromiumPath ? { executablePath: chromiumPath } : undefined);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await harness.newContext(browser, { viewport, locale: "en-US", ...(viewport.width < 500 ? { hasTouch: true, isMobile: true } : {}) }, base);
    const page = await context.newPage();
    // Desktop proves xterm's DOM measurement fallback; mobile retains ordinary capabilities.
    if (viewport.width > 500) await page.addInitScript(() => {
      Object.defineProperty(globalThis, "OffscreenCanvas", { configurable: true, writable: true, value: undefined });
    });
    page.setDefaultTimeout(30_000);
    const errors = harness.errorsFor(context);
    const created = new Set();
    const streamRequests = [];
    let disconnect;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/terminal" && request.method() === "POST") created.add(request.postDataJSON().id);
      if (/^\/api\/terminal\/[^/]+\/events$/.test(new URL(request.url()).pathname)) streamRequests.push(request.url());
    });
    const ready = () => page.locator(".terminal-panel:visible .is-ready").waitFor();
    const text = () => page.locator(".terminal-panel:visible .xterm-rows").innerText();
    const expectFontWeight = (weight, bold = false) => page.waitForFunction(({ weight, bold }) => {
      const panel = [...document.querySelectorAll(".terminal-panel")].find(el => el.getBoundingClientRect().width > 0);
      const character = panel?.querySelector(`.xterm-rows span${bold ? ".xterm-bold" : ":not(.xterm-bold)"}`);
      return character && getComputedStyle(character).fontWeight === String(weight);
    }, { weight, bold });
    const run = async (command) => {
      await page.locator(".terminal-panel:visible .xterm-helper-textarea").focus();
      await page.keyboard.type(command);
      await page.keyboard.press("Enter");
    };
    const waitOutput = (pattern) => page.waitForFunction((source) => {
      const panel = [...document.querySelectorAll(".terminal-panel")].find((element) => element.getBoundingClientRect().width > 0);
      return new RegExp(source).test(panel?.querySelector(".xterm-rows")?.textContent ?? "");
    }, pattern);
    const showSidebar = async () => {
      const button = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await button.count()) await button.click();
    };
    const visiblePanel = async () => {
      // This button stays mounted and keeps its name when the main toggle changes.
      const toggle = page.locator("#file-panel").getByRole("button", { name: "Hide file panel", exact: true, includeHidden: true });
      await toggle.waitFor({ state: "attached" });
      const expanded = await toggle.getAttribute("aria-expanded");
      assert.ok(expanded === "true" || expanded === "false", "panel state is initialized");
      if (expanded === "false") await page.getByRole("button", { name: "Show file panel", exact: true }).click();
      await page.waitForFunction(() => {
        const panel = document.getElementById("file-panel");
        if (panel?.querySelector('button[aria-expanded]')?.getAttribute("aria-expanded") !== "true") return false;
        const bounds = panel.getBoundingClientRect();
        const header = panel.firstElementChild.getBoundingClientRect();
        // Closed desktop panels retain full-width children; visibility alone
        // does not establish that the tab bar is unclipped or onscreen.
        return header.width > 0 && header.height > 0
          && header.left >= Math.max(0, bounds.left) - 1
          && header.right <= Math.min(innerWidth, bounds.right) + 1
          && header.top >= Math.max(0, bounds.top) - 1
          && header.bottom <= Math.min(innerHeight, bounds.bottom) + 1;
      });
    };
    const hidePanel = async () => {
      const button = page.locator("#file-panel").getByRole("button", { name: "Hide file panel", exact: true, includeHidden: true });
      if (await button.getAttribute("aria-expanded") === "true") await button.click();
    };
    try {
      await page.goto(`${base}/?session=terminal-a1`);
      await page.getByText("Terminal session one message", { exact: true }).waitFor();
      await showSidebar();
      await page.getByRole("button", { name: "Open workspace terminal", exact: true }).click();
      await ready();
      const fontSelect = page.getByRole("combobox", { name: "Terminal font" });
      assert.equal(await fontSelect.inputValue(), "nerd");
      await page.waitForFunction(() => document.fonts.check('13px "Pi Web Nerd Font"'));
      assert.equal((await fetch(`${base}/fonts/JetBrainsMonoNerdFontMono-Regular.ttf`)).status, 200);
      await fontSelect.selectOption("system");
      assert.equal(await page.evaluate(() => localStorage.getItem("pi-web:terminal-font")), "system");
      await fontSelect.selectOption("nerd");
      await run("export PR695_TOKEN=alive; printf '\\nTOKEN:%s:%s\\n' \"$PR695_TOKEN\" \"$$\"");
      await waitOutput("TOKEN:alive:[0-9]+");
      const pid = (await text()).match(/TOKEN:alive:(\d+)/)[1];
      const [id] = created;
      assert.equal(created.size, 1);
      const originalStreams = streamRequests.length;
      const terminalPanel = page.locator(".terminal-panel:visible");
      await terminalPanel.getByRole("button", { name: "Use light terminal theme", exact: true }).click();
      assert.equal(await terminalPanel.getAttribute("data-terminal-theme"), "light");
      assert.equal(await terminalPanel.evaluate(el => getComputedStyle(el).backgroundColor), "rgb(251, 251, 252)");
      await terminalPanel.getByRole("button", { name: "Use dark terminal theme", exact: true }).click();
      const waitFont = expected => page.waitForFunction(expected => {
        const panel = [...document.querySelectorAll(".terminal-panel")].find(el => el.getBoundingClientRect().width > 0);
        const rows = panel?.querySelector(".xterm-rows");
        return rows && getComputedStyle(rows).fontSize === expected;
      }, expected);
      for (const [action, expected] of [["End", "23px"], ["Home", "11px"], ["reset", "13px"]]) {
        // On phones the file panel covers the sidebar toggle. Use the actual
        // panel controls, never force-click through the overlying terminal.
        await hidePanel();
        await showSidebar();
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        const size = page.getByRole("slider", { name: "Chat & terminal font size", exact: true });
        if (action === "reset") await page.getByRole("button", { name: "Reset chat & terminal font size", exact: true }).click();
        else await size.press(action);
        await page.keyboard.press("Escape");
        if (viewport.width < 500) await page.locator("#session-sidebar").getByText("Terminal session one", { exact: true }).click();
        await visiblePanel();
        await waitFont(expected);
      }
      // Change shared typography while the retained terminal is hidden. Nerd
      // keeps its glyph family, System follows mono, and both take its base weight.
      await hidePanel();
      await showSidebar();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("textbox", { name: "Monospace font", exact: true }).fill("monospace");
      await page.getByRole("slider", { name: "Monospace font weight", exact: true }).fill("600");
      await page.keyboard.press("Escape");
      if (viewport.width < 500) await page.locator("#session-sidebar").getByText("Terminal session one", { exact: true }).click();
      await visiblePanel();
      await expectFontWeight(600);
      assert.match(await terminalPanel.locator(".xterm-rows").evaluate(el => getComputedStyle(el).fontFamily), /Pi Web Nerd Font/);
      await fontSelect.selectOption("system");
      await page.waitForFunction(() => {
        const rows = [...document.querySelectorAll(".terminal-panel")].find(el => el.getBoundingClientRect().width > 0)?.querySelector(".xterm-rows");
        return rows && getComputedStyle(rows).fontFamily.startsWith("monospace,");
      });
      await expectFontWeight(600);
      await run("printf '\\033[1mBOLD_FONT\\033[0m\\n'");
      await expectFontWeight(700, true);
      await fontSelect.selectOption("nerd");
      await expectFontWeight(600);
      assert.equal(streamRequests.length, originalStreams, "appearance changes retain the same SSE connection");
      assert.equal(created.size, 1, "appearance changes never create another PTY");
      await run("printf '\\nAPPEARANCE:%s:%s\\n' \"$PR695_TOKEN\" \"$$\"");
      await waitOutput(`APPEARANCE:alive:${pid}`);
      if (viewport.width < 500) {
        const keys = terminalPanel.getByRole("toolbar", { name: "Terminal extra keys", exact: true });
        await keys.waitFor();
        await terminalPanel.locator(".xterm-helper-textarea").focus();
        await page.keyboard.type("printf 'SHOULD_NOT_RUN'");
        await keys.getByRole("button", { name: "CTRL", exact: true }).tap();
        assert.equal(await terminalPanel.locator(".xterm-helper-textarea").evaluate(el => el === document.activeElement), true, "extra keys preserve input focus");
        await page.keyboard.type("u");
        assert.equal(await keys.getByRole("button", { name: "CTRL", exact: true }).getAttribute("aria-pressed"), "false");
        await run("printf '\\nKEYS:ctrl-u:%s\\n' \"$PR695_TOKEN\"");
        await waitOutput("KEYS:ctrl-u:alive");
        await terminalPanel.locator(".xterm-helper-textarea").focus();
        await page.keyboard.type("printf '\\nKEYS:%s\\n' fo");
        await keys.getByRole("button", { name: "Left", exact: true }).tap();
        await page.keyboard.type("o");
        await page.keyboard.press("Enter");
        await waitOutput("KEYS:foo");
      }
      const resized = await fetch(`${base}/api/terminal/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "resize", cols: 80, rows: 1 }) });
      assert.equal(resized.status, 200, "one-row keyboard fits are accepted and clamped");
      await run("printf '\\nCLAMP:%s\\n' \"$(stty size)\"");
      await waitOutput("CLAMP:2 80");
      for (const rows of [0, -1, 1.5, 1001, "1"]) {
        const invalid = await fetch(`${base}/api/terminal/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "resize", cols: 80, rows }) });
        assert.equal(invalid.status, 400, `invalid rows remain rejected: ${rows}`);
      }
      if (viewport.width <= 640) {
        const host = page.locator(".terminal-panel:visible .terminal-xterm-host");
        const previousStyle = await host.getAttribute("style");
        const fitted = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/terminal/${id}`
          && response.request().method() === "POST" && response.request().postDataJSON()?.type === "resize"
          && response.request().postDataJSON()?.rows === 2);
        void fitted.catch(() => {});
        await host.evaluate((node) => { node.style.height = "1px"; node.style.flex = "none"; });
        try { assert.equal((await fitted).status(), 200); }
        finally { await host.evaluate((node, style) => { if (style === null) node.removeAttribute("style"); else node.setAttribute("style", style); }, previousStyle); }
        await ready();
        await run("printf '\\nKEYBOARD-RESTORED\\n'");
        await waitOutput("KEYBOARD-RESTORED");
      }
      const terminalNode = await page.locator(".terminal-panel").elementHandle();
      // Mobile's existing full-width terminal covers the top bar; hide, never terminate it.
      await hidePanel();
      await page.getByRole("button", { name: "Git Explorer", exact: true }).click();
      const explorer = page.locator("#git-explorer-panel");
      await explorer.getByRole("combobox", { name: "History branch" }).waitFor();
      if (viewport.width > 640) {
        await visiblePanel();
        await explorer.getByRole("button", { name: "Expand Git Explorer", exact: true }).click();
        assert.equal(await page.locator("#file-panel").evaluate((node) => node.inert), true);
        assert.equal(await terminalNode.evaluate((node) => node.isConnected), true, "Fullscreen never unmounts the real terminal");
        assert.equal((await fetch(`${base}/api/terminal/${id}`)).status, 200);
        await explorer.getByRole("button", { name: "Restore Git Explorer", exact: true }).press("Enter");
        assert.equal(await page.locator("#file-panel").evaluate((node) => node.inert), false);
        assert.equal(created.size, 1, "Restore must not create another shell");
      } else {
        assert.equal(await explorer.getByRole("button", { name: "Expand Git Explorer", exact: true }).count(), 0);
        await hidePanel();
      }
      await explorer.getByRole("button", { name: "Close Git Explorer", exact: true }).click();
      await visiblePanel();
      await run("printf '\\nEXPLORER:%s:%s\\n' \"$PR695_TOKEN\" \"$$\"");
      await waitOutput(`EXPLORER:alive:${pid}`);
      assert.equal(created.size, 1, "Explorer round trip retains shell identity and environment");

      let calibratedFont;
      const setMono = async family => {
        await showSidebar();
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await page.getByRole("textbox", { name: "Monospace font", exact: true }).fill(family);
        await page.keyboard.press("Escape");
      };
      const gridFor = async marker => {
        await run(`printf '\\n${marker}:%s\\n' "$(stty size)"`);
        await waitOutput(`${marker}:[0-9]+ [0-9]+`);
        return (await text()).match(new RegExp(`${marker}:([0-9]+ [0-9]+)`))[1];
      };
      if (viewport.width > 500) {
        await terminalPanel.locator('.xterm-char-measure-element[aria-hidden="true"]').waitFor({ state: "attached" });
        await fontSelect.selectOption("system");
        await setMono("monospace");
        const a = await gridFor("FONT_A");
        await setMono("serif");
        const b = await gridFor("FONT_B");
        assert.notEqual(a, b, "calibration fonts must have different real PTY grids");
        await setMono("monospace");
        assert.equal(await gridFor("FONT_A_RESTORED"), a);
        calibratedFont = b;
      }
      await hidePanel();
      await showSidebar();
      await page.getByText("note.txt", { exact: true }).click();
      await page.getByText("File viewer fixture", { exact: true }).waitFor();
      assert.equal(await page.locator(".terminal-panel").count(), 1);
      assert.equal(await page.locator(".terminal-panel").isVisible(), false);
      if (calibratedFont) await setMono("serif");
      await page.getByRole("tab", { name: "Terminal: workspace-a", exact: true }).click();
      await ready();
      if (calibratedFont) {
        assert.equal(await gridFor("FONT_HIDDEN_REVEAL"), calibratedFont, "hidden font changes must remeasure cells on reveal, not just refit old metrics");
        assert.equal(streamRequests.length, originalStreams);
        assert.equal(created.size, 1);
        await setMono("monospace");
        await fontSelect.selectOption("nerd");
      }
      await hidePanel();
      await showSidebar();
      await page.getByText("Terminal session two", { exact: true }).click();
      await page.getByText("Terminal session two message", { exact: true }).waitFor();
      await visiblePanel();
      await ready();
      await run("printf '\\nSESSION:%s:%s\\n' \"$PR695_TOKEN\" \"$$\"");
      await waitOutput(`SESSION:alive:${pid}`);

      await fontSelect.selectOption("system");
      await page.waitForFunction(() => JSON.parse(sessionStorage.getItem("pi-web:terminal-tabs") ?? "{}").open === true);
      const savedTabs = await page.evaluate(() => JSON.parse(sessionStorage.getItem("pi-web:terminal-tabs")));
      assert.ok(savedTabs.tabs.some((tab) => tab.id === savedTabs.activeId), "the active terminal is persisted before reload");
      disconnect = await terminalDisconnectFixture(base, id);
      await page.route(disconnect.matches, disconnect.route);
      await page.reload();
      // Terminal storage restores before the asynchronous sidebar/session load,
      // which can close the panel again. Observe both restores before opening.
      await page.getByText("Terminal session two message", { exact: true }).waitFor();
      await page.waitForFunction((cwd) => {
        const panel = [...document.querySelectorAll(".terminal-panel")].find((element) =>
          element.querySelector(".terminal-panel-path > span:last-child")?.getAttribute("title") === cwd);
        return Boolean(panel?.querySelector(".is-ready"))
          && panel.querySelector('select[aria-label="Terminal font"]')?.value === "system";
      }, workspace);
      await visiblePanel();
      await page.getByRole("tab", { name: "Terminal: workspace-a", exact: true }).click();
      await ready();
      assert.equal(await fontSelect.inputValue(), "system", "font choice survives page reload");
      await expectFontWeight(600);
      assert.match(await terminalPanel.locator(".xterm-rows").evaluate(el => getComputedStyle(el).fontFamily), /^monospace,/);
      await fontSelect.selectOption("nerd");
      await run("printf '\\nREFRESH:%s:%s\\n' \"$PR695_TOKEN\" \"$$\"");
      await waitOutput(`REFRESH:alive:${pid}`);
      assert.equal(created.size, 1, "refresh must reconnect, not create");

      // End only the actual terminal SSE stream: unrelated browser polls stay online.
      disconnect.endStream();
      await page.locator(".terminal-panel:visible .is-connecting").waitFor();
      disconnect.releaseReconnect();
      await ready();
      await closeTerminalDisconnect(page, disconnect); disconnect = undefined;
      assert.equal(created.size, 1, "native SSE retry retains the original shell");
      await run("printf '\\nRECONNECT:%s:%s\\n' \"$PR695_TOKEN\" \"$$\"");
      await waitOutput(`RECONNECT:alive:${pid}`);
      assert.equal(((await text()).match(new RegExp(`REFRESH:alive:${pid}`, "g")) ?? []).length, 1, "reconnect must not replay delivered output");

      await page.screenshot({ path: join(artifacts, `${viewport.width}.png`), fullPage: true });
      const dimensions = await page.locator(".terminal-panel:visible").evaluate((element) => {
        const panel = element.getBoundingClientRect();
        const screen = element.querySelector(".xterm-screen").getBoundingClientRect();
        return { panelWidth: panel.width, screenWidth: screen.width, screenHeight: screen.height, fits: screen.right <= panel.right + 1 && screen.bottom <= panel.bottom + 1 };
      });
      assert.ok(dimensions.screenWidth > 100 && dimensions.screenHeight > 100 && dimensions.fits, JSON.stringify(dimensions));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

      await page.getByRole("button", { name: "Restart terminal", exact: true }).click();
      await page.waitForFunction((oldId) => {
        const saved = JSON.parse(sessionStorage.getItem("pi-web:terminal-tabs"));
        return saved.tabs.length === 1 && saved.tabs[0].id !== oldId;
      }, id);
      await ready();
      assert.equal((await fetch(`${base}/api/terminal/${id}`)).status, 404);
      await run("exit 7");
      await page.getByText("Process exited with code 7", { exact: true }).waitFor();
      const currentId = await page.evaluate(() => JSON.parse(sessionStorage.getItem("pi-web:terminal-tabs")).tabs[0].id);
      await page.getByRole("button", { name: "Terminate terminal workspace-a", exact: true }).click();
      await page.locator(".terminal-panel").waitFor({ state: "detached" });
      assert.equal((await fetch(`${base}/api/terminal/${currentId}`)).status, 404);

      let releaseCreation;
      const creationResponse = new Promise((resolve) => { releaseCreation = resolve; });
      await page.route("**/api/terminal", async (route) => {
        const response = await route.fetch();
        await creationResponse;
        await route.fulfill({ response });
      });
      await hidePanel();
      await showSidebar();
      await page.getByRole("button", { name: "Open workspace terminal", exact: true }).click();
      await page.getByRole("button", { name: "Terminate terminal workspace-a", exact: true }).click();
      releaseCreation();
      await page.locator(".terminal-panel").waitFor({ state: "detached" });
      await page.unroute("**/api/terminal");
      for (const terminalId of created) assert.equal((await fetch(`${base}/api/terminal/${terminalId}`)).status, 404);

      await showSidebar();
      await page.getByRole("button", { name: "Open workspace terminal", exact: true }).click();
      await ready();
      await run("export PR695_WORKSPACE=retained");
      await hidePanel();
      await showSidebar();
      await page.getByRole("button").and(page.getByTitle(workspace, { exact: true })).first().click();
      await page.getByRole("button").and(page.getByTitle(otherWorkspace, { exact: true })).click();
      await page.getByText("Other workspace session", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Open workspace terminal", exact: true }).click();
      await ready();
      const workspaceTabs = await page.evaluate(() => JSON.parse(sessionStorage.getItem("pi-web:terminal-tabs")).tabs);
      assert.deepEqual(workspaceTabs.map((tab) => tab.cwd).sort(), [workspace, otherWorkspace].sort());
      const otherId = workspaceTabs.find((tab) => tab.cwd === otherWorkspace).id;
      assert.equal((await (await fetch(`${base}/api/terminal/${otherId}`)).json()).cwd, otherWorkspace);
      await page.getByRole("tab", { name: "Terminal: workspace-a", exact: true }).click();
      await run("printf '\\nWORKSPACE:%s\\n' \"$PR695_WORKSPACE\"");
      await waitOutput("WORKSPACE:retained");
      await page.screenshot({ path: join(artifacts, `${viewport.width}-workspaces.png`), fullPage: true });
      for (const name of ["workspace-a", "workspace-b"]) {
        await page.getByRole("button", { name: `Terminate terminal ${name}`, exact: true }).click();
      }
      // Both asynchronous DELETEs can still be settling. A strict single-element
      // locator rejects two remaining panels instead of waiting for all to close.
      await page.waitForFunction(() => document.querySelectorAll(".terminal-panel").length === 0);
      for (const terminalId of created) assert.equal((await fetch(`${base}/api/terminal/${terminalId}`)).status, 404);
      assert.deepEqual(errors, []);
      console.log(`PASS ${viewport.width}: real shell, files, sessions, refresh, reconnect, restart, exit, close during creation, workspace isolation`);
    } catch (error) {
      await harness.fail(error);
      // DOM snapshots and screenshots belong to the bounded shared capture path;
      // do not issue unbounded page.evaluate diagnostics after a browser failure.
      throw error;
    } finally {
      try { if (disconnect) await closeTerminalDisconnect(page, disconnect); }
      finally { await harness.closeContext(context); }
    }
  }
});
coverage.finish();
} catch (error) {
  coverage.fail(error);
  console.error(error);
  await harness.fail(error);
} finally {
  await harness.finish();
}
