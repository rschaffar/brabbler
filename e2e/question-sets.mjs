import assert from "node:assert/strict";
import { checkBlockingCard } from "./blocking-card.mjs";

export async function checkQuestionSets(page, width) {
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
    await checkBlockingCard(card);
  };
  const next = () => card.getByRole("button", { name: "Next", exact: true }).click();
  const back = () => card.getByRole("button", { name: "Back", exact: true }).click();
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
    assert.equal(await card.getByRole("radio", { checked: true }).count(), 0, "recommendations are not defaults");
    await card.getByRole("radio", { name: /Small/ }).check();
    await details().fill("Keep the first release small");
    await next();
    await card.getByRole("checkbox", { name: "Desktop", exact: true }).check();
    await card.getByRole("checkbox", { name: "Mobile", exact: true }).check();
    await card.getByRole("checkbox", { name: "None", exact: true }).check();
    await card.getByRole("checkbox", { name: "None", exact: true }).uncheck();
    assert.equal(await card.getByRole("checkbox", { name: "None", exact: true }).isChecked(), false);
    await card.getByRole("checkbox", { name: "None", exact: true }).check();
    assert.equal(await card.getByRole("checkbox", { name: "Desktop", exact: true }).isChecked(), false);
    await card.getByRole("checkbox", { name: "Desktop", exact: true }).check();
    assert.equal(await card.getByRole("checkbox", { name: "None", exact: true }).isChecked(), false);
    await card.getByRole("checkbox", { name: "Mobile", exact: true }).check();
    await details().fill("Test both sizes");
    await next();
    await main().fill("A temporary constraint");
    await details().fill("Separate text details");
    await card.getByRole("checkbox", { name: "Skip this question", exact: true }).check();
    await back();
    assert.equal(await card.getByRole("checkbox", { name: "Mobile", exact: true }).isChecked(), true);
    assert.equal(await details().inputValue(), "Test both sizes");
    await back();
    await card.getByRole("radio", { name: "Write an alternative answer", exact: true }).check();
    await main().fill("A tailored release");
    assert.equal(await details().inputValue(), "Keep the first release small", "additional details survive changing the main-answer mode");
    await details().fill("And keep it reversible");
    await main().press("Control+Enter");
    await page.keyboard.press("Escape");
    assert.equal(commands.filter((c) => c.type === "extension_ui_response").length, 0, "navigation and keyboard editing never submit");
    await card.getByRole("button", { name: "Collapse", exact: true }).click();
    await live.getByRole("button", { name: /Awaiting response.*E2E question set/ }).click();
    assert.equal(await main().inputValue(), "A tailored release");
    await page.reload({ waitUntil: "domcontentloaded" });
    await card.waitFor();
    assert.equal(await live.getAttribute("data-question-set"), id);
    assert.equal(await main().inputValue(), "A tailored release");
    assert.equal(await details().inputValue(), "And keep it reversible");
    // Navigate using the responsive overview, not just sequential buttons.
    if (width < 640) await card.getByRole("combobox", { name: "Question navigation" }).selectOption("3");
    else await card.getByRole("navigation").getByRole("button", { name: "Review answers", exact: true }).click();
    await card.getByText("A tailored release", { exact: true }).waitFor();
    await card.getByText("And keep it reversible", { exact: true }).waitFor();
    await card.getByRole("button", { name: "Edit Notes", exact: true }).click();
    assert.equal(await main().inputValue(), "A temporary constraint");
    assert.equal(await details().inputValue(), "Separate text details");
    assert.equal(await card.getByRole("checkbox", { name: "Skip this question", exact: true }).isChecked(), true);
    await card.getByRole("button", { name: "Review answers", exact: true }).last().click();
    // Simulate a client network rejection before dispatch, without suppressing real console/HTTP failures.
    await page.evaluate(() => {
      const original = window.fetch;
      window.fetch = (...args) => {
        const body = args[1]?.body;
        if (typeof body === "string" && JSON.parse(body).type === "extension_ui_response") {
          window.fetch = original;
          // An unresolved connection must become retryable via the real acknowledgement deadline.
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

    await start();
    await details().fill("Details alone are not a main answer");
    await next(); await next();
    await card.getByRole("button", { name: "Review answers", exact: true }).last().click();
    assert.equal(await card.getByRole("button", { name: "Submit answers", exact: true }).isDisabled(), true);
    await card.getByRole("button", { name: "Cancel", exact: true }).click();
    await card.getByRole("button", { name: "Keep editing", exact: true }).click();
    await card.getByRole("button", { name: "Cancel", exact: true }).click();
    await card.getByRole("button", { name: "Cancel question set", exact: true }).click();
    await finish(null);

    await start("batch-timeout");
    const beforeTimeout = commands.filter((c) => c.type === "extension_ui_response").length;
    await details().fill("Must not be submitted by timeout");
    await finish(null);
    assert.equal(commands.filter((c) => c.type === "extension_ui_response").length, beforeTimeout);
    console.log(`PASS: ${width}px question sets: mixed drafts, alternatives plus details, navigation/review, refresh, retry, receipts, cancel and expiry`);
  } finally {
    page.off("request", capture);
  }
}
