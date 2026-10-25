import assert from "node:assert/strict";

export async function waitForTrustAgent(page, sessionId, base) {
  // Unlike an early GET, this non-prompt command joins lazy construction and
  // extension binding. Async waitForFunction predicates are not awaited by the
  // pinned Playwright poller, so use the actual command acknowledgement instead.
  const response = await page.request.post(`${base}/api/agent/${encodeURIComponent(sessionId)}`, {
    data: { type: "get_state" }, timeout: 30_000, maxRetries: 0,
  });
  assert.equal(response.ok(), true, `Trust readiness HTTP ${response.status()}`);
  const reply = await response.json();
  assert.equal(reply.success, true, reply.error ?? "Trust readiness command was not acknowledged");
  assert.equal(reply.data?.sessionId, sessionId, "Readiness must acknowledge the selected session");
  for (const key of ["isStreaming", "isPromptRunning", "isBashRunning", "isCompacting"]) {
    assert.equal(reply.data?.[key], false, `Selected agent must be idle: ${key}`);
  }
}

export async function checkProjectTrustScopes(page, { base, api, trustProject, trustLinked, mainId, width }) {
  await page.goto(`${base}/?session=${mainId}`, { waitUntil: "domcontentloaded" });
  if (width <= 600) await page.locator('[data-mobile-session-identity="true"]').getByText("Trust main fixture", { exact: true }).waitFor();
  else await page.getByText("Trust main fixture", { exact: true }).first().waitFor();
  const banner = page.getByRole("button", { name: "Restricted mode", exact: true }).first();
  const dialog = page.getByRole("dialog", { name: "Manage project resource trust" });
  const apply = async () => {
    await waitForTrustAgent(page, mainId, base);
    await dialog.getByRole("button", { name: "Apply trust decision" }).click();
    await dialog.waitFor({ state: "detached" });
  };
  let splitCallerInput = null;
  let restoreSidebar = null;
  let firstGrantFailed = false;
  let firstGrantError;
  const firstGrantCleanupErrors = [];
  try {
    if (width > 600) {
      // Existing native fixture identities, not a supplied ROOT-only harness:
      // saved chat B stays open while the real sidebar selects linked checkout A.
      const saved = (await api("/api/sessions?includeArchived=1")).sessions.filter((session) => session.id === mainId);
      assert.equal(saved.length, 1, "G5 exactly one independently saved selected chat");
      const savedChatCwdB = saved[0].cwd;
      assert.equal(savedChatCwdB, trustProject, "G5 saved catalogue binds chat B to its original root");
      const beforeB = await api(`/api/project-trust?cwd=${encodeURIComponent(savedChatCwdB)}`);
      const beforeA = await api(`/api/project-trust?cwd=${encodeURIComponent(trustLinked)}`);
      assert.equal(beforeB.checkoutRoot, savedChatCwdB, "G5 actual registered chat root B");
      assert.equal(beforeA.checkoutRoot, trustLinked, "G5 actual registered sidebar candidate A");
      assert.notEqual(beforeA.checkoutRoot, beforeB.checkoutRoot, "G5 literal physical root A must differ from saved-chat root B");
      assert.equal(beforeB.scope, "none", "G5 original initial None at B");
      assert.equal(beforeA.scope, "none", "G5 original initial None at A");
      assert.equal(beforeB.requiresTrust, true, "G5 original chat fixture has gated resources");
      assert.equal(beforeA.requiresTrust, true, "G5 linked fixture can expose the same real dialog, not a 409/setup red");
      // Bind the actual switcher title, not a path substring shared by Upload
      // buttons after the linked checkout's Files tree has rendered.
      const header = cwd => page.getByRole("button")
        .and(page.getByTitle(`Switch worktree: ${cwd}`, { exact: true }));
      const mainHeader = header(savedChatCwdB);
      const linkedHeader = header(beforeA.checkoutRoot);
      const mainOption = page.locator(".wt-row").getByRole("button").and(page.getByTitle(savedChatCwdB, { exact: true }));
      const linkedOption = page.locator(".wt-row").getByRole("button").and(page.getByTitle(beforeA.checkoutRoot, { exact: true }));
      await mainHeader.waitFor({ state: "visible" });
      assert.equal(await mainHeader.count(), 1, "G5 unique native main-worktree switcher");
      // Register local UI restoration BEFORE admitting the first switcher click.
      // This does not compensate trust writes or synthesize native authority.
      restoreSidebar = async () => {
        if (await linkedHeader.isVisible()) {
          await linkedHeader.click();
          await mainOption.click();
        } else {
          await mainHeader.waitFor({ state: "visible" });
          if (await mainOption.isVisible()) await mainOption.click();
        }
        await mainHeader.waitFor({ state: "visible" });
        assert.equal((await mainHeader.getAttribute("title")).includes(savedChatCwdB), true, "G5 restore original sidebar root B");
      };
      await mainHeader.click();
      await linkedOption.waitFor({ state: "visible" });
      const sidebarOptionCwdA = await linkedOption.getAttribute("title");
      assert.equal(sidebarOptionCwdA, beforeA.checkoutRoot, "G5 independent native worktree-option path A");
      await linkedOption.click();
      await linkedHeader.waitFor({ state: "visible" });
      assert.equal(await linkedHeader.count(), 1, "G5 unique selected linked-worktree switcher");
      const selectedSidebarTitle = await linkedHeader.getAttribute("title");
      assert.equal(selectedSidebarTitle.includes(sidebarOptionCwdA), true, "G5 real sidebar now selects A for new work");
      await page.locator("#chat-content").getByText("Trust main fixture", { exact: true }).first().waitFor();
      assert.equal(new URL(page.url()).searchParams.get("session"), mainId, "G5 saved chat B remains independently selected");
      splitCallerInput = { selectedSessionId: mainId, savedChatCwdB, sidebarOptionCwdA, selectedSidebarTitle,
        registeredRootA: beforeA.checkoutRoot, registeredRootB: beforeB.checkoutRoot };
    }
    await banner.waitFor();
    await banner.click();
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("radio").count(), 2, "both choices shown without preselection");
    assert.equal(await dialog.getByRole("radio", { checked: true }).count(), 0);
    await dialog.getByRole("radio", { name: /Trust this worktree only/ }).check();
    await apply();
    // Consume BOTH actual status bodies before either scalar can throw. These
    // are native results of the existing UI mutation, not authority tokens.
    const grantedChat = await api(`/api/project-trust?cwd=${encodeURIComponent(trustProject)}`);
    const untouchedLinked = await api(`/api/project-trust?cwd=${encodeURIComponent(trustLinked)}`);
    if (splitCallerInput) console.log("G5 actual default caller input/result " + JSON.stringify({ ...splitCallerInput,
      grantedChatScope: grantedChat.scope, grantedChatTrusted: grantedChat.trusted,
      sidebarScope: untouchedLinked.scope, sidebarTrusted: untouchedLinked.trusted }));
    assert.equal(grantedChat.scope, "worktree", width > 600 ? "G5 selected-chat root B must receive the worktree grant" : "selected worktree grant");
    assert.equal(untouchedLinked.trusted, false, width > 600 ? "G5 independent sidebar root A must remain untrusted" : "linked root remains untrusted");
  } catch (error) { firstGrantFailed = true; firstGrantError = error; }
  finally {
    if (restoreSidebar) {
      // Independent cleanup attempts retain original Error references. No new
      // route/body gates, callbacks or held peers exist; api calls above await
      // their existing owners. The harness collectors stay live throughout.
      try {
        if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      } catch (error) { firstGrantCleanupErrors.push(error); }
      try { await restoreSidebar(); } catch (error) { firstGrantCleanupErrors.push(error); }
    }
  }
  if (firstGrantFailed && !firstGrantCleanupErrors.length) throw firstGrantError;
  if (firstGrantFailed || firstGrantCleanupErrors.length) throw new AggregateError(
    [...(firstGrantFailed ? [firstGrantError] : []), ...firstGrantCleanupErrors], "G5 first-grant/independent UI restoration failed");
  // Each successful decision invalidates idle wrappers. Every subsequent Apply
  // repeats the readiness barrier, not the decision or a rejected POST.

  if (width <= 600) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  if (width <= 600) await settings.getByRole("combobox", { name: "Settings", exact: true }).selectOption("general");
  // Repository choices are owned by the real dialog/transaction and native root tests.
  // The installed Settings entry is represented by the worktree revoke below.

  await settings.getByRole("button", { name: "Manage trust…" }).click();
  await dialog.getByRole("radio", { name: /Stop trusting this worktree/ }).check();
  await apply();
  assert.equal((await api(`/api/project-trust?cwd=${encodeURIComponent(trustProject)}`)).trusted, false);
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  if (width <= 600) {
    const backdrop = page.locator(".sidebar-overlay-backdrop");
    if (await backdrop.isVisible()) await backdrop.click({ position: { x: width - 10, y: 200 } });
  }
  await page.getByRole("button", { name: "Restricted mode", exact: true }).first().waitFor();
  if (width > 600) {
    // Reset only to preserve the NEXT original input's initial None/two choices.
    await page.getByRole("button", { name: "Restricted mode", exact: true }).first().click();
    await dialog.getByRole("radio", { name: /Clear this worktree's restriction/ }).check();
    await apply();
    assert.equal((await api(`/api/project-trust?cwd=${encodeURIComponent(trustProject)}`)).scope, "none");
  }
  console.log(`PASS: ${width}px selected-root worktree grant/revoke via banner/Settings${width > 600 ? ", reset for next original input" : ", compact restricted render"}`);
}
