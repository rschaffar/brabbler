import assert from "node:assert/strict";

/** Browser-only geometry shared by the complete chain and responsive cases. */
export function activityLayoutChecks(page, width, selected) {
  const checkWorktreeBadge = async (row) => {
    const badge = row.locator('span[title^="Worktree: "]');
    if (selected.isWorktree && selected.branch) {
      await badge.waitFor({ state: "visible" });
      assert.equal(await badge.textContent(), selected.branch);
      assert.equal(await badge.getAttribute("title"), `Worktree: ${selected.cwd}`);
      const button = row.locator("button.activity-item");
      if (await button.count()) assert.ok((await button.getAttribute("aria-label")).includes(selected.branch), "accessible row name includes the worktree branch");
      const bounds = await badge.boundingBox();
      assert.ok(bounds.width > 0 && bounds.x + bounds.width <= width, "worktree badge fits the viewport");
    } else {
      assert.equal(await badge.count(), 0, "main-checkout sessions have no worktree badge");
    }
  };
  const dotColor = (row) => row.locator(".activity-item-top .activity-dot")
    .evaluate((dot) => getComputedStyle(dot).backgroundColor);
  const checkActionBox = async (row) => {
    assert.equal(await row.locator(".activity-item-action").count(), 0, "navigation needs no visible Open/Review label");
    const layout = await row.evaluate((button) => {
      const card = button.parentElement.getBoundingClientRect();
      const box = button.parentElement.querySelector(".activity-item-actions");
      const bounds = box.getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      const title = button.querySelector(".activity-item-title").getBoundingClientRect();
      const controls = [...box.querySelectorAll("button")];
      return {
        compactRightBox: bounds.left >= rect.right && bounds.right <= card.right && bounds.width <= 60 && bounds.width >= 24,
        titleUsesRightEdge: Math.abs(title.right - (rect.right - parseFloat(getComputedStyle(button).paddingRight))) < 1,
        verticallyCentered: Math.abs((bounds.top + bounds.bottom) - (card.top + card.bottom)) < 1,
        stackedTargets: controls.length > 0 && controls.every((control, index) => {
          const target = control.getBoundingClientRect();
          const previous = controls[index - 1]?.getBoundingClientRect();
          return target.left >= bounds.left && target.right <= bounds.right && target.width >= 24 && target.height >= 24
            && (!previous || target.top >= previous.bottom) && getComputedStyle(control).fontSize === "11px";
        }),
      };
    });
    assert.deepEqual(layout, { compactRightBox: true, titleUsesRightEdge: true, verticallyCentered: true, stackedTargets: true },
      "small text actions stack inside one narrow box beside the session, with separate usable targets");
  };
  const checkControlFits = async (button) => {
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    assert.ok(box && box.width > 0 && box.x >= 0 && box.x + box.width <= width + 1, "control fits viewport");
  };
  return { checkWorktreeBadge, dotColor, checkActionBox, checkControlFits };
}

/** Real native receipt response/body barrier, matched to the displayed completion. */
export function activityReceiptResponse(page, op, sessionId, at) {
  const pending = page.waitForResponse((response) => {
    const request = response.request();
    if (new URL(response.url()).pathname !== "/api/activity/review" || request.method() !== "POST") return false;
    const body = request.postDataJSON();
    return body.op === op && body.entries.some((entry) => entry.sessionId === sessionId && entry.at === at);
  });
  void pending.catch(() => {});
  const complete = pending.then(async (response) => {
    assert.equal(response.status(), 200);
    const persisted = await response.json();
    const completion = persisted.completedRuns.find((entry) => entry.sessionId === sessionId);
    assert.ok(completion && completion.at === at, "native reply retains the exact displayed completion");
    const confirmed = op === "ack" ? persisted.reviewedRuns : persisted.laterRuns;
    assert.ok(confirmed.some((entry) => entry.sessionId === sessionId && entry.at >= at), "native reply confirms the exact submitted receipt");
    return persisted;
  });
  void complete.catch(() => {});
  return complete;
}
