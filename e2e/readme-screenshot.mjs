// Documentation illustration only, not an additional functional coverage scenario.
// All content is authored here and rendered by the real packaged application.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const commandSource = `export interface Command {
  id: string;
  label: string;
  run: () => void;
}

/** Match every word, regardless of case or order. */
export function searchCommands(
  commands: readonly Command[],
  query: string,
): Command[] {
  const words = query.trim().toLowerCase()
    .split(/\\s+/).filter(Boolean);

  return commands.filter(({ label }) =>
    words.every(word =>
      label.toLowerCase().includes(word),
    ),
  );
}

export const shortcuts = [
  { keys: "Ctrl K", action: "Open palette" },
  { keys: "↑ / ↓", action: "Choose a command" },
  { keys: "Enter", action: "Run command" },
  { keys: "Escape", action: "Return to editor" },
] as const;
`;

export function seedReadmeScreenshot({ agentDir, writeSession, message, ids }) {
  const project = join(agentDir, "workspace", "brabbler");
  mkdirSync(join(project, "src"), { recursive: true });
  const file = join(project, "src", "commands.ts");
  writeFileSync(file, commandSource);
  writeFileSync(join(project, "README.md"), "# Command palette\n\nA small, keyboard-first workspace experiment.\n");
  writeFileSync(join(project, "src", "palette.ts"), "export const paletteTitle = 'Find a command';\n");
  // A genuine disposable Git root makes the branch/worktree controls representative.
  const git = (...args) => execFileSync("git", ["-C", project, ...args], { stdio: "pipe" });
  git("init", "-qb", "main");
  git("add", "README.md", "src");
  git("-c", "user.name=README Fixture", "-c", "user.email=e2e@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "-qm", "Add command palette example");
  const now = Date.now();
  const exampleSession = (id, entries, cwd) => {
    const minutes = id === ids[0] ? 3 : id === ids[1] ? 27 : 115;
    const time = now - minutes * 60_000;
    for (const entry of entries) {
      entry.timestamp = new Date(time).toISOString();
      entry.message.timestamp = time;
    }
    writeSession(id, entries, cwd);
  };

  const result = message("readme-read-result", "readme-read", "toolResult", [
    { type: "text", text: "src/commands.ts\n27 lines · TypeScript" },
  ]);
  Object.assign(result.message, { toolCallId: "readme-tool", toolName: "read", isError: false });
  exampleSession(ids[0], [
    message("readme-user", null, "user", "Add keyboard navigation to the command palette. Keep the search small and easy to test."),
    message("readme-read", "readme-user", "assistant", [
      { type: "text", text: "I'll keep filtering separate from the UI, then make every command reachable from the keyboard." },
      { type: "toolCall", id: "readme-tool", name: "read", arguments: { path: "src/commands.ts" } },
    ]),
    result,
    message("readme-answer", "readme-read-result", "assistant",
      "## A keyboard-first command palette\n\n"
      + "The search stays deliberately small: every word matches, in any order, without a fuzzy-search dependency.\n\n"
      + "- **Ctrl K** opens the palette.\n"
      + "- **↑ / ↓** moves between results; **Enter** runs the selection.\n"
      + "- **Escape** returns focus to the editor.\n\n"
      + "### Keep the seams clear\n\n"
      + "`searchCommands` is a pure function. Keyboard handling and focus restoration stay in the palette, so each can be tested independently.\n\n"
      + `[Open commands.ts](${file}) · [Project notes](${join(project, "README.md")})\n\n`
      + "Next, I’d add cases for an empty query, mixed case, and multi-word matches."),
  ], project);
  exampleSession(ids[1], [
    message("readme-review-user", null, "user", "Review the release checklist"),
    message("readme-review-answer", "readme-review-user", "assistant", "Keep the release focused: review the diff, run the checks, and document the result."),
  ], project);
  exampleSession(ids[2], [
    message("readme-stream-user", null, "user", "Explain the streaming pipeline"),
    message("readme-stream-answer", "readme-stream-user", "assistant", "The browser follows session events while the server owns the agent lifecycle."),
  ], project);
}

export async function captureReadmeScreenshot({ base, sessionId, newInputContext, harness, artifacts }) {
  const context = await newInputContext("en-desktop", {
    viewport: { width: 1440, height: 960 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const errors = harness.errorsFor(context);
  const failures = [];
  try {
    await context.addInitScript(({ origin }) => {
      if (location.origin !== origin) return;
      localStorage.setItem("brabbler-theme", "dark");
      localStorage.setItem("brabbler-sidebar-width", "252");
      localStorage.setItem("brabbler-right-panel-width", "500");
    }, { origin: base });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Open commands.ts", exact: true }).click();
    const panel = page.locator("#file-panel");
    await panel.getByText("searchCommands", { exact: false }).first().waitFor();
    const process = page.getByRole("button", { name: /^Process details/ });
    await process.click();
    await page.locator('button[aria-expanded="true"]').filter({ hasText: /^Process details/ }).waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
    });
    await page.mouse.move(1430, 950);
    await page.screenshot({ path: join(artifacts, "readme-dark.png"), animations: "disabled" });
    console.log("README illustration captured with synthetic content; not an additional coverage scenario.");
  } catch (error) {
    failures.push(error);
  }
  try { await harness.closeContext(context); } catch (error) { failures.push(error); }
  try { assert.deepEqual(errors, [], "README capture browser/server errors, including teardown"); }
  catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, "README screenshot capture failed");
}
