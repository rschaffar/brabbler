import assert from "node:assert/strict";
import { join } from "node:path";
import { checkBlockingCard } from "./blocking-card.mjs";

export const extensionSource = `export default function (pi) {
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
          { id: "scope", shortLabel: "Scope", question: "Choose scope", type: "single", required: true, options: [
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
        contextExpanded: false,
      };
      const answer = await ctx.ui.askUser(question, mode === "timeout" ? 2500 : undefined);
      ctx.ui.notify("E2E ask_user result: " + JSON.stringify(answer));
    },
  });
}`;

export async function checkExtensionDialogs(page, artifacts, width) {
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
    for (const [key, expected] of [["ArrowUp", "Option 30"], ["ArrowDown", "Option 1"], ["ArrowRight", "Option 2"], ["ArrowLeft", "Option 1"], ["End", "Option 30"], ["Home", "Option 1"], ["End", "Option 30"]]) {
      await page.keyboard.press(key);
      assert.equal(await page.locator(":focus").textContent(), expected);
    }
    assert.ok(await page.locator(":focus").evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const container = element.closest(".blocking-card-body").getBoundingClientRect();
      return bounds.top >= container.top && bounds.bottom <= container.bottom;
    }), "Keyboard selection must scroll into view");
    await page.screenshot({ path: join(artifacts, `extension-select-${width}.png`) });
    await page.keyboard.press("Enter");
    await select.waitFor({ state: "hidden" });
    await finish("select", "Option 30");
    const receipt = page.locator("[data-interaction-receipt]").last();
    await receipt.getByRole("button", { name: /Answered.*E2E select/ }).click();
    const historical = receipt.getByRole("group", { name: "E2E select", exact: true });
    await checkBlockingCard(historical);
    assert.equal(await historical.getByRole("button").count(), 1, "historical choices cannot be submitted");
    await historical.getByText("Option 30", { exact: true }).last().waitFor();
    await historical.getByRole("button", { name: "Collapse", exact: true }).click();

    for (const mode of ["select", "confirm", "input", "editor"]) {
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

    const longTitle = await start("longtitle");
    await longTitle.getByRole("button", { name: "Cancel", exact: true }).click();
    await finish("longtitle", "false");

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
    console.log(`PASS: ${width}px extension keyboard navigation, cancel, draft preservation, server expiry and read-only receipts`);
  } finally {
    page.off("request", onRequest);
  }
}
