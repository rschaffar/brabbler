import assert from "node:assert/strict";

export async function checkAskUserDialog(page, width) {
  const commands = [];
  const onRequest = (request) => {
    if (request.method() === "POST" && /\/api\/agent\/[^/]+$/.test(new URL(request.url()).pathname)) {
      commands.push(request.postDataJSON());
    }
  };
  page.on("request", onRequest);
  const start = async (mode) => {
    await page.locator("[data-minimap-preview-box]").waitFor({ state: "hidden" });
    await page.locator("textarea").last().fill(`/e2e-ask-user ${mode}`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const card = page.getByRole("group", { name: "E2E browser question" });
    await card.waitFor();
    assert.equal(await card.locator("xpath=ancestor::div[contains(@class, 'overflow-y-auto')]").count() > 0, true, "Question card belongs to the chat scroller");
    return card;
  };
  const finish = async (answer) => {
    await page.getByText(`E2E ask_user result: ${JSON.stringify(answer)}`, { exact: true }).last().waitFor();
    await page.getByRole("button", { name: "Stop agent", exact: true }).waitFor({ state: "hidden" });
  };
  try {
    const single = await start("single");
    await single.getByText("A detailed reason for asking").waitFor();
    await single.getByText("Second", { exact: true }).click();
    await single.getByRole("textbox", { name: "Optional comment" }).fill("More context");
    await single.getByRole("button", { name: "Collapse" }).click();
    await page.getByRole("button", { name: /Awaiting response.*E2E browser question/ }).click();
    assert.equal(await single.getByRole("textbox", { name: "Optional comment" }).inputValue(), "More context");
    await single.getByRole("button", { name: "Submit" }).click();
    await finish({ kind: "selection", selections: ["Second"], comment: "More context" });

    const multi = await start("multi");
    await multi.getByText("First", { exact: true }).click();
    await multi.getByText("Second", { exact: true }).click();
    await multi.getByRole("button", { name: "Submit" }).click();
    await finish({ kind: "selection", selections: ["First", "Second"] });

    const freeform = await start("freeform");
    await freeform.getByRole("textbox", { name: "Type your answer…" }).fill("My own answer");
    await freeform.getByRole("button", { name: "Submit" }).click();
    await finish({ kind: "freeform", text: "My own answer" });

    const longContext = await start("long");
    assert.equal(await longContext.getByText(/More background/).isVisible(), false, "Long context starts collapsed");
    await longContext.getByText("Context", { exact: true }).click();
    await longContext.getByText(/More background/).waitFor({ state: "visible" });
    await longContext.getByRole("button", { name: "Cancel" }).click();
    await finish(null);

    const beforeCancel = commands.length;
    const cancelled = await start("single");
    await cancelled.getByRole("radio", { name: /First/ }).focus();
    await page.keyboard.press("Escape");
    await cancelled.waitFor({ state: "hidden" });
    await finish(null);
    assert.equal(commands.slice(beforeCancel).filter((command) => command.type === "extension_ui_response" && command.cancelled).length, 1);
    assert.equal(commands.slice(beforeCancel).some((command) => command.type === "abort"), false);

    const timed = await start("timeout");
    await timed.getByText(/expires in \ds/).waitFor();
    const beforeTimeout = commands.length;
    await timed.waitFor({ state: "hidden", timeout: 10000 });
    await finish(null);
    assert.equal(commands.slice(beforeTimeout).some((command) => command.type === "extension_ui_response"), false);
    console.log(`PASS: ${width}px browser-native ask_user single/multi/freeform/cancel/expiry`);
  } finally {
    page.off("request", onRequest);
  }
}
