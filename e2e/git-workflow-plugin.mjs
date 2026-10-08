import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkBlockingCard } from "./blocking-card.mjs";
import { withExpectedBrowserConflict } from "./expected-browser-conflict.mjs";

/** Fixture-only command delegates to the production plugin implementation, no model. */
export function gitPluginFixtureSource(root) {
  return `import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { executeGitOperation } from ${JSON.stringify(join(root, "plugins/git-workflow/server.ts"))};
export default function (pi) {
  pi.registerCommand("e2e-git-plugin", { handler: async (mode, ctx) => {
    let operation;
    if (mode.startsWith("cleanup-")) {
      const selectedCheckout = ctx.cwd + "-" + mode;
      const git = (...args) => execFileSync("git", ["-C", selectedCheckout, ...args], { encoding: "utf8" }).trim();
      operation = { action: "cleanupFeature", checkout: selectedCheckout, featureBranch: "cleanup", featureTip: git("rev-parse", "cleanup"),
        integrationCommit: git("rev-parse", "main"), targetBranch: "main", worktreePath: join(selectedCheckout + "-worktrees", "cleanup"),
        removeWorktree: true, deleteBranch: true, artifactRoots: ["node_modules", ".codegraph"] };
    } else if (mode.startsWith("preview-")) {
      const action = mode.split("-")[1];
      const targetCheckout = execFileSync("git", ["-C", ctx.cwd, "worktree", "list", "--porcelain"], { encoding: "utf8" }).split("\\n\\n").find((record) => record.includes("branch refs/heads/target")).split("\\n")[0].slice(9);
      operation = action === "rebase" || action === "merge"
        ? { action, checkout: action === "merge" ? targetCheckout : ctx.cwd, featureBranch: "feature" }
        : action === "removeWorktree" ? { action, checkout: ctx.cwd, path: targetCheckout }
        : { action, checkout: ctx.cwd, branch: action === "attachWorktree" ? "comparison-base" : "preview-new", baseBranch: action === "attachWorktree" ? "comparison-base" : "target", path: join(ctx.cwd + "-worktrees", "preview-new") };
    } else {
      const selectedCheckout = mode.startsWith("cross-") ? ctx.cwd + "-foreign" : ctx.cwd;
      const draft = Array.from({ length: 5000 }, (_, index) => "Plugin context " + (index + 1) + "\\n");
      draft[49] = "Plugin whole-file candidate " + mode + "\\n";
      draft[4499] = "Plugin distant candidate " + mode + "\\n";
      writeFileSync(join(selectedCheckout, "draft.txt"), draft.join(""));
      writeFileSync(join(selectedCheckout, "second-draft.txt"), "Second plugin candidate " + mode + "\\n");
      operation = { action: "commit", checkout: selectedCheckout, mode: "files", files: ["draft.txt", "second-draft.txt"], message: "Plugin browser commit " + mode };
    }
    const result = await executeGitOperation(ctx.cwd, operation, ctx.ui, undefined, { id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd });
    ctx.ui.notify("Git plugin fixture " + mode + ": " + (result.isError ? "refused" : "completed"));
  } });
}`;
}
export async function checkGitWorkflowPlugin(page, base, repo, sessionId, artifacts, width) {
  const command = async (body) => {
    const response = await page.request.post(`${base}/api/agent/${sessionId}`, { data: body });
    assert.ok(response.ok(), await response.text()); return (await response.json()).data;
  };
  const patch = async (set, scope = "global", reset = [], cwd = repo) => {
    const response = await page.request.patch(`${base}/api/plugins/bundled`, { data: { pluginId: "git-workflow", cwd, sessionId, scope, set, reset } });
    assert.ok(response.ok(), await response.text()); return (await response.json()).settings;
  };
  const tip = () => execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  await patch({ enabled: false });
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  await page.locator("textarea").last().waitFor();
  const initialTools = await command({ type: "get_tools" });
  assert.ok(initialTools.some((tool) => tool.name === "read" && tool.active));
  assert.equal(initialTools.some((tool) => tool.name === "git_commit" && tool.active), false);
  // Settings UI is the real write path, not a plugin execution endpoint.
  if (width <= 600) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  if (width <= 600) await settings.getByRole("combobox", { name: "Settings", exact: true }).selectOption("plugins");
  else await settings.getByRole("button", { name: "Plugins", exact: true }).click();
  await settings.getByRole("button", { name: "Git Workflow", exact: true }).click();
  const panel = settings.getByRole("region", { name: "Git Workflow settings" });
  await panel.waitFor();
  await panel.getByLabel("Enable plugin (all projects)").check();
  await panel.getByText(/Effective: true · Source: global/).waitFor();
  await panel.getByLabel("Plugin settings scope").selectOption("project");
  await panel.getByLabel("commit", { exact: true }).selectOption("deny");
  await panel.getByText(/Effective: "deny" · Source: project/).waitFor();
  await panel.getByRole("button", { name: "Use global default", exact: true }).click();
  await panel.getByText(/Effective: "ask" · Source: builtin/).first().waitFor();
  await panel.getByLabel("Plugin settings scope").selectOption("session");
  await panel.getByLabel("commit", { exact: true }).selectOption("allow");
  await panel.getByText(/Effective: "allow" · Source: session/).waitFor();
  await panel.getByLabel("Workflow preset", { exact: true }).selectOption("current-branch");
  await panel.getByRole("button", { name: "Apply workflow preset", exact: true }).click();
  await panel.getByText(/Effective: "current-branch" · Source: session/).waitFor();
  assert.equal(await panel.getByLabel("commit", { exact: true }).inputValue(), "allow", "preset does not change operation permissions");
  await panel.getByLabel("Plugin settings scope").selectOption("project");
  assert.equal(await panel.getByLabel("commit", { exact: true }).inputValue(), "ask", "project editor must not show masking session value");
  await panel.getByLabel("Plugin settings scope").selectOption("session");
  await panel.getByLabel("Workflow preset", { exact: true }).selectOption("always-ask");
  await panel.getByRole("button", { name: "Apply workflow preset", exact: true }).click();
  await panel.getByText(/Effective: "ask" · Source: session/).first().waitFor();
  assert.equal(await panel.getByLabel("Working location").inputValue(), "ask");
  assert.equal(await panel.getByLabel("Working location").locator("option:checked").textContent(), "Ask via ask_user");
  await panel.getByLabel("commit", { exact: true }).locator("..").getByRole("button", { name: "Use project default", exact: true }).click();
  await panel.getByLabel("commit", { exact: true }).locator("..").getByText(/Source: builtin/).waitFor();
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  if (width <= 600) await page.locator(".sidebar-overlay-backdrop").click({ position: { x: width - 10, y: 200 } });
  assert.ok((await command({ type: "get_tools" })).some((tool) => tool.name === "git_commit" && tool.active));
  await page.getByRole("button", { name: "Session plugin settings", exact: true }).click();
  await panel.waitFor();
  assert.equal(await panel.getByLabel("Plugin settings scope").inputValue(), "session");
  assert.equal(await panel.getByLabel("Working location").inputValue(), "ask");
  await settings.getByRole("button", { name: "Close", exact: true }).click();

  const start = async (mode, title = "Git commit") => {
    const input = page.locator("textarea").last(); await input.fill(`/e2e-git-plugin ${mode}-${width}`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const card = page.getByRole("group", { name: title, exact: true }); await card.waitFor(); await checkBlockingCard(card); return card;
  };
  const finish = async (mode, result) => {
    await page.getByText(`Git plugin fixture ${mode}-${width}: ${result}`, { exact: true }).waitFor();
    await page.waitForFunction(async (sid) => {
      const response = await fetch(`/api/agent/${sid}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "get_state" }) });
      const { data } = await response.json(); return data && !data.isPromptRunning && !data.isStreaming;
    }, sessionId);
  };
  const before = tip();
  let card = await start("decline");
  await card.getByRole("button", { name: "Reject", exact: true }).click();
  await finish("decline", "refused"); assert.equal(tip(), before);

  const contextPath = "/api/plugins/bundled/git-workflow/patch-context";
  const contextReads = [], commands = [];
  const recordReviewRequest = (request) => {
    const address = new URL(request.url());
    if (address.pathname === contextPath) contextReads.push(request);
    if (address.pathname === `/api/agent/${sessionId}` && request.method() === "POST") commands.push(request.postDataJSON());
  };
  const decisions = () => commands.filter((request) => request.type === "extension_ui_response" || request.type === "abort");
  const fileToggle = (file, path) => file.getByRole("button", { name: `Toggle diff: ${path}`, exact: true });
  const version = (file, name) => file.getByRole("group", { name: "File version", exact: true }).getByRole("button", { name, exact: true });
  // CodeView only mounts a window of lines. Navigate before checking distant text;
  // never require all 5,000 lines to exist in the DOM.
  const expectLine = async (file, name, number, text) => {
    const region = file.getByRole("region", { name, exact: true });
    const row = region.locator(`[data-line="${number}"]`).filter({ hasText: text }).first();
    await row.waitFor();
    assert.equal((await row.textContent()).trimEnd(), text);
  };
  const jumpTo = async (file, name, number, text) => {
    await file.getByLabel("Line number", { exact: true }).fill(String(number));
    await file.getByRole("button", { name: "Go to line", exact: true }).click();
    await expectLine(file, name, number, text);
  };
  const completeRaw = (group) => group.locator("details").filter({ has: page.getByText("Complete raw patch", { exact: true }) });
  const draftPath = join(repo, "draft.txt");
  // Parent seeds this tracked file before the root commit; subsequent viewport
  // runs may have a previous plugin candidate at the two changed lines.
  const beforeDraft = execFileSync("git", ["-C", repo, "show", `${before}:draft.txt`], { encoding: "utf8" });
  const beforeLines = beforeDraft.trimEnd().split("\n");
  assert.equal(beforeLines.length, 5000, "draft.txt must be committed as a 5,000-line context fixture");
  const candidate = `Plugin whole-file candidate reconnect-${width}`;
  const distantCandidate = `Plugin distant candidate reconnect-${width}`;
  page.on("request", recordReviewRequest);
  try {
    card = await start("reconnect");
    await page.reload({ waitUntil: "domcontentloaded" });
    card = page.getByRole("group", { name: "Git commit", exact: true }); await card.waitFor();
    await card.getByText(/Plugin browser commit reconnect/).first().waitFor();
    const first = card.getByRole("region", { name: "File changes: draft.txt", exact: true });
    const second = card.getByRole("region", { name: "File changes: second-draft.txt", exact: true });
    await card.getByRole("button", { name: "Side by side", exact: true }).click();
    await first.getByRole("region", { name: "Side-by-side diff", exact: true }).waitFor();
    await first.getByText("Modified", { exact: true }).waitFor();
    assert.equal(await fileToggle(second, "second-draft.txt").getAttribute("aria-expanded"), "false");
    assert.equal(await card.getByRole("group", { name: "Patch view", exact: true }).count(), 1);
    await first.getByRole("button", { name: "Next change", exact: true }).click();
    await expectLine(first, "Side-by-side diff", 50, candidate);
    await first.getByRole("button", { name: "Next change", exact: true }).click();
    await expectLine(first, "Side-by-side diff", 4500, distantCandidate);
    await first.getByRole("button", { name: "Previous change", exact: true }).click();
    await expectLine(first, "Side-by-side diff", 50, candidate);
    await card.getByRole("button", { name: "Raw patch", exact: true }).click();
    const reviewedPatch = await first.getByRole("region", { name: "Raw patch", exact: true }).textContent();
    assert.equal(reviewedPatch.match(/^@@ /gm)?.length, 2, "The original partial patch contains both distant changes");
    assert.equal(reviewedPatch.includes("Plugin context 2500"), false, "Unchanged full-file text is not part of the supplied patch");
    await completeRaw(card).locator("summary").click();
    const reviewedCompletePatch = await completeRaw(card).locator("pre").textContent();
    assert.ok(reviewedCompletePatch.startsWith(reviewedPatch));
    assert.ok(reviewedCompletePatch.includes(`Second plugin candidate reconnect-${width}`));
    assert.equal(contextReads.length, 0, "Reconnect, patch rendering and change navigation never eagerly load full files");

    await card.getByRole("button", { name: "Side by side", exact: true }).click();
    const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === contextPath);
    await first.getByRole("button", { name: "Show full file", exact: true }).click();
    const liveContext = await loaded;
    assert.equal(liveContext.status(), 200);
    assert.equal(liveContext.request().method(), "GET");
    const contextUrl = liveContext.url(), query = new URL(contextUrl).searchParams;
    assert.deepEqual([...query.keys()].sort(), ["file", "handle"], "Context transport has no checkout, path or revision authority");
    assert.match(query.get("handle"), /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    assert.equal(query.get("file"), "0");
    const snapshot = await liveContext.json();
    const proposedDraft = readFileSync(draftPath, "utf8");
    assert.equal(proposedDraft.trimEnd().split("\n").length, 5000);
    assert.equal(snapshot.oldFile.contents, beforeDraft);
    assert.equal(snapshot.newFile.contents, proposedDraft);
    await jumpTo(first, "Side-by-side diff", 2500, "Plugin context 2500");
    assert.ok(await first.getByRole("region", { name: "Side-by-side diff", exact: true }).locator("[data-line]").count() < 1000,
      "Full-file reading remains virtualized");
    assert.equal(contextReads.length, 1);
    await first.getByRole("button", { name: "Diff context", exact: true }).click();
    await card.getByRole("button", { name: "Unified", exact: true }).click();
    await first.getByRole("button", { name: "Show full file", exact: true }).click();
    await jumpTo(first, "Unified diff", 2500, "Plugin context 2500");
    await version(first, "Before").click();
    await jumpTo(first, "Before file", 50, beforeLines[49]);
    await jumpTo(first, "Before file", 4500, beforeLines[4499]);
    await version(first, "After").click();
    await jumpTo(first, "After file", 50, candidate);
    await jumpTo(first, "After file", 4500, distantCandidate);
    await first.getByRole("searchbox", { name: "Search full file", exact: true }).fill("plugin context 2500");
    await first.getByRole("button", { name: "Next match", exact: true }).click();
    await expectLine(first, "After file", 2500, "Plugin context 2500");
    await first.getByText("1/1 matches", { exact: true }).waitFor();
    await fileToggle(first, "draft.txt").click();
    assert.equal(await first.locator(".git-diff-code-view").count(), 0, "Collapsed file renderers unmount");
    await fileToggle(first, "draft.txt").click();
    assert.equal(await version(first, "After").getAttribute("aria-pressed"), "true");
    assert.equal(await first.getByRole("searchbox", { name: "Search full file", exact: true }).inputValue(), "plugin context 2500");
    await expectLine(first, "After file", 2500, "Plugin context 2500");
    await version(first, "Changes").click();
    assert.equal(await first.getByRole("button", { name: "Diff context", exact: true }).getAttribute("aria-pressed"), "true");
    await fileToggle(second, "second-draft.txt").click();
    await second.getByRole("region", { name: "Unified diff", exact: true }).waitFor();
    assert.equal(await second.getByRole("button", { name: "Show full file", exact: true }).getAttribute("aria-pressed"), "false",
      "Showing one full file does not expand another file's context");
    await card.getByRole("button", { name: "Collapse all files", exact: true }).click();
    assert.equal(await card.locator(".git-diff-code-view").count(), 0);
    await card.getByRole("button", { name: "Expand all files", exact: true }).click();
    await first.getByRole("region", { name: "Unified diff", exact: true }).waitFor();
    await first.getByRole("button", { name: "Diff context", exact: true }).waitFor();
    await card.getByRole("button", { name: "Collapse", exact: true }).click();
    await page.getByRole("button", { name: /Awaiting response.*Git commit/ }).click();
    await first.getByRole("region", { name: "Unified diff", exact: true }).waitFor();
    assert.equal(contextReads.length, 1, "View/version switches, file/card collapse and Expand all files reuse only the requested snapshot");

    await card.getByRole("button", { name: "Side by side", exact: true }).click();
    const beforeWide = decisions().length;
    await first.getByRole("button", { name: "Wide view", exact: true }).click();
    const wide = page.getByRole("dialog", { name: "Review file: draft.txt", exact: true });
    await wide.waitFor();
    await jumpTo(wide, "Side-by-side diff", 4500, distantCandidate);
    await wide.getByRole("button", { name: "Close wide view", exact: true }).focus();
    await page.keyboard.press("Escape");
    await wide.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.textContent === "Wide view");
    assert.equal(decisions().length, beforeWide, "Escape from wide reading neither rejects the approval nor aborts the session");
    assert.equal(await card.getByRole("button", { name: "Approve commit", exact: true }).isEnabled(), true);
    assert.equal(tip(), before, "Context and wide reading are display-only");
    await checkBlockingCard(card);
    await page.screenshot({ path: join(artifacts, `git-plugin-approval-${width}.png`) });
    await first.getByRole("button", { name: "Diff context", exact: true }).click();
    await card.getByRole("button", { name: "Raw patch", exact: true }).click();
    assert.equal(await first.getByRole("region", { name: "Raw patch", exact: true }).textContent(), reviewedPatch);
    assert.equal(await completeRaw(card).locator("pre").textContent(), reviewedCompletePatch, "Reading context never rewrites the approved patch");
    await card.getByRole("button", { name: "Approve commit", exact: true }).click();
    await finish("reconnect", "completed"); assert.notEqual(tip(), before);
    const receipt = page.locator("[data-interaction-receipt]").last();
    await receipt.waitFor();
    const receiptId = await receipt.getAttribute("data-interaction-receipt");
    assert.equal(decisions().length, 1);
    assert.equal(decisions()[0].action, "approve");
    assert.equal(decisions()[0].id, receiptId);
    const committedTip = tip(), committedDraft = readFileSync(draftPath);
    const changedDraft = "Changed after approval — not the historical diff or full-file context\n";
    writeFileSync(draftPath, changedDraft);
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      const historical = page.locator(`[data-interaction-receipt="${receiptId}"]`);
      await historical.waitFor();
      assert.equal(await historical.count(), 1);
      assert.equal(contextReads.length, 1, "Collapsed historical receipts never load context");
      const saved = await page.request.get(`${base}/api/sessions/${sessionId}?tail=1000&tree=summary`);
      assert.ok(saved.ok(), await saved.text());
      const receipts = (await saved.json()).context.messages.filter((message) => message.role === "custom"
        && message.customType === "pi-web:interaction-receipt" && message.details?.request?.id === receiptId);
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0].details.request.patchContext, query.get("handle"), "Saved receipt carries the original opaque snapshot handle");
      assert.equal(receipts[0].details.request.patch, reviewedCompletePatch);
      await historical.getByRole("button", { name: /Answered.*Git commit/ }).click();
      const group = historical.getByRole("group", { name: "Git commit", exact: true });
      const historicalFile = group.getByRole("region", { name: "File changes: draft.txt", exact: true });
      await checkBlockingCard(group);
      // Raw was persisted before approval; choose split explicitly rather than
      // assuming receipt expansion resets the shared browser view preference.
      await group.getByRole("button", { name: "Side by side", exact: true }).click();
      await historicalFile.getByRole("region", { name: "Side-by-side diff", exact: true }).waitFor();
      assert.equal(contextReads.length, 1, "Opening a receipt's patch still does not load full-file context");
      const historicalLoaded = page.waitForResponse(contextUrl);
      await historicalFile.getByRole("button", { name: "Show full file", exact: true }).click();
      const historicalContext = await historicalLoaded;
      assert.equal(historicalContext.status(), 200);
      assert.deepEqual(await historicalContext.json(), snapshot, "Historical Before/After use the immutable reviewed trees, not current files or HEAD");
      assert.equal(contextReads.length, 2);
      assert.equal(contextReads[1].url(), contextUrl);
      await jumpTo(historicalFile, "Side-by-side diff", 2500, "Plugin context 2500");
      await version(historicalFile, "Before").click();
      await jumpTo(historicalFile, "Before file", 50, beforeLines[49]);
      await version(historicalFile, "After").click();
      await jumpTo(historicalFile, "After file", 50, candidate);
      await jumpTo(historicalFile, "After file", 4500, distantCandidate);
      await version(historicalFile, "Changes").click();
      await group.getByRole("button", { name: "Raw patch", exact: true }).click();
      assert.equal(await historicalFile.getByRole("region", { name: "Raw patch", exact: true }).textContent(), reviewedPatch);
      await group.getByText("Decision only — see the tool result for execution outcome.", { exact: true }).waitFor();
      assert.equal(await group.getByRole("button", { name: /Approve commit|Reject|Cancel/ }).count(), 0);
      await group.getByRole("button", { name: "Collapse", exact: true }).click();
      assert.equal(await historical.getByRole("region", { name: "Raw patch", exact: true }).count(), 0);
      assert.equal(await historical.locator(".git-diff-code-view").count(), 0, "Collapsed historical diff bodies unmount");

      // Remount so the successful context cache cannot hide the deliberate
      // expired-snapshot response. Only this exact opaque request may fail.
      await historical.getByRole("button", { name: /Answered.*Git commit/ }).click();
      await group.getByRole("button", { name: "Side by side", exact: true }).click();
      await historicalFile.getByRole("region", { name: "Side-by-side diff", exact: true }).waitFor();
      assert.equal(contextReads.length, 2);
      const expiredBody = { error: "This context snapshot has expired or the server restarted; the saved patch remains available." };
      const refuseContext = (route) => route.fulfill({ status: 409, json: expiredBody });
      await page.route(contextUrl, refuseContext);
      try {
        await withExpectedBrowserConflict(page, { scenario: "expired historical plugin context", url: contextUrl, method: "GET", body: null }, async () => {
          const refusedResponse = page.waitForResponse(contextUrl);
          await historicalFile.getByRole("button", { name: "Show full file", exact: true }).click();
          const refused = await refusedResponse;
          assert.equal(refused.status(), 409);
          assert.deepEqual(await refused.json(), expiredBody);
          const alert = historicalFile.getByRole("alert");
          await alert.waitFor();
          assert.ok((await alert.textContent()).includes(expiredBody.error));
          assert.equal(await historicalFile.getByRole("region", { name: "Side-by-side diff", exact: true }).isVisible(), true);
          await group.getByRole("button", { name: "Raw patch", exact: true }).click();
          assert.equal(await historicalFile.getByRole("region", { name: "Raw patch", exact: true }).textContent(), reviewedPatch,
            "Unavailable context leaves the exact saved raw patch readable");
          assert.equal(contextReads.length, 3, "Expired context is not retried automatically");
          assert.equal(decisions().length, 1, "Read-only context controls never submit an approval or cancellation");
          assert.equal(tip(), committedTip);
          return refused;
        });
      } finally {
        await page.unroute(contextUrl, refuseContext);
      }
      await group.getByRole("button", { name: "Collapse", exact: true }).click();
      assert.equal(await historical.getByRole("region", { name: "Raw patch", exact: true }).count(), 0);
      assert.equal(decisions().length, 1);
      assert.equal(tip(), committedTip, "Historical review cannot execute the approval again");
      assert.equal(readFileSync(draftPath, "utf8"), changedDraft, "Historical context never modifies the current file");
    } finally {
      writeFileSync(draftPath, committedDraft);
    }
  } finally {
    page.off("request", recordReviewRequest);
  }

  await patch({ targetBranch: "target" });
  for (const [action, title] of [["rebase", "Git rebase"], ["merge", "Git merge"], ["createWorktree", "Create Git worktree"], ["attachWorktree", "Attach Git worktree"], ["removeWorktree", "Remove Git worktree"]]) {
    card = await start(`preview-${action}`, title);
    if (action === "rebase" || action === "merge") {
      await card.getByText("feature → target", { exact: true }).waitFor();
      await card.getByRole("region", { name: "Operation notes", exact: true }).getByText(/not a predicted rebase\/merge result/).waitFor();
      await card.getByRole("group", { name: "Patch view" }).waitFor();
    } else assert.equal(await card.getByRole("group", { name: "Patch view" }).count(), 0);
    await card.getByRole("button", { name: "Reject", exact: true }).click();
    await finish(`preview-${action}`, "refused");
  }
  card = await start("cancel");
  const beforeCancel = tip();
  await card.getByRole("button", { name: "Cancel", exact: true }).focus();
  await page.keyboard.press("Escape");
  await finish("cancel", "refused"); assert.equal(tip(), beforeCancel);

  // An unrelated repository uses its own Ask/check settings, never the caller's Deny.
  const foreign = `${repo}-foreign`;
  const foreignGit = (...args) => execFileSync("git", ["-C", foreign, "-c", "commit.gpgSign=false", ...args], { encoding: "utf8" }).trim();
  if (!existsSync(foreign)) {
    execFileSync("git", ["init", "-b", "delivery", foreign], { stdio: "ignore" });
    foreignGit("config", "user.name", "E2E"); foreignGit("config", "user.email", "e2e@example.invalid");
    writeFileSync(join(foreign, "draft.txt"), "Foreign initial draft\n");
    writeFileSync(join(foreign, "second-draft.txt"), "Foreign initial second draft\n");
    foreignGit("add", "."); foreignGit("commit", "-m", "Foreign initial");
  }
  await patch({ commit: "deny", commitChecks: [{ name: "Caller check must not run", command: "exit 7" }] }, "project");
  // Settings use the ordinary browser workspace-selection authorization.
  const selected = await page.request.post(`${base}/api/cwd/validate`, { data: { cwd: foreign } });
  assert.ok(selected.ok(), await selected.text());
  const selectedCheck = `test "$PWD" = '${foreign}'`;
  await patch({ commit: "ask", commitChecks: [{ name: "Selected checkout check", command: selectedCheck }] }, "project", [], foreign);
  const ownTip = tip(); const foreignBefore = foreignGit("rev-parse", "HEAD");
  card = await start("cross-approve");
  await card.getByText(foreign, { exact: true }).waitFor();
  await card.getByRole("region", { name: "Required checks", exact: true }).getByText(selectedCheck, { exact: true }).waitFor();
  await card.getByRole("button", { name: "Approve commit", exact: true }).click();
  await finish("cross-approve", "completed");
  assert.notEqual(foreignGit("rev-parse", "HEAD"), foreignBefore); assert.equal(tip(), ownTip);
  const foreignCommitted = foreignGit("rev-parse", "HEAD");
  card = await start("cross-cancel");
  await patch({ commit: "allow" }, "project"); await card.waitFor();
  await patch({ commit: "deny" }, "project", [], foreign); await card.waitFor({ state: "hidden" });
  await finish("cross-cancel", "refused");
  assert.equal(foreignGit("rev-parse", "HEAD"), foreignCommitted); assert.equal(tip(), ownTip);
  await patch({}, "project", ["commit", "commitChecks"]);

  card = await start("disable");
  await patch({ enabled: false }); await card.waitFor({ state: "hidden" });
  await finish("disable", "refused");
  assert.equal((await command({ type: "get_tools" })).some((tool) => tool.name === "git_commit" && tool.active), false);
  await patch({ enabled: true });
  card = await start("stop");
  const beforeStop = tip();
  if (width <= 600) await page.locator("textarea").last().press("Escape");
  else await page.getByRole("button", { name: "Stop", exact: true }).click();
  await card.waitFor({ state: "hidden" });
  assert.equal(tip(), beforeStop);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("textarea").last().waitFor();
  assert.equal(await page.getByRole("group", { name: "Git commit", exact: true }).count(), 0);
  await page.locator("[data-interaction-receipt]").last().getByRole("button", { name: /Interrupted.*Git commit/ }).waitFor();
  // Allow still creates one durable outcome card and never a decision receipt.
  await patch({ commit: "allow" }, "project");
  const decisionsBeforeAllow = await page.locator("[data-interaction-receipt]").count();
  await page.locator("textarea").last().fill(`/e2e-git-plugin allow-${width}`);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await finish("allow", "completed");
  assert.equal(await page.locator("[data-interaction-receipt]").count(), decisionsBeforeAllow);
  const allowed = page.locator("[data-operation-receipt]").last();
  await allowed.getByRole("button", { name: /Succeeded/ }).waitFor();
  const operationId = await allowed.getAttribute("data-operation-receipt");
  await page.reload({ waitUntil: "domcontentloaded" });
  const saved = page.locator(`[data-operation-receipt="${operationId}"]`);
  await saved.getByRole("button", { name: /Succeeded/ }).click();
  await saved.getByText("Policy authorized · allow · project", { exact: true }).waitFor();
  assert.equal(await saved.getByRole("button", { name: "Approve commit", exact: true }).count(), 0);
  assert.equal(await page.locator(`[data-operation-receipt="${operationId}"]`).count(), 1);
  await saved.getByRole("button", { name: "Collapse", exact: true }).click();
  await patch({}, "project", ["commit"]);

  // One approval covers compact artifact inventory, linked worktree and local ref.
  const cleanupRepo = `${repo}-cleanup-${width}`;
  execFileSync("git", ["init", "-qb", "main", cleanupRepo]);
  const cleanupGit = (...args) => execFileSync("git", ["-C", cleanupRepo, "-c", "commit.gpgSign=false", ...args], { encoding: "utf8" }).trim();
  cleanupGit("config", "user.name", "E2E"); cleanupGit("config", "user.email", "e2e@example.invalid");
  writeFileSync(join(cleanupRepo, ".gitignore"), "node_modules/\n.codegraph/\n");
  cleanupGit("add", "."); cleanupGit("commit", "-qm", "Cleanup base");
  const cleanupPath = join(`${cleanupRepo}-worktrees`, "cleanup");
  cleanupGit("worktree", "add", "-b", "cleanup", cleanupPath);
  execFileSync("git", ["-C", cleanupPath, "-c", "commit.gpgSign=false", "commit", "--allow-empty", "-qm", "Integrated feature"]);
  cleanupGit("merge", "--no-ff", "--no-edit", "cleanup");
  for (const root of ["node_modules", ".codegraph"]) { mkdirSync(join(cleanupPath, root)); writeFileSync(join(cleanupPath, root, "generated"), "fixture artifact"); }
  assert.ok((await page.request.post(`${base}/api/cwd/validate`, { data: { cwd: cleanupRepo } })).ok());
  await patch({ cleanupFeature: "ask", targetBranch: "main", approvedArtifactRoots: "node_modules, .codegraph" }, "project", [], cleanupRepo);
  card = await start("cleanup", "Clean up integrated Git feature");
  await card.getByText(/entries · .* bytes · SHA256/).first().waitFor();
  await card.getByRole("button", { name: "Clean up listed resources", exact: true }).click();
  await finish("cleanup", "completed");
  assert.equal(existsSync(cleanupPath), false); assert.equal(cleanupGit("branch", "--list", "cleanup"), "");
  const cleanupReceipt = page.locator("[data-operation-receipt]").last();
  await cleanupReceipt.getByRole("button", { name: /Succeeded/ }).click();
  await cleanupReceipt.getByText("User approved · ask · project", { exact: true }).waitFor();
  await checkBlockingCard(cleanupReceipt.getByRole("group", { name: "Clean up integrated Git feature", exact: true }));
  await cleanupReceipt.getByRole("button", { name: "Collapse", exact: true }).click();
  console.log(`PASS: ${width}px durable Ask/Allow outcomes and bounded combined cleanup; all Git approval layouts, lazy snapshot context in split/unified/Before/After, search/navigation/collapse, wide Escape, exact read-only historical context and expired raw fallback, cross-repository settings, toggle, rejection, reconnect and Stop`);
}
