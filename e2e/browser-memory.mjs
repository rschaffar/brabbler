import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Native ownership/DOM proof with synthetic content, not a heap/RSS ceiling. */
export async function checkBrowserMemoryLifetimes(page, { base, sessionId, markdownFile, previewFile, artifacts }) {
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: 'domcontentloaded' });
  const chat = page.locator('#chat-content'), viewport = chat.locator('.scrollbar-subtle.overflow-y-auto');
  await chat.locator('[data-entry-id="e4999"]').first().waitFor();
  const samples = [];
  const cdp = await page.context().newCDPSession(page);
  const contexts = new Map(), allContexts = new Map(), rendererFrames = new Set(), destroyedFrames = new Set();
  cdp.on('Runtime.executionContextCreated', ({ context }) => { contexts.set(context.id, context.auxData?.frameId); allContexts.set(context.id, context.auxData?.frameId); });
  cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => contexts.delete(executionContextId));
  cdp.on('Runtime.executionContextsCleared', () => contexts.clear());
  cdp.on('Page.frameAttached', ({ frameId }) => rendererFrames.add(frameId));
  cdp.on('Page.frameDetached', ({ frameId }) => destroyedFrames.add(frameId));
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  try {
    for (let cycle = 0; cycle < 3; cycle++) {
      const latest = await chat.locator('[data-entry-id="e4999"]').first().elementHandle();
      for (let pageIndex = 0; pageIndex < 6; pageIndex++) {
        const before = await chat.locator('[data-entry-id]').first().getAttribute('data-entry-id');
        const response = page.waitForResponse(reply => {
          const url = new URL(reply.url());
          return url.pathname === `/api/sessions/${sessionId}/context` && url.searchParams.has('before');
        });
        await viewport.evaluate(node => { node.scrollTop = 0; });
        await (await response).finished();
        await page.waitForFunction(previous => document.querySelector('#chat-content [data-entry-id]')?.getAttribute('data-entry-id') !== previous, before);
      }
      const older = await chat.locator('[data-entry-id]').first().elementHandle();
      assert.ok(await chat.locator('[data-entry-id]:not([data-message-role])').count() > 200, 'explicit scrollback may retain a wider window');
      assert.equal(await latest.evaluate(node => node.isConnected), true, 'newer messages remain mounted while reading history');
      await viewport.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.waitForFunction(() => {
        const nodes = document.querySelectorAll('#chat-content [data-entry-id]:not([data-message-role])');
        return nodes.length > 0 && nodes.length <= 200 && !!document.querySelector('#chat-content [data-entry-id="e4999"]');
      });
      assert.equal(await older.evaluate(node => node.isConnected), false, 'returning to latest unmounts discarded older output');
      await older.dispose(); await latest.dispose();
      await cdp.send('HeapProfiler.collectGarbage');
      samples.push({ phase: `history-${cycle}`, dom: await cdp.send('Memory.getDOMCounters'), heap: await cdp.send('Runtime.getHeapUsage') });
    }
    const showSidebar = page.getByRole('button', { name: 'Show sidebar', exact: true });
    if (await showSidebar.isVisible()) await showSidebar.click();
    writeFileSync(markdownFile, '# Disposable diagrams\n\n```mermaid\nblock-beta\nnode0["Unique block 0"]\n```\n');
    await page.getByTitle(markdownFile.replace(/\\/g, '/'), { exact: true }).click();
    const panel = page.locator('#file-panel');
    for (let i = 0; i < 16; i++) {
      if (i) writeFileSync(markdownFile, `# Disposable diagrams\n\n\`\`\`mermaid\nblock-beta\nnode${i}["Unique block ${i}"]\n\`\`\`\n`);
      await panel.locator('.mermaid-preview-button svg').getByText(`Unique block ${i}`, { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('iframe[data-mermaid-renderer]').length === 0);
      // A native protocol roundtrip and a render opportunity expose the actual
      // browsing-context destruction events, not merely absence of an element.
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await cdp.send('Runtime.getHeapUsage');
      assert.ok(rendererFrames.size >= i + 1, 'each unique block uses a fresh browsing context');
      assert.equal([...rendererFrames].every(id => destroyedFrames.has(id)), true, 'all admitted renderer frames are destroyed');
      assert.equal([...contexts.values()].some(id => rendererFrames.has(id)), false, 'no Mermaid execution context survives publication');
    }
    assert.ok([...allContexts.values()].filter(id => rendererFrames.has(id)).length >= 16, 'real child library contexts were evaluated, not just allocated empty frames');
    await cdp.send('HeapProfiler.collectGarbage');
    samples.push({ phase: 'diagrams', frames: rendererFrames.size, destroyed: destroyedFrames.size,
      dom: await cdp.send('Memory.getDOMCounters'), heap: await cdp.send('Runtime.getHeapUsage') });

    // Untrusted HTML keeps its existing opaque-origin sandbox. Hiding must
    // destroy its executable document, not merely turn off file watching.
    writeFileSync(previewFile, '<!doctype html><html><body><p>Disposable preview</p><script>window.previewInstance=Math.random();window.ticks=0;setInterval(()=>window.ticks++,20);</script></body></html>');
    await page.getByTitle(previewFile.replace(/\\/g, '/'), { exact: true }).click();
    for (let i = 0; i < 6; i++) {
      const element = await panel.locator('iframe').elementHandle();
      assert.equal(await element.getAttribute('sandbox'), 'allow-scripts');
      const frame = await element.contentFrame();
      await frame.waitForFunction(() => typeof window.previewInstance === 'number');
      const instance = await frame.evaluate(() => window.previewInstance);
      const detached = page.waitForEvent('framedetached', { predicate: candidate => candidate === frame });
      await panel.getByRole('button', { name: 'Hide file panel', exact: true }).click();
      await detached;
      assert.equal(frame.isDetached(), true, 'hidden preview has no script/timer realm');
      assert.equal(await element.evaluate(node => node.isConnected), false);
      await element.dispose();
      await page.getByRole('button', { name: 'Show file panel', exact: true }).click();
      const next = await (await panel.locator('iframe').elementHandle()).contentFrame();
      await next.waitForFunction(() => typeof window.previewInstance === 'number');
      assert.notEqual(await next.evaluate(() => window.previewInstance), instance, 'reveal creates a new executable document');
    }
    await panel.getByRole('button', { name: 'Hide file panel', exact: true }).click();
    writeFileSync(join(artifacts, 'browser-memory-lifetimes.json'), JSON.stringify({
      proof: 'Bounded live-tail DOM, explicit scrollback retention, fresh/destroyed diagram contexts and hidden preview destruction; samples are not an RSS/GC ceiling.', samples,
    }, null, 2));
  } finally { await cdp.detach(); }
}
