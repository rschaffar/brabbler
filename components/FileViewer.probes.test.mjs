import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { open, read, reader, click, type, button, expectRead, expectEdit, expectGit, eligible, denied } from './file-viewer-harness.fixture.mjs';

const patch = 'diff --git a/file.txt b/file.txt\nindex 3367afd..b00cafe 100644\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+saved\n';
const rawPreference = window => window.localStorage.setItem('brabbler:git-diff-preferences', JSON.stringify({ view: 'raw', wrap: true }));

for (const nextCwd of ['/new-checkout', '/old-checkout']) for (const currentPatch of ['patch', patch]) test(`disposed watcher preserves current edit revision and actual supported diff (${nextCwd}/${currentPatch === 'patch' ? 'legacy-literal' : 'native-patch'})`, async t => {
  const h = await open(t, { filePath: '/file.txt', cwd: '/old-checkout', sourceSessionId: 'session', watchEnabled: true,
    initialDisplayMode: 'diff' }, { setup: rawPreference });
  const { view, runtime, props, initial } = h;
  await initial[1].deliver(read('original')); await initial[0].deliver(read('obsolete replay'));
  const oldSource = runtime.liveSources[0], oldRead = expectRead(runtime, props);
  await oldSource.connected(); await oldRead.headers();
  const next = { ...props, cwd: nextCwd, watchEnabled: false };
  const reset = nextCwd !== props.cwd ? expectRead(runtime, next) : null;
  await h.render(next);
  if (reset) await reset.deliver(read('reset'));
  await h.render({ ...next, watchEnabled: true });
  const source = runtime.liveSources[0], current = expectRead(runtime, next);
  await source.connected();
  const edit = expectEdit(runtime, next), git = expectGit(runtime, next);
  await current.deliver(read('saved', eligible)); await edit.headers(); await git.headers();
  const admitted = runtime.requests.length;
  await oldRead.deliver(read('poison', eligible));
  await oldSource.invokeRetained('connected'); await oldSource.invokeRetained('change');
  assert.equal(runtime.requests.length, admitted, 'old lifetime neither admits probes nor advances a generation that invalidates the held current bodies');
  await edit.deliver({ content: 'saved', revision: 'revision', writable: true, editIdentity: 'a'.repeat(64) });
  await git.deliver(currentPatch === 'patch' ? { supported: true, patch: currentPatch }
    : { supported: true, patch: currentPatch, revision: 'working-revision', status: 'modified' });
  // Preserve the exact legacy response AND a valid native patch. The literal
  // takes the real parser's raw fallback; no fake success child or preload.
  await click(view, button(reader(view), 'Diff'));
  assert.equal(button(reader(view), 'Diff').getAttribute('aria-pressed'), 'true');
  assert.equal(reader(view).querySelector('[aria-label="Raw patch"]').textContent, currentPatch);
  if (currentPatch === 'patch') assert.equal(h.diffWorks.length, 0, 'a non-parseable legacy patch starts no native highlighter');
  else await h.joinDiff();
  assert.equal(reader(view).querySelector('.is-lightweight') === null, true);
  assert.equal(reader(view).textContent.includes('Preparing highlighted diff'), false, 'current highlighter completion is joined');
  await click(view, button(reader(view), 'Edit'));
  const field = reader(view).querySelector('textarea');
  assert.equal(Boolean(field), true); assert.equal(field.value, 'saved');
  await type(view, field, 'changed');
  const save = runtime.expect({ type: 'save', path: next.filePath, sessionId: next.sourceSessionId,
    body: { content: 'changed', expectedRevision: 'revision', expectedEditIdentity: 'a'.repeat(64) } });
  await click(view, button(reader(view), 'Save'));
  const afterRead = expectRead(runtime, next), afterGit = expectGit(runtime, next);
  await save.deliver({ revision: 'next-revision' });
  await afterRead.deliver(read('changed', eligible)); await afterGit.deliver({ supported: false });
  assert.equal(h.store.snapshot('reader').saving, false);
  assert.equal(h.store.snapshot('reader').draft === undefined, true);
  runtime.assertHealthy();
});

test('a current supported deleted Diff survives the real read error and suppresses Source/Edit', async t => {
  const modes = [];
  const h = await open(t, { initialState: { displayMode: 'diff', wrapLines: true, scrollTop: 19, scrollLeft: 7 },
    onStateChange(state) { modes.push(state.displayMode); } }, { setup(window) {
      rawPreference(window);
      // This case opens an already-visible pane. Supply its measurement BEFORE
      // restoration runs, not an unregistered observer/reveal schedule afterward.
      for (const [key, value] of [['clientWidth', 640], ['clientHeight', 400]]) {
        Object.defineProperty(window.HTMLElement.prototype, key, { configurable: true,
          get() { return this.classList.contains('file-viewer-content') ? value : 0; } });
      }
    } });
  const git = expectGit(h.runtime, h.props);
  await h.initial[1].deliver({ error: 'deleted file', probeEligibility: { edit: false, gitDiff: true } }, { status: 404 });
  await git.headers();
  assert.equal(reader(h.view).textContent, 'Loading...');
  assert.equal(modes.includes('source'), false, 'an unresolved Git body cannot demote restored Diff even temporarily');
  const deleted = 'diff --git a/a.txt b/a.txt\ndeleted file mode 100644\nindex 7898192..0000000\n--- a/a.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-a\n';
  await git.deliver({ supported: true, patch: deleted, status: 'deleted' });
  await h.joinDiff();
  await h.initial[0].deliver(read('obsolete', denied));
  const root = reader(h.view), pane = root.querySelector('.file-viewer-content');
  assert.equal(pane.scrollTop, 19); assert.equal(pane.scrollLeft, 7);
  assert.equal(root.querySelector('[aria-label="Raw patch"]').textContent, deleted);
  assert.equal(modes.at(-1), 'diff', 'the real state reporter and rendered raw patch retain restored Diff; a single available mode has no toggle');
  assert.equal([...root.querySelectorAll('button')].some(node => ['Source', 'Edit'].includes(node.textContent)), false);
  assert.equal(root.querySelector('.is-lightweight') === null, true);
  h.runtime.assertHealthy();
});

for (const status of [200, 409]) test(`unmount does not cancel an admitted Save (${status}) or lose its terminal callback`, async t => {
  const saving = [];
  const h = await open(t, { onSavingChange: value => saving.push(value) });
  const edit = expectEdit(h.runtime, h.props);
  await h.initial[1].deliver(read('A', { edit: true, gitDiff: false })); await h.initial[0].deliver(read('obsolete'));
  await edit.deliver({ content: 'A', revision: 'r1', writable: true, editIdentity: 'identity' });
  await click(h.view, button(reader(h.view), 'Edit'));
  await type(h.view, reader(h.view).querySelector('textarea'), 'B');
  const save = h.runtime.expect({ type: 'save', path: h.props.filePath, sessionId: h.props.sourceSessionId,
    body: { content: 'B', expectedRevision: 'r1', expectedEditIdentity: 'identity' } });
  await click(h.view, button(reader(h.view), 'Save')); await save.headers();
  await h.view.unmount();
  assert.equal(h.store.snapshot('reader').saving, true, 'observer removal is not write cancellation');
  const refresh = status === 200 ? expectRead(h.runtime, h.props) : null;
  await save.deliver(status === 200 ? { revision: 'r2' } : { error: 'revision conflict' }, { status });
  if (refresh) await refresh.deliver(read('B'));
  assert.equal(save.jsonReturned, true);
  assert.equal(h.store.snapshot('reader').saving, false);
  assert.deepEqual(saving, [true, false]);
  if (status === 200) assert.equal(h.store.snapshot('reader').draft === undefined, true);
  else assert.deepEqual(h.store.snapshot('reader').draft, { content: 'B', baseline: 'A', revision: 'r1' });
  h.runtime.assertHealthy();
});
