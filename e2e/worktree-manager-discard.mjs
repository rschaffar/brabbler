import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

export async function checkManagerDiscard(page, { base, fixture, manager, open, patchSettings }) {
  const { repo, dirty, git, discard: f } = fixture;
  const surface = manager.getByRole("region", { name: "Removal review & outcome", exact: true });
  // Never match a completed/cancelled history button when awaiting live status.
  const status = (text) => surface.getByRole("status").filter({ hasText: new RegExp(`^${text}$`) });
  const remove = () => surface.getByRole("button", { name: "Remove listed resources", exact: true });
  const loss = () => surface.getByRole("checkbox", { name: LOSS, exact: true });
  const getOperation = async (id) => {
    // Use actual browser transport so independent verification requests/responses
    // appear in the retained trace, rather than an untraced Node HTTP pool.
    // No retry, mocked status or error exemption: any transport/HTTP/body failure fails.
    const response = await page.evaluate(async (url) => {
      const result = await fetch(url, { cache: "no-store" });
      return { status: result.status, text: await result.text() };
    }, `${base}${ACTIONS}/${id}`);
    assert.equal(response.status, 200, response.text);
    return JSON.parse(response.text);
  };
  const branchTip = (branch) => git("for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`);
  const registrations = () => git("worktree", "list", "--porcelain");
  const snapshot = () => ({
    refs: git("for-each-ref", "--format=%(refname) %(objectname)"), registrations: registrations(),
    paths: [repo, dirty, f.worktreeOnly, f.combined, f.detached].map((path) => ({
      path, exists: existsSync(path),
      status: existsSync(path) ? git("-C", path, "status", "--porcelain", "--untracked-files=all") : null,
      source: existsSync(path) ? readFileSync(join(path, "source.txt"), "utf8") : null,
    })),
    detachedSource: existsSync(f.detached) ? readFileSync(join(f.detached, "detached-only.txt"), "utf8") : null,
    dirtySource: readFileSync(join(dirty, "manual.txt"), "utf8"),
  });
  const select = async (branch, search = branch) => {
    await waitManagerButton(page, manager, "Refresh");
    await manager.getByLabel("Search branches or paths", { exact: true }).fill(search);
    const button = manager.getByRole("button", { name: branch, exact: true });
    await button.waitFor();
    if (await button.getAttribute("aria-expanded") !== "true") await button.click();
  };
  const prepare = async () => {
    const button = await waitManagerButton(page, manager, "Review removal…");
    const preparation = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === ACTIONS);
    await button.click();
    const response = await preparation;
    assert.equal(response.status(), 202, await response.text());
    const initial = await response.json();
    await checkManagerReadyReview(surface);
    const op = await getOperation(initial.id);
    assert.equal(op.action, "remove"); assert.equal(op.state, "review");
    return op;
  };
  const refreshActual = async () => {
    await surface.getByRole("button", { name: "Refresh actual state", exact: true }).click();
    await surface.waitFor({ state: "hidden" });
    await waitManagerButton(page, manager, "Refresh");
  };
  const approve = async (op, required) => {
    if (required) {
      assert.equal(op.card.requiredAcknowledgment, LOSS);
      assert.equal(op.acknowledgment.label, LOSS);
      await loss().waitFor();
      assert.equal(await loss().isChecked(), false);
      assert.equal(await remove().isDisabled(), true, "server loss requirement gates approval even under Allow");
      await loss().check();
    } else {
      assert.equal(op.card.requiredAcknowledgment, undefined);
      assert.equal(op.acknowledgment, undefined);
      assert.equal(await surface.getByRole("checkbox").count(), 0, "retaining a branch / detached removal needs no branch-loss checkbox");
    }
    await (await waitManagerButton(page, surface, "Remove listed resources")).click();
    await status(COMPLETED).waitFor();
    const saved = await getOperation(op.id);
    assert.equal(saved.state, "succeeded"); assert.equal(saved.decision, "approve");
    if (required) {
      assert.equal(saved.acknowledgment.cardDigest, op.acknowledgment.cardDigest);
      assert.equal(saved.acknowledgment.accepted, true);
      assert.ok(saved.acknowledgment.acceptedAt);
    }
    return saved;
  };
  const invalidApproval = async (op, acknowledgment, reason) => {
    const before = snapshot();
    // APIRequestContext is deliberately used: this expected HTTP 409 is not an
    // intercepted browser network failure and needs no console/error exemption.
    const response = await page.request.post(`${base}${ACTIONS}/${op.id}`, { data: {
      cwd: repo, decision: "approve", ...(acknowledgment === undefined ? {} : { acknowledgment }),
    } });
    assert.equal(response.status(), 409, `${reason}: ${await response.text()}`);
    const unchanged = await getOperation(op.id);
    assert.equal(unchanged.state, "review", `${reason} leaves review actionable`);
    assert.equal(unchanged.decision, undefined);
    assert.deepEqual(unchanged.acknowledgment, op.acknowledgment);
    assert.deepEqual(snapshot(), before, `${reason} changes no refs, registrations, folders or source`);
    await checkManagerReadyReview(surface);
  };

  // Branch-only unintegrated loss: missing/false answers fail without effects;
  // checking then rejecting is not consent and cannot be reused by a fresh card.
  await manager.getByLabel("Sort", { exact: true }).selectOption("name");
  await select(f.branchOnly);
  assert.match(await manager.locator(`tr[data-branch="${f.branchOnly}"]`).innerText(), /Not integrated/);
  const first = await prepare();
  assert.equal(first.card.requiredAcknowledgment, LOSS);
  assert.equal(first.acknowledgment.label, LOSS);
  assert.equal(await loss().isChecked(), false);
  assert.equal(await remove().isDisabled(), true);
  await invalidApproval(first, undefined, "missing loss acknowledgment");
  await invalidApproval(first, { cardDigest: first.acknowledgment.cardDigest, accepted: false }, "false loss acknowledgment");
  const beforeReject = snapshot();
  await loss().check();
  await waitManagerButton(page, surface, "Remove listed resources");
  assert.equal(await remove().isEnabled(), true);
  await surface.getByRole("button", { name: "Keep resources", exact: true }).click();
  await status(CANCELLED).waitFor();
  const rejected = await getOperation(first.id);
  assert.equal(rejected.decision, "reject"); assert.equal(rejected.acknowledgment.accepted, undefined);
  assert.deepEqual(snapshot(), beforeReject, "checking then rejecting keeps all resources");
  assert.equal(branchTip(f.branchOnly), f.unmergedTip);
  await refreshActual();
  const fresh = await prepare();
  assert.notEqual(fresh.id, first.id);
  assert.notEqual(fresh.acknowledgment.cardDigest, first.acknowledgment.cardDigest);
  assert.equal(await loss().isChecked(), false, "new operation resets the checked UI state");
  assert.equal(await remove().isDisabled(), true);
  await invalidApproval(fresh, { cardDigest: first.acknowledgment.cardDigest, accepted: true }, "stale previous card digest");
  const branchRemoval = await approve(fresh, true);
  assert.equal(branchTip(f.branchOnly), "");
  await refreshActual();

  // Reopen, select this exact completed record (not the first similarly named
  // button), and verify durable consent is evidence only, never replay authority.
  await manager.getByRole("button", { name: "Close", exact: true }).click();
  await manager.waitFor({ state: "hidden" });
  await open();
  const listResponse = await page.request.get(`${base}${ACTIONS}?${new URLSearchParams({ cwd: repo })}`);
  assert.equal(listResponse.status(), 200, await listResponse.text());
  const { operations } = await listResponse.json();
  const index = operations.findIndex((op) => op.id === branchRemoval.id);
  assert.ok(index >= 0);
  await manager.getByText("Recorded project operations", { exact: true }).click();
  const history = manager.locator("details").filter({ hasText: /^Recorded project operations/ });
  const historyButton = history.getByRole("button").nth(index);
  await historyButton.waitFor();
  const handle = await historyButton.elementHandle();
  try { await page.waitForFunction((element) => element?.isConnected && !element.disabled, handle); }
  finally { await handle?.dispose(); }
  await historyButton.click();
  await status(COMPLETED).waitFor();
  await surface.getByText(`${f.branchOnly} at ${f.unmergedTip}`, { exact: true }).waitFor();
  const recorded = surface.getByRole("checkbox", { name: `${LOSS} · Recorded acknowledgment (read-only)`, exact: true });
  await recorded.waitFor();
  assert.equal(await recorded.isChecked(), true); assert.equal(await recorded.isDisabled(), true);
  assert.equal(await remove().count(), 0);
  assert.equal(await surface.getByRole("button", { name: "Keep resources", exact: true }).count(), 0);
  const historical = await getOperation(branchRemoval.id);
  assert.deepEqual(historical.acknowledgment, branchRemoval.acknowledgment);
  assert.equal(historical.card, undefined, "history has no live card");
  assert.equal(historical.receipt.card.requiredAcknowledgment, LOSS);
  assert.equal(historical.receipt.card.actions.length, 0, "durable receipt has no actionable controls");
  const downloadLink = surface.getByRole("link", { name: "Download complete exact review", exact: true });
  await downloadLink.waitFor();
  const download = await page.request.get(new URL(await downloadLink.getAttribute("href"), base).href);
  assert.equal(download.status(), 200, "unintegrated exact review survives local-ref deletion");
  assert.ok((await download.text()).includes(f.unmergedTip));
  await refreshActual();

  await select(f.worktreeOnlyBranch);
  assert.match(await manager.locator(`tr[data-branch="${f.worktreeOnlyBranch}"]`).innerText(), /Not integrated/);
  await manager.getByLabel("Resources", { exact: true }).selectOption("worktree");
  await approve(await prepare(), false);
  assert.equal(existsSync(f.worktreeOnly), false);
  assert.equal(branchTip(f.worktreeOnlyBranch), f.unmergedTip, "worktree-only removal retains the exact unintegrated branch");
  assert.ok(!registrations().includes(`worktree ${f.worktreeOnly}\n`));
  await refreshActual();

  await select(f.combinedBranch);
  assert.match(await manager.locator(`tr[data-branch="${f.combinedBranch}"]`).innerText(), /Not integrated/);
  await manager.getByLabel("Resources", { exact: true }).selectOption("both");
  await approve(await prepare(), true);
  assert.equal(existsSync(f.combined), false); assert.equal(branchTip(f.combinedBranch), "");
  assert.ok(!registrations().includes(`worktree ${f.combined}\n`));
  await refreshActual();

  // Comparison is evidence, not a blanket mismatch veto. Both actual targets
  // remain protected while a different integrated branch can be removed.
  await manager.getByLabel("Comparison target", { exact: true }).selectOption("unfinished");
  await manager.getByText("This temporary comparison differs from the configured target.", { exact: false }).waitFor();
  for (const [branch, blocker] of [["main", "Configured target protected"], ["unfinished", "Comparison target protected"]]) {
    await select(branch);
    await manager.getByText(blocker, { exact: false }).first().waitFor();
    assert.equal(await manager.getByRole("button", { name: "Review removal…", exact: true }).isDisabled(), true);
  }
  const configuredTip = branchTip("main"), comparisonTip = branchTip("unfinished");
  await select(f.mismatch);
  await approve(await prepare(), false);
  assert.equal(branchTip(f.mismatch), "", "safe non-target branch is not blocked by mismatch");
  assert.equal(branchTip("main"), configuredTip); assert.equal(branchTip("unfinished"), comparisonTip);
  await refreshActual();

  // API settings writes affect only the disposable project. Close/reopen to
  // discard the manager's temporary comparison state; do not write browser settings.
  await manager.getByRole("button", { name: "Close", exact: true }).click();
  await manager.waitFor({ state: "hidden" });
  await patchSettings({ targetBranch: "missing-manager-target" }, "project");
  await open();
  await manager.getByText("No comparison target: integration is Unknown.", { exact: false }).waitFor();
  await manager.getByText("Configured target missing-manager-target is not a local branch.", { exact: true }).waitFor();
  assert.equal(await manager.getByLabel("Comparison target", { exact: true }).inputValue(), "");
  await select(f.noTarget);
  assert.match(await manager.locator(`tr[data-branch="${f.noTarget}"]`).innerText(), /Unknown/);
  const noTarget = await prepare();
  assert.ok(noTarget.card.fields.some((field) => field.label === "Captured comparison (not policy authority)" && field.value === "None"));
  await approve(noTarget, true);
  assert.equal(branchTip(f.noTarget), "");
  await refreshActual();

  // The detached fixture is a real clean unique commit, not a diagnostic or an
  // integrated branch masquerading as detached. Removal deletes only its folder.
  await select("Detached HEAD", f.detached);
  await manager.getByText("Detached HEAD: removing this worktree may leave its commit without a branch.", { exact: false }).waitFor();
  assert.equal(await manager.getByLabel("Resources", { exact: true }).inputValue(), "worktree");
  assert.equal(await manager.getByLabel("Resources", { exact: true }).locator('option[value="branch"], option[value="both"]').count(), 0);
  const refsBeforeDetached = git("for-each-ref", "--format=%(refname) %(objectname)");
  const detached = await prepare();
  await surface.getByRole("region", { name: "Detached commit warning", exact: true }).waitFor();
  assert.ok(detached.card.fields.some((field) => field.label === "Exact subject" && field.value === `Detached HEAD at ${f.detachedHead}`));
  await approve(detached, false);
  assert.equal(existsSync(f.detached), false);
  assert.ok(!registrations().includes(`worktree ${f.detached}\n`));
  assert.equal(git("for-each-ref", "--format=%(refname) %(objectname)"), refsBeforeDetached, "detached removal deletes no branch");
  assert.equal(existsSync(join(dirty, "manual.txt")), true, "untracked blocker fixture remains untouched");
}
