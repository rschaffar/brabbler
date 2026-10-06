import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { checkBlockingCard } from "./blocking-card.mjs";

/** Fixture-only command delegates to the production plugin implementation, no model. */
export function gitPluginFixtureSource(root) {
  return `import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { executeGitOperation } from ${JSON.stringify(join(root, "plugins/git-workflow/server.ts"))};
export default function (pi) {
  pi.registerCommand("e2e-git-plugin", { handler: async (mode, ctx) => {
    let operation;
    if (mode.startsWith("preview-")) {
      const action = mode.split("-")[1];
      const targetCheckout = execFileSync("git", ["-C", ctx.cwd, "worktree", "list", "--porcelain"], { encoding: "utf8" }).split("\\n\\n").find((record) => record.includes("branch refs/heads/target")).split("\\n")[0].slice(9);
      operation = action === "rebase" || action === "merge"
        ? { action, checkout: action === "merge" ? targetCheckout : ctx.cwd, featureBranch: "feature" }
        : action === "removeWorktree" ? { action, checkout: ctx.cwd, path: targetCheckout }
        : { action, checkout: ctx.cwd, branch: action === "attachWorktree" ? "comparison-base" : "preview-new", baseBranch: action === "attachWorktree" ? "comparison-base" : "target", path: join(ctx.cwd + "-worktrees", "preview-new") };
    } else {
      writeFileSync(join(ctx.cwd, "draft.txt"), "Plugin whole-file candidate " + mode + "\\n");
      writeFileSync(join(ctx.cwd, "second-draft.txt"), "Second plugin candidate " + mode + "\\n");
      operation = { action: "commit", checkout: ctx.cwd, mode: "files", files: ["draft.txt", "second-draft.txt"], message: "Plugin browser commit " + mode };
    }
    const result = await executeGitOperation(ctx.cwd, operation, ctx.ui);
    ctx.ui.notify("Git plugin fixture " + mode + ": " + (result.isError ? "refused" : "completed"));
  } });
}`;
}
export async function checkGitWorkflowPlugin(page, base, repo, sessionId, artifacts, width) {
  const command = async (body) => {
    const response = await page.request.post(`${base}/api/agent/${sessionId}`, { data: body });
    assert.ok(response.ok(), await response.text()); return (await response.json()).data;
  };
  const patch = async (set, scope = "global", reset = []) => {
    const response = await page.request.patch(`${base}/api/plugins/bundled`, { data: { pluginId: "git-workflow", cwd: repo, scope, set, reset } });
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
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  if (width <= 600) await page.locator(".sidebar-overlay-backdrop").click({ position: { x: width - 10, y: 200 } });
  assert.ok((await command({ type: "get_tools" })).some((tool) => tool.name === "git_commit" && tool.active));

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

  card = await start("reconnect");
  await page.reload({ waitUntil: "domcontentloaded" });
  card = page.getByRole("group", { name: "Git commit", exact: true }); await card.waitFor();
  await card.getByText(/Plugin browser commit reconnect/).first().waitFor();
  const first = card.getByRole("region", { name: "File changes: draft.txt", exact: true });
  const second = card.getByRole("region", { name: "File changes: second-draft.txt", exact: true });
  await first.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  assert.equal(await second.getByRole("button").getAttribute("aria-expanded"), "false");
  assert.equal(await card.getByRole("group", { name: "Patch view" }).count(), 1);
  await second.getByRole("button").click();
  await second.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await card.getByRole("button", { name: "Unified", exact: true }).click();
  await first.getByRole("region", { name: "Unified diff" }).waitFor();
  await second.getByRole("region", { name: "Unified diff" }).waitFor();
  await card.getByRole("button", { name: "Collapse all", exact: true }).click();
  assert.equal(await card.getByRole("region", { name: "Unified diff" }).count(), 0);
  await card.getByRole("button", { name: "Expand all", exact: true }).click();
  await first.getByRole("region", { name: "Unified diff" }).waitFor();
  await card.getByRole("button", { name: "Collapse", exact: true }).click();
  await page.getByRole("button", { name: /Awaiting response.*Git commit/ }).click();
  await first.getByRole("region", { name: "Unified diff" }).waitFor();
  await card.getByRole("button", { name: "Side by side", exact: true }).click();
  await checkBlockingCard(card);
  await page.screenshot({ path: join(artifacts, `git-plugin-approval-${width}.png`) });
  await card.getByRole("button", { name: "Approve commit", exact: true }).click();
  await finish("reconnect", "completed"); assert.notEqual(tip(), before);

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
  console.log(`PASS: ${width}px all Git approval layouts, multi-file diffs, toggle, rejection, reconnect and Stop`);
}
