import assert from 'node:assert/strict';
import { waitForAsyncCondition } from './async-condition.mjs';
import { sidebarReady } from './sidebar-readiness.mjs';
import { observeBrowserReads } from './browser-read-barrier.mjs';

/** Original X global-switch UI, shared without changing its actual endpoints,
 * payload assertions, mobile Plugins selector, close or backdrop behavior.
 */
export async function setAcceptanceEnabled(page, { width }, enabled) {
  const dialog = page.getByRole('dialog', { name: 'Acceptance', exact: true });
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Close acceptance', exact: true }).click();
  const sidebar = page.getByRole('button', { name: 'Show sidebar', exact: true });
  if (await sidebar.isVisible()) await sidebar.click();
  await waitForAsyncCondition(page, sidebarReady);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  if (width <= 600) await settings.getByRole('combobox', { name: 'Settings', exact: true }).selectOption('plugins');
  else await settings.getByRole('button', { name: 'Plugins', exact: true }).click();
  await settings.getByRole('button', { name: 'Acceptance', exact: true }).click();
  const panel = settings.getByRole('region', { name: 'Acceptance settings', exact: true });
  const checkbox = panel.getByLabel('Enabled', { exact: true });
  assert.equal(await checkbox.isChecked(), !enabled, 'each switch action starts in the opposite state');
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/plugins/bundled' && response.request().method() === 'PATCH' && response.request().postDataJSON().pluginId === 'acceptance');
  void saved.catch(() => {});
  await checkbox.setChecked(enabled);
  const response = await saved; assert.equal(response.status(), 200, await response.text());
  const body = response.request().postDataJSON(); assert.equal(body.scope, 'global');
  assert.equal((await response.json()).settings.enabled, enabled);
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  if (width <= 600 && await page.locator('.sidebar-overlay-backdrop').isVisible()) await page.locator('.sidebar-overlay-backdrop').click({ position: { x: width - 10, y: 200 } });
}

/** Thin REAL responsive Acceptance bridge. Desktop X alone creates/runs jobs;
 * this helper observes its retained actual profiles/history and toggles settings.
 * No status/profile response is synthesized and no job is admitted or cancelled.
 */
export async function checkAcceptanceResponsive(page, { base, api, project, width, returnSessionId }) {
  assert.ok(width === 700 || width === 390);
  const endpoint = `/api/acceptance?cwd=${encodeURIComponent(project)}`;
  const dialog = page.getByRole('dialog', { name: 'Acceptance', exact: true });
  const trigger = page.getByRole('button', { name: 'Acceptance', exact: true });
  const failures = [];
  let before;
  const openAndObserve = async (enabled) => {
    const reads = await observeBrowserReads(page, [{ pathname: '/api/acceptance', query: { cwd: project } }]);
    const observationFailures = [];
    try {
      await trigger.click();
      await dialog.waitFor();
      const observed = await reads.wait();
      assert.ok(observed.length > 0 && observed.every(read => read.outcome === 'consumed'), 'Acceptance consumes its own actual status body');
      await dialog.getByText('Reading acceptance status…', { exact: true }).waitFor({ state: 'hidden' });
      if (!enabled) await dialog.getByText(/^Acceptance is disabled\./).waitFor();
      else await dialog.getByText(/^Acceptance is disabled\./).waitFor({ state: 'hidden' });
      for (const profile of before.profiles) {
        const run = dialog.getByRole('button', { name: `Run ${profile.name}`, exact: true });
        await run.waitFor();
        assert.equal(await run.isDisabled(), !enabled, 'actual retained profile admission reflects the global switch');
      }
      const box = await dialog.boundingBox();
      assert.ok(box && box.width > 0 && box.x >= 0 && box.x + box.width <= width + 1, 'acceptance dialog fits viewport');
    } catch (error) { observationFailures.push(error); }
    finally {
      try { await reads.dispose(); } catch (error) { observationFailures.push(error); }
    }
    if (observationFailures.length) throw new AggregateError(observationFailures, 'Actual Acceptance status observation failed');
  };
  try {
    await page.goto(`${base}/?cwd=${encodeURIComponent(project)}`, { waitUntil: 'domcontentloaded' });
    before = await api(endpoint);
    assert.equal(before.enabled, false, 'desktop X left actual Acceptance disabled');
    assert.deepEqual(before.profiles.map(profile => profile.name).sort(), ['held', 'quick'], 'reuse the real profiles from desktop X');
    assert.ok(before.runs.every(run => !['queued', 'running'].includes(run.state)), 'the native desktop chain already settled its own jobs');
    await openAndObserve(false);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true, 'native Escape restores the actual responsive Acceptance trigger');

    await setAcceptanceEnabled(page, { width }, true);
    assert.equal((await api(endpoint)).enabled, true, 'native status agrees with the enabled PATCH body');
    await openAndObserve(true);
    await dialog.getByRole('button', { name: 'Close acceptance', exact: true }).click();
    await setAcceptanceEnabled(page, { width }, false);
    assert.equal((await api(endpoint)).enabled, false, 'native status agrees with the disabled PATCH body');
    await openAndObserve(false);
    await dialog.getByRole('button', { name: 'Close acceptance', exact: true }).click();
    const after = await api(endpoint);
    assert.deepEqual(after.profiles, before.profiles, 'responsive status/settings retain the native configured profiles');
    assert.deepEqual(after.runs.map(run => run.id), before.runs.map(run => run.id), 'responsive observation/settings do not admit or replace native jobs');
    console.log(`PASS: ${width}px real Acceptance status/profiles, dialog bounds, Escape focus and global Settings switch`);
  } catch (error) { failures.push(error); }
  finally {
    // Idempotent native reset only; never cancel independently admitted work.
    try {
      const disabled = await page.request.patch(`${base}/api/plugins/bundled`, { data: { pluginId: 'acceptance', scope: 'global', set: { enabled: false }, reset: [] } });
      assert.equal(disabled.status(), 200);
      assert.equal((await disabled.json()).settings.enabled, false);
      assert.equal((await api(endpoint)).enabled, false);
    } catch (error) { failures.push(error); }
    try {
      await page.goto(`${base}/?session=${returnSessionId}`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Active branch answer', { exact: true }).waitFor();
    } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Responsive Acceptance fixture failed');
  }
}
