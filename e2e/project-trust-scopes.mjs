import assert from "node:assert/strict";

export async function checkProjectTrustScopes(page, { base, api, trustProject, trustLinked, mainId, width }) {
  await page.goto(`${base}/?session=${mainId}`, { waitUntil: "domcontentloaded" });
  if (width <= 600) await page.locator('[data-mobile-session-identity="true"]').getByText("Trust main fixture", { exact: true }).waitFor();
  else await page.getByText("Trust main fixture", { exact: true }).first().waitFor();
  const banner = page.getByRole("button", { name: "Restricted mode", exact: true }).first();
  await banner.waitFor();
  await banner.click();
  const dialog = page.getByRole("dialog", { name: "Manage project resource trust" });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("radio").count(), 2, "both choices shown without preselection");
  assert.equal(await dialog.getByRole("radio", { checked: true }).count(), 0);
  await dialog.getByRole("radio", { name: /Trust this worktree only/ }).check();
  await dialog.getByRole("button", { name: "Apply trust decision" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal((await api(`/api/project-trust?cwd=${encodeURIComponent(trustProject)}`)).scope, "worktree");
  assert.equal((await api(`/api/project-trust?cwd=${encodeURIComponent(trustLinked)}`)).trusted, false);
  // Trust invalidates idle wrappers; wait for the selected chat's replacement to finish starting
  // before another scope change, which correctly refuses any checkout with an active startup.
  await api(`/api/agent/${mainId}`);

  if (width <= 600) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  if (width <= 600) await settings.getByRole("combobox", { name: "Settings", exact: true }).selectOption("general");
  await settings.getByRole("button", { name: "Manage trust…" }).click();
  await dialog.getByRole("radio", { name: /Trust this Git project/ }).check();
  await dialog.getByRole("button", { name: "Apply trust decision" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal((await api(`/api/project-trust?cwd=${encodeURIComponent(trustLinked)}`)).scope, "repository");

  await settings.getByRole("button", { name: "Manage trust…" }).click();
  await dialog.getByRole("radio", { name: /Stop trusting this Git project/ }).check();
  await dialog.getByRole("button", { name: "Apply trust decision" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal((await api(`/api/project-trust?cwd=${encodeURIComponent(trustLinked)}`)).trusted, false);
  assert.equal((await api(`/api/project-trust?cwd=${encodeURIComponent(trustProject)}`)).scope, "worktree");

  await settings.getByRole("button", { name: "Manage trust…" }).click();
  await dialog.getByRole("radio", { name: /Stop trusting this worktree/ }).check();
  await dialog.getByRole("button", { name: "Apply trust decision" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal((await api(`/api/project-trust?cwd=${encodeURIComponent(trustProject)}`)).trusted, false);
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  if (width <= 600) {
    const backdrop = page.locator(".sidebar-overlay-backdrop");
    if (await backdrop.isVisible()) await backdrop.click({ position: { x: width - 10, y: 200 } });
  }
  await page.getByRole("button", { name: "Restricted mode", exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Restricted mode", exact: true }).first().click();
  await dialog.getByRole("radio", { name: /Clear this worktree's restriction/ }).check();
  await dialog.getByRole("button", { name: "Apply trust decision" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal((await api(`/api/project-trust?cwd=${encodeURIComponent(trustProject)}`)).scope, "none");
  console.log(`PASS: ${width}px scoped trust dialog, project propagation and revocation`);
}
