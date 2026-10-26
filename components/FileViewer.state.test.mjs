import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { open, read, reader, click, button, denied, expectRead } from './file-viewer-harness.fixture.mjs';
import { filesRuntime } from './files-runtime.fixture.mjs';

function viewport(pane, width = 640, height = 400) {
  Object.defineProperty(pane, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(pane, 'clientHeight', { configurable: true, value: height });
}

test('restored state waits for a measurable pane, then events and cleanup report to the current callback', async t => {
  const old = [], current = [], restored = { displayMode: 'source', wrapLines: true, scrollTop: 83, scrollLeft: 17 };
  const h = await open(t, { filePath: '/root/guide.md', initialDisplayMode: 'preview', initialState: restored,
    onStateChange: (...args) => old.push(args) });
  await h.initial[1].deliver(read('# title\n\nbody', denied, 'markdown')); await h.initial[0].deliver(read('obsolete'));
  const root = reader(h.view), pane = root.querySelector('.file-viewer-content');
  assert.equal(button(root, 'Source').getAttribute('aria-pressed'), 'true');
  assert.equal(pane.scrollTop, 0, 'zero-size viewport does not consume restoration');
  viewport(pane); await h.runtime.notifyResize(pane);
  assert.equal(pane.scrollTop, 83); assert.equal(pane.scrollLeft, 17);
  const before = old.length;
  await h.render({ ...h.props, onStateChange: (...args) => current.push(args) });
  await click(h.view, button(root, 'Preview'));
  assert.deepEqual(current.at(-1)[0], { ...restored, displayMode: 'preview' });
  await click(h.view, button(root, 'Source'));
  await click(h.view, root.querySelector('[aria-label="Disable word wrap"]'));
  assert.deepEqual(current.at(-1)[0], { ...restored, wrapLines: false });
  pane.scrollTop = 41; pane.scrollLeft = 9;
  await h.view.dispatch(pane, new h.view.window.Event('scroll', { bubbles: true }));
  assert.deepEqual(current.at(-1)[0], { displayMode: 'source', wrapLines: false, scrollTop: 41, scrollLeft: 9 });
  // Restoration is input, not a controlled prop on ordinary rerenders.
  await h.render({ ...h.props, initialState: { displayMode: 'preview', wrapLines: true, scrollTop: 999, scrollLeft: 999 },
    onStateChange: (...args) => current.push(args) });
  assert.equal(pane.scrollTop, 41); assert.equal(button(root, 'Source').getAttribute('aria-pressed'), 'true');
  await h.view.unmount();
  assert.deepEqual(current.at(-1), [{ displayMode: 'source', wrapLines: false, scrollTop: 41, scrollLeft: 9 }, false]);
  assert.equal(old.length, before);
});

for (const language of ['markdown', 'html']) test(`Strict delayed ${language} Preview defaults only once; explicit Source remains current`, async t => {
  const reports = [];
  const h = await open(t, { filePath: `/root/guide.${language === 'html' ? 'html' : 'md'}`, watchEnabled: true,
    onStateChange: state => reports.push(state.displayMode) });
  assert.equal(reader(h.view).textContent, 'Loading...');
  await h.initial[1].deliver(read(language === 'html' ? '<b>saved</b>' : '# saved', denied, language));
  await h.initial[0].deliver(read('obsolete'));
  assert.equal(button(reader(h.view), 'Preview').getAttribute('aria-pressed'), 'true');
  assert.equal(reports.filter(mode => mode === 'preview').length, 1);
  await click(h.view, button(reader(h.view), 'Source'));
  const refresh = expectRead(h.runtime, h.props);
  await h.runtime.liveSources[0].connected(); await refresh.deliver(read('updated', denied, language));
  assert.equal(button(reader(h.view), 'Source').getAttribute('aria-pressed'), 'true');
  assert.equal(reports.filter(mode => mode === 'preview').length, 1);
});

test('pending source command joins contiguous chunks once, waits for visibility, handles EOF and does not replay on reactivation', async t => {
  const reports = [];
  const h = await open(t, { initialLineTarget: { line: 4 }, navigationId: 1, onStateChange: (...args) => reports.push(args) });
  const chunk = expectRead(h.runtime, h.props, 8);
  await h.initial[1].deliver({ ...read('one\ntwo\n'), truncated: true, nextOffset: 8, size: 24 });
  await h.initial[0].deliver(read('obsolete'));
  await chunk.headers();
  const pane = reader(h.view).querySelector('.file-viewer-content');
  const count = h.runtime.requests.length;
  await h.render({ ...h.props, navigationId: 2, initialLineTarget: { line: 5 } });
  assert.equal(h.runtime.requests.length, count, 'held offset has one admission');
  await chunk.deliver(read('three\nfour\nfive'));
  assert.equal(reader(h.view).querySelectorAll('.file-source-line').length, 5);
  assert.equal(reader(h.view).querySelector('[data-file-line-target]') === null, true, 'hidden viewport retains the command');
  viewport(pane); await h.runtime.notifyResize(pane);
  assert.equal(reader(h.view).querySelector('[data-file-line-target]')?.getAttribute('data-line-number'), '5');
  pane.scrollTop = 77;
  viewport(pane, 0, 0); await h.runtime.notifyResize(pane);
  viewport(pane); await h.runtime.notifyResize(pane);
  assert.equal(pane.scrollTop, 77, 'handled target does not replay when shown');
  await h.render({ ...h.props, navigationId: 3, initialLineTarget: { line: 99 } });
  assert.equal(reader(h.view).querySelector('[data-file-line-target]') === null, true, 'EOF clears prior highlight');
  assert.match(reader(h.view).textContent, /99/);
  assert.equal(h.runtime.requests.length, count);
  await h.view.unmount();
  assert.equal(reports.at(-1)[1], true, 'EOF is a handled command, not a permanent pending target');
});

test('markdown table tokens stay inline despite Tailwind table utility (genuine SSR/CSS retain)', async t => {
  const runtime = filesRuntime();
  t.after(() => runtime.dispose());
  const { default: reactSyntaxHighlighter } = await import('react-syntax-highlighter');
  const { Prism: SyntaxHighlighter } = reactSyntaxHighlighter;
  const html = renderToStaticMarkup(React.createElement(SyntaxHighlighter, { language: 'markdown' }, '| Name | Desc |\n| --- | --- |\n| A | first |'));
  assert.match(html, /class="token table[ "]/);
  const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /span\.token\.table\s*\{[^}]*display:\s*inline;/);
});
