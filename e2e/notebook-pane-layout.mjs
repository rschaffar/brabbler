import assert from 'node:assert/strict';

// Native geometry/capture/focus only; policy permutations live in the mounted reader.
export async function checkNotebookPaneLayout(page, guided) {
  const controls = guided.getByRole('group', { name: 'Notebook layout', exact: true });
  const toggle = name => controls.getByRole('button', { name, exact: true });
  const prose = guided.locator('.guided-prose'), evidence = guided.locator('.guided-evidence-area');
  const image = evidence.locator('img'), originalImage = await image.elementHandle();
  const originalSrc = await image.getAttribute('src');
  const divider = guided.getByRole('separator', { name: 'Resize explanation and evidence', exact: true });
  await toggle('Outline').click();
  assert.equal(await guided.locator('.guided-outline').isVisible(), false);
  await toggle('Explanation').click();
  assert.equal(await prose.isVisible(), false); assert.equal(await evidence.isVisible(), true);
  assert.equal(await divider.count(), 0, 'hidden divider is absent from accessible roles');
  await toggle('Evidence').click();
  await guided.getByRole('status').filter({ hasText: 'Explanation and evidence are hidden' }).waitFor();
  await toggle('Reset layout').click();
  assert.equal(await originalImage.evaluate(node => node === document.querySelector('.guided-evidence-area img')), true, 'same decoded image node');
  assert.equal(await image.getAttribute('src'), originalSrc, 'same admitted blob snapshot');

  const mobile = page.viewportSize().width < 640;
  if (mobile) {
    assert.equal(await divider.isVisible(), false, 'narrow content stacks without an unusable splitter');
    const p = await prose.boundingBox(), e = await evidence.boundingBox();
    assert.ok(e.y >= p.y + p.height, 'narrow explanation and evidence stack');
  } else {
    const panel = page.locator('#file-panel');
    await panel.getByRole('button', { name: 'Expand file panel', exact: true }).click();
    await divider.waitFor();
    await divider.scrollIntoViewIfNeeded();
    const initial = await prose.boundingBox();
    const handle = await divider.boundingBox();
    // Keep the cursor inside the visible portion even for a very tall evidence pane.
    const y = Math.max(5, Math.min(page.viewportSize().height - 15, handle.y + 40));
    await page.mouse.move(handle.x + handle.width / 2, y); await page.mouse.down();
    try {
      assert.equal(await divider.evaluate(node => node.hasPointerCapture(1)), true, 'native capture admitted');
      await page.mouse.move(handle.x + handle.width / 2 + 100, y, { steps: 5 });
    } finally { await page.mouse.up(); }
    const resized = await prose.boundingBox();
    assert.ok(resized.width > initial.width + 60, 'drag gives explanation actual width');
    await divider.focus(); await page.keyboard.press('Home');
    assert.equal(await divider.getAttribute('aria-valuenow'), '20');
    await page.keyboard.press('Shift+ArrowRight');
    assert.equal(await divider.getAttribute('aria-valuenow'), '30');
    await page.keyboard.press('Enter');
    assert.equal(await divider.getAttribute('aria-valuenow'), '33');
    const again = await divider.boundingBox();
    const nextY = Math.max(5, Math.min(page.viewportSize().height - 15, again.y + 40));
    await page.mouse.move(again.x + again.width / 2, nextY); await page.mouse.down();
    try {
      await page.mouse.move(again.x + again.width / 2 + 60, nextY);
      await page.keyboard.press('Tab');
      assert.equal(await divider.getAttribute('aria-valuenow'), '33', 'leaving focus cancels the native drag');
      assert.equal(await divider.evaluate(node => node.hasPointerCapture(1)), false);
    } finally { await page.mouse.up(); }
    // Actual CSS must recover the same mounted preview after reflow/hiding.
    await toggle('Evidence').click();
    const full = await prose.boundingBox(); assert.ok(full.width > resized.width, 'one pane takes full step width');
    await prose.getByRole('button', { name: 'Return to current step', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.guided-evidence-area, .guided-pane-divider')), false, 'tabbing past prose skips the hidden evidence subtree and divider');
    await toggle('Evidence').click();
    await panel.getByRole('button', { name: 'Restore file panel width', exact: true }).click();
  }
  for (const pane of [prose, evidence]) {
    const box = await pane.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1, 'pane remains within viewport');
  }
  await toggle('Reset layout').click();
  assert.equal(await originalImage.evaluate(node => node === document.querySelector('.guided-evidence-area img')), true);
  assert.equal(await image.getAttribute('src'), originalSrc);
}
