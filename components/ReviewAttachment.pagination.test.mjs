import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { packet, click, textButton } from './cards-git.fixture.mjs';

// Only display pagination moves here. The installed journey keeps the actual
// large command, cold page/body, fullscreen, approval and both 45-file commits.
test('real large Card advances its 46-entry page and consumes the new selected entry at both original inputs', async t => {
  const h = await packet(t, { review: true, cardDescendants: true,
    reviewStarts: [0, 40], reviewEntryIds: [0, 1, 40] });
  const { BlockingRequestCard } = await h.load('./BlockingRequestCard.tsx');
  const files = Array.from({ length: 45 }, (_, index) => `large-review-${index}.txt`).sort();
  const marker = 'Text about GIT binary patch is not binary\n';
  const root = h.view.container;
  for (const width of [1280, 390]) {
    const from = h.requests.length;
    const patch = name => {
      const header = `diff --git a/${name} b/${name}\n`;
      const added = `Large browser review large-${width}\n`.repeat(2000);
      return width === 1280
        ? header + `new file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1,2001 @@\n` + (marker + added).split('\n').slice(0, -1).map(line => `+${line}\n`).join('')
        : header + `--- a/${name}\n+++ b/${name}\n@@ -1,2001 +1,2001 @@\n ${marker}`
          + 'Large browser review large-1280\n'.repeat(2000).split('\n').slice(0, -1).map(line => `-${line}\n`).join('')
          + added.split('\n').slice(0, -1).map(line => `+${line}\n`).join('');
    };
    const entries = [{ id: 0, label: 'Exact operation, checks and captured state', kind: 'text', bytes: 100, sha256: 'a'.repeat(64) },
      ...files.map((file, index) => ({ id: index + 1, label: `a/${file} b/${file}`, kind: 'patch',
        bytes: Buffer.byteLength(patch(file)), sha256: 'b'.repeat(64) }))];
    const review = { version: 1, id: 'review', operationId: `a046677d-8293-4445-9a2b-55831734${width === 1280 ? '1280' : '0390'}`,
      bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), entries: 46, sha256: 'c'.repeat(64) };
    assert.ok(review.bytes > 256 * 1024, 'original large review uses paged entries, not aggregate inline patch');
    const request = { type: 'extension_ui_request', id: `large-${width}`, method: 'plugin_card', pluginId: 'git-workflow',
      title: 'Git commit', review, actions: [{ id: 'approve', label: 'Approve commit', primary: true }] };
    const pending = (key, value) => h.requests.slice(from).filter(item => item.status === undefined && item.url.searchParams.get(key) === String(value));
    const deliver = async (key, value, payload) => {
      const reads = pending(key, value);
      assert.ok(reads.length, `actual ${key}=${value} read admitted`);
      for (const read of reads) await h.reply(read, payload);
    };
    await h.render(createElement(BlockingRequestCard, { key: width, request, sessionId: 'current', onReadWork: h.onReadWork,
      onRespond: () => assert.fail('pagination must never approve the native operation') }));
    await deliver('start', 0, { entries: entries.slice(0, 40), total: 46, next: 40 });
    await deliver('entry', 0, { text: JSON.stringify({ message: `Large exact browser review large-${width}` }), offset: 0, next: null, complete: true });
    assert.match(root.textContent, /Showing entries 1–40 of 46/);
    await click(h.view, root.querySelector(`[aria-label="Open diff: ${entries[1].label}"]`));
    await deliver('entry', 1, { text: patch(files[0]), offset: 0, next: null, complete: true });
    await click(h.view, textButton(root, 'Next files'));
    // Assert admission BEFORE awaiting a request a defective button cannot make.
    assert.equal(pending('start', 40).some(read => !read.signal.aborted), true, 'Next files requests the original page-40 boundary');
    await deliver('start', 40, { entries: entries.slice(40), total: 46, next: null });
    assert.match(root.textContent, /Showing entries 41–46 of 46/);
    const selected = pending('entry', 40).find(read => !read.signal.aborted);
    assert.ok(selected, 'new page selects entry 40 rather than retaining the old entry');
    const original = selected.readWork;
    assert.ok(original && typeof original.then === 'function');
    let finished = false;
    const observation = original.then(() => { finished = true; });
    await click(h.view, textButton(root, 'Raw patch'));
    assert.equal(finished, false, 'new selected-entry body and original continuation remain held');
    await deliver('entry', 40, { text: patch(files[39]), offset: 0, next: null, complete: true });
    await observation;
    assert.equal(selected.readWork, original);
    assert.equal(selected.bodyCalls, 1);
    assert.equal(root.querySelector('[aria-label="Raw patch"]').textContent, patch(files[39]));
    assert.equal(root.textContent.includes('Binary changes are summarized; file contents are not shown.'), false);
    assert.equal([...root.querySelectorAll('button')].some(button => button.textContent === 'Next files'), false);
    assert.ok(textButton(root, 'Previous files')); // Existence only: original browser never exercised Previous files.
    assert.equal(h.requests.slice(from).some(read => read.url.searchParams.has('patch')), false);
    assert.ok(textButton(root, 'Approve commit'), 'real action footer survives display pagination');
    await h.render(null);
    await h.settle();
  }
});
