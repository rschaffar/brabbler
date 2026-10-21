import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createOwnedRoutes } from "./owned-routes.mjs";

const fence = value => "```pi-review\n" + JSON.stringify(value, null, 2) + "\n```";
export function seedReviewNotebooks({ gitProject, targetWorktree, env, writeSession, message }) {
  const git = (...args) => execFileSync("git", ["-C", gitProject, ...args], { env, encoding: "utf8" }).trim();
  const id = "e2e-review-notebook";
  const oid = git("rev-parse", "feature"), prior = git("rev-parse", "comparison-base");
  const common = { version: 1, cwd: gitProject, branch: "feature", oid, priority: "thorough" };
  const source = { ...common, kind: "source", id: "pinned-code", title: "Pinned code", path: "z-context.txt", start: 49, end: 51 };
  const text = "# Review notebook\n\nFollow the important change, not the mutable checkout.\n\n" + fence(source) + "\n\n" +
    fence({ ...source, id: "unchanged-context", title: "Unchanged context", oid: prior }) + "\n\n" +
    fence({ ...common, kind: "commit", id: "feature-commit", title: "Feature changes" }) + "\n\n" +
    fence({ ...source, version: 99, title: "<script>globalThis.REVIEW_BAD=true</script>" }) + "\n\n" +
    "```pi-review\n{broken JSON\n```\n\n";
  const document = join(targetWorktree, "review-notebook.md");
  writeFileSync(document, text);
  writeSession(id, [message("review-user", null, "user", "Guided review fixture"),
    message("review-answer", "review-user", "assistant", [{ type: "text", text: text +
      `\n\n[Open review document](${document})\n\n[Open working source](${join(gitProject, "z-context.txt")}#L50)` }])], targetWorktree);
  writeFileSync(join(gitProject, "z-context.txt"), readFileSync(join(gitProject, "z-context.txt"), "utf8").replace("Explorer changed 50\n", "WORKING TREE ONLY\n"));
  return { id, document, gitProject, targetWorktree, oid, prior, git };
}

export async function checkReviewNotebooks(page, { base, fixture: f }) {
  const before = [f.git("rev-parse", "HEAD"), f.git("status", "--porcelain"), readFileSync(f.document, "utf8")];
  const requests = [], writes = [];
  const observe = request => {
    const url = new URL(request.url());
    if (url.pathname === "/api/git/explorer" && url.searchParams.get("cwd") === f.gitProject) requests.push(url);
    if (url.pathname.startsWith("/api/git/") && request.method() !== "GET") writes.push(request.url());
  };
  page.on("request", observe);
  const stop = (scope, id) => scope.locator(`[data-review-stop="${id}"]`);
  const activate = async button => {
    if (page.viewportSize().width > 700) { await button.focus(); await page.keyboard.press("Enter"); }
    else await button.tap();
  };
  try {
    await page.goto(`${base}/?session=${f.id}`, { waitUntil: "domcontentloaded" });
    const chat = page.locator("[data-message-text]");
    await stop(chat, "pinned-code").getByRole("button", { name: "Expand source", exact: true }).waitFor();
    await stop(chat, "feature-commit").scrollIntoViewIfNeeded();
    assert.equal(requests.length, 0, "Visible collapsed blocks perform no Git reads");
    assert.equal(await page.locator(".review-notebook-invalid").count(), 2);
    assert.equal(await page.locator(".review-notebook-invalid button").filter({ hasText: "Expand source" }).count(), 0);
    assert.equal(await page.evaluate(() => globalThis.REVIEW_BAD), undefined);

    const exercise = async scope => {
      const source = stop(scope, "pinned-code");
      const n = requests.length;
      await activate(source.getByRole("button", { name: "Expand source", exact: true }));
      await source.getByRole("region", { name: "Pinned source z-context.txt", exact: true }).waitFor();
      assert.deepEqual(await source.locator(".review-notebook-source-line").allTextContents(), ["49Context line 49", "50Explorer changed 50", "51Context line 51"]);
      assert.equal(requests.slice(n).filter(url => ["patch", "context"].includes(url.searchParams.get("op"))).length, 0);
      const identity = requests.slice(n).find(url => url.searchParams.get("op") === "source");
      assert.equal(identity.searchParams.get("oid"), f.oid); assert.equal(identity.searchParams.get("head"), f.oid);
      assert.equal(identity.searchParams.get("branch"), "feature"); assert.equal(identity.searchParams.get("start"), "49");
      await source.getByRole("button", { name: "Collapse source", exact: true }).click();
      await source.getByRole("button", { name: "Show file diff", exact: true }).click();
      await source.getByRole("button", { name: "Show full file", exact: true }).waitFor();
      await source.getByRole("button", { name: "Unified", exact: true }).click();
      const contexts = requests.filter(url => url.searchParams.get("op") === "context").length;
      await source.getByRole("button", { name: "Show full file", exact: true }).click();
      await source.getByRole("button", { name: "Diff context", exact: true }).waitFor();
      assert.ok(requests.filter(url => url.searchParams.get("op") === "context").length > contexts);
      await source.getByRole("group", { name: "File version", exact: true }).getByRole("button", { name: "Before", exact: true }).click();
      await source.getByRole("region", { name: "Before file", exact: true }).waitFor();
      assert.doesNotMatch(await source.innerText(), /WORKING TREE ONLY/);
      await source.getByRole("button", { name: "Collapse file diff", exact: true }).click();
      const unchanged = stop(scope, "unchanged-context");
      await unchanged.getByRole("button", { name: "Expand source", exact: true }).click();
      await unchanged.getByText("Context line 50", { exact: true }).waitFor();
      await unchanged.getByRole("button", { name: "Collapse source", exact: true }).click();
      const commit = stop(scope, "feature-commit");
      await commit.getByRole("button", { name: "Expand commit", exact: true }).click();
      await commit.getByRole("region", { name: "Git commit details", exact: true }).waitFor();
      await commit.getByText("second feature", { exact: true }).waitFor();
      await commit.getByRole("button", { name: "Collapse commit", exact: true }).click();
      for (const card of await scope.locator(".review-notebook-block").all()) {
        const bounds = await card.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width + 1, "Review stop stays inside its pane");
      }
    };
    await exercise(chat);
    const reveal = stop(chat, "pinned-code").getByRole("button", { name: "Reveal in Git Explorer", exact: true });
    const urlBefore = page.url();
    await reveal.click();
    const explorer = page.getByRole("region", { name: "Git Explorer", exact: true });
    await explorer.getByRole("region", { name: "Git commit details", exact: true }).getByText("second feature", { exact: true }).waitFor();
    assert.equal(page.url(), urlBefore, "Reveal does not relocate the session");
    if (page.viewportSize().width < 700) await explorer.getByRole("button", { name: "← Back to commits", exact: true }).click();
    const historyBranch = explorer.getByRole("combobox", { name: "History branch", exact: true });
    // Detail and graph load independently. Wait for this graph's actual branch inventory,
    // not merely the faster commit-detail response, before asserting its selection.
    await historyBranch.locator('option[value="feature"]').waitFor({ state: "attached" });
    assert.equal(await historyBranch.inputValue(), "feature");
    await explorer.locator("[aria-pressed=true]").filter({ hasText: "second feature" }).waitFor();
    await activate(explorer.getByRole("button", { name: "Return to workspace history", exact: true }));
    await page.waitForFunction(() => Boolean(document.activeElement?.closest("#git-explorer-panel")));
    await page.getByRole("region", { name: "Git Explorer", exact: true }).getByRole("combobox", { name: "History branch", exact: true }).selectOption("target");
    await page.getByRole("button", { name: "Close Git Explorer", exact: true }).click();
    await reveal.click();
    await page.getByRole("region", { name: "Git commit details", exact: true }).getByText("second feature", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Close Git Explorer", exact: true }).click();

    if (page.viewportSize().width > 700) for (const close of [false, true]) {
      let release, entered;
      const gate = new Promise(resolve => { release = resolve; });
      const seen = new Promise(resolve => { entered = resolve; });
      const match = url => url.pathname === "/api/git/explorer" && url.searchParams.get("cwd") === f.gitProject && url.searchParams.get("op") === "commit" && url.searchParams.get("oid") === f.prior;
      const routes = createOwnedRoutes(async route => {
        const response = await route.fetch(); entered(); await gate; await route.fulfill({ response });
      }, route => route.continue());
      await page.route(match, routes.handler);
      try {
        if (close) {
          await reveal.click();
          await page.getByRole("region", { name: "Git commit details", exact: true }).getByText("second feature", { exact: true }).waitFor();
        }
        const slow = stop(chat, "unchanged-context");
        await slow.getByRole("button", { name: "Reveal in Git Explorer", exact: true }).click();
        await seen;
        if (close) await page.getByRole("button", { name: "Close Git Explorer", exact: true }).click();
        else {
          await reveal.click();
          await page.getByRole("region", { name: "Git commit details", exact: true }).getByText("second feature", { exact: true }).waitFor();
        }
        release();
        await slow.getByRole("button", { name: "Reveal in Git Explorer", exact: true }).waitFor();
        if (close) assert.equal(await page.locator("#git-explorer-panel").count(), 0, "Late reveal cannot reopen a closed panel");
        else {
          await page.getByRole("region", { name: "Git commit details", exact: true }).getByText("second feature", { exact: true }).waitFor();
          await page.getByRole("button", { name: "Close Git Explorer", exact: true }).click();
        }
      } finally { release(); await routes.dispose(handler => page.unroute(match, handler)); }
    }

    const beforePreview = requests.length;
    await page.getByRole("link", { name: "Open review document", exact: true }).click();
    const preview = page.locator("#file-panel .markdown-body");
    await stop(preview, "pinned-code").waitFor();
    assert.equal(requests.length, beforePreview, "File preview also leaves review blocks inert");
    await exercise(preview);
    await page.locator("#file-panel").getByRole("button", { name: "Hide file panel", exact: true }).click();
    await page.getByRole("link", { name: "Open working source", exact: true }).click();
    await page.locator("#file-panel").getByText("WORKING TREE ONLY", { exact: true }).waitFor();
    assert.deepEqual(writes, []);
    assert.deepEqual([f.git("rev-parse", "HEAD"), f.git("status", "--porcelain"), readFileSync(f.document, "utf8")], before);
    console.log(`PASS: ${page.viewportSize().width}px lazy revision-bound review stops, immutable diff/context, file previews, explicit Explorer reveal and read-only navigation`);
  } finally {
    page.off("request", observe);
    // Leave the next owned Markdown chain a clean presentation without touching its fixtures.
    await page.goto(`${base}/?session=${f.id}`, { waitUntil: "domcontentloaded" });
  }
}
