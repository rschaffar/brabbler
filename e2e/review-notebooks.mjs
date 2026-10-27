import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createOwnedRoutes } from "./owned-routes.mjs";
import { checkGuidedReviewWorkflow } from "./guided-review-workflow.mjs";

const fence = value => "```pi-review\n" + JSON.stringify(value, null, 2) + "\n```";
export function seedReviewNotebooks({ gitProject, targetWorktree, env, writeSession, message }) {
  const git = (...args) => execFileSync("git", ["-C", gitProject, ...args], { env, encoding: "utf8" }).trim();
  const id = "e2e-review-notebook";
  const oid = git("rev-parse", "feature"), prior = git("rev-parse", "comparison-base");
  const tree = git("rev-parse", `${oid}^{tree}`);
  let historyTip = oid, deepOid;
  for (let i = 0; i < 45; i++) {
    historyTip = git("commit-tree", tree, "-p", historyTip, "-m", `Review history ${i}`);
    if (i === 14) deepOid = historyTip; // row 30: loaded, but below either viewport.
  }
  git("branch", "review-history", historyTip);
  const common = { version: 1, cwd: gitProject, branch: "feature", oid, priority: "thorough" };
  const source = { ...common, kind: "source", id: "pinned-code", title: "Pinned code", path: "z-context.txt", start: 49, end: 51 };
  const text = "# Review notebook\n\nFollow the important change, not the mutable checkout.\n\n" + fence(source) + "\n\n" +
    fence({ ...source, id: "unchanged-context", title: "Unchanged context", oid: prior }) + "\n\n" +
    fence({ ...source, id: "highlighted-code", title: "Highlighted code", path: "review-source.tsx", start: 2, end: 6 }) + "\n\n" +
    fence({ ...common, kind: "commit", id: "feature-commit", title: "Feature changes" }) + "\n\n" +
    fence({ ...common, kind: "commit", id: "deep-history", title: "Earlier review step", branch: "review-history", oid: deepOid }) + "\n\n" +
    fence({ ...source, version: 99, title: "<script>globalThis.REVIEW_BAD=true</script>" }) + "\n\n" +
    "```pi-review\n{broken JSON\n```\n\n";
  const document = join(targetWorktree, "review-notebook.md");
  writeFileSync(document, text);
  const guidedFolder = join(targetWorktree, "guided-review"); mkdirSync(guidedFolder);
  const guidedIndex = join(guidedFolder, "index.md");
  const metadata = (language, value) => `\`\`\`${language}\n${JSON.stringify(value)}\n\`\`\`\n`;
  writeFileSync(guidedIndex, "# Guided review\n\n" + metadata("pi-notebook", { version: 1, id: "reader-bridge", title: "Guided reader bridge", chapters: [
    { id: "ordering", title: "Ordering", path: "ordering.md" }, { id: "failure", title: "Failure behavior", path: "failure.md" },
  ] }));
  writeFileSync(join(guidedFolder, "ordering.md"), metadata("pi-step", { version: 1, id: "inspect", title: "Inspect the immutable evidence" }) +
    "Compare the implementation with its surrounding context.\n\n" +
    metadata("pi-question", { version: 1, id: "constructor", shortLabel: "Judgment", question: "Is the boundary understandable?", type: "single", required: true, options: [{ id: "clear", title: "Clear" }, { id: "inspect", title: "Needs inspection" }], explanation: "The author recommends checking rejection before extraction, not grading the reviewer." }) +
    metadata("pi-question", { version: 1, id: "notes", shortLabel: "Understanding", question: "What did you inspect?", type: "text", required: false }) +
    metadata("pi-question", { version: 1, id: "design", shortLabel: "Design", question: "Which design properties matter?", type: "multiple", required: false, options: [{ id: "local", title: "Locality" }, { id: "durable", title: "Durability" }, { id: "none", title: "None", exclusive: true }] }) +
    fence({ ...source, id: "guided-source" }) + "\n\n" +
    fence({ ...source, id: "guided-code", title: "Implementation", path: "review-source.tsx", start: 2, end: 6 }) + "\n\n" +
    metadata("pi-evidence", { version: 1, kind: "compare", id: "guided-range", title: "Whole feature range", cwd: gitProject, branch: "feature", base: prior, candidate: oid, path: "z-context.txt" }) + "\n\n" +
    metadata("pi-evidence", { version: 1, kind: "file", id: "guided-image", title: "Working diagram", path: "assets/pixel.png" }));
  mkdirSync(join(guidedFolder, "assets"));
  // Reviewed inline one-pixel raster; no network/codec-generation dependency.
  writeFileSync(join(guidedFolder, "assets/pixel.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=", "base64"));
  writeFileSync(join(guidedFolder, "failure.md"), metadata("pi-step", { version: 1, id: "failure-step", title: "Check the failure boundary" }) +
    "This second step lives in another chapter file.\n\n" + metadata("pi-evidence", { version: 1, kind: "web", id: "reference", title: "External background", url: "https://example.invalid/no-auto-read" }));
  writeSession(id, [message("review-user", null, "user", "Guided review fixture"),
    message("review-answer", "review-user", "assistant", [{ type: "text", text: text +
      `\n\n[Open review document](${document})\n\n[Open guided review](${guidedIndex})\n\n[Open working source](${join(gitProject, "z-context.txt")}#L50)` }])], targetWorktree);
  writeFileSync(join(gitProject, "z-context.txt"), readFileSync(join(gitProject, "z-context.txt"), "utf8").replace("Explorer changed 50\n", "WORKING TREE ONLY\n"));
  writeFileSync(join(gitProject, "review-source.tsx"), "WORKING CODE ONLY\n");
  return { id, document, guidedIndex, gitProject, targetWorktree, oid, prior, deepOid, git };
}

export async function checkReviewNotebooks(page, { base, fixture: f }) {
  const before = [f.git("rev-parse", "HEAD"), f.git("show-ref"), f.git("status", "--porcelain"), readFileSync(f.document, "utf8")];
  const requests = [], writes = [], assetRequests = [];
  const observe = request => {
    const url = new URL(request.url());
    if (url.pathname === "/api/git/explorer" && url.searchParams.get("cwd") === f.gitProject) requests.push(url);
    if (url.pathname.startsWith("/api/git/") && request.method() !== "GET") writes.push(request.url());
    if (url.pathname === "/api/review-notebook" && url.searchParams.has("asset")) assetRequests.push(url);
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
      assert.deepEqual((await source.locator(".review-notebook-source-line").allTextContents()).map(line => line.replace(/\n$/, "")), ["49Context line 49", "50Explorer changed 50", "51Context line 51"]);
      assert.equal(requests.slice(n).filter(url => ["patch", "context"].includes(url.searchParams.get("op"))).length, 0);
      assert.equal(await source.locator(".review-notebook-source .token").count(), 0, "Unknown/plain filenames remain uncolored");
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
      const code = stop(scope, "highlighted-code");
      await activate(code.getByRole("button", { name: "Expand source", exact: true }));
      const region = code.getByRole("region", { name: "Pinned source review-source.tsx", exact: true });
      // Inline theme styles consume semantic classes such as `keyword`.
      const keyword = region.locator(".token").filter({ hasText: /^export$/ }).first();
      await keyword.waitFor();
      assert.deepEqual(await region.locator(".review-notebook-source-line > span:first-child").allTextContents(), ["2", "3", "4", "5", "6"]);
      assert.equal((await region.locator(".review-notebook-source-line").nth(1).textContent()).replace(/\n$/, ""), "3", "Blank source lines retain their coordinates");
      assert.match(await region.innerText(), /<script>not executable<\/script>/);
      assert.doesNotMatch(await region.innerText(), /WORKING CODE ONLY|Outside the excerpt/);
      assert.equal(await region.locator("script").count(), 0, "Source text remains escaped");
      assert.equal(await region.locator(".token.attr-equals").count() > 0, true, "TSX attributes use the filename grammar");
      assert.equal(await region.locator(".review-notebook-source-line").last().locator(".token").count() > 0, true, "Multiline tokens span source rows");
      assert.equal(await keyword.evaluate(token => getComputedStyle(token).color !== getComputedStyle(token.closest("code")).color), true, "Tokens have visible syntax colors");
      await code.getByRole("button", { name: "Collapse source", exact: true }).click();
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

    await stop(chat, "deep-history").getByRole("button", { name: "Reveal in Git Explorer", exact: true }).click();
    const deepExplorer = page.getByRole("region", { name: "Git Explorer", exact: true });
    await deepExplorer.getByRole("region", { name: "Git commit details", exact: true }).getByText("Review history 14", { exact: true }).waitFor();
    // Intentionally inspect DOM readiness while the mobile graph is hidden; a
    // visible-role query would wait forever before Back can expose that graph.
    await deepExplorer.locator('[aria-label="History branch"] option[value="review-history"]').waitFor({ state: "attached" });
    if (page.viewportSize().width < 1100) await deepExplorer.getByRole("button", { name: "← Back to commits", exact: true }).click();
    const deepRow = deepExplorer.locator('[aria-label="Commit graph"] button[aria-pressed="true"]');
    await page.waitForFunction(row => {
      const viewport = row.closest('[aria-label="Commit graph"]');
      const bounds = row.getBoundingClientRect(), frame = viewport.getBoundingClientRect();
      return viewport.clientHeight > 0 && viewport.scrollTop > 0 && bounds.top >= frame.top && bounds.bottom <= frame.bottom;
    }, await deepRow.elementHandle());
    assert.ok((await deepRow.getAttribute("title")).startsWith(f.deepOid));
    await deepExplorer.getByRole("button", { name: "Close Git Explorer", exact: true }).click();

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
    await page.getByRole("link", { name: "Open guided review", exact: true }).click();
    const startGuided = page.locator("#file-panel").getByRole("button", { name: "Start guided reading", exact: true });
    await startGuided.waitFor();
    const beforeGuided = requests.length;
    assert.equal(assetRequests.length, 0, "no binary assets loaded by ordinary Markdown");
    await activate(startGuided);
    const guided = page.getByRole("region", { name: "Guided reading", exact: true });
    await guided.getByText("Explorer changed 50", { exact: true }).waitFor();
    assert.ok(requests.length > beforeGuided, "explicit file entry loads actual pinned evidence");
    await guided.getByRole("combobox", { name: "Second evidence target", exact: true }).selectOption("guided-code");
    await guided.locator('[data-review-stop="guided-code"] .review-notebook-source-line').first().waitFor();
    const panes = guided.locator(".guided-evidence"); assert.equal(await panes.count(), 2);
    const boxes = await Promise.all([panes.nth(0).boundingBox(), panes.nth(1).boundingBox()]);
    for (const box of boxes) assert.ok(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1, "both evidence readers remain inside Files");
    if (page.viewportSize().width < 640) assert.ok(boxes[1].y >= boxes[0].y + boxes[0].height, "touch comparison stacks without overlap");
    await guided.getByRole("combobox", { name: "Evidence target", exact: true }).selectOption("guided-range");
    const range = guided.getByRole("region", { name: "Primary evidence: Whole feature range", exact: true });
    await range.getByRole("button", { name: "Show full file", exact: true }).waitFor();
    await range.getByRole("button", { name: "Unified", exact: true }).click();
    await range.getByRole("button", { name: "Show full file", exact: true }).click();
    await range.getByRole("button", { name: "Diff context", exact: true }).waitFor();
    for (const mode of ["Before", "After"]) {
      await range.getByRole("group", { name: "File version", exact: true }).getByRole("button", { name: mode, exact: true }).click();
      await range.getByRole("region", { name: `${mode} file`, exact: true }).waitFor();
    }
    await range.getByRole("group", { name: "File version", exact: true }).getByRole("button", { name: "Changes", exact: true }).click();
    await range.getByRole("region", { name: "Unified diff", exact: true }).waitFor();
    assert.ok(requests.some(url => url.searchParams.get("op") === "compare-context" && url.searchParams.get("base") === f.prior && url.searchParams.get("candidate") === f.oid && url.searchParams.get("path") === "z-context.txt"));
    assert.doesNotMatch(await range.innerText(), /WORKING TREE ONLY/);
    assert.equal(assetRequests.length, 0, "unselected image target stays unread");
    await guided.getByRole("combobox", { name: "Evidence target", exact: true }).selectOption("guided-image");
    const image = guided.locator(".guided-binary-evidence img"); await image.waitFor();
    await page.waitForFunction(node => node.complete && node.naturalWidth > 0, await image.elementHandle());
    assert.ok((await image.getAttribute("src")).startsWith("blob:"), "native image decodes only its admitted snapshot URL");
    const imageBounds = await image.boundingBox();
    assert.ok(imageBounds && imageBounds.x >= 0 && imageBounds.x + imageBounds.width <= page.viewportSize().width + 1, "selected image stays inside Files");
    assert.equal(assetRequests.filter(url => url.searchParams.get("index") === f.guidedIndex && url.searchParams.get("asset") === "assets/pixel.png").length, 1);
    await activate(guided.getByRole("button", { name: "Next", exact: true }));
    await guided.getByRole("heading", { name: "Check the failure boundary", exact: true }).waitFor();
    assert.equal(await guided.locator('[aria-current="step"]').textContent(), "Check the failure boundary");
    await activate(guided.getByRole("button", { name: "Back", exact: true }));
    assert.equal(await guided.getByRole("combobox", { name: "Evidence target", exact: true }).inputValue(), "guided-image", "Back preserves this step's selection");
    await guided.getByRole("combobox", { name: "Evidence target", exact: true }).selectOption("guided-source");
    await guided.getByText("Explorer changed 50", { exact: true }).waitFor();
    await activate(guided.getByRole("button", { name: "Return to document", exact: true }));
    await startGuided.waitFor();
    assert.equal(await guided.count(), 0);
    await page.locator("#file-panel").getByRole("button", { name: "Hide file panel", exact: true }).click();
    await page.getByRole("link", { name: "Open working source", exact: true }).click();
    await page.locator("#file-panel").getByText("WORKING TREE ONLY", { exact: true }).waitFor();
    assert.deepEqual(writes, []);
    assert.deepEqual([f.git("rev-parse", "HEAD"), f.git("show-ref"), f.git("status", "--porcelain"), readFileSync(f.document, "utf8")], before);
    console.log(`PASS: ${page.viewportSize().width}px lazy revision-bound review stops, immutable diff/context, file previews, explicit Explorer reveal and read-only navigation`);
    await checkGuidedReviewWorkflow(page, { base, fixture: f });
  } finally {
    page.off("request", observe);
    // Leave the next owned Markdown chain a clean presentation without touching its fixtures.
    await page.goto(`${base}/?session=${f.id}`, { waitUntil: "domcontentloaded" });
  }
}
