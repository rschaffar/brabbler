import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { observeGuidedReviewAgentRequest, assertNoGuidedReviewAgentExecution } from './guided-review-agent-observation.mjs';

/** Thin installed desktop/touch bridge, appended to the original Markdown notebook chain.
 * Native Chromium Selection API is exercised; this is not native iOS/Android selection UI proof. */
export async function checkGuidedReviewWorkflow(page, { base, fixture: f }) {
  const width = page.viewportSize().width, folder = dirname(f.guidedIndex), chapter = join(folder, 'ordering.md');
  writeFileSync(chapter, readFileSync(chapter, 'utf8').replace('Compare the implementation with its surrounding context.', `Compare the implementation with its surrounding context.\n\nWorkflow input ${width}.`));
  const agentRequests = [];
  const observe = request => { const record = observeGuidedReviewAgentRequest(request); if (record) agentRequests.push(record); };
  page.on('request', observe);
  const guided = page.getByRole('region', { name: 'Guided reading', exact: true });
  const panel = page.locator('.notebook-review-panel');
  const open = async () => {
    await page.goto(`${base}/?session=${f.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: 'Open guided review', exact: true }).click();
    await page.locator('#file-panel').getByRole('button', { name: 'Start guided reading', exact: true }).click();
    await guided.getByRole('heading', { name: 'Inspect the immutable evidence', exact: true }).waitFor();
  };
  const save = async (button, kind) => {
    const response = page.waitForResponse(response => {
      if (new URL(response.url()).pathname !== '/api/review-data' || response.request().method() !== 'POST') return false;
      const body = response.request().postDataJSON(); return body.action === 'append' && body.operation.kind === kind || kind === 'import' && body.action === 'import';
    });
    await button.click(); const result = await response; await result.finished(); assert.equal(result.status(), 200);
    await panel.getByRole('status', { includeHidden: true }).filter({ hasText: /Saved/ }).waitFor({ state: 'attached' });
  };
  const tip = () => {
    const root = join(folder, 'review-data/reviewer'), names = readdirSync(root).filter(n => /^\d{10}\.json$/.test(n)).sort();
    return JSON.parse(readFileSync(join(root, names.at(-1)), 'utf8'));
  };
  try {
    await page.locator('#file-panel').getByRole('button', { name: 'Hide file panel', exact: true }).click();
    await page.locator('.chat-input-textarea').fill(`Unsent review draft ${width}`);
    await open();
    if (!existsSync(join(folder, 'review-data'))) assert.equal(await panel.getByText('Reading only — no writes enabled', { exact: true }).count(), 1);
    await panel.getByRole('button', { name: 'Enable review recording', exact: true }).click();
    const judgment = panel.getByRole('region', { name: 'Authored question: Judgment', exact: true });
    await judgment.getByRole('combobox', { name: 'Recorded outcome', exact: true }).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Reviewed', exact: true }).isDisabled(), true, 'required current outcome only gates Reviewed');
    await judgment.getByRole('combobox', { name: 'Recorded outcome', exact: true }).selectOption('unsure');
    await save(judgment.getByRole('button', { name: 'Record outcome', exact: true }), 'answer');
    await judgment.getByText('Reveal author explanation (not grading)', { exact: true }).click();
    await judgment.getByText(/Author guidance: The author recommends/).waitFor();
    const text = panel.getByRole('region', { name: 'Authored question: Understanding', exact: true });
    await text.locator('textarea').first().fill('Inspected immutable rejection ordering');
    await save(text.getByRole('button', { name: 'Record outcome', exact: true }), 'answer');
    const multiple = panel.getByRole('region', { name: 'Authored question: Design', exact: true });
    await multiple.getByRole('checkbox', { name: 'Locality', exact: true }).check();
    await multiple.getByRole('checkbox', { name: 'Durability', exact: true }).check();
    await save(multiple.getByRole('button', { name: 'Record outcome', exact: true }), 'answer');
    await save(panel.getByRole('button', { name: 'Reviewed', exact: true }), 'mark');
    const source = guided.locator('[data-review-stop="guided-source"] .review-notebook-source');
    await source.locator('[data-review-source-line="49"]').waitFor();
    await source.evaluate(root => {
      const content = root.querySelector('[data-review-source-line="49"] > span:last-child');
      const range = document.createRange(); range.selectNodeContents(content);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await panel.getByRole('button', { name: 'Capture current anchor', exact: true }).click();
    await panel.getByRole('region', { name: 'New feedback', exact: true }).locator('pre').filter({ hasText: '"start": 49' }).waitFor();
    await panel.getByRole('textbox', { name: 'Feedback text', exact: true }).fill(`Pinned source concern ${width}`);
    await save(panel.getByRole('button', { name: 'Save feedback', exact: true }), 'feedback');
    const tray = panel.getByRole('region', { name: 'Cross-chapter review tray', exact: true });
    const first = tray.locator('article').filter({ hasText: `Pinned source concern ${width}` });
    await first.getByRole('checkbox').check();
    await guided.getByRole('button', { name: 'Next', exact: true }).click();
    await guided.getByRole('heading', { name: 'Check the failure boundary', exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Capture current anchor', exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => { const p = document.querySelector('.notebook-review-panel'); return [...p.querySelectorAll('button')].some(b => b.textContent === 'Capture current anchor' && !b.disabled); });
    await panel.getByRole('button', { name: 'Capture current anchor', exact: true }).click();
    await panel.getByRole('combobox', { name: 'Feedback kind', exact: true }).selectOption('guide-issue');
    await panel.getByRole('textbox', { name: 'Feedback text', exact: true }).fill(`Cross-chapter guide concern ${width}`);
    await save(panel.getByRole('button', { name: 'Save feedback', exact: true }), 'feedback');
    await tray.locator('article').filter({ hasText: `Cross-chapter guide concern ${width}` }).getByRole('checkbox').check();
    await save(panel.getByRole('button', { name: 'Prepare in chat', exact: true }), 'prepare');
    const preview = panel.getByRole('region', { name: 'Frozen batch preview', exact: true });
    await preview.getByRole('button', { name: 'Add batch to chat draft', exact: true }).waitFor();
    const batch = tip().state.events.findLast(e => e.operation.kind === 'prepare').operation.batch;
    assert.equal(batch.items.length, 2); assert.equal(batch.destination.id, f.id);
    assert.equal(batch.items[0].anchor.selection.start, 49); assert.equal(batch.items[0].anchor.target.oid, f.oid);
    await save(preview.getByRole('button', { name: 'Add batch to chat draft', exact: true }), 'drafted');
    const composer = page.locator('.chat-input-textarea');
    assert.ok((await composer.inputValue()).startsWith(`Unsent review draft ${width}`));
    assert.ok((await composer.inputValue()).includes(`BEGIN GUIDED REVIEW BATCH ${batch.id}`));
    assertNoGuidedReviewAgentExecution(agentRequests, f.id);
    if (width < 700) await page.getByRole('link', { name: 'Open guided review', exact: true }).click();
    const item = batch.items[0];
    const reply = { version: 1, batchId: batch.id, items: [{ id: item.id, version: item.version, fingerprint: item.anchor.fingerprint, response: `Investigated reply ${width}`, evidence: `Pinned ${f.oid}`, proposedChanges: 'Proposal only; no changes applied' }] };
    await preview.getByRole('textbox', { name: 'JSON reply import fallback', exact: true }).fill(JSON.stringify(reply));
    await save(preview.getByRole('button', { name: 'Import pasted JSON reply', exact: true }), 'import');
    await first.getByText(`Investigated reply ${width}`, { exact: true }).waitFor();
    await tray.locator(`[data-review-batch="${batch.id}"]`).getByText(/Incomplete\/partial reply/).waitFor();
    await save(first.getByRole('button', { name: 'Resolve (reviewer only)', exact: true }), 'resolve');
    await first.getByRole('button', { name: 'Reopen (reviewer only)', exact: true }).waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: 'Open guided review', exact: true }).click();
    await page.locator('#file-panel').getByRole('button', { name: 'Start guided reading', exact: true }).click();
    await panel.getByRole('button', { name: 'Load saved review record', exact: true }).click();
    await guided.getByRole('heading', { name: 'Check the failure boundary', exact: true }).waitFor();
    await panel.getByText(`Investigated reply ${width}`, { exact: true }).waitFor();
    await tray.locator('article').filter({ hasText: `Pinned source concern ${width}` }).getByRole('button', { name: 'Reopen (reviewer only)', exact: true }).waitFor();
    writeFileSync(chapter, readFileSync(chapter, 'utf8').replace(/Is the boundary understandable(?: after revision \d+)?\?/, `Is the boundary understandable after revision ${width}?`));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: 'Open guided review', exact: true }).click();
    await page.locator('#file-panel').getByRole('button', { name: 'Start guided reading', exact: true }).click();
    await panel.getByRole('button', { name: 'Enable review recording', exact: true }).click();
    await guided.getByRole('heading', { name: 'Check the failure boundary', exact: true }).waitFor();
    await guided.getByRole('button', { name: 'Back', exact: true }).click();
    await panel.getByText(/Changed — re-review needed/).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Reviewed', exact: true }).isDisabled(), true);
    await judgment.getByRole('combobox', { name: 'Recorded outcome', exact: true }).selectOption('skip');
    await save(judgment.getByRole('button', { name: 'Record outcome', exact: true }), 'answer');
    await save(panel.getByRole('button', { name: 'Reviewed', exact: true }), 'mark');
    for (const field of await panel.locator('textarea, select').all()) {
      const box = await field.boundingBox();
      if (box) assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'native review fields fit Files at this viewport');
    }
    assertNoGuidedReviewAgentExecution(agentRequests, f.id);
    console.log(`PASS: ${width}px native guided review recording/forms/selection/cross-chapter draft/import/reviewer resolution/reload/re-review bridge`);
  } finally {
    page.off('request', observe);
    console.log(`Guided review agent HTTP observations (${width}px): ${JSON.stringify(agentRequests)}`);
  }
}
