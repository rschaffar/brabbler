import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { waitForAsyncCondition } from './async-condition.mjs';
import { holdBrowserRead } from './browser-read-barrier.mjs';
import { setAcceptanceEnabled } from './project-acceptance-ui.mjs';

export async function openAcceptanceConfiguration(dialog) {
  // Initial status inserts profile cards above the native summary. Do not click
  // a coordinate captured before that layout change has completed.
  await dialog.getByText('Reading acceptance status…', { exact: true }).waitFor({ state: 'hidden' });
  await dialog.getByText('Configure project profiles', { exact: true }).click();
  const editor = dialog.getByRole('textbox', { name: 'Profiles JSON', exact: true });
  await editor.waitFor({ state: 'visible' });
  assert.equal(await editor.isEnabled(), true, 'configuration is editable after initial status');
  return editor;
}

export async function openAcceptanceWithHeldStatus(page, dialog, project) {
  // Hold the browser's original GET, not an APIRequestContext fetch/fulfill copy
  // that can reuse an idle Node socket closed by the server while awaiting UI.
  const read = await holdBrowserRead(page, { pathname: '/api/acceptance', query: { cwd: project } });
  const failures = [];
  try {
    await page.getByRole('button', { name: 'Acceptance', exact: true }).click();
    await dialog.waitFor();
    await read.arrived();
    await dialog.getByText('Reading acceptance status…', { exact: true }).waitFor();
    const reads = await read.releaseAndObserve();
    assert.ok(reads.length > 0 && reads.every(read => read.outcome === 'consumed'), 'initial status requires genuine browser JSON consumption, never cancellation');
  } catch (error) { failures.push(error); }
  finally {
    try { await read.dispose(); }
    catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Acceptance initial status fixture failed');
  }
}

export async function checkProjectAcceptance(page, { base, api, post, project, width, returnSessionId }) {
  const input = `acceptance-${width}.txt`;
  writeFileSync(join(project, input), `exact source ${width}\n`);
  const held = `const fs=require('node:fs'),path=require('node:path'); console.log('acceptance fixture ready'); const timer=setInterval(()=>{if(fs.existsSync(path.join(process.env.BRABBLER_ACCEPTANCE_RUNTIME,'release'))){clearInterval(timer);console.log('acceptance fixture passed');}},50);setTimeout(()=>process.exit(9),20000).unref();`;
  const make = (name, source) => ({ name, label: `Acceptance ${name} ${width}`, coverage: 'focused', argv: ['node', '-e', source], inputs: [input], cpus: 1, memoryMiB: 128, permission: 'allow' });
  const profiles = [make('held', held), make('quick', 'console.log("quick acceptance passed")')];
  const endpoint = `/api/acceptance?cwd=${encodeURIComponent(project)}`;
  const dialog = page.getByRole('dialog', { name: 'Acceptance', exact: true });
  const openAcceptance = async () => {
    await page.getByRole('button', { name: 'Acceptance', exact: true }).click(); await dialog.waitFor();
  };
  const setEnabled = enabled => setAcceptanceEnabled(page, { width }, enabled);
  const tools = async () => (await post(`/api/agent/${returnSessionId}`, { type: 'get_tools' })).data.filter(tool => tool.name.startsWith('acceptance_'));
  const waitRun = (id, state) => waitForAsyncCondition(page, async ({ endpoint, id, state }) => {
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const run = (await response.json()).runs.find((run) => run.id === id);
    return run?.state === state && run;
  }, { endpoint, id, state });
  const clickRun = async name => {
    const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/acceptance' && response.request().method() === 'POST' && response.request().postDataJSON().action === 'run');
    void response.catch(() => {});
    await dialog.getByRole('button', { name: `Run ${name}`, exact: true }).click();
    const reply = await response; assert.equal(reply.status(), 200, await reply.text());
    return (await reply.json()).run;
  };
  // Reproduce the failed initial-read ordering with real persisted profiles and
  // one held browser request. Its unmodified response comes from the server.
  const previousProfiles = [
    make('previous-one', 'console.log("previous profile one")'),
    make('previous-two', 'console.log("previous profile two")'),
  ];
  await post('/api/acceptance', { cwd: project, action: 'configure', profiles: previousProfiles });
  const failures = [];
  try {
    await page.goto(`${base}/?cwd=${encodeURIComponent(project)}`, { waitUntil: 'domcontentloaded' });
    assert.equal((await api(endpoint)).enabled, false, 'Acceptance defaults off and remains off between variants');
    assert.ok((await tools()).every(tool => !tool.active));
    await openAcceptanceWithHeldStatus(page, dialog, project);
    await dialog.getByText(/^Acceptance is disabled\./).waitFor();
    const editor = await openAcceptanceConfiguration(dialog);
    await dialog.getByRole('button', { name: 'Run previous-one', exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Run previous-two', exact: true }).waitFor();
    await editor.fill(JSON.stringify(profiles));
    const refreshedProfiles = previousProfiles.map(profile => ({ ...profile, label: `${profile.label} refreshed` }));
    await post('/api/acceptance', { cwd: project, action: 'configure', profiles: refreshedProfiles });
    // A newly rendered label proves a poll was applied, not just that response
    // headers arrived. The editor draft must survive that same React update.
    await dialog.getByText(refreshedProfiles[0].label, { exact: true }).waitFor();
    assert.equal(await editor.inputValue(), JSON.stringify(profiles), 'status polling cannot overwrite an editable configuration draft');
    const save = page.waitForResponse(response => new URL(response.url()).pathname === '/api/acceptance' && response.request().method() === 'POST' && response.request().postDataJSON().action === 'configure');
    void save.catch(() => {});
    await dialog.getByRole('button', { name: 'Save profiles', exact: true }).click();
    assert.equal((await save).status(), 200);
    assert.equal(await dialog.getByRole('button', { name: 'Run held', exact: true }).isDisabled(), true);
    await setEnabled(true); await openAcceptance();
    assert.equal((await tools()).filter(tool => tool.active).length, 3, 'enabled tools become available in the existing native wrapper');
    const first = await clickRun('held'); await waitRun(first.id, 'running');
    const current = await api(endpoint);
    const shared = await post('/api/acceptance', { cwd: project, action: 'run', profile: 'held', profileDigest: current.profileDigests.held, requestId: randomUUID() });
    assert.equal(shared.run.id, first.id); assert.equal(shared.joined, true); assert.equal(shared.run.requests.length, 2);
    const second = await clickRun('quick'); await waitRun(second.id, 'queued'); assert.notEqual(first.id, second.id);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'Acceptance', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.reload({ waitUntil: 'domcontentloaded' }); await openAcceptance();
    await dialog.locator(`[data-acceptance-run="${first.id}"]`).waitFor();
    assert.equal((await api(endpoint)).runs.filter(run => run.id === first.id).length, 1);
    writeFileSync(join(first.runtimeDirectory, 'release'), 'release\n');
    await waitRun(first.id, 'passed'); const completed = await waitRun(second.id, 'passed');
    assert.equal(completed.settled, true); assert.ok(completed.executionMs >= 0); assert.ok(completed.queueMs >= 0);
    await dialog.locator(`[data-acceptance-run="${second.id}"]`).getByRole('button', { name: 'Run logs', exact: true }).click();
    await dialog.getByRole('region', { name: 'Run logs', exact: true }).locator('pre').filter({ hasText: 'quick acceptance passed' }).waitFor();
    const third = await clickRun('held'); await waitRun(third.id, 'running');
    const fourth = await clickRun('quick'); await waitRun(fourth.id, 'queued');
    await setEnabled(false);
    assert.equal((await waitRun(fourth.id, 'cancelled')).settled, true);
    assert.equal((await waitRun(third.id, 'running')).settled, false, 'disable does not abort independently running work');
    assert.ok((await tools()).every(tool => !tool.active));
    const disabled = await api(endpoint); assert.equal(disabled.enabled, false); assert.equal(disabled.profiles.length, 2);
    const refused = await page.request.post(`${base}/api/acceptance`, { data: { action: 'run', cwd: project, profile: 'quick', profileDigest: disabled.profileDigests.quick, requestId: randomUUID() } });
    assert.equal(refused.status(), 400); assert.equal((await api(endpoint)).runs.length, disabled.runs.length);
    await openAcceptance(); await dialog.getByText(/^Acceptance is disabled\./).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Run held', exact: true }).isDisabled(), true);
    await dialog.locator(`[data-acceptance-run="${third.id}"]`).getByRole('button', { name: 'Cancel acceptance run', exact: true }).click();
    assert.equal((await waitRun(third.id, 'cancelled')).settled, true);
    await setEnabled(true); await openAcceptance();
    const fresh = await clickRun('quick'); await waitRun(fresh.id, 'passed');
    assert.notEqual(fresh.id, fourth.id); assert.equal((await api(endpoint)).runs.find(run => run.id === fourth.id).state, 'cancelled');
    const box = await dialog.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, 'acceptance dialog fits viewport');
    await setEnabled(false); await openAcceptance();
    await dialog.getByText(/^Acceptance is disabled\./).waitFor();
    await dialog.locator(`[data-acceptance-run="${first.id}"]`).getByRole('button', { name: 'Run logs', exact: true }).click();
    await dialog.getByRole('region', { name: 'Run logs', exact: true }).locator('pre').filter({ hasText: 'acceptance fixture passed' }).waitFor();
    await dialog.getByRole('button', { name: 'Close acceptance', exact: true }).click();
    console.log(`PASS: ${width}px optional global Acceptance switch, retained profiles/history, live tools, queue cancellation and active job control`);
  } catch (error) { failures.push(error); }
  finally {
    try {
      const state = await api(endpoint);
      for (const run of state.runs) if (['queued', 'running'].includes(run.state)) {
        await post('/api/acceptance', { cwd: project, action: 'cancel', runId: run.id });
        await waitRun(run.id, 'cancelled');
      }
    } catch (error) { failures.push(error); }
    try {
      const disabled = await page.request.patch(`${base}/api/plugins/bundled`, { data: { pluginId: 'acceptance', scope: 'global', set: { enabled: false }, reset: [] } });
      assert.equal(disabled.status(), 200);
    } catch (error) { failures.push(error); }
    try { await page.goto(`${base}/?session=${returnSessionId}`, { waitUntil: 'domcontentloaded' }); }
    catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Project acceptance fixture failed');
  }
}
