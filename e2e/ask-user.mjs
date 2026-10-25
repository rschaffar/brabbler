import assert from "node:assert/strict";
import { checkBlockingCard, checkBlockingCardArrival } from "./blocking-card.mjs";
import { checkQuestionSets } from "./question-sets.mjs";

// Conditional replacement only: requires reviewed lower/default/fault gates in
// the private disposition map and NEW success-only scenario IDs at dispatch.
export async function checkAskUserDialog(page, width) {
  const desktop = width >= 640;
  const commands = [];
  const onRequest = (request) => {
    if (request.method() === "POST" && /\/api\/agent\/[^/]+$/.test(new URL(request.url()).pathname)) commands.push(request.postDataJSON());
  };
  page.on("request", onRequest);
  const start = async (mode) => {
    await page.locator("[data-minimap-preview-box]").waitFor({ state: "hidden" });
    await page.locator("textarea").last().fill(`/e2e-ask-user ${mode}`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const card = page.getByRole("group", { name: "E2E browser question" });
    await card.waitFor();
    await checkBlockingCardArrival(card);
    await checkBlockingCard(card);
    assert.equal(await card.locator("xpath=ancestor::div[contains(@class, 'overflow-y-auto')]").count() > 0, true, "Question card belongs to the chat scroller");
    return card;
  };
  const finish = async (answer) => {
    await page.getByText(`E2E ask_user result: ${JSON.stringify(answer)}`, { exact: true }).last().waitFor();
    await page.getByRole("button", { name: "Stop agent", exact: true }).waitFor({ state: "hidden" });
  };
  try {
    if (desktop) {
      await start("single");
      await page.reload({ waitUntil: "domcontentloaded" });
      const single = page.getByRole("group", { name: "E2E browser question" });
      await single.waitFor();
      await single.getByText("A detailed reason for asking").waitFor();
      await single.getByText("Second", { exact: true }).click();
      await single.getByRole("textbox", { name: "Additional details (optional)" }).fill("More context");
      await single.getByRole("button", { name: "Collapse" }).click();
      await page.waitForFunction(() => document.activeElement?.classList.contains("blocking-card-collapsed"));
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA" && document.activeElement.closest(".blocking-card"));
      assert.equal(await single.getByRole("textbox", { name: "Additional details (optional)" }).inputValue(), "More context");
      await single.getByRole("button", { name: "Submit" }).click();
      await finish({ kind: "selection", selections: ["Second"], comment: "More context" });
      const saved = page.locator("[data-interaction-receipt]").last();
      await saved.waitFor();
      const receiptId = await saved.getAttribute("data-interaction-receipt");
      await page.reload({ waitUntil: "domcontentloaded" });
      const receipt = page.locator(`[data-interaction-receipt="${receiptId}"]`);
      await receipt.waitFor();
      assert.equal(await receipt.count(), 1, "saved question receipt is not duplicated by reconnect");
      const beforeReview = commands.filter((command) => command.type === "extension_ui_response").length;
      await receipt.getByRole("button", { name: /Answered.*E2E browser question/ }).click();
      await receipt.getByText("Second — More context", { exact: true }).last().waitFor();
      await receipt.getByText("Another description", { exact: true }).waitFor();
      const historical = receipt.getByRole("group", { name: "E2E browser question" });
      await checkBlockingCard(historical);
      assert.equal(await historical.getByRole("textbox").count(), 0);
      assert.equal(await historical.getByRole("button", { name: /Submit|Cancel/ }).count(), 0);
      await historical.getByRole("button", { name: "Collapse", exact: true }).click();
      assert.equal(commands.filter((command) => command.type === "extension_ui_response").length, beforeReview);

      // Distinct real single-question protocol expiry, original 2500ms policy.
      const timed = await start("timeout");
      await timed.getByText(/expires in \ds/).waitFor();
      const beforeTimeout = commands.length;
      await timed.waitFor({ state: "hidden", timeout: 10000 });
      await finish(null);
      assert.equal(commands.slice(beforeTimeout).some((command) => command.type === "extension_ui_response"), false);
      await page.locator("[data-interaction-receipt]").last().getByRole("button", { name: /Timed out.*E2E browser question/ }).waitFor();
    } else {
      // Real compact long-body geometry, touch disclosure and inline focus.
      const long = await start("long");
      await long.getByText(/More background/).waitFor();
      await long.getByText("Context", { exact: true }).tap();
      await long.getByText("Context", { exact: true }).tap();
      await long.getByText(/More background/).waitFor();
      await checkBlockingCard(long);
      const field = long.getByRole("textbox", { name: "Additional details (optional)" });
      await field.fill("More context");
      await long.getByRole("button", { name: "Collapse", exact: true }).tap();
      await page.waitForFunction(() => document.activeElement?.classList.contains("blocking-card-collapsed"));
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA" && document.activeElement.closest(".blocking-card"));
      assert.equal(await field.inputValue(), "More context");
      const beforeCancel = commands.length;
      await long.getByRole("radio", { name: /First/ }).focus();
      await page.keyboard.press("Escape");
      await long.waitFor({ state: "hidden" });
      await finish(null);
      assert.equal(commands.slice(beforeCancel).filter((command) => command.type === "extension_ui_response" && command.cancelled).length, 1);
      assert.equal(commands.slice(beforeCancel).some((command) => command.type === "abort"), false);
    }
    await checkQuestionSets(page, width);
    console.log(`PASS: ${width}px thin installed question ${desktop ? "receipt/expiry" : "touch/focus/overflow"} bridge`);
  } finally {
    page.off("request", onRequest);
  }
}
