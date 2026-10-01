import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createJiti } from "jiti";

/** Evidence from a DIFFERENT process than the test server, never executable capabilities. */
export async function seedGitActionHistory(agentDir, sessionId) {
  const jiti = createJiti(import.meta.url);
  const { createGitAction, transitionGitAction } = await jiti.import("../lib/git-action-journal.ts");
  const retired = join(agentDir, "retired-history-workspace");
  mkdirSync(retired);
  const patch = [
    "diff --git a/long.txt b/long.txt", "index 1111111..2222222 100644", "--- a/long.txt", "+++ b/long.txt", "@@ -1 +1 @@",
    `-Retained old line ${"x".repeat(360)}`, `+Retained new line ${"y".repeat(360)}`,
    "diff --git a/old-name.txt b/new-name.txt", "similarity index 100%", "rename from old-name.txt", "rename to new-name.txt",
    "diff --git a/image.bin b/image.bin", "index 1111111..2222222 100644", "Binary files a/image.bin and b/image.bin differ",
    "diff --git a/run.sh b/run.sh", "old mode 100644", "new mode 100755", "",
  ].join("\n");
  const candidate = (message) => ({ kind: "commit", repositoryRoot: retired, featureBranch: "retired-feature", message,
    paths: ["long.txt", "old-name.txt", "new-name.txt", "image.bin", "run.sh"], parentOid: "1".repeat(40), candidateTreeOid: "2".repeat(40),
    diff: { fromTreeOid: "3".repeat(40), toTreeOid: "2".repeat(40), patch, hasBinaryChanges: true } });
  const records = {};
  for (const [name, state] of [["declined", "declined"], ["expired", "awaiting-decision"], ["interrupted", "executing"], ["missing", "declined"], ["oversized", "declined"]]) {
    const snapshot = candidate(`E2E saved ${name} candidate`);
    if (name === "oversized") { delete snapshot.diff; snapshot.diffUnavailable = "Candidate patch exceeds the 1 MB capture limit"; }
    let record = await createGitAction({ sessionId, source: "agent", candidate: snapshot }, agentDir);
    record = await transitionGitAction(record.id, record.revision, { state: "awaiting-decision" }, agentDir);
    // Publish the artificial interrupted action only after the normal Git
    // browser flows run. Durable admission rightly refuses any checkout if a
    // retired legacy journal's Git resource can no longer be identified.
    if (state !== "awaiting-decision" && name !== "interrupted") record = await transitionGitAction(record.id, record.revision,
      { state, decision: "declined" }, agentDir);
    records[name] = record.id;
  }
  rmSync(join(agentDir, "pi-web", "git-actions", "v1", records.missing, "candidate.json"));
  rmSync(retired, { recursive: true });
  const entries = Object.values(records).map((id, index) => ({ type: "custom", customType: "pi-web:git-action",
    id: `saved-card-${index}`, parentId: index ? `saved-card-${index - 1}` : "root", timestamp: new Date().toISOString(), data: { version: 1, actionId: id } }));
  return { records, entries };
}

export async function interruptSeededGitAction(agentDir, id) {
  const jiti = createJiti(import.meta.url);
  const { readGitAction, transitionGitAction } = await jiti.import("../lib/git-action-journal.ts");
  const { record } = await readGitAction(id, {}, agentDir);
  assert.equal(record?.state, "awaiting-decision");
  await transitionGitAction(id, record.revision, { state: "executing", decision: "approved",
    intended: { commit: "4".repeat(40), tree: "2".repeat(40), parents: ["1".repeat(40)], authorEmail: "e2e@example.invalid" } }, agentDir);
}

export async function checkSavedGitActionHistory(page, { base, api, sessionId, records, artifacts }) {
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "load" });
  await page.getByText("Saved Git action history fixture", { exact: true }).waitFor();
  const card = (name) => page.locator(`[data-git-action-id="${records[name]}"]`);
  await card("declined").getByRole("heading", { name: /Declined/ }).waitFor();
  await card("expired").getByRole("heading", { name: /Expired/ }).waitFor();
  await card("interrupted").getByRole("heading", { name: /Recovery required/ }).waitFor();
  assert.match(await card("interrupted").innerText(), /prepared|Prepared/);
  assert.match(await card("interrupted").innerText(), /4444444444444444444444444444444444444444/);
  for (const name of Object.keys(records)) {
    assert.equal(await card(name).getByRole("button", { name: /^(Approve|Confirm|Run|Commit|Integrate|Retry)/ }).count(), 0,
      "Disk history must never recover a live approval or retry capability");
  }
  const metadata = await api(`/api/git/actions/${records.declined}?sessionId=${sessionId}`);
  assert.equal(metadata.candidate, undefined);
  assert.doesNotMatch(JSON.stringify(metadata), /Retained old line|reviewToken|planId/);
  const captured = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(records.declined)
    && new URL(response.url()).searchParams.get("includeArtifact") === "1");
  const expand = card("declined").getByRole("button", { name: /^Captured candidate/ });
  await expand.focus();
  await expand.press("Enter");
  const snapshot = await (await captured).json();
  assert.match(snapshot.candidate.diff.patch, /Retained old line/);
  const split = card("declined").getByRole("region", { name: "Side-by-side diff" });
  await split.locator('[data-deletions] [data-line-type="change-deletion"]').getByText(/Retained old line/).waitFor();
  await split.locator('[data-additions] [data-line-type="change-addition"]').getByText(/Retained new line/).waitFor();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await card("declined").scrollIntoViewIfNeeded();
    await split.waitFor();
    const columns = split.locator("[data-code]");
    assert.equal(await columns.count(), 2);
    const widths = await columns.evaluateAll((nodes) => nodes.map((node) => ({ client: node.clientWidth, scroll: node.scrollWidth })));
    assert.ok(widths.every((value) => value.client > 0 && value.scroll > value.client), "Long captured lines scroll inside each diff column");
    await columns.first().evaluate((node) => { node.scrollLeft = 80; });
    assert.equal(await columns.nth(1).evaluate((node) => node.scrollLeft), 0, "Old/new columns scroll independently");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Diff does not widen mobile page");
    if (artifacts) await page.screenshot({ path: join(artifacts, `git-action-history-${width}.png`) });
  }
  await card("declined").getByRole("button", { name: "Unified", exact: true }).click();
  await card("declined").getByRole("region", { name: "Unified diff" }).waitFor();
  await card("declined").getByRole("button", { name: "Raw patch", exact: true }).click();
  assert.match(await card("declined").getByRole("region", { name: "Raw patch", exact: true }).first().innerText(), /Retained new line/);
  for (const label of [/old-name\.txt → new-name\.txt/, /image\.bin/, /run\.sh/]) {
    const detail = card("declined").locator("details").filter({ has: page.locator("summary").filter({ hasText: label }) });
    await detail.locator("summary").click();
    await detail.getByRole("region", { name: "Raw patch" }).waitFor();
  }
  await card("missing").getByRole("button", { name: /^Captured candidate/ }).click();
  await card("missing").getByText(/Captured artifact unavailable/).waitFor();
  await card("oversized").getByRole("button", { name: /^Captured candidate/ }).click();
  await card("oversized").getByText(/Candidate patch exceeds the 1 MB capture limit/).waitFor();
  assert.equal(await card("oversized").getByRole("region", { name: /diff|patch/i }).count(), 0, "Unavailable bytes must not appear as a partial diff");
  await page.reload({ waitUntil: "load" });
  await card("declined").getByRole("heading", { name: /Declined/ }).waitFor();
  await card("expired").getByRole("heading", { name: /Expired/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^(Approve|Confirm|Retry) (commit|merge|integration|action)/ }).count(), 0);
  await page.setViewportSize({ width: 1280, height: 800 });
  console.log("PASS: captured multi-file history survives reload/workspace loss, restart expiry/recovery is read-only, missing artifacts explicit, desktop/mobile independent split scrolling");
}
