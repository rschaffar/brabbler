import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { markdownDom, byText, assertMediaRelease } from './markdown-dom.fixture.mjs';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
async function production() {
  const { MarkdownMedia, MarkdownMediaScope } = await jiti.import('./MarkdownMedia.tsx');
  const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
  return { MarkdownMedia, MarkdownMediaScope, I18nProvider };
}
const url = href => new URL(href, 'https://fixture.invalid/');

for (const type of ['audio', 'video']) {
  test(`mounted ${type} activation, Strict Effects, error and explicit reload keep the real DOM owner`, async t => {
    const f = markdownDom(t, { media: true });
    const { MarkdownMedia, MarkdownMediaScope, I18nProvider } = await production();
    const oldOpens = [], opens = [];
    let props = { filePath: `/outside/take.${type === 'audio' ? 'wav' : 'webm'}`, type, label: 'Recording', sessionId: 'origin',
      onOpenFile: (...args) => oldOpens.push(args) };
    const element = () => createElement(I18nProvider, null,
      createElement(MarkdownMediaScope, { active: true }, createElement(MarkdownMedia, props)));
    const view = await f.mount(element());
    const button = text => byText(view.container, 'button', text);
    const player = () => view.container.querySelector(type);
    assert.equal(player(), null);
    assert.equal(view.container.querySelector('[src]'), null);
    assert.deepEqual(f.mediaCalls, []);
    const download = view.container.querySelector('a[download]');
    assert.ok(download);
    assert.equal(url(download.href).pathname, `/api/files/outside/take.${type === 'audio' ? 'wav' : 'webm'}`);
    assert.deepEqual([...url(download.href).searchParams], [['type', 'download'], ['sessionId', 'origin']]);
    await f.click(button(`Load ${type}: Recording`));
    const node = player();
    assert.ok(node instanceof view.window.HTMLMediaElement);
    const src = node.getAttribute('src');
    const source = url(src);
    assert.equal(source.pathname, url(download.href).pathname);
    assert.equal(source.searchParams.get('type'), 'read');
    assert.equal(source.searchParams.get('sessionId'), 'origin');
    assert.match(source.searchParams.get('v'), /^\d+-\d+$/);
    assert.equal(node.controls, true);
    assert.equal(node.getAttribute('aria-label'), props.label);
    assert.equal(node.getAttribute('preload'), 'metadata');
    assert.equal(node.hasAttribute('autoplay'), false);
    if (type === 'video') assert.equal(node.playsInline, true);
    // Newly mounted LoadedMedia gets real Strict Effects cleanup/setup on the
    // same node. The second setup must restore the src removed by cleanup.
    assert.deepEqual(f.mediaCalls.filter(call => call.element === node).map(({ method, src: value }) => [method, value]), [
      ['pause', src], ['load', null],
    ]);
    assert.equal(node.getAttribute('src'), src, 'Strict replay restored source on the existing node');
    const afterReplay = f.mediaCalls.length;
    await view.rerender(element());
    assert.equal(player(), node);
    assert.equal(node.getAttribute('src'), src);
    assert.equal(f.mediaCalls.length, afterReplay);
    await f.click(button('Open in Files'));
    assert.deepEqual(oldOpens, [[props.filePath]]);
    props = { ...props, onOpenFile: (...args) => opens.push(args) };
    await view.rerender(element());
    await f.click(button('Open in Files'));
    assert.deepEqual(opens, [[props.filePath]]);
    assert.deepEqual(oldOpens, [[props.filePath]]);
    assert.equal(player(), node, 'callback-only rerender retains activation');

    await view.dispatch(node, new view.window.Event('error'));
    assert.match(view.container.querySelector('[role="status"]').textContent, /Unable to play/);
    assert.equal(player(), node);
    assert.equal(node.getAttribute('src'), src);
    assert.equal(f.mediaCalls.length, afterReplay, 'error feedback does not reload or retry');
    await view.rerender(element());
    assert.equal(player(), node);
    assert.equal(node.getAttribute('src'), src);
    assert.equal(f.mediaCalls.length, afterReplay);
    assert.match(view.container.querySelector('[role="status"]').textContent, /Unable to play/, 'same-props rerender retains error feedback');
    assert.ok(view.container.querySelector('a[download]'), 'error retains download recovery');

    const unloadStart = f.mediaCalls.length;
    await f.click(button('Unload player'));
    assert.equal(player(), null);
    assert.equal(node.isConnected, false);
    assertMediaRelease(f.mediaCalls.slice(unloadStart), node, src);
    assert.equal(view.container.querySelector('[role="status"]'), null);
    await f.click(button(`Load ${type}: Recording`));
    const reloaded = player(), nextSrc = reloaded.getAttribute('src');
    assert.notEqual(reloaded, node);
    assert.notEqual(nextSrc, src, 'each explicit activation gets a fresh token without relying on elapsed time');
    assert.equal(url(nextSrc).searchParams.get('sessionId'), 'origin');
    assert.equal(view.container.querySelector('[role="status"]'), null);
    const unmountStart = f.mediaCalls.length;
    await view.unmount();
    assertMediaRelease(f.mediaCalls.slice(unmountStart), reloaded, nextSrc);
    assert.equal(reloaded.isConnected, false);
    assert.equal(view.container.childNodes.length, 0);
    assert.equal(f.visibilityListeners.size, 0);
    assert.deepEqual(f.requests, []);
  });
}

test('source and session changes independently reset the mounted activation owner and scoped URLs', async t => {
  const f = markdownDom(t, { media: true });
  const { MarkdownMedia, MarkdownMediaScope, I18nProvider } = await production();
  let props = { filePath: '/outside/first.wav', type: 'audio', label: 'Recording', sessionId: 'origin' };
  const element = () => createElement(I18nProvider, null,
    createElement(MarkdownMediaScope, { active: true }, createElement(MarkdownMedia, props)));
  const view = await f.mount(element());
  const activate = async () => {
    await f.click(byText(view.container, 'button', 'Load audio: Recording'));
    return view.container.querySelector('audio');
  };
  const first = await activate(), firstSrc = first.getAttribute('src');
  const changePath = f.mediaCalls.length;
  props = { ...props, filePath: '/outside/second.wav' };
  await view.rerender(element());
  assert.equal(view.container.querySelector('audio'), null);
  assertMediaRelease(f.mediaCalls.slice(changePath), first, firstSrc);
  const second = await activate(), secondSrc = second.getAttribute('src');
  assert.equal(url(secondSrc).pathname, '/api/files/outside/second.wav');
  assert.equal(url(secondSrc).searchParams.get('sessionId'), 'origin');
  const changeSession = f.mediaCalls.length;
  props = { ...props, sessionId: 'other-session' };
  await view.rerender(element());
  assert.equal(view.container.querySelector('audio'), null);
  assertMediaRelease(f.mediaCalls.slice(changeSession), second, secondSrc);
  assert.equal(url(view.container.querySelector('a[download]').href).searchParams.get('sessionId'), 'other-session');
  const third = await activate(), thirdSrc = third.getAttribute('src');
  assert.equal(url(thirdSrc).pathname, '/api/files/outside/second.wav');
  assert.equal(url(thirdSrc).searchParams.get('sessionId'), 'other-session');
  assert.notEqual(third, second);
  const unmountStart = f.mediaCalls.length;
  await view.unmount();
  assertMediaRelease(f.mediaCalls.slice(unmountStart), third, thirdSrc);
  assert.deepEqual(f.requests, []);
});

for (const type of ['audio', 'video']) {
  test(`real media scope combines ${type} coverage and document visibility without automatic resumption`, async t => {
    const f = markdownDom(t, { media: true, initiallyHidden: true });
    const { MarkdownMedia, MarkdownMediaScope, I18nProvider } = await production();
    let active = true;
    const props = { filePath: `/outside/take.${type === 'audio' ? 'wav' : 'webm'}`, type, label: 'Recording', sessionId: 'origin' };
    const element = () => createElement(I18nProvider, null,
      createElement(MarkdownMediaScope, { active }, createElement(MarkdownMedia, props)));
    const view = await f.mount(element());
    const player = () => view.container.querySelector(type);
    const assertCovered = () => {
      // Boolean diagnostics avoid recursively formatting a React-owned DOM/fiber
      // tree when a deliberate defect wrongly leaves a player/control mounted.
      assert.equal(Boolean(player()), false, 'covered media has no player');
      assert.equal(Boolean(view.container.querySelector('.markdown-media-load')), false, 'covered media has no activation control');
      assert.equal(view.container.textContent, 'Recording');
    };
    const assertUnloaded = () => {
      assert.equal(Boolean(player()), false, 'uncovered media remains unloaded');
      assert.ok(byText(view.container, 'button', `Load ${type}: Recording`));
    };
    const activate = async () => {
      await f.click(byText(view.container, 'button', `Load ${type}: Recording`));
      return player();
    };
    assertCovered();
    assert.equal(f.visibilityAdds, 2, 'Strict Effects replayed the real scope setup');
    assert.equal(f.visibilityRemoves, 1);
    assert.equal(f.visibilityListeners.size, 1);
    await f.setHidden(false);
    assertUnloaded();
    const first = await activate(), firstSrc = first.getAttribute('src');
    const hideStart = f.mediaCalls.length;
    await f.setHidden(true);
    assertCovered();
    assertMediaRelease(f.mediaCalls.slice(hideStart), first, firstSrc);
    active = false;
    await view.rerender(element());
    await f.setHidden(false);
    assertCovered(); // Visibility alone cannot override a covered chat.
    active = true;
    await view.rerender(element());
    assertUnloaded(); // Neither uncovering nor visibility replay activation.
    const second = await activate(), secondSrc = second.getAttribute('src');
    assert.notEqual(secondSrc, firstSrc);
    const coverStart = f.mediaCalls.length;
    active = false;
    await view.rerender(element());
    assertCovered();
    assertMediaRelease(f.mediaCalls.slice(coverStart), second, secondSrc);
    active = true;
    await view.rerender(element());
    assertUnloaded();
    const last = await activate(), lastSrc = last.getAttribute('src');
    const unmountStart = f.mediaCalls.length;
    await view.unmount();
    assertMediaRelease(f.mediaCalls.slice(unmountStart), last, lastSrc);
    assert.equal(last.isConnected, false);
    assert.equal(f.visibilityListeners.size, 0);
    assert.equal(f.visibilityAdds, f.visibilityRemoves);
    const afterUnmount = f.mediaCalls.length;
    await f.setHidden(true);
    await f.setHidden(false);
    assert.equal(f.mediaCalls.length, afterUnmount);
    assert.equal(view.container.childNodes.length, 0);
    assert.deepEqual(f.requests, []);
  });
}
