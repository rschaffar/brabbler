import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export async function checkExplorerUploads(page, { project, base }) {
  const width = page.viewportSize().width, mobile = width <= 640;
  const folder = join(project, `uploads-${width}`), nested = join(folder, "nested");
  mkdirSync(nested, { recursive: true });
  const existing = join(nested, "existing.txt");
  writeFileSync(existing, "original\n");
  const sidebar = page.locator("#session-sidebar"), explorer = page.getByTestId("file-explorer"), panel = page.locator("#file-panel");
  async function showExplorer() {
    const hidePanel = panel.getByRole("button", { name: "Hide file panel", exact: true });
    if (mobile && await hidePanel.isVisible()) await hidePanel.click();
    const show = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await show.isVisible()) await show.click();
    await explorer.waitFor();
  }
  const rowLabel = file => explorer.getByTitle(file.replace(/\\/g, "/"), { exact: true });
  const row = file => rowLabel(file).locator("..");
  const payload = (name, contents) => ({ name, mimeType: "text/plain", buffer: Buffer.from(contents) });
  const response = type => page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.startsWith("/api/files/") && new URL(r.url()).searchParams.get("type") === type);
  async function completed(action) {
    // Attach both rejection owners before dispatch: an action failure must not
    // leave a response waiter rejecting unhandled during context teardown.
    const [reply] = await Promise.all([response("upload"), Promise.resolve().then(action)]);
    assert.ok(reply.status() === 200 || reply.status() === 207, `Unexpected upload response ${reply.status()}`);
    const data = await reply.json();
    assert.deepEqual(data.errors, []);
    await explorer.getByTitle(`${data.uploaded.length} uploaded`, { exact: true }).waitFor();
    return data;
  }
  async function pick(directory, entries) {
    const button = directory === project ? sidebar.getByRole("button", { name: "Upload files to project root", exact: true })
      : explorer.getByRole("button", { name: `Upload here… (${directory})`, exact: true });
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), Promise.resolve().then(async () => {
      if (mobile) await button.tap();
      else { await button.focus(); await button.press("Enter"); }
    })]);
    await chooser.setFiles(entries);
  }
  async function drop(target, entries) {
    const transfer = await page.evaluateHandle(items => {
      const data = new DataTransfer();
      for (const item of items) data.items.add(new File([item.contents], item.name, { type: "text/plain" }));
      return data;
    }, entries);
    try {
      await target.dispatchEvent("dragover", { dataTransfer: transfer });
      await explorer.getByRole("status").filter({ hasText: "Drop files into" }).waitFor();
      await target.dispatchEvent("drop", { dataTransfer: transfer });
    } finally { await transfer.dispose(); }
  }

  await showExplorer();
  await sidebar.getByRole("button", { name: "Refresh explorer", exact: true }).click();
  const expand = path => explorer.getByRole("button", { name: `Expand folder (${path})`, exact: true });
  const collapse = path => explorer.getByRole("button", { name: `Collapse folder (${path})`, exact: true });
  await expand(folder).focus(); await expand(folder).press("Enter");
  await expand(nested).focus(); await expand(nested).press("Enter");
  await rowLabel(existing).waitFor();
  await collapse(nested).press("Enter"); // cache the closed folder before uploading

  await completed(() => drop(row(nested), [{ name: "collapsed.txt", contents: "collapsed destination\n" }]));
  assert.equal(readFileSync(join(nested, "collapsed.txt"), "utf8"), "collapsed destination\n");
  assert.equal(existsSync(join(project, "collapsed.txt")), false);
  await expand(nested).press("Enter");
  await rowLabel(join(nested, "collapsed.txt")).waitFor();

  await completed(() => drop(row(existing), [{ name: "file-row.txt", contents: "containing folder\n" }]));
  assert.equal(readFileSync(join(nested, "file-row.txt"), "utf8"), "containing folder\n");
  assert.equal(existsSync(join(project, "file-row.txt")), false);
  assert.match(await explorer.getByTestId("upload-destination").innerText(), new RegExp(nested.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await explorer.getByRole("button", { name: "Add uploaded file to chat", exact: true }).click();
  // The explicit mention action must use the nested destination, never cwd/name.
  const messageInput = page.locator(".chat-input-textarea");
  assert.match(await messageInput.inputValue(), new RegExp(`uploads-${width}/nested/file-row\\.txt`));
  await messageInput.fill("");
  await showExplorer();

  const rootName = `root-${width}.txt`;
  await completed(() => drop(explorer, [{ name: rootName, contents: "root\n" }]));
  assert.equal(readFileSync(join(project, rootName), "utf8"), "root\n");
  await completed(() => pick(project, [payload(`root-picker-${width}.txt`, "root picker\n")]));
  assert.equal(readFileSync(join(project, `root-picker-${width}.txt`), "utf8"), "root picker\n");
  await completed(() => pick(nested, [payload("keyboard.txt", "keyboard picker\n")]));
  assert.equal(readFileSync(join(nested, "keyboard.txt"), "utf8"), "keyboard picker\n");

  // Reusing the same picker selection still raises change. Conflict review is
  // explicit, holds the target and blocks every competing upload control.
  await pick(nested, [payload("existing.txt", "cancelled\n")]);
  await explorer.getByRole("button", { name: "Cancel", exact: true }).waitFor();
  assert.equal(await sidebar.getByRole("button", { name: "Upload files to project root", exact: true }).isDisabled(), true);
  await explorer.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(readFileSync(existing, "utf8"), "original\n");
  await pick(nested, [payload("existing.txt", "skip\n"), payload("new-with-skip.txt", "new\n")]);
  await explorer.getByRole("button", { name: "Skip existing", exact: true }).waitFor();
  const skipped = await completed(() => explorer.getByRole("button", { name: "Skip existing", exact: true }).click());
  assert.deepEqual(skipped.skipped, ["existing.txt"]);
  assert.equal(readFileSync(existing, "utf8"), "original\n");

  // Changed-file rows use the same containing-folder rule as the ordinary tree.
  const statusRoute = "**/api/git/status?*";
  const changedStatus = route => route.fulfill({ json: { isGitRepository: true, repositoryRoot: project,
    files: [{ filePath: existing, status: "modified", code: "M", indexStatus: " ", worktreeStatus: "M" }], additions: 1, deletions: 0 } });
  await page.route(statusRoute, changedStatus);
  try {
    await sidebar.getByRole("button", { name: "Refresh explorer", exact: true }).click();
    const changes = sidebar.getByRole("button", { name: "1 changed files", exact: true });
    await changes.click();
    const changedRow = explorer.locator("[data-upload-directory][title]");
    assert.equal(await changedRow.getAttribute("title"), existing);
    await completed(() => drop(changedRow, [{ name: "changed-row.txt", contents: "changed row folder\n" }]));
    assert.equal(readFileSync(join(nested, "changed-row.txt"), "utf8"), "changed row folder\n");
    assert.equal(existsSync(join(project, "changed-row.txt")), false);
    await changes.click();
  } finally { await page.unroute(statusRoute, changedStatus); }

  // Browser folder entries are classified before any asynchronous work. A mixed
  // transfer uploads individual files but never flattens a directory input.
  const mixedFixture = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File([], "folder-input"));
    data.items.add(new File(["mixed file\n"], "mixed.txt", { type: "text/plain" }));
    // Chromium can return a fresh DataTransferItem wrapper on each access;
    // patch the prototype for this one synthetic directory-entry transfer.
    const original = DataTransferItem.prototype.webkitGetAsEntry;
    DataTransferItem.prototype.webkitGetAsEntry = function () {
      return this.getAsFile()?.name === "folder-input" ? { isDirectory: true, name: "folder-input" } : original.call(this);
    };
    return { data, original };
  });
  const mixed = await mixedFixture.getProperty("data");
  try { await completed(() => row(nested).dispatchEvent("drop", { dataTransfer: mixed })); }
  finally {
    await mixedFixture.evaluate(({ original }) => { DataTransferItem.prototype.webkitGetAsEntry = original; });
    await mixed.dispose(); await mixedFixture.dispose();
  }
  await explorer.getByRole("status").filter({ hasText: "Folder uploads are not supported" }).waitFor();
  assert.equal(readFileSync(join(nested, "mixed.txt"), "utf8"), "mixed file\n");
  assert.equal(existsSync(join(nested, "folder-input")), false);
  assert.equal(await explorer.evaluate(node => {
    const data = new DataTransfer(); data.setData("text/plain", "not a file");
    const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data });
    node.dispatchEvent(event); return event.defaultPrevented;
  }), false, "non-file drags must pass through without becoming writes");

  // Search uses a filtered projection. Uploading to a search folder must not
  // replace its matching children with the full unfiltered directory listing.
  await sidebar.getByRole("button", { name: "Search files", exact: true }).click();
  const search = explorer.getByRole("textbox", { name: "Search files", exact: true });
  await search.fill("existing");
  await rowLabel(existing).waitFor();
  await completed(() => pick(nested, [payload("not-a-search-match.txt", "search destination\n")]));
  assert.equal(await rowLabel(join(nested, "not-a-search-match.txt")).count(), 0);
  await rowLabel(existing).waitFor();
  await completed(() => pick(nested, [payload("existing-copy.txt", "matching search upload\n")]));
  await rowLabel(join(nested, "existing-copy.txt")).waitFor();
  writeFileSync(join(nested, "existing-external.txt"), "external search refresh\n");
  await sidebar.getByRole("button", { name: "Refresh explorer", exact: true }).click();
  await rowLabel(join(nested, "existing-external.txt")).waitFor();
  assert.equal(await rowLabel(join(nested, "not-a-search-match.txt")).count(), 0);
  await sidebar.getByRole("button", { name: "Search files", exact: true }).click();

  // Clean previews refresh; dirty drafts survive overwrite. On mobile the panel
  // is hidden during picker interaction, so this also proves reconnect sync.
  await rowLabel(existing).click();
  await panel.getByTitle("Live sync active", { exact: true }).waitFor();
  await showExplorer();
  await pick(nested, [payload("existing.txt", "clean replacement\n")]);
  await completed(() => explorer.getByRole("button", { name: "Replace", exact: true }).click());
  if (mobile) await rowLabel(existing).click();
  await panel.getByText("clean replacement", { exact: false }).waitFor();
  await panel.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = panel.getByRole("textbox", { name: "Edit", exact: true });
  await editor.fill("Keep my dirty draft");
  await showExplorer();
  await pick(nested, [payload("existing.txt", "disk replacement\n")]);
  await completed(() => explorer.getByRole("button", { name: "Replace", exact: true }).click());
  if (mobile) await rowLabel(existing).click();
  await panel.getByText(/File changed on disk/).waitFor();
  assert.equal(await editor.inputValue(), "Keep my dirty draft");
  assert.equal(await panel.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
  page.once("dialog", dialog => dialog.accept());
  await panel.getByRole("button", { name: "Discard draft and reload", exact: true }).click();
  assert.equal(await editor.inputValue(), "disk replacement\n");
  await panel.getByRole("button", { name: "Close existing.txt", exact: true }).click();
  const hide = panel.getByRole("button", { name: "Hide file panel", exact: true });
  if (await hide.isVisible()) await hide.click();

  const outside = join(dirname(project), `upload-outside-${width}`);
  mkdirSync(outside, { recursive: true });
  const encoded = outside.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  for (const type of ["upload-check", "upload"]) {
    const form = new FormData(); form.append("files", new Blob(["forbidden"]), "sentinel.txt");
    const denial = await fetch(`${base}/api/files/${encoded}?type=${type}`, {
      method: "POST", ...(type === "upload-check" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileNames: ["sentinel.txt"] }) } : { body: form }),
    });
    assert.equal(denial.status, 403, "outside-root directories remain non-uploadable");
    await denial.arrayBuffer();
  }
  assert.equal(existsSync(join(outside, "sentinel.txt")), false);
  console.log(`PASS: ${width}px Explorer root/nested/file-row drops, collapsed refresh, keyboard picker, conflicts, search projection and overwrite draft sync`);
}
