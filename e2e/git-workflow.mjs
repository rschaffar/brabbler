import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/** Real local Git objects and a persisted chat; no model, mock endpoint or Git mutation outside the fixture. */
export async function checkGitWorkflow(page, { base, api, sessionId, cwd, targetWorktree }) {
  const git = (...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "load" });
  let navigations = 0;
  page.on("load", () => { navigations++; });
  await page.getByText("Ready to review Git workflow", { exact: true }).waitFor();
  for (const name of ["Workspace workflow", "Review & commit", "Local integration review"]) {
    const iconBounds = await page.getByRole("button", { name, exact: true }).boundingBox();
    assert.ok(iconBounds && iconBounds.y < 80, `${name} belongs beside Activity in the top bar, not near the composer`);
  }
  const openGitControls = async (name) => {
    const trigger = page.getByRole("button", { name, exact: true }).first();
    if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
    const regionName = name === "Workspace workflow" ? "workspace controls" : name === "Review & commit" ? "commit controls" : "merge controls";
    await page.getByRole("region", { name: regionName }).waitFor();
  };
  await openGitControls("Workspace workflow");
  const workflow = page.getByRole("region", { name: "Workspace workflow settings" });
  await workflow.getByRole("button", { name: /Workspace workflow/ }).click();
  await workflow.getByText(`Actual session cwd: ${cwd}`).waitFor();
  await workflow.getByText(/No saved session policy/).waitFor();
  await workflow.getByLabel("Require current branch (optional)").fill("feature");
  await workflow.getByLabel("Local integration target (optional)").fill("target");
  await workflow.getByRole("button", { name: "Save session policy" }).click();
  await workflow.getByText(/Saved for this session/).waitFor();
  const saved = await api(`/api/git/workflow?sessionId=${sessionId}`);
  assert.equal(saved.cwd, cwd);
  assert.equal(saved.sessionSnapshotPresent, true);
  assert.equal(saved.session.integration.targetBranch, "target");
  // New-chat composer is opened through the UI; both preference saves must work without a document reload.
  await page.getByRole("button", { name: "New", exact: true }).click();
  await openGitControls("Workspace workflow");
  await workflow.getByRole("button", { name: /Workspace workflow/ }).click();
  await workflow.getByText(`New session cwd: ${cwd}`).waitFor();
  await workflow.getByLabel("Require current branch (optional)").fill("feature");
  await workflow.getByLabel("Local integration target (optional)").fill("target");
  await workflow.getByRole("button", { name: "Save project default" }).click();
  await workflow.getByText(/Project default saved for future chats/).waitFor();
  const project = await api(`/api/git/workflow?cwd=${encodeURIComponent(cwd)}`);
  assert.equal(project.project.branch, "feature");
  assert.equal(project.project.integration.targetBranch, "target");
  assert.equal(navigations, 0, "workflow preferences must not reload the browser");

  // The new-chat sidebar intentionally hides the persisted chat; reopen it for operational review.
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  await page.getByText("Ready to review Git workflow", { exact: true }).waitFor();
  await openGitControls("Workspace workflow");
  await workflow.getByRole("button", { name: /Workspace workflow/ }).click();
  await openGitControls("Local integration review");
  const review = page.getByRole("region", { name: "Local integration review" });
  await review.getByRole("button", { name: "Local integration review" }).click();
  await review.getByText("Feature branch").waitFor();
  assert.match(await review.innerText(), /feature[\s\S]*Target branch[\s\S]*target/);
  const commits = review.getByRole("button", { name: /^Commit \d+:/ });
  await commits.nth(1).waitFor();
  assert.equal(await commits.count(), 2);
  const patch = review.locator('[aria-label="Read-only patch"]');
  const wholeResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/review" && response.request().method() === "POST");
  await review.getByRole("button", { name: "Show read-only patch" }).click();
  const wholeHttp = await wholeResponse;
  assert.deepEqual(wholeHttp.request().postDataJSON().selection, { kind: "merge" });
  const whole = await wholeHttp.json();
  assert.ok(whole.diff?.patch?.includes("First feature patch"), JSON.stringify(whole));
  await patch.locator("pre").waitFor();
  assert.match(await patch.locator("pre").innerText(), /First feature patch/);
  assert.match(await patch.locator("pre").innerText(), /Second feature patch/);
  await commits.first().click();
  const singleResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/review" && response.request().method() === "POST");
  await review.getByRole("button", { name: "Show read-only patch" }).click();
  const singleHttp = await singleResponse;
  const firstOid = (await commits.first().innerText()).match(/Commit 1: ([a-f0-9]+)/)?.[1];
  assert.deepEqual(singleHttp.request().postDataJSON().selection, { kind: "commits", commitOids: [firstOid] });
  const single = await singleHttp.json();
  assert.notEqual(single.diff.toTreeOid, whole.diff.toTreeOid);
  await patch.locator("pre").filter({ hasText: "First feature patch" }).waitFor();
  assert.equal((await patch.innerText()).includes("Second feature patch"), false, "single commit must not include the next commit");
  await review.getByRole("combobox").nth(1).selectOption("1");
  const rangeResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/review" && response.request().method() === "POST");
  await review.getByRole("button", { name: "Show read-only patch" }).click();
  const rangeHttp = await rangeResponse;
  const secondOid = (await commits.nth(1).innerText()).match(/Commit 2: ([a-f0-9]+)/)?.[1];
  assert.deepEqual(rangeHttp.request().postDataJSON().selection, { kind: "commits", commitOids: [firstOid, secondOid] });
  const range = await rangeHttp.json();
  assert.equal(range.diff.toTreeOid, whole.diff.toTreeOid);
  await patch.locator("pre").filter({ hasText: "Second feature patch" }).waitFor();
  assert.match(await patch.innerText(), /First feature patch/, "consecutive range contains both commits");
  console.log("PASS: project and session workflow preferences, whole/single/range read-only merge review");

  await openGitControls("Review & commit");
  const commitPanel = page.getByRole("region", { name: "commit controls" });
  await commitPanel.getByRole("button", { name: "Review & commit" }).click();
  await commitPanel.getByText("draft.txt", { exact: false }).waitFor();
  await commitPanel.getByRole("checkbox").check();
  await commitPanel.getByLabel("Commit message").fill("E2E manual commit");
  const before = git("rev-parse", "HEAD");
  await commitPanel.getByRole("button", { name: "Preview", exact: true }).click();
  const candidate = commitPanel.locator('[aria-label="Commit preview"]');
  await candidate.getByText("Review exact commit candidate").waitFor();
  assert.equal(git("rev-parse", "HEAD"), before, "preview must not commit");
  assert.match(await candidate.innerText(), /draft\.txt/);
  await candidate.getByRole("button", { name: "Confirm commit" }).click();
  await commitPanel.getByText("Last commit created").waitFor();
  assert.notEqual(git("rev-parse", "HEAD"), before);
  assert.equal(git("show", "--format=", "--name-only", "HEAD"), "draft.txt");
  console.log("PASS: manual whole-file commit preview and explicit confirmation");

  // Saving a check alone neither runs it nor grants integration approval.
  await openGitControls("Workspace workflow");
  await workflow.getByRole("button", { name: /Workspace workflow/ }).click();
  await workflow.getByRole("button", { name: /^Add check/ }).click();
  await workflow.getByLabel("Label", { exact: true }).fill("Fixture verification");
  await workflow.getByLabel("Executable (one path or name)").fill(process.execPath);
  await workflow.getByLabel(/Arguments \(one literal argument/).fill("-e\nprocess.exit(0)");
  await workflow.getByRole("button", { name: "Save session policy" }).click();
  await workflow.getByText(/Saved for this session/).waitFor();
  await openGitControls("Local integration review");
  await review.getByRole("button", { name: "Local integration review" }).click();
  await review.getByRole("button", { name: "Refresh review" }).click();
  await review.getByRole("button", { name: "Run check 1" }).waitFor();
  const targetBeforeVerification = execFileSync("git", ["-C", targetWorktree, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  await review.getByRole("button", { name: "Run check 1" }).click();
  await review.getByText(/Passed: receipt/).waitFor();
  assert.equal(execFileSync("git", ["-C", targetWorktree, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), targetBeforeVerification, "verification must not integrate");
  await review.getByRole("button", { name: "Prepare exact integration proposal" }).click();
  const proposal = review.getByLabel("Exact integration proposal");
  await proposal.getByText("Review exact integration proposal — not yet applied").waitFor();
  const expectedMerge = await proposal.locator("dt", { hasText: "Exact merge commit OID" }).locator("xpath=following-sibling::dd[1]").innerText();
  await proposal.getByText(/draft\.txt/).waitFor();
  await proposal.getByRole("button", { name: "I have reviewed this exact proposal" }).click();
  await proposal.getByRole("button", { name: /^Confirm exact plan/ }).click();
  await review.getByText("Local integration completed").waitFor();
  assert.equal(execFileSync("git", ["-C", targetWorktree, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), expectedMerge);
  console.log("PASS: explicit check, exact proposal, separately approved unsigned local merge");

  await openGitControls("Workspace workflow");
  await workflow.getByRole("button", { name: /Workspace workflow/ }).click();
  const continuation = workflow.getByLabel("Continue session in another worktree");
  await continuation.getByText(targetWorktree, { exact: false }).first().waitFor();
  await continuation.getByRole("button", { name: "Continue here…" }).click();
  await continuation.getByRole("button", { name: "Confirm continuation" }).click();
  await page.waitForFunction((id) => document.querySelector(`[data-session-id="${id}"]`)?.textContent?.includes("target"), sessionId);
  await page.getByText("Ready to review Git workflow", { exact: true }).waitFor();
  await openGitControls("Workspace workflow");
  await workflow.getByRole("button", { name: /Workspace workflow/ }).click();
  await workflow.getByText(`Actual session cwd: ${targetWorktree}`).waitFor();
  const moved = await api(`/api/git/workflow?sessionId=${sessionId}`);
  assert.equal(moved.cwd, targetWorktree);
  assert.equal((await api("/api/sessions?force=1")).sessions.find((session) => session.id === sessionId)?.cwd, targetWorktree);
  console.log("PASS: same chat continues in registered target worktree");

  const originalViewport = page.viewportSize();
  try {
    await page.setViewportSize({ width: 390, height: 800 });
    for (const name of ["Workspace workflow", "Review & commit", "Local integration review"]) {
      const icon = page.getByRole("button", { name, exact: true }).first();
      const rect = await icon.boundingBox();
      assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= 390 && rect.y < 80, `${name} top-bar icon should remain reachable at mobile width`);
    }
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}
