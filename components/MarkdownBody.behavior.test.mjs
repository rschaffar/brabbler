import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createJiti } from 'jiti';
import { markdownDom, byText } from './markdown-dom.fixture.mjs';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
async function production() {
  const { MarkdownBody } = await jiti.import('./MarkdownBody.tsx');
  const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
  return { MarkdownBody, I18nProvider };
}

test('mounted local links use current callbacks, cwd, PDF page and source coordinates', async t => {
  const f = markdownDom(t); // Guard imports too; no permitted network operations.
  const { MarkdownBody, I18nProvider } = await production();
  const first = [], current = [];
  const oldOpen = (...args) => first.push(args), open = (...args) => current.push(args);
  let text = '[Range](src/code.ts#L36-L48)\n\n[PDF](report.pdf#page=7)\n\n`src/code.ts:36:5`\n\n[Web](https://example.test/docs)';
  let props = { cwd: '/alpha', onOpenFile: oldOpen };
  const element = () => createElement(I18nProvider, null, createElement(MarkdownBody, props, text));
  const view = await f.mount(element());
  const link = name => byText(view.container, 'a', name);
  for (const modifiers of [{}, {}, { ctrlKey: true }, { metaKey: true }]) {
    assert.equal(await f.click(link('Range'), modifiers), true);
  }
  assert.deepEqual(first, Array.from({ length: 4 }, () => ['/alpha/src/code.ts', undefined, { line: 36, endLine: 48 }]));

  // Change each closure dependency independently: a combined change could hide
  // one missing dependency if the other still rebuilds the renderer.
  props = { ...props, onOpenFile: open };
  await view.rerender(element());
  assert.equal(await f.click(link('Range')), true);
  props = { ...props, cwd: '/beta' };
  await view.rerender(element());
  assert.equal(await f.click(link('Range')), true);
  assert.equal(await f.click(link('PDF')), true);
  assert.equal(await f.click(link('src/code.ts:36:5')), true);
  assert.deepEqual(current, [
    ['/alpha/src/code.ts', undefined, { line: 36, endLine: 48 }],
    ['/beta/src/code.ts', undefined, { line: 36, endLine: 48 }],
    ['/beta/report.pdf', 7, undefined],
    ['/beta/src/code.ts', undefined, { line: 36, column: 5 }],
  ]);
  assert.equal(first.length, 4, 'obsolete handler never receives a new click');
  assert.equal(link('Web').target, '_blank');
  assert.equal(link('Web').rel, 'noopener noreferrer');
  assert.equal(await f.click(link('Web')), false, 'ordinary web destination is not handled as a file');
  assert.equal(current.length, 4);
  text = text.replace('#L36-L48', '#L70-L72').replace('#page=7', '#page=8');
  await view.rerender(element());
  assert.equal(await f.click(link('Range')), true);
  assert.equal(await f.click(link('PDF')), true);
  assert.deepEqual(current.slice(4), [
    ['/beta/src/code.ts', undefined, { line: 70, endLine: 72 }],
    ['/beta/report.pdf', 8, undefined],
  ]);

  props = { ...props, onOpenFile: undefined };
  await view.rerender(element());
  assert.equal([...view.container.querySelectorAll('a')].some(node => node.textContent === 'src/code.ts:36:5'), false);
  assert.equal(await f.click(link('Range')), false, 'removing the handler removes in-app interception');
  assert.equal(current.length, 6);
  await view.unmount();
  assert.equal(view.container.childNodes.length, 0);
  assert.deepEqual(f.requests, []);
});

test('mounted blocked links explain traversal without navigation and preserve/reset feedback deliberately', async t => {
  const f = markdownDom(t);
  const { MarkdownBody, I18nProvider } = await production();
  const opened = [];
  let props = { cwd: '/repo', onOpenFile: (...args) => opened.push(args) };
  let text = '[Blocked](../outside/file.ts#L14)\n\n[Encoded](%2e%2e/outside/file.ts#L14)';
  const element = () => createElement(I18nProvider, null, createElement(MarkdownBody, props, text));
  const view = await f.mount(element());
  const blocked = name => byText(view.container, 'button', name);
  const trigger = blocked('Blocked');
  assert.equal(trigger.closest('a') === null, true, 'blocked trigger is not an anchor');
  assert.equal(view.container.querySelector('[href]') === null, true, 'blocked links supply no href');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  const explanation = trigger.title;
  assert.match(explanation, /outside.*absolute filesystem path/i);
  await f.click(trigger, { ctrlKey: true });
  const status = view.container.querySelector('[role="status"]');
  assert.ok(status);
  assert.equal(status.textContent.trim(), explanation);
  assert.equal(trigger.getAttribute('aria-controls'), status.id);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  await act(() => { trigger.focus(); });
  props = { ...props, className: 'unrelated-parent-update' };
  await view.rerender(element());
  assert.equal(blocked('Blocked') === trigger, true, 'unrelated rerender keeps the actual feedback owner');
  assert.equal(view.window.document.activeElement === trigger, true, 'focus remains on trigger');
  assert.equal(view.container.querySelector('[role="status"]') === status, true, 'same feedback node');
  await f.click(trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(view.container.querySelector('[role="status"]') === null, true, 'toggle clears feedback');
  await f.click(blocked('Encoded'), { metaKey: true });
  assert.equal(blocked('Encoded').getAttribute('aria-expanded'), 'true');
  assert.equal(blocked('Encoded').closest('a') === null, true, 'encoded traversal is not an anchor');
  assert.deepEqual(opened, []);

  // A new rejected destination must not reuse an expanded explanation owner.
  await f.click(trigger);
  text = '[Blocked](../different/file.ts#L14)';
  await view.rerender(element());
  assert.equal(blocked('Blocked') !== trigger, true, 'new destination resets feedback owner');
  assert.equal(blocked('Blocked').getAttribute('aria-expanded'), 'false');
  assert.equal(view.container.querySelector('[role="status"]') === null, true, 'new destination has no stale feedback');
  props = { ...props, cwd: undefined };
  text = '[Missing base](src/file.ts)';
  await view.rerender(element());
  const missing = blocked('Missing base');
  assert.match(missing.title, /no working directory/i);
  assert.equal(missing.closest('a') === null, true, 'missing cwd has no navigable ancestor');
  await f.click(missing);
  assert.match(view.container.querySelector('[role="status"]').textContent, /no working directory/i);
  assert.deepEqual(opened, []);
  assert.deepEqual(f.requests, []);
});

test('reader-local anchors dispatch click and Enter through the current reader callback, not Files', async t => {
  const f = markdownDom(t);
  const { MarkdownBody, I18nProvider } = await production();
  const oldReads = [], reads = [], files = [];
  const oldNavigate = href => oldReads.push(href), navigate = href => reads.push(href);
  let props = { cwd: '/repo', onOpenFile: (...args) => files.push(args), onNavigateLink: oldNavigate };
  const text = '[Read](refs/a.md#details)\n\n[Section](#details)\n\n## Details\n\n[Web](https://example.test/docs)';
  const element = () => createElement(I18nProvider, null, createElement(MarkdownBody, props, text));
  const view = await f.mount(element());
  const link = name => byText(view.container, 'a', name);
  assert.equal(link('Read').hasAttribute('href'), false);
  assert.equal(link('Read').getAttribute('role'), 'link');
  assert.equal(link('Read').tabIndex, 0);
  await f.click(link('Read'));
  assert.deepEqual(oldReads, ['refs/a.md#details']);
  props = { ...props, onNavigateLink: navigate };
  await view.rerender(element());
  await f.click(link('Read'));
  await view.dispatch(link('Read'), new view.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await f.click(link('Section'));
  assert.equal(link('Section').hasAttribute('href'), false);
  assert.deepEqual(reads, ['refs/a.md#details', 'refs/a.md#details', '#user-content-details']);
  assert.deepEqual(oldReads, ['refs/a.md#details']);
  assert.equal(await f.click(link('Web')), false);
  assert.equal(link('Web').href, 'https://example.test/docs');
  assert.deepEqual(files, []);
  assert.deepEqual(f.scrolls, [], 'reader-local fragment is delegated, not scrolled by the chat handler');
  assert.deepEqual(f.requests, []);
});

test('fragment clicks find raw anchors and heading fallbacks inside their own mounted Markdown root', async t => {
  const f = markdownDom(t);
  const { MarkdownBody, I18nProvider } = await production();
  const opened = [];
  const props = { cwd: '/repo', onOpenFile: (...args) => opened.push(args) };
  const text = '## Target\n\n<a id="target"></a>\n\n[Raw](#target)\n\n[Heading](#only-heading)\n\n## Only heading';
  const view = await f.mount(createElement(I18nProvider, null,
    createElement('section', null,
      createElement('a', { id: 'user-content-target', 'data-outside-markdown': true }),
      createElement(MarkdownBody, { ...props, className: 'first' }, text),
      createElement(MarkdownBody, { ...props, className: 'second' }, text))));
  const roots = [...view.container.querySelectorAll('.markdown-body')];
  assert.equal(roots.length, 2);
  const before = { url: view.window.location.href, history: view.window.history.length };
  const raw = root => root.querySelector('[id="user-content-target"]');
  const heading = root => root.querySelector('[data-heading-anchor="only-heading"]');
  assert.ok(raw(roots[0])); assert.ok(raw(roots[1])); assert.ok(heading(roots[1]));
  assert.equal(await f.click(byText(roots[1], 'a', 'Raw')), true);
  assert.equal(await f.click(byText(roots[1], 'a', 'Heading')), true);
  assert.equal(await f.click(byText(roots[0], 'a', 'Raw')), true);
  const targets = [raw(roots[1]), heading(roots[1]), raw(roots[0])];
  assert.equal(f.scrolls.length, targets.length);
  f.scrolls.forEach((call, index) => {
    assert.equal(call.element === targets[index], true, `exact scoped scroll target ${index}`);
    assert.deepEqual(call.options, { block: 'start' });
  });
  assert.deepEqual({ url: view.window.location.href, history: view.window.history.length }, before);
  assert.deepEqual(opened, []);
  assert.deepEqual(f.requests, []);
  // The scroll spy proves selected DOM target/wiring, not physical scroll bounds.
});
