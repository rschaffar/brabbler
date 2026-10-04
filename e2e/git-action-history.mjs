import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createJiti } from "jiti";
import { canonical, document } from "../lib/git-action-legacy-fixture.mjs";

// Fixture-only historical bytes. Production has no v1 writer and cannot adopt
// these records. Retain only our own seed for the later interruption fixture.
const interruptions = new Map();
function seedLegacyRecord(agentDir, record, candidate) {
  const dir = join(agentDir, "pi-web", "git-actions", "v1", record.id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "candidate.json"), canonical({ version: 1, candidate }), { flag: "wx", mode: 0o600 });
  const file = join(dir, "record.json");
  writeFileSync(file, document(record), { flag: "wx", mode: 0o600 });
  return file;
}

/** Evidence from a DIFFERENT process than the test server, never executable capabilities. */
export async function seedGitActionHistory(agentDir, sessionId) {
  const jiti = createJiti(import.meta.url);
  const { createGitAction, transitionGitAction, releaseGitAction, captureGitActionRecord, advanceGitActionRecord } = await jiti.import("../lib/git-action-journal.ts");
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
  for (const name of ["declined", "expired", "interrupted", "missing", "oversized", "corrupt"]) {
    const snapshot = candidate(`E2E saved ${name} candidate`);
    if (name === "oversized") { delete snapshot.diff; snapshot.diffUnavailable = "Candidate patch exceeds the 1 MB capture limit"; }
    const input = { sessionId, source: "agent", candidate: snapshot };
    let record;
    if (["expired", "interrupted", "corrupt"].includes(name)) {
      // Only deliberate legacy fixtures model persisted pre-restart requests.
      // New active candidates are process-only and must never be resurrected.
      const captured = captureGitActionRecord(input);
      record = advanceGitActionRecord(captured.record, captured.candidate, { state: "awaiting-decision" });
      if (name === "corrupt") record = advanceGitActionRecord(record, captured.candidate, { state: "declined", decision: "declined" });
      const file = seedLegacyRecord(agentDir, record, captured.candidate);
      if (name === "interrupted") interruptions.set(record.id, { agentDir, file, record, candidate: captured.candidate });
    } else {
      record = await createGitAction(input, agentDir);
      const id = record.id;
      try {
        record = await transitionGitAction(id, record.revision, { state: "awaiting-decision" }, agentDir);
        record = await transitionGitAction(id, record.revision, { state: "declined", decision: "declined" }, agentDir);
        assert.equal(record.diagnostics, undefined, "fixture must persist before the server starts");
      } finally { releaseGitAction(id, agentDir); }
    }
    records[name] = record.id;
  }
  rmSync(join(agentDir, "git-diagnostics-v2", `${records.missing}.artifact`));
  // Corrupt legacy bytes stay read-only and do not poison the shared v2 inventory
  // used by the subsequent browser flows (v2 corruption has isolated unit tests).
  writeFileSync(join(agentDir, "pi-web", "git-actions", "v1", records.corrupt, "candidate.json"), "corrupt captured artifact");
  rmSync(retired, { recursive: true });
  const entries = Object.values(records).map((id, index) => ({ type: "custom", customType: "pi-web:git-action",
    id: `saved-card-${index}`, parentId: index ? `saved-card-${index - 1}` : "root", timestamp: new Date().toISOString(), data: { version: 1, actionId: id } }));
  return { records, entries };
}

export async function interruptSeededGitAction(agentDir, id) {
  const jiti = createJiti(import.meta.url);
  const { advanceGitActionRecord, readGitAction } = await jiti.import("../lib/git-action-journal.ts");
  const own = interruptions.get(id);
  assert.equal(own?.agentDir, agentDir, "only the original disposable legacy seed may be changed");
  assert.equal((await readGitAction(id, {}, agentDir)).record?.state, "expired", "disk history is never a live request");
  // Artificial historical interruption only: prepared IDs are NOT native success.
  const record = advanceGitActionRecord(own.record, own.candidate, { state: "executing", decision: "approved",
    intended: { commit: "4".repeat(40), tree: "2".repeat(40), parents: ["1".repeat(40)], authorEmail: "e2e@example.invalid" } });
  writeFileSync(own.file, document(record));
  interruptions.delete(id);
  assert.equal((await readGitAction(id, {}, agentDir)).record?.state, "recovery-required");
}

export async function checkSavedGitActionHistory(page, { base, api, sessionId, records, artifacts }) {
  // This UUID chat already reached its worktree and retains a succeeded
  // continue receipt. Its saved cards must survive every status read.
  const assertStableReceiptCard = async () => {
    const savedCard = page.locator(`[data-git-action-id="${records.declined}"]`);
    await savedCard.getByRole("heading", { name: /Declined/ }).waitFor();
    await savedCard.evaluate((element) => { element.dataset.e2eStableReceiptCard = "1"; });
    let transitionReads = 0;
    let forcedListReads = 0;
    const observe = (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/git/workspace-transition" && url.searchParams.get("sessionId") === sessionId) transitionReads++;
      if (url.pathname === "/api/sessions" && url.searchParams.has("force")) forcedListReads++;
    };
    page.on("request", observe);
    try {
      await page.waitForTimeout(1800);
      assert.equal(await savedCard.getAttribute("data-e2e-stable-receipt-card"), "1", "completed transition must not remount a saved Git card");
      assert.ok(transitionReads <= 2, `completed transition repeatedly polled on remount (${transitionReads} reads)`);
      assert.ok(forcedListReads <= 2, `chat remount repeatedly forced the sidebar catalogue (${forcedListReads} reads)`);
    } finally { page.off("request", observe); }
  };
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "load" });
  await page.getByText("Saved Git action history fixture", { exact: true }).waitFor();
  const card = (name) => page.locator(`[data-git-action-id="${records[name]}"]`);
  await assertStableReceiptCard();
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
  for (const name of ["missing", "corrupt"]) {
    await card(name).getByRole("button", { name: /^Captured candidate/ }).click();
    await card(name).getByText(/Captured artifact unavailable/).waitFor();
    assert.equal(await card(name).getByRole("region", { name: /diff|patch/i }).count(), 0, "Unavailable/corrupt bytes must not render a reconstructed diff");
  }
  await card("oversized").getByRole("button", { name: /^Captured candidate/ }).click();
  await card("oversized").getByText(/Candidate patch exceeds the 1 MB capture limit/).waitFor();
  assert.equal(await card("oversized").getByRole("region", { name: /diff|patch/i }).count(), 0, "Unavailable bytes must not appear as a partial diff");
  await page.reload({ waitUntil: "load" });
  await assertStableReceiptCard();
  await card("expired").getByRole("heading", { name: /Expired/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^(Approve|Confirm|Retry) (commit|merge|integration|action)/ }).count(), 0);
  await page.setViewportSize({ width: 1280, height: 800 });
  console.log("PASS: captured multi-file history survives reload/workspace loss, restart expiry/recovery is read-only, missing/corrupt artifacts explicit, desktop/mobile independent split scrolling");
}
