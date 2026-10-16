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
  await banner.waitFor();
  await banner.click();
  const dialog = page.getByRole("dialog", { name: "Manage project resource trust" });
  await dialog.waitFor();
  const apply = async () => {
    await waitForTrustAgent(page, mainId, base);
    await dialog.getByRole("button", { name: "Apply trust decision" }).click();
    await dialog.waitFor({ state: "detached" });
  };
  assert.equal(await dialog.getByRole("radio").count(), 2, "both choices shown without preselection");
  assert.equal(await dialog.getByRole("radio", { checked: true }).count(), 0);
  await dialog.getByRole("radio", { name: /Trust this worktree only/ }).check();
  await apply();
  assert.equal((await api(`/api/project-trust?cwd=${encodeURIComponent(trustProject)}`)).scope, "worktree");
  assert.equal((await api(`/api/project-trust?cwd=${encodeURIComponent(trustLinked)}`)).trusted, false);
  // Each successful decision invalidates idle wrappers. Every subsequent Apply
  // repeats the readiness barrier, not the decision or a rejected POST.

  if (width <= 600) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  if (width <= 600) await settings.getByRole("combobox", { name: "Settings", exact: true }).selectOption("general");
  await settings.getByRole("button", { name: "Manage trust…" }).click();
  await dialog.getByRole("radio", { name: /Trust this Git project/ }).check();
  await apply();
  assert.equal((await api(`/api/project-trust?cwd=${encodeURIComponent(trustLinked)}`)).scope, "repository");

  await settings.getByRole("button", { name: "Manage trust…" }).click();
  await dialog.getByRole("radio", { name: /Stop trusting this Git project/ }).check();
  await apply();
  assert.equal((await api(`/api/project-trust?cwd=${encodeURIComponent(trustLinked)}`)).trusted, false);
  assert.equal((await api(`/api/project-trust?cwd=${encodeURIComponent(trustProject)}`)).scope, "worktree");

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
  await page.getByRole("button", { name: "Restricted mode", exact: true }).first().click();
  await dialog.getByRole("radio", { name: /Clear this worktree's restriction/ }).check();
  await apply();
  assert.equal((await api(`/api/project-trust?cwd=${encodeURIComponent(trustProject)}`)).scope, "none");
  console.log(`PASS: ${width}px scoped trust dialog, project propagation and revocation`);
}
