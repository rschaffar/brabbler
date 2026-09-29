import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";

const expectedConflicts = new WeakMap();
/** Consume only declared, real 409 task-review responses, not arbitrary console errors. */
export function consumeExpectedTaskConflict(page, event) {
  const count = expectedConflicts.get(page) ?? 0;
  if (!count || event.text() !== "Failed to load resource: the server responded with a status of 409 (Conflict)") return false;
  try { if (new URL(event.location().url).pathname !== "/api/git/workflow/task") return false; } catch { return false; }
  expectedConflicts.set(page, count - 1); return true;
}

/** Disposable repository/documents only. Never targets the operator's agent dir. */
export async function checkGitTaskBinding(page, { cwd, task, home, contained, screenshot }) {
  const openEvidence = async () => {
    await home();
    const summary = task.getByText("Source evidence · optional legacy metadata", { exact: true });
    if (!await summary.locator("..").evaluate((element) => element.open)) await summary.click();
  };
  if (process.platform !== "linux") {
    await openEvidence();
    const unavailable = task.locator('details[aria-label="Task binding and source review"]');
    await unavailable.locator(":scope > summary").click();
    await unavailable.getByText(/available only with Linux/).waitFor();
    assert.equal(await unavailable.getByLabel("Task goal").isDisabled(), true);
    await unavailable.locator(":scope > summary").click();
    console.log("PASS: source adoption is explicitly unavailable without Linux descriptor-relative reads");
    return;
  }
  const folder = join(cwd, "e2e-task-review"), local = join(cwd, "AGENTS.md"), ancestor = join(dirname(cwd), "AGENTS.md");
  for (const path of [folder, local, ancestor]) assert.equal(existsSync(path), false, `Fixture owns new path ${path}`);
  mkdirSync(folder);
  const first = join(folder, "first.md"), second = join(folder, "second.md"), dependency = join(folder, `dependency-${"long-".repeat(25)}.md`);
  const exact = "E2E exact source text. No execution permission.\n<script>window.taskReviewInjected=true</script>\n" + "bounded long source line ".repeat(50) + "\n" + "source evidence only\n".repeat(50);
  writeFileSync(first, exact); writeFileSync(second, "E2E second linked source; evidence only.\n");
  writeFileSync(dependency, "E2E explicit dependency; no automatic link traversal.\n"); symlinkSync(first, local);
  const originalViewport = page.viewportSize();
  const binding = task.locator('details[aria-label="Task binding and source review"]');
  const request = (operation) => page.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/workflow/task"
    && response.request().method() === "POST" && response.request().postDataJSON()?.operation === operation);
  const click = async (operation, label, status = 200) => {
    if (status === 409) expectedConflicts.set(page, (expectedConflicts.get(page) ?? 0) + 1);
    const response = request(operation); await binding.getByRole("button", { name: label, exact: true }).click();
    const http = await response, body = await http.json(); assert.equal(http.status(), status, JSON.stringify(body)); return { http, body };
  };
  try {
    await openEvidence(); await binding.locator(":scope > summary").focus(); await page.keyboard.press("Enter");
    await binding.getByLabel("Task goal").fill("E2E explicitly reviewed task — not a grant");
    await binding.getByLabel("Originating user request").selectOption("root");
    await binding.getByLabel("Existing task checkout").selectOption("feature");
    await binding.getByLabel("Additional Markdown dependencies").fill(dependency);
    const missingA = await click("preview", "Preview task & instruction sources", 409);
    assert.deepEqual(missingA.body.sourceTargets, [{ path: local, realPath: first }]);
    assert.equal(missingA.body.snapshot, undefined);
    symlinkSync(second, ancestor); // A second exact destination appears while the first question is open.
    const missingB = await click("preview", "Read these exact source destinations", 409);
    assert.deepEqual(missingB.body.sourceTargets, [{ path: ancestor, realPath: second }]);
    const prepared = await click("preview", "Read these exact source destinations");
    assert.equal(prepared.http.request().postDataJSON().targets.length, 2, "Previously selected A survives the B disclosure");
    assert.equal(prepared.body.snapshot.sources.sources.find((source) => source.path === local).content, exact);
    const candidate = binding.getByLabel("Exact task binding preview");
    await candidate.waitFor();
    const sourceDocument = candidate.locator(".workflow-binding-source").filter({ has: page.locator("summary").filter({ hasText: local }) });
    await sourceDocument.locator("summary").click();
    assert.equal(await sourceDocument.locator("pre").textContent(), exact);
    assert.equal(await sourceDocument.locator("script,img").count(), 0);
    assert.equal(await candidate.getByRole("checkbox").count(), 0, "One explicit adoption button, no review acknowledgement gate");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await sourceDocument.scrollIntoViewIfNeeded();
      await contained(`${width}px task/source evidence review`);
      assert.equal(await sourceDocument.locator("pre").evaluate((element) => element.scrollHeight > element.clientHeight), true);
      await screenshot(`workflow-task-source-review-${width}.png`);
    }
    const adopted = (await click("adopt", "Adopt reviewed task metadata")).body;
    assert.equal(adopted.status.status, "current"); assert.equal(adopted.status.binding.generation, 1);
    await binding.locator(":scope > summary").filter({ hasText: "Reviewed metadata · current" }).waitFor();
    assert.match(await binding.innerText(), /not retarget existing Git tools|does not retarget existing Git tools/);

    await click("preview", "Preview task & instruction sources");
    appendFileSync(first, "External change after preview\n");
    await click("adopt", "Adopt reviewed task metadata", 409);
    await binding.getByRole("alert").waitFor();
    await click("preview", "Preview task & instruction sources");
    const readopted = (await click("adopt", "Adopt reviewed task metadata")).body;
    assert.notEqual(readopted.status.binding.id, adopted.status.binding.id, "Each explicit adoption has a fresh private binding ID"); assert.equal(readopted.status.binding.generation, 2);
    const released = (await click("release", "Release task binding")).body;
    assert.equal(released.status.status, "released"); assert.equal(released.status.binding.generation, 3);
    await page.reload({ waitUntil: "load" }); await openEvidence();
    await binding.locator(":scope > summary").click();
    await binding.locator(":scope > summary").filter({ hasText: / · Released$/ }).waitFor();
    assert.match(await binding.innerText(), /generation 3/);
    assert.equal(await binding.getByRole("button", { name: "Adopt reviewed task metadata" }).count(), 0, "Reload cannot recreate an approval preview");
    await binding.locator(":scope > summary").click();
    console.log("PASS: explicit task/source evidence, successive destination consent, inert complete text, desktop/mobile containment, stale adoption refusal, generation/release/reload");
  } finally {
    rmSync(local, { force: true }); rmSync(ancestor, { force: true }); rmSync(folder, { recursive: true, force: true });
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}
