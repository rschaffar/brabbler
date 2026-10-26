import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createOwnedRoutes } from "./owned-routes.mjs";

export async function checkExplorerUploads(page, { project, base }) {
  const width = page.viewportSize().width, mobile = width <= 640;
  // PRIVATE-FILES-DECLARATIONS
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
  // Two retained caller GET ports only; not a new transport/idle framework.
  async function callerRead(matcher, action, inspect) {
    const readFailures = [], actionFailures = [];
    let reply, data, bodyRead = false, nativeJSON;
    const waiting = page.waitForResponse(matcher);
    const original = waiting.then(async response => {
      reply = response; nativeJSON = response.json();
      data = await nativeJSON; bodyRead = true;
      // PRIVATE-FILES-CALLER-BODY
      return response;
    });
    const acknowledged = original.then(undefined, error => { readFailures.push(error); });
    try {
      await action();
      // PRIVATE-FILES-CALLER-ACTION
    } catch (error) { actionFailures.push(error); }
    const [body, ack] = await Promise.allSettled([original, acknowledged]);
    const failures = [...actionFailures, ...readFailures];
    if (ack.status === "rejected") failures.push(ack.reason);
    // Status/input/DTO diagnostics are AFTER the original complete body/ACK joins,
    // and are independently attempted even when the initiating UI action failed.
    if (reply !== undefined) {
      try { assert.equal(reply.status(), 200); } catch (error) { failures.push(error); }
    }
    try { await inspect(data, bodyRead, reply); } catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Files caller action and original complete GET observation failed");
    return body.value;
  }

  async function completed(action) {
    const readFailures = [], actionFailures = [];
    // Own the ORIGINAL response wait and COMPLETE real body before dispatch.
    let nativeJSON;
    const waiting = response("upload");
    const read = waiting.then(async reply => {
      nativeJSON = reply.json();
      const data = await nativeJSON;
      // PRIVATE-FILES-UPLOAD-BODY
      return { reply, data };
    });
    // PRIVATE-FILES-UPLOAD-ADMITTED
    const acknowledged = read.then(undefined, error => { readFailures.push(error); });
    try {
      await action();
      // PRIVATE-FILES-UPLOAD-ACTION
    } catch (error) { actionFailures.push(error); }
    // An independent action failure cannot skip the admitted wait/body or ACK.
    // Missing responses retain the EXISTING timeout; no replay/cancellation.
    const [body, ack] = await Promise.allSettled([read, acknowledged]);
    const failures = [...actionFailures, ...readFailures];
    if (ack.status === "rejected") failures.push(ack.reason);
    if (body.status === "fulfilled") {
      try {
        const { reply, data } = body.value;
        assert.ok(reply.status() === 200 || reply.status() === 207, `Unexpected upload response ${reply.status()}`);
        assert.deepEqual(data.errors, []);
      } catch (error) { failures.push(error); }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Upload action and complete response observation failed");
    const { data } = body.value;
    await explorer.getByTitle(`${data.uploaded.length} uploaded`, { exact: true }).waitFor();
    return data;
  }
  async function pick(directory, entries) {
    const button = directory === project ? sidebar.getByRole("button", { name: "Upload files to project root", exact: true })
      : explorer.getByRole("button", { name: `Upload here… (${directory})`, exact: true });
    const choiceFailures = [], actionFailures = [];
    const choosing = page.waitForEvent("filechooser");
    const acknowledged = choosing.then(undefined, error => { choiceFailures.push(error); });
    try {
      if (mobile) await button.tap();
      else { await button.focus(); await button.press("Enter"); }
      // PRIVATE-FILES-CHOOSER-ACTION
    } catch (error) { actionFailures.push(error); }
    const [choice, ack] = await Promise.allSettled([choosing, acknowledged]);
    const failures = [...actionFailures, ...choiceFailures];
    if (ack.status === "rejected") failures.push(ack.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Upload picker action and original chooser observation failed");
    await choice.value.setFiles(entries);
  }
  async function drop(target, entries) {
    const transfer = await page.evaluateHandle(items => {
      const data = new DataTransfer();
      for (const item of items) data.items.add(new File([item.contents], item.name, { type: "text/plain" }));
      return data;
    }, entries);
    let primary, primaryFailed = false;
    const failures = [];
    try {
      await target.dispatchEvent("dragover", { dataTransfer: transfer });
      await explorer.getByRole("status").filter({ hasText: "Drop files into" }).waitFor();
      await target.dispatchEvent("drop", { dataTransfer: transfer });
      // PRIVATE-FILES-DROP-ACTION
    } catch (error) { primary = error; primaryFailed = true; }
    finally {
      // PRIVATE-FILES-DROP-RELEASE
      try {
        await transfer.dispose();
        // PRIVATE-FILES-DROP-DISPOSE
      } catch (error) { failures.push(error); }
    }
    const errors = primaryFailed ? [primary, ...failures] : failures;
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Upload drop and original transfer disposal failed");
  }

  await showExplorer();
  await sidebar.getByRole("button", { name: "Refresh explorer", exact: true }).click();
  const expand = path => explorer.getByRole("button", { name: `Expand folder (${path})`, exact: true });
  await expand(folder).focus(); await expand(folder).press("Enter");
  await expand(nested).focus(); await expand(nested).press("Enter");
  await rowLabel(existing).waitFor();
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

  // Retain ONLY the unbound real Sidebar caller -> exact ChangeRow -> back.
  // No changed-row upload or containing-folder policy replay remains here.
  const statusRoute = "**/api/git/status?*";
  const statusSnapshot = { isGitRepository: true, repositoryRoot: project,
    files: [{ filePath: existing, status: "modified", code: "M", indexStatus: " ", worktreeStatus: "M" }], additions: 1, deletions: 0 };
  const changedStatus = route => route.fulfill({ json: statusSnapshot });
  const statusOwner = createOwnedRoutes(changedStatus, changedStatus);
  const statusCallbacks = [], statusAcks = [], statusFailures = [];
  let statusPrimary, statusFailed = false;
  const statusAdapter = route => {
    const original = statusOwner.handler(route); statusCallbacks.push(original);
    const ack = original.then(undefined, error => { statusFailures.push(error); });
    statusAcks.push(ack); return ack; // External dispatcher ACK, not original callback proof.
  };
  try {
    // Registration failure after callback admission still enters exact removal/joins.
    await page.route(statusRoute, statusAdapter);
    await callerRead(response => {
      const url = new URL(response.url());
      return response.request().method() === "GET" && url.pathname === "/api/git/status" && url.searchParams.get("cwd") === project;
    }, () => sidebar.getByRole("button", { name: "Refresh explorer", exact: true }).click(),
    (data, bodyRead) => { if (bodyRead) assert.deepEqual(data, statusSnapshot); });
    const changes = sidebar.getByRole("button", { name: "1 changed files", exact: true });
    await changes.click();
    const changedRow = explorer.locator("[data-upload-directory][title]");
    assert.equal(await changedRow.getAttribute("title"), existing);
    assert.equal(await changedRow.getAttribute("data-upload-directory"), nested);
    await changes.click();
    await rowLabel(existing).waitFor();
  } catch (error) { statusPrimary = error; statusFailed = true; }
  finally {
    // PRIVATE-FILES-STATUS-RELEASE
    // No held gates. Dispose joins full original callbacks, EXACT adapter removal,
    // and callbacks admitted during removal. Subsequent joins remain independent.
    try { await statusOwner.dispose(() => page.unroute(statusRoute, statusAdapter)); }
    catch (error) { statusFailures.push(error); }
    try {
      let joined = 0;
      while (joined < statusCallbacks.length) {
        const admitted = statusCallbacks.slice(joined); joined += admitted.length;
        await Promise.allSettled(admitted); // SAME original errors are already live in ACK/owner collectors.
      }
    } catch (error) { statusFailures.push(error); }
    try {
      let joined = 0;
      while (joined < statusAcks.length) {
        const admitted = statusAcks.slice(joined); joined += admitted.length;
        const results = await Promise.allSettled(admitted);
        for (const result of results) if (result.status === "rejected") statusFailures.push(result.reason);
      }
    } catch (error) { statusFailures.push(error); }
  }
  const statusErrors = statusFailed ? [statusPrimary, ...statusFailures] : statusFailures;
  if (statusErrors.length === 1) throw statusErrors[0];
  if (statusErrors.length) throw new AggregateError(statusErrors, "Changed-files caller and independent status callback/ACK settlement failed");

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
  let mixed, mixedPrimary, mixedFailed = false;
  const mixedFailures = [];
  try {
    mixed = await mixedFixture.getProperty("data");
    await completed(() => row(nested).dispatchEvent("drop", { dataTransfer: mixed }));
    // PRIVATE-FILES-MIXED-ACTION
  } catch (error) { mixedPrimary = error; mixedFailed = true; }
  finally {
    // Restore the REALM prototype and independently dispose BOTH admitted handles,
    // including a failed getProperty/action/body/restore. No failure replaces primary.
    for (const attempt of [
      () => mixedFixture.evaluate(({ original }) => { DataTransferItem.prototype.webkitGetAsEntry = original; }),
      () => mixed?.dispose(), () => mixedFixture.dispose(),
    ]) { try { await attempt(); } catch (error) { mixedFailures.push(error); } }
  }
  const mixedErrors = mixedFailed ? [mixedPrimary, ...mixedFailures] : mixedFailures;
  if (mixedErrors.length === 1) throw mixedErrors[0];
  if (mixedErrors.length) throw new AggregateError(mixedErrors, "Mixed drop and independent prototype/handle cleanup failed");
  await explorer.getByRole("status").filter({ hasText: "Folder uploads are not supported" }).waitFor();
  assert.equal(readFileSync(join(nested, "mixed.txt"), "utf8"), "mixed file\n");
  assert.equal(existsSync(join(nested, "folder-input")), false);
  assert.equal(await explorer.evaluate(node => {
    const data = new DataTransfer(); data.setData("text/plain", "not a file");
    const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data });
    node.dispatchEvent(event); return event.defaultPrevented;
  }), false, "non-file drags must pass through without becoming writes");

  // Retain real Search-files open/query -> ONE real external writer/Refresh -> close.
  // No nonmatching/matching upload server transactions or their policy waits.
  const search = explorer.getByRole("textbox", { name: "Search files", exact: true });
  const indexResponse = response => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === "/api/file-index"
      && url.searchParams.get("cwd") === project && url.searchParams.get("q") === "existing";
  };
  const inspectSearch = async (data, bodyRead, expectedPath, reply, requireRefresh = false) => {
    assert.equal(await search.count(), 1, "real Search-files caller leaves its actual input mounted");
    assert.equal(await search.inputValue(), "existing", "original literal query survives the real caller");
    if (requireRefresh && reply !== undefined) assert.equal(new URL(reply.url()).searchParams.get("refresh"), "1", "actual Refresh-explorer invalidates the real index cache");
    if (bodyRead) {
      assert.equal(Array.isArray(data.matches), true);
      assert.equal(data.matches.some(entry => entry.path === expectedPath && !entry.isDir), true, "real index body contains the original exact result");
    }
  };
  await callerRead(indexResponse, async () => {
    await sidebar.getByRole("button", { name: "Search files", exact: true }).click();
    await search.fill("existing");
  }, (data, bodyRead, reply) => inspectSearch(data, bodyRead, `uploads-${width}/nested/existing.txt`, reply));
  await rowLabel(existing).waitFor();
  // EXACT original external-refresh input; DTO mutation is NOT substituted for it.
  writeFileSync(join(nested, "existing-external.txt"), "external search refresh\n");
  await callerRead(indexResponse,
    () => sidebar.getByRole("button", { name: "Refresh explorer", exact: true }).click(),
    (data, bodyRead, reply) => inspectSearch(data, bodyRead, `uploads-${width}/nested/existing-external.txt`, reply, true));
  await rowLabel(join(nested, "existing-external.txt")).waitFor();
  await sidebar.getByRole("button", { name: "Search files", exact: true }).click();

  // ONE real replacement/watch bridge. Clean-vs-dirty policy is lower-owned;
  // mobile still hides the panel while picking and proves actual reconnect sync.
  await rowLabel(existing).click();
  await panel.getByTitle("Live sync active", { exact: true }).waitFor();
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

  // Keep native installed denial ONCE; both literal width tuples also run in the existing native owner.
  if (!mobile) {
    const outside = join(dirname(project), `upload-outside-${width}`);
    mkdirSync(outside, { recursive: true });
    const encoded = outside.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    for (const type of ["upload-check", "upload"]) {
      const form = new FormData(); form.append("files", new Blob(["forbidden"]), "sentinel.txt");
      const denial = await fetch(`${base}/api/files/${encoded}?type=${type}`, {
        method: "POST", ...(type === "upload-check" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileNames: ["sentinel.txt"] }) } : { body: form }),
      });
      await denial.arrayBuffer();
      assert.equal(denial.status, 403, "outside-root directories remain non-uploadable");
    }
    assert.equal(existsSync(join(outside, "sentinel.txt")), false);
  }
  console.log(`PASS: ${width}px Explorer native file-row/mention, keyboard/tap picker, same-selection, mixed no-flatten owned changed/search callers and one overwrite/watch bridge`);
}
