import assert from "node:assert/strict";
import { checkBlockingCard, checkBlockingCardArrival } from "./blocking-card.mjs";

// One native/default publication journey; compact input owns native select/tap,
// focus and bounds, not a second answer/policy/deadline matrix. Private gates apply.
export async function checkQuestionSets(page, width) {
  const desktop = width >= 640;
  const commands = [];
  const capture = (request) => {
    if (request.method() === "POST" && /\/api\/agent\/[^/]+$/.test(new URL(request.url()).pathname)) commands.push(request.postDataJSON());
  };
  page.on("request", capture);
  const live = page.locator("[data-question-set]");
  const card = live.getByRole("group", { name: "E2E question set", exact: true });
  const start = async (mode = "batch") => {
    await page.locator("[data-minimap-preview-box]").waitFor({ state: "hidden" });
    await page.locator("textarea").last().fill(`/e2e-ask-user ${mode}`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await card.waitFor();
    await checkBlockingCardArrival(card);
    await checkBlockingCard(card);
  };
  const next = () => card.getByRole("button", { name: "Next", exact: true }).click();
  const details = () => card.getByRole("textbox", { name: "Additional details (optional)", exact: true });
  const main = () => card.getByRole("textbox", { name: "Type your answer…", exact: true });
  const finish = async (answers) => {
    await page.getByText(`E2E batch result: ${JSON.stringify(answers)}`, { exact: true }).last().waitFor();
    await page.getByRole("button", { name: "Stop agent", exact: true }).waitFor({ state: "hidden" });
    await live.waitFor({ state: "hidden" });
  };
  try {
    await start();
    const id = await live.getAttribute("data-question-set");
    await card.getByRole("radio", { name: "Write an alternative answer", exact: true }).check();
    await main().fill("A tailored release");
    await details().fill("And keep it reversible");
    await next();
    await card.getByRole("checkbox", { name: "Desktop", exact: true }).check();
    await card.getByRole("checkbox", { name: "Mobile", exact: true }).check();
    await details().fill("Test both sizes");
    await next();
    await main().fill("A temporary constraint");
    await details().fill("Separate text details");
    await card.getByRole("checkbox", { name: "Skip this question", exact: true }).check();
    // Actual responsive overview branch, rather than a duplicated policy matrix.
    if (desktop) await card.getByRole("navigation").getByRole("button", { name: /^Scope:/ }).click();
    else await card.getByRole("combobox", { name: "Question navigation" }).selectOption("0");
    // The existing value needs no second edit. The actual mounted mixed-draft
    // owner covers collapse state; retain native compact disclosure once.
    if (!desktop) {
      await card.getByRole("button", { name: "Collapse", exact: true }).click();
      await live.getByRole("button", { name: /Awaiting response.*E2E question set/ }).click();
    }
    if (desktop) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await card.waitFor();
      assert.equal(await live.getAttribute("data-question-set"), id);
      assert.equal(await main().inputValue(), "A tailored release");
      assert.equal(await details().inputValue(), "And keep it reversible");
      await card.getByRole("navigation").getByRole("button", { name: "Review answers", exact: true }).click();
    } else {
      const navigation = card.getByRole("combobox", { name: "Question navigation" });
      await navigation.focus();
      await navigation.selectOption("3");
      await page.waitForFunction(() => document.activeElement?.tagName === "H3" && document.activeElement.closest("[data-question-set]"));
    }
    await card.getByText("A tailored release", { exact: true }).waitFor();
    await card.getByText("And keep it reversible", { exact: true }).waitFor();
    await checkBlockingCard(card);
    if (!desktop) {
      await card.getByRole("button", { name: "Edit Notes", exact: true }).tap();
      assert.equal(await main().inputValue(), "A temporary constraint");
      assert.equal(await details().inputValue(), "Separate text details");
      await main().focus();
      assert.equal(await main().evaluate(node => node === document.activeElement), true);
      await card.getByRole("button", { name: "Cancel", exact: true }).tap();
      await card.getByRole("button", { name: "Cancel question set", exact: true }).tap();
      await finish(null);
      return;
    }

    // Original 15000ms native ACK deadline ONCE, no shortened policy or retry.
    // First fetch is held before native dispatch; explicit retry dispatches once.
    await page.evaluate(() => {
      const original = window.fetch;
      window.fetch = (...args) => {
        const body = args[1]?.body;
        if (typeof body === "string" && JSON.parse(body).type === "extension_ui_response") {
          window.fetch = original;
          return new Promise((_, reject) => {
            args[1].signal.addEventListener("abort", () => reject(args[1].signal.reason), { once: true });
          });
        }
        return original(...args);
      };
    });
    await card.getByRole("button", { name: "Submit answers", exact: true }).click();
    await card.getByRole("alert").waitFor({ timeout: 20000 });
    await card.getByText("A tailored release", { exact: true }).waitFor();
    await card.getByRole("button", { name: "Retry submission", exact: true }).click();
    const answers = [
      { id: "scope", kind: "freeform", text: "A tailored release", comment: "And keep it reversible" },
      { id: "platforms", kind: "selection", selections: ["desktop", "mobile"], comment: "Test both sizes" },
      { id: "notes", kind: "skipped" },
    ];
    await finish(answers);
    assert.equal(commands.filter((c) => c.type === "extension_ui_response").length, 1);
    assert.equal(await page.evaluate((requestId) => Object.keys(sessionStorage).some((key) => key.startsWith("pi-web:question-draft:") && key.endsWith(requestId)), id), false);
    const receipt = page.locator(`[data-interaction-receipt="${id}"]`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await receipt.getByRole("button", { name: /Answered.*E2E question set/ }).click();
    await receipt.getByText("And keep it reversible", { exact: true }).waitFor();
    await receipt.getByText("Test both sizes", { exact: true }).waitFor();
    assert.equal(await receipt.getByRole("textbox").count(), 0);
    assert.equal(await receipt.getByRole("button", { name: /Submit|Edit|Cancel/ }).count(), 0);
    assert.equal(await receipt.count(), 1);
    await receipt.getByRole("button", { name: "Collapse", exact: true }).click();

    // Batch-specific original 4000ms server expiry, distinct from legacy2500
    // and select4000 -> untimed input. No synthetic/native-authority substitution.
    await start("batch-timeout");
    const beforeTimeout = commands.filter((c) => c.type === "extension_ui_response").length;
    await details().fill("Must not be submitted by timeout");
    await finish(null);
    assert.equal(commands.filter((c) => c.type === "extension_ui_response").length, beforeTimeout);
  } finally {
    page.off("request", capture);
  }
}
