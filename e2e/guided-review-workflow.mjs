import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { observeGuidedReviewAgentRequest, assertNoGuidedReviewAgentExecution } from './guided-review-agent-observation.mjs';

/** Installed desktop/touch bridge: reading → ordinary draft → explicit guide reload.
 * Former recording/batch/import assertions are retired in docs/notebook-recording-retirement.md. */
export async function checkGuidedReviewWorkflow(page, { base, fixture: f }) {
  const width = page.viewportSize().width, folder = dirname(f.guidedIndex), chapter = join(folder, 'failure.md');
  const history = join(folder, 'review-data', 'reviewer'); mkdirSync(history, { recursive: true });
  const savedFile = join(history, '0000000001.json');
  if (!existsSync(savedFile)) writeFileSync(savedFile, '{malformed historical review; preserve byte-for-byte');
  const savedBytes = readFileSync(savedFile);
  const recoveryKey = `brabbler-notebook-review-draft-v2:${encodeURIComponent(f.guidedIndex)}:retained-fixture`;
  const recoveryBytes = '{malformed browser recovery; do not migrate';
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [recoveryKey, recoveryBytes]);
  const agentRequests = [], recordingRequests = [];
  const observe = request => {
    const record = observeGuidedReviewAgentRequest(request); if (record) agentRequests.push(record);
    if (new URL(request.url()).pathname === '/api/review-data') recordingRequests.push(request.url());
  };
  page.on('request', observe);
  const guided = page.getByRole('region', { name: 'Guided reading', exact: true });
  const open = async () => {
    await page.goto(`${base}/?session=${f.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: 'Open guided review', exact: true }).click();
    await page.locator('#file-panel').getByRole('button', { name: 'Start guided reading', exact: true }).click();
    await guided.getByRole('heading', { name: 'Inspect the immutable evidence', exact: true }).waitFor();
  };
  try {
    await page.locator('#file-panel').getByRole('button', { name: 'Hide file panel', exact: true }).click();
    await page.locator('.chat-input-textarea').fill(`Unsent notebook request ${width}`);
    await open();
    assert.equal(await page.locator('.notebook-review-panel').count(), 0);
    await guided.getByText('Author guidance (optional)', { exact: true }).click();
    const guidance = guided.locator('.notebook-author-guidance');
    for (const text of ['Is the boundary understandable?', 'Clear', 'Needs inspection', 'Locality', 'Durability']) await guidance.getByText(text, { exact: true }).waitFor();
    await guidance.getByText(/The author recommends checking rejection/).waitFor();
    assert.equal(await guidance.locator('input, textarea, select, button').count(), 0, 'legacy content is readable, never a form');
    await guided.getByRole('button', { name: 'Next', exact: true }).click();
    await guided.getByRole('heading', { name: 'Check the failure boundary', exact: true }).waitFor();
    await guided.getByRole('button', { name: 'Ask about this step', exact: true }).click();
    const composer = page.locator('.chat-input-textarea');
    await composer.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('.chat-input-textarea')?.value.includes('"stepId": "failure-step"'));
    const draft = await composer.inputValue();
    assert.ok(draft.startsWith(`Unsent notebook request ${width}`));
    const context = JSON.parse(draft.split('~~~json\n')[1].split('\n~~~')[0]);
    assert.equal(context.indexPath, f.guidedIndex); assert.equal(context.chapterPath, 'failure.md');
    assert.equal(context.stepId, 'failure-step'); assert.match(context.displayedStepSha256, /^[a-f0-9]{64}$/);
    assertNoGuidedReviewAgentExecution(agentRequests, f.id);
    if (width < 700) await page.getByRole('link', { name: 'Open guided review', exact: true }).click();
    const update = `Agent-edited explanation for viewport ${width}.`;
    writeFileSync(chapter, readFileSync(chapter, 'utf8') + `\n\n${update}\n`);
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/review-notebook' && new URL(response.url()).searchParams.get('index') === f.guidedIndex && !new URL(response.url()).searchParams.has('asset'));
    await guided.getByRole('button', { name: 'Reload guide', exact: true }).click();
    const response = await loaded; await response.finished(); assert.equal(response.status(), 200);
    await guided.getByText(update, { exact: true }).waitFor();
    assert.equal(await guided.locator('[aria-current="step"]').textContent(), 'Check the failure boundary');
    for (const control of await guided.locator('.guided-reader-toolbar button').all()) {
      const box = await control.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, 'walkthrough controls fit the viewport');
    }
    assert.deepEqual(readFileSync(savedFile), savedBytes);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), recoveryKey), recoveryBytes);
    await open();
    assert.equal(await page.locator('.notebook-review-panel').count(), 0);
    assert.deepEqual(readFileSync(savedFile), savedBytes);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), recoveryKey), recoveryBytes);
    assert.deepEqual(recordingRequests, []);
    assertNoGuidedReviewAgentExecution(agentRequests, f.id);
    console.log(`PASS: ${width}px reader-only legacy guidance, preserved history, step-to-chat draft without Send, and explicit position-preserving guide reload`);
  } finally {
    page.off('request', observe);
    console.log(`Guided notebook agent HTTP observations (${width}px): ${JSON.stringify(agentRequests)}`);
  }
}
