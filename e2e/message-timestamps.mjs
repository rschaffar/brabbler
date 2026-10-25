import assert from "node:assert/strict";

// Scalar timestamp policy belongs to the real mounted ChatWindow case. Keep
// BOTH desktop locale/font geometries and BOTH original mobile native controls.
export async function checkMessageTimestamps(page, { nativeProcess = false } = {}) {
  await page.getByText("E2E final answer", { exact: true }).waitFor();
  if (nativeProcess) {
    const process = page.getByRole("button", { name: /^Process details/ });
    assert.equal(await process.getAttribute("aria-expanded"), "false");
    await process.click(); // Native hit-testing/actionability; never force/dispatch.
    assert.equal(await process.getAttribute("aria-expanded"), "true");
    await process.click();
    assert.equal(await process.getAttribute("aria-expanded"), "false");
    console.log("PASS: original mobile RICH Process control expands and collapses natively");
    return;
  }
  const answerTime = page.locator("[data-message-role='assistant'][data-entry-id='answer'] time");
  const timeRect = await answerTime.boundingBox();
  const usageRect = await answerTime.locator("xpath=preceding-sibling::*[1]").boundingBox();
  assert.ok(timeRect && usageRect, "Timestamp and usage/cost must have actual rectangles");
  assert.ok(timeRect.x >= usageRect.x + usageRect.width, "Timestamp is to the right of the usage/cost");
  assert.ok(Math.abs(timeRect.y - usageRect.y) < 3, "Timestamp is on the usage row");
  console.log(`PASS: ${page.viewportSize().width}px timestamp is beside usage on the same row`);
}
