import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { waitForAsyncCondition } from './async-condition.mjs';

export async function checkProjectAcceptance(page, { base, api, post, project, width, returnSessionId }) {
  const input = `acceptance-${width}.txt`;
  writeFileSync(join(project, input), `exact source ${width}\n`);
  const held = `const fs=require('node:fs'),path=require('node:path'); console.log('acceptance fixture ready'); const timer=setInterval(()=>{if(fs.existsSync(path.join(process.env.PI_WEB_ACCEPTANCE_RUNTIME,'release'))){clearInterval(timer);console.log('acceptance fixture passed');}},50);setTimeout(()=>process.exit(9),20000).unref();`;
  const make = (name, source) => ({ name, label: `Acceptance ${name} ${width}`, coverage: 'focused', argv: ['node', '-e', source], inputs: [input], cpus: 1, memoryMiB: 128, permission: 'allow' });
  const profiles = [make('held', held), make('quick', 'console.log("quick acceptance passed")')];
  const endpoint = `/api/acceptance?cwd=${encodeURIComponent(project)}`;
  const dialog = page.getByRole('dialog', { name: 'Acceptance', exact: true });
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
  try {
    await page.goto(`${base}/?cwd=${encodeURIComponent(project)}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Acceptance', exact: true }).click();
    await dialog.waitFor();
    await dialog.getByText('Configure project profiles', { exact: true }).click();
    const editor = dialog.getByRole('textbox', { name: 'Profiles JSON', exact: true });
    await editor.fill(JSON.stringify(profiles));
    assert.equal(await editor.inputValue(), JSON.stringify(profiles), 'initial status cannot overwrite an editable configuration draft');
    const save = page.waitForResponse(response => new URL(response.url()).pathname === '/api/acceptance' && response.request().method() === 'POST' && response.request().postDataJSON().action === 'configure');
    void save.catch(() => {});
    await dialog.getByRole('button', { name: 'Save profiles', exact: true }).click();
    assert.equal((await save).status(), 200);
    const first = await clickRun('held');
    await waitRun(first.id, 'running');
    const current = await api(endpoint);
    const shared = await post('/api/acceptance', { cwd: project, action: 'run', profile: 'held', profileDigest: current.profileDigests.held, requestId: randomUUID() });
    assert.equal(shared.run.id, first.id); assert.equal(shared.joined, true);
    assert.equal(shared.run.requests.length, 2);
    const second = await clickRun('quick');
    await waitRun(second.id, 'queued');
    assert.notEqual(first.id, second.id);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'Acceptance', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Acceptance', exact: true }).click();
    await dialog.waitFor();
    await dialog.locator(`[data-acceptance-run="${first.id}"]`).waitFor();
    assert.equal((await api(endpoint)).runs.filter(run => run.id === first.id).length, 1);
    writeFileSync(join(first.runtimeDirectory, 'release'), 'release\n');
    await waitRun(first.id, 'passed');
    const completed = await waitRun(second.id, 'passed');
    assert.equal(completed.settled, true); assert.ok(completed.executionMs >= 0); assert.ok(completed.queueMs >= 0);
    await dialog.locator(`[data-acceptance-run="${second.id}"]`).getByRole('button', { name: 'Run logs', exact: true }).click();
    await dialog.getByRole('region', { name: 'Run logs', exact: true }).locator('pre').filter({ hasText: 'quick acceptance passed' }).waitFor();
    const third = await clickRun('held'); await waitRun(third.id, 'running');
    await dialog.locator(`[data-acceptance-run="${third.id}"]`).getByRole('button', { name: 'Cancel acceptance run', exact: true }).click();
    assert.equal((await waitRun(third.id, 'cancelled')).settled, true);
    const box = await dialog.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, 'acceptance dialog fits viewport');
    await dialog.getByRole('button', { name: 'Close acceptance', exact: true }).click();
  } finally {
    const state = await api(endpoint);
    for (const run of state.runs) if (['queued', 'running'].includes(run.state)) {
      await post('/api/acceptance', { cwd: project, action: 'cancel', runId: run.id });
      await waitRun(run.id, 'cancelled');
    }
    await page.goto(`${base}/?session=${returnSessionId}`, { waitUntil: 'domcontentloaded' });
  }
}
