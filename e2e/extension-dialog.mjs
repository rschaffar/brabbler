import assert from "node:assert/strict";
import { join } from "node:path";
import { checkBlockingCard, checkBlockingCardArrival } from "./blocking-card.mjs";

export const extensionSource = `export default function (pi) {
  // Ledger-only Activity setup uses a real completed command, not a question timer.
  // Real interaction/expiry remains owned by the question and dialog scenarios.
  pi.registerCommand("e2e-complete", {
    handler: async (_args, ctx) => { ctx.ui.notify("E2E completion fixture"); },
  });
  pi.registerCommand("e2e-dialog", {
    handler: async (mode, ctx) => {
      let result;
      if (mode === "timeout") {
        await ctx.ui.select("E2E timeout", ["Wait"], { timeout: 4000 });
        result = await ctx.ui.input("E2E after timeout");
      } else if (mode === "longtitle") {
        result = await ctx.ui.confirm("E2E longtitle\\n" + "A long extension title. ".repeat(160), "Details");
      } else if (mode === "select") {
        result = await ctx.ui.select("E2E select", Array.from({ length: 30 }, (_, i) => "Option " + (i + 1)));
      } else {
        result = await ctx.ui[mode]("E2E " + mode, "Details");
      }
      ctx.ui.notify("E2E " + mode + " result: " + String(result));
    },
  });
  pi.registerCommand("e2e-ask-user", {
    handler: async (mode, ctx) => {
      if (mode.startsWith("batch")) {
        const answer = await ctx.ui.askUserBatch({ title: "E2E question set", context: "Related decisions", questions: [
          { id: "scope", shortLabel: "Scope", question: "Choose scope", context: "Scope background", type: "single", required: true, options: [
            { id: "small", title: "Small", description: "Start small", recommended: true }, { id: "large", title: "Large" },
          ] },
          { id: "platforms", shortLabel: "Platforms", question: "Choose platforms", type: "multiple", required: true, options: [
            { id: "desktop", title: "Desktop" }, { id: "mobile", title: "Mobile" }, { id: "none", title: "None", exclusive: true },
          ] },
          { id: "notes", shortLabel: "Notes", question: "Any constraints?", type: "text", required: false, options: [] },
        ] }, mode === "batch-timeout" ? 4000 : undefined);
        ctx.ui.notify("E2E batch result: " + JSON.stringify(answer));
        return;
      }
      const question = {
        question: "E2E browser question",
        context: mode === "long" ? "More background. ".repeat(30) : "A detailed reason for asking",
        options: mode === "freeform" ? [] : [
          { title: "First", description: "A helpful description" },
          { title: "Second", description: "Another description" },
        ],
        allowMultiple: mode === "multi",
        allowFreeform: true,
        allowComment: true,
        contextExpanded: true,
      };
      const answer = await ctx.ui.askUser(question, mode === "timeout" ? 2500 : undefined);
      ctx.ui.notify("E2E ask_user result: " + JSON.stringify(answer));
    },
  });
}`;

export async function checkExtensionDialogs(page, artifacts, width) {
  // Conditional reduced body; new scenario IDs and lower/default fault gates
  // are required before dispatch. extensionSource/protocol deadlines unchanged.
  const desktop = width >= 640;
  const commands = [];
  const onRequest = (request) => {
    if (request.method() === "POST" && /\/api\/agent\/[^/]+$/.test(new URL(request.url()).pathname)) {
      commands.push(request.postDataJSON());
    }
  };
  page.on("request", onRequest);
  const start = async (mode) => {
    await page.mouse.move(0, 0);
    await page.locator("[data-minimap-preview-box]").waitFor({ state: "hidden" });
    const input = page.locator("textarea").last();
    await input.fill(`/e2e-dialog ${mode}`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const card = page.getByRole("group", mode === "longtitle" ? { name: /^E2E longtitle/ } : { name: `E2E ${mode}`, exact: true });
    await card.waitFor();
    await checkBlockingCardArrival(card);
    await checkBlockingCard(card);
    assert.equal(await card.locator("xpath=ancestor::div[contains(@class, 'overflow-y-auto')]").count() > 0, true, "Question card belongs to the chat scroller");
    return card;
  };
  const finish = async (mode, result) => {
    await page.getByText(`E2E ${mode} result: ${result}`, { exact: true }).waitFor();
    await page.getByRole("button", { name: "Stop agent", exact: true }).waitFor({ state: "hidden" });
  };

  try {
    const select = await start("select");
    await page.waitForFunction(() => document.activeElement?.textContent === "Option 1");
    // One real wrap/focus/scroll witness. End targets this SAME Option 30;
    // its separate key destination is verified by the exact seven-key owner.
    await page.keyboard.press("ArrowUp");
    assert.equal(await page.locator(":focus").textContent(), "Option 30");
    assert.ok(await page.locator(":focus").evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const container = element.closest(".blocking-card-body").getBoundingClientRect();
      return bounds.top >= container.top && bounds.bottom <= container.bottom;
    }), "Keyboard selection must scroll into view");
    await page.screenshot({ path: join(artifacts, `extension-select-${width}.png`) });
    if (desktop) await page.keyboard.press("Enter");
    else await select.getByRole("button", { name: "Option 30", exact: true }).tap();
    await select.waitFor({ state: "hidden" });
    await finish("select", "Option 30");
    const receipt = page.locator("[data-interaction-receipt]").last();
    await receipt.getByRole("button", { name: /Answered.*E2E select/ }).click();
    const historical = receipt.getByRole("group", { name: "E2E select", exact: true });
    await checkBlockingCard(historical);
    assert.equal(await historical.getByRole("button").count(), 1, "historical choices cannot be submitted");
    await historical.getByText("Option 30", { exact: true }).last().waitFor();
    await historical.getByRole("button", { name: "Collapse", exact: true }).click();

    // One cancellation/focus representative for each materially different
    // native field. Boolean/default-return/count permutations belong lower.
    for (const mode of [desktop ? "input" : "editor"]) {
      const dialog = await start(mode);
      assert.ok(await page.locator(":focus").evaluate(element => element.closest('[role="group"]')));
      if (mode === "input" || mode === "editor") {
        await dialog.getByRole("textbox").fill("Preserved draft");
        await dialog.getByRole("button", { name: "Collapse", exact: true }).click();
        await page.waitForFunction(() => document.activeElement?.classList.contains("blocking-card-collapsed"));
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => document.activeElement?.matches("input, textarea") && document.activeElement.closest(".blocking-card"));
        assert.equal(await dialog.getByRole("textbox").inputValue(), "Preserved draft");
      }
      if (mode === "input" || mode === "editor") await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
      const before = commands.length;
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await finish(mode, mode === "confirm" ? "false" : "undefined");
      assert.equal(commands.slice(before).filter(command => command.type === "extension_ui_response").length, 1);
      assert.equal(commands.slice(before).some(command => command.type === "abort"), false, "Dialog Esc must not abort the agent");
    }

    // Real input Enter vs editor newline/Ctrl+Enter, not handler simulation.
    const mode = desktop ? "input" : "editor";
    const nativeField = await start(mode);
    const field = nativeField.getByRole("textbox");
    await field.fill("Native field");
    if (desktop) await field.press("Enter");
    else {
      await field.press("Enter");
      await field.press("N");
      assert.equal(await field.inputValue(), "Native field\nN");
      await field.press("Control+Enter");
    }
    await finish(mode, desktop ? "Native field" : "Native field\nN");

    const longTitle = await start("longtitle");
    await longTitle.getByRole("button", { name: "Cancel", exact: true }).click();
    await finish("longtitle", "false");

    // Compact long-title/body geometry above is retained; this distinct real
    // 4000ms server-expiry -> untimed-input handoff executes desktop only.
    if (!desktop) return;
    const timed = await start("timeout");
    const countdown = timed.getByText(/expires in \ds/);
    await countdown.waitFor();
    const initialCountdown = await countdown.innerText();
    await page.waitForFunction(initial => {
      const text = document.querySelector('[role="group"][aria-label="E2E timeout"]:not([hidden])')?.textContent;
      return text?.includes("expires in") && !text.includes(initial);
    }, initialCountdown);
    const before = commands.length;
    await timed.getByRole("button", { name: "Collapse", exact: true }).click();
    await page.getByRole("button", { name: /Awaiting response.*E2E timeout.*expires in/ }).waitFor();
    const afterTimeout = page.getByRole("group", { name: "E2E after timeout", exact: true });
    await afterTimeout.waitFor();
    assert.equal(commands.slice(before).some(command => command.type === "extension_ui_response"), false, "Only the server closes expired requests");
    assert.equal(await afterTimeout.getByText(/expires in/).count(), 0);
    await afterTimeout.getByRole("textbox").fill("Still answerable");
    await page.keyboard.press("Enter");
    await finish("timeout", "Still answerable");
    await page.getByRole("button", { name: /Timed out.*E2E timeout/ }).last().waitFor();
    console.log(`PASS: ${width}px thin native extension focus/scroll/receipt/sequential-expiry bridge`);
  } finally {
    page.off("request", onRequest);
  }
}
