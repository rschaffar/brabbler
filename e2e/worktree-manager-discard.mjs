import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBrowserJson, readBrowserResponse } from "./browser-http.mjs";

const ACTIONS = "/api/plugins/bundled/git-workflow/project-actions";
const LOSS = "I understand that deleting this local branch can discard work not proven integrated, and I accept this loss.";
const READY = "Ready for exact review — nothing has been deleted";
const COMPLETED = "Resource removal completed";
const CANCELLED = "Cancelled — check any already-dispatched effects";

/** Called only while seeding the acceptance child's private agentDir, before
 * startup. No host repositories, sessions or resources are selected. */
export function seedManagerDiscardFixtures({ repo, git, env, commit }) {
  const branchOnly = "unmerged-branch", noTarget = "no-target-branch", mismatch = "mismatch-safe";
  const worktreeOnlyBranch = "unmerged-worktree-only", combinedBranch = "unmerged-combined";
  const worktreeOnly = `${repo}-${worktreeOnlyBranch}`, combined = `${repo}-${combinedBranch}`, detached = `${repo}-detached-unique`;
  git("branch", branchOnly, "unfinished"); git("branch", noTarget, "unfinished");
  git("branch", mismatch, "integrated");
  git("worktree", "add", "-b", worktreeOnlyBranch, worktreeOnly, "unfinished");
  git("worktree", "add", "-b", combinedBranch, combined, "unfinished");
  git("worktree", "add", "--detach", detached, "main");
  writeFileSync(join(detached, "detached-only.txt"), "unique detached disposable work\n");
  execFileSync("git", ["-C", detached, "add", "detached-only.txt"], { env });
  commit(detached, "unique detached fixture", "2024-01-01T12:00:00Z");
  const detachedHead = git("-C", detached, "rev-parse", "HEAD"), unmergedTip = git("rev-parse", "unfinished");
  assert.match(detachedHead, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
  assert.equal(git("branch", "--contains", detachedHead), "", "detached fixture commit has no branch");
  for (const path of [worktreeOnly, combined, detached]) assert.equal(git("-C", path, "status", "--porcelain"), "", "new removal fixtures are source-clean");
  return { branchOnly, noTarget, mismatch, worktreeOnlyBranch, combinedBranch, worktreeOnly, combined, detached, detachedHead, unmergedTip };
}

/** Wait for readiness rather than taking an instantaneous disabled snapshot or
 * forcing a click. Uses the page's existing deadline; no retries or sleeps. */
export async function waitManagerButton(page, surface, name, first = false) {
  const matches = surface.getByRole("button", { name, exact: typeof name === "string" });
  const button = first ? matches.first() : matches;
  await button.waitFor();
  const handle = await button.elementHandle();
  try { await page.waitForFunction((element) => element?.isConnected && !element.disabled, handle); }
  finally { await handle?.dispose(); }
  return button;
}

/** Verify the complete live review presentation, not only server metadata or
 * a similarly named history button. All waits use the existing page deadline. */
export async function checkManagerReadyReview(surface) {
  await surface.getByRole("status").filter({ hasText: new RegExp(`^${READY}$`) }).waitFor();
  await surface.getByRole("heading", { name: "Remove selected Git resources", exact: true }).waitFor();
  await surface.getByText("Manual browser confirmation required", { exact: true }).waitFor();
  await surface.getByText("Approves only these frozen branch/worktree/artifact resources together. It is not future disposal authority.", { exact: true }).waitFor();
}

/** Thin installed/native bridge. Controlled Manager records are not Git authority:
 * both inputs prepare and reject a REAL review; desktop additionally approves
 * the original combined resource and reads its immutable review after deletion.
 */
export async function checkManagerDiscard(page, { base, fixture, manager, open, width }) {
  const { repo, dirty, git, discard: f } = fixture;
  const surface = manager.getByRole("region", { name: "Removal review & outcome", exact: true });
  const status = text => surface.getByRole("status").filter({ hasText: new RegExp(`^${text}$`) });
  const remove = () => surface.getByRole("button", { name: "Remove listed resources", exact: true });
  const loss = () => surface.getByRole("checkbox", { name: LOSS, exact: true });
  const getOperation = id => readBrowserJson(page, `${base}${ACTIONS}/${id}`);
  const branchTip = branch => git("for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`);
  const registrations = () => git("worktree", "list", "--porcelain");
  // Preserve the original native negative footprint once, not once for each
  // malformed envelope. These are actual refs/files/registrations, not UI rows.
  const snapshot = () => ({
    refs: git("for-each-ref", "--format=%(refname) %(objectname)"), registrations: registrations(),
    paths: [repo, dirty, f.worktreeOnly, f.combined, f.detached].map(path => ({
      path, exists: existsSync(path),
      status: existsSync(path) ? git("-C", path, "status", "--porcelain", "--untracked-files=all") : null,
      source: existsSync(path) ? readFileSync(join(path, "source.txt"), "utf8") : null,
    })),
    detachedSource: existsSync(f.detached) ? readFileSync(join(f.detached, "detached-only.txt"), "utf8") : null,
    dirtySource: readFileSync(join(dirty, "manual.txt"), "utf8"),
  });
  const prepare = async () => {
    const button = await waitManagerButton(page, manager, "Review removal…");
    const preparation = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === ACTIONS);
    void preparation.catch(() => {}); // Observe early failure, keep original await.
    await button.click();
    const response = await preparation;
    assert.equal(response.status(), 202, await response.text());
    const initial = await response.json();
    const body = response.request().postDataJSON();
    assert.equal(initial.id, body.requestId);
    assert.deepEqual(body, { cwd: repo, requestId: initial.id, action: "remove", payload: {
      subject: { kind: "branch", branch: f.combinedBranch, tip: f.unmergedTip },
      worktreePath: f.combined, removeWorktree: true, deleteBranch: true,
      comparisonTarget: { branch: "main", tip: git("rev-parse", "main") },
    } });
    await checkManagerReadyReview(surface);
    const op = await getOperation(initial.id);
    assert.equal(op.cwd, repo); assert.equal(op.action, "remove"); assert.equal(op.state, "review");
    assert.equal(op.card.requiredAcknowledgment, LOSS); assert.equal(op.acknowledgment.label, LOSS);
    assert.equal(await loss().isChecked(), false); assert.equal(await remove().isDisabled(), true);
    return op;
  };
  const acknowledge = async () => {
    await loss().focus();
    assert.equal(await loss().evaluate(node => node === document.activeElement), true);
    await loss().check();
    await waitManagerButton(page, surface, "Remove listed resources");
    await remove().scrollIntoViewIfNeeded();
    const rect = await remove().boundingBox(); assert.ok(rect, "native review action has a physical box");
    assert.equal(await remove().evaluate((node, bounds) => {
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return node === hit || node.contains(hit);
    }, rect), true, "loss approval action is reachable in the native modal");
  };
  const refreshActual = async () => {
    await surface.getByRole("button", { name: "Refresh actual state", exact: true }).click();
    await surface.waitFor({ state: "hidden" });
    await waitManagerButton(page, manager, "Refresh");
  };

  await manager.getByLabel("Sort", { exact: true }).selectOption("name");
  await waitManagerButton(page, manager, "Refresh");
  await manager.getByLabel("Search branches or paths", { exact: true }).fill(f.combinedBranch);
  const row = manager.getByRole("button", { name: f.combinedBranch, exact: true });
  await row.waitFor(); if (await row.getAttribute("aria-expanded") !== "true") await row.click();
  assert.match(await manager.locator(`tr[data-branch="${f.combinedBranch}"]`).innerText(), /Not integrated/);
  await manager.getByLabel("Resources", { exact: true }).selectOption("both");
  const first = await prepare(), beforeReject = snapshot();
  assert.equal(existsSync(f.combined), true); assert.equal(branchTip(f.combinedBranch), f.unmergedTip);
  await acknowledge();
  await surface.getByRole("button", { name: "Keep resources", exact: true }).click();
  await status(CANCELLED).waitFor();
  const rejected = await getOperation(first.id);
  assert.equal(rejected.decision, "reject"); assert.equal(rejected.acknowledgment.accepted, undefined);
  assert.deepEqual(snapshot(), beforeReject, "native Reject keeps refs, registrations, folders and source");
  await refreshActual();
  await page.waitForFunction(branch => document.activeElement?.getAttribute("data-manager-row") === `branch:${branch}`, f.combinedBranch);
  // Mobile keeps the long loss label, live native review, real checkbox/hit
  // targets, rejection and automatic row focus. No second native policy matrix.
  if (width <= 600) return;

  const fresh = await prepare();
  assert.notEqual(fresh.id, first.id); assert.notEqual(fresh.acknowledgment.cardDigest, first.acknowledgment.cardDigest);
  await acknowledge();
  await remove().click(); await status(COMPLETED).waitFor();
  const saved = await getOperation(fresh.id);
  assert.equal(saved.state, "succeeded"); assert.equal(saved.decision, "approve");
  assert.equal(saved.acknowledgment.cardDigest, fresh.acknowledgment.cardDigest);
  assert.equal(saved.acknowledgment.accepted, true); assert.ok(saved.acknowledgment.acceptedAt);
  // Bind the endpoint to the approved native record, independently of any DOM
  // href or public reviewBaseUrl. The preceding Reject has the SAME subject tip.
  assert.equal(saved.id, fresh.id);
  assert.ok(saved.receipt?.card?.review, "approved native record has its own saved review reference");
  const savedReview = structuredClone(saved.receipt.card.review);
  const nativeOperationId = saved.receipt.operationId;
  assert.match(nativeOperationId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(saved.receipt.card.operationId, nativeOperationId, "native card and receipt share their own operation ID");
  assert.equal(savedReview.version, 1); assert.equal(savedReview.operationId, nativeOperationId);
  assert.match(savedReview.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(Number.isSafeInteger(savedReview.bytes) && savedReview.bytes > 0, true);
  const expectedDownload = new URL(`${ACTIONS}/${fresh.id}/reviews/${savedReview.id}?download=1`, base);
  assert.equal(existsSync(f.combined), false); assert.equal(branchTip(f.combinedBranch), "");
  assert.ok(!registrations().includes(`worktree ${f.combined}\n`));
  assert.equal(existsSync(join(dirty, "manual.txt")), true);
  await refreshActual();

  // The field-only mounted history is NOT this immutable/default review bridge.
  // Reopen and read the EXACT own completed UUID after its real ref/path vanished.
  await manager.getByRole("button", { name: "Close", exact: true }).click();
  await manager.waitFor({ state: "hidden" }); await open();
  const { operations } = await readBrowserJson(page, `${base}${ACTIONS}?${new URLSearchParams({ cwd: repo })}`);
  const index = operations.findIndex(op => op.id === fresh.id); assert.ok(index >= 0);
  await manager.getByText("Recorded project operations", { exact: true }).click();
  const history = manager.locator("details").filter({ hasText: /^Recorded project operations/ });
  const historyButton = history.getByRole("button").nth(index);
  await historyButton.waitFor();
  const handle = await historyButton.elementHandle();
  try { await page.waitForFunction(element => element?.isConnected && !element.disabled, handle); }
  finally { await handle?.dispose(); }
  await historyButton.click(); await status(COMPLETED).waitFor();
  await surface.getByText(`${f.combinedBranch} at ${f.unmergedTip}`, { exact: true }).waitFor();
  const recorded = surface.getByRole("checkbox", { name: `${LOSS} · Recorded acknowledgment (read-only)`, exact: true });
  await recorded.waitFor(); assert.equal(await recorded.isChecked(), true); assert.equal(await recorded.isDisabled(), true);
  assert.equal(await remove().count(), 0);
  assert.equal(await surface.getByRole("button", { name: "Keep resources", exact: true }).count(), 0);
  const historical = await getOperation(fresh.id);
  assert.equal(historical.id, fresh.id);
  assert.deepEqual(historical.receipt.card.review, savedReview, "same approved native review after reopening");
  assert.deepEqual(historical.acknowledgment, saved.acknowledgment);
  assert.equal(historical.card, undefined); assert.equal(historical.receipt.card.requiredAcknowledgment, LOSS);
  assert.equal(historical.receipt.card.actions.length, 0);
  const link = surface.getByRole("link", { name: "Download complete exact review", exact: true }); await link.waitFor();
  const renderedDownload = new URL(await link.getAttribute("href"), base);
  assert.equal(renderedDownload.origin, expectedDownload.origin, "review link stays on the installed origin");
  assert.equal(renderedDownload.pathname, expectedDownload.pathname, "review link owns the approved operation AND saved review ID");
  assert.equal(renderedDownload.search, "?download=1", "complete review, no duplicate/entry/patch query");
  assert.equal(renderedDownload.hash, ""); assert.equal(renderedDownload.username, ""); assert.equal(renderedDownload.password, "");
  // Identity is checked BEFORE consuming the real browser response. This is
  // complete text-body proof, not rendered Pierre or an OS download event.
  const complete = await readBrowserResponse(page, renderedDownload.href);
  assert.equal(Buffer.byteLength(complete, "utf8"), savedReview.bytes, "complete owned native review byte length");
  assert.ok(complete.includes(f.unmergedTip), "immutable exact review survives native ref/path deletion");
  await refreshActual();
}
