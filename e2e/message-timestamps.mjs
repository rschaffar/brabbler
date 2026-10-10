import assert from "node:assert/strict";

export async function checkMessageTimestamps(page, timestamp) {
  await page.getByText("E2E final answer", { exact: true }).waitFor();
  const processDetails = page.getByRole("button", { name: /^Process details/ });
  const assistantEntries = page.locator("[data-message-role='assistant']");
  assert.equal(await assistantEntries.locator("time").count(), 1, "Final answer shows its timestamp while process details are collapsed");
  const answerTime = assistantEntries.locator("time");
  assert.equal(await answerTime.getAttribute("datetime"), timestamp);
  const englishTime = await page.evaluate((value) => {
    const date = new Date(value);
    const now = new Date();
    const time = date.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
    const sameDay = date.toDateString() === now.toDateString();
    const day = date.toLocaleDateString("en", { month: "short", day: "numeric", year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
    return { visible: sameDay ? time : `${day} ${time}`, tooltip: date.toLocaleString("en") };
  }, timestamp);
  assert.equal(await answerTime.textContent(), englishTime.visible);
  assert.equal(await answerTime.getAttribute("title"), englishTime.tooltip);
  const metadataOrder = await answerTime.evaluate((el) => ({
    previous: el.previousElementSibling?.textContent,
    next: el.nextElementSibling?.getAttribute("title"),
  }));
  assert.equal(metadataOrder.previous, "100 in · 20 out · 30 cache R · $0.0123");
  assert.equal(metadataOrder.next, "Copy message");
  if (page.viewportSize().width > 600) {
    const timeRect = await answerTime.boundingBox();
    const usageRect = await answerTime.locator("xpath=preceding-sibling::*[1]").boundingBox();
    assert.ok(timeRect.x >= usageRect.x + usageRect.width, "Timestamp is to the right of the usage/cost");
    assert.ok(Math.abs(timeRect.y - usageRect.y) < 3, "Timestamp is on the usage row");
  }
  await processDetails.click();
  assert.equal(await assistantEntries.locator("time").count(), 2, "Each stored assistant entry shows exactly one timestamp, even when the final entry is split");
  assert.equal(await page.locator("[data-message-role='assistant'][data-entry-id='call'] time").count(), 1);
  assert.equal(await page.locator("[data-message-role='assistant'][data-entry-id='answer'] time").count(), 1);
  await processDetails.click();
  console.log(`PASS: ${page.viewportSize().width}px message timestamps follow cost, include intermediate entries and do not duplicate split entries`);
}
