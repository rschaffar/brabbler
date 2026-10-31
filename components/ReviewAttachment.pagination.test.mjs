import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { packet, click, textButton } from './cards-git.fixture.mjs';
import { review, overview, preview, live, deliver } from './operation-review.fixture.mjs';

// Same 45 native-file input tuples. Metadata is no longer an inventory entry;
// page-40 remains the exact production boundary. Installed approval/native effects stay.
test('real v2 Card pages 45 files and joins only its newly selected file at both original inputs', async t => {
  const h = await packet(t, { review: true, cardDescendants: true, reviewStarts: [0, 40], reviewEntryIds: [0, 40] });
  const { BlockingRequestCard } = await h.load('./BlockingRequestCard.tsx');
  const files = Array.from({ length: 45 }, (_, id) => ({ id, path: `large-review-${id}.txt`, status: 'M' })).sort((a, b) => a.path.localeCompare(b.path)).map((file, id) => ({ ...file, id }));
  const marker = 'Text about GIT binary patch is not binary\n';
  for (const width of [1280, 390]) {
    const from = h.requests.length;
    const patch = name => {
      const header = `diff --git a/${name} b/${name}\n`, added = `Large browser review large-${width}\n`.repeat(2000);
      return width === 1280 ? header + `new file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1,2001 @@\n` + (marker + added).split('\n').slice(0, -1).map(line => `+${line}\n`).join('')
        : header + `--- a/${name}\n+++ b/${name}\n@@ -1,2001 +1,2001 @@\n ${marker}` + 'Large browser review large-1280\n'.repeat(2000).split('\n').slice(0, -1).map(line => `-${line}\n`).join('') + added.split('\n').slice(0, -1).map(line => `+${line}\n`).join('');
    };
    const request = { type: 'extension_ui_request', id: `large-${width}`, method: 'plugin_card', pluginId: 'git-workflow', title: 'Git commit', review,
      actions: [{ id: 'approve', label: 'Approve commit', primary: true }] };
    await h.render(createElement(BlockingRequestCard, { key: width, request, sessionId: 'current', onReadWork: h.onReadWork, onRespond: () => assert.fail('paging is not authority') }));
    await deliver(h, 'overview', overview(), undefined, from);
    await deliver(h, 'page', { files: files.slice(0, 40), total: 45, next: 40 }, undefined, from);
    await deliver(h, 'preview', preview(patch(files[0].path)), undefined, from);
    assert.match(h.view.container.textContent, /Showing files 1–40 of 45/);
    await click(h.view, textButton(h.view.container, 'Next files'));
    const selectedPage = live(h, 'page'); assert.equal(selectedPage.url.searchParams.get('start'), '40');
    await deliver(h, 'page', { files: files.slice(40), total: 45, next: null }, undefined, from);
    const selected = live(h, 'preview'); assert.equal(selected.url.searchParams.get('file'), '40');
    const original = selected.readWork; let finished = false; const observation = original.then(() => { finished = true; });
    await click(h.view, textButton(h.view.container, 'Raw patch')); assert.equal(finished, false);
    await deliver(h, 'preview', preview(patch(files[40].path)), undefined, from); await observation;
    assert.equal(selected.readWork, original); assert.equal(selected.bodyCalls, 1);
    assert.equal(h.view.container.querySelector('[aria-label="Raw patch"]').textContent, patch(files[40].path));
    assert.match(h.view.container.textContent, /Showing files 41–45 of 45/);
    assert.equal(h.view.container.textContent.includes('Binary changes are summarized; file contents are not shown.'), false);
    assert.equal([...h.view.container.querySelectorAll('button')].some(button => button.textContent === 'Next files'), false);
    assert.ok(textButton(h.view.container, 'Previous files')); assert.ok(textButton(h.view.container, 'Approve commit'));
    assert.equal(h.requests.slice(from).some(read => read.url.searchParams.get('op') === 'patch'), false, 'no aggregate patch read to render one file');
    await h.render(null); await h.settle();
  }
});
