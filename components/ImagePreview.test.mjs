import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { act, createElement } from 'react';
import { createJiti } from 'jiti';
import { filesRuntime } from './files-runtime.fixture.mjs';

// Genuine default-composition retain: ImagePreview alone is not ChatInput's
// attachment/remove wiring. No mounted-child claim for this source guard.
test('composer attachments compose the shared preview with a separate remove action', async () => {
  const input = await readFile(new URL('./ChatInput.tsx', import.meta.url), 'utf8');
  assert.match(input, /import \{ ImagePreview \} from "\.\/ImagePreview"/);
  assert.match(input, /<ImagePreview key=\{img\.previewUrl\} src=\{img\.previewUrl\}>[\s\S]*?<img[\s\S]*?src=\{img\.previewUrl\}[\s\S]*?<\/ImagePreview>\s*<button\s*type="button"\s*onClick=\{\(\) => removeImage\(i\)\}/);
});

async function preview(t) {
  const runtime = filesRuntime({ dialog: true });
  let view;
  t.after(() => runtime.dispose(() => view?.unmount(), () => view?.dispose()));
  const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
  const { ImagePreview } = await jiti.import('./ImagePreview.tsx');
  const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
  const element = (src = '/one.png', alt = '  picture  ') => createElement(I18nProvider, null,
    createElement(ImagePreview, { src, alt }, createElement('span', null, 'attachment')));
  view = await runtime.mount(t, element(), { beforeDispose: runtime.settle, setup(window) { runtime.setup(window); window.document.body.style.overflow = 'scroll'; } });
  const trigger = view.container.querySelector('[aria-haspopup="dialog"]');
  const click = node => view.dispatch(node, new view.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return { view, runtime, trigger, click,
    async open() { await act(async () => { trigger.focus(); }); await click(trigger); return view.container.querySelector('dialog'); },
    render: (src, alt) => view.rerender(element(src, alt)),
  };
}

test('actual image dialog has current contents, local DOM ownership, modal focus and failure-safe overflow cleanup', async t => {
  const h = await preview(t), { view, trigger } = h;
  assert.equal(trigger.getAttribute('aria-label'), 'Preview image:   picture  ', 'nonblank alt preserves its original whitespace');
  await h.render('/one.png', ' \t ');
  assert.equal(trigger.getAttribute('aria-label'), 'Preview image', 'blank alt does not add an empty suffix');
  await h.render('/one.png', '  picture  ');
  assert.equal(view.container.querySelector('dialog') === null, true);
  const dialog = await h.open();
  assert.equal(dialog.open, true);
  assert.equal(dialog.parentElement === trigger.parentElement, true, 'dialog remains in owning composition, not a portal');
  const close = dialog.querySelector('button');
  assert.equal(view.window.document.activeElement === close, true);
  assert.equal(view.window.document.body.style.overflow, 'hidden');
  assert.equal(dialog.querySelector('img').getAttribute('src'), '/one.png');
  await h.render('/two.png', 'new');
  assert.equal(view.container.querySelector('dialog') === dialog, true);
  assert.equal(dialog.querySelector('img').getAttribute('src'), '/two.png');
  assert.equal(dialog.querySelector('img').alt, 'new');
  await h.click(close);
  assert.equal(view.container.querySelector('dialog') === null, true);
  assert.equal(view.window.document.activeElement === trigger, true);
  assert.equal(view.window.document.body.style.overflow, 'scroll');
  await h.open(); await view.unmount();
  assert.equal(view.window.document.body.style.overflow, 'scroll');
  assert.equal(h.runtime.requests.length, 0, 'no transport authority is conferred by preview');
});

for (const eventType of ['keydown', 'cancel']) test(`actual ${eventType} consumes dismissal before global shortcuts`, async t => {
  const h = await preview(t), dialog = await h.open();
  let propagated = 0;
  const listener = () => { propagated++; };
  const document = h.view.window.document;
  document.addEventListener(eventType, listener);
  // Central disposal may already have closed window.document; retain the owner.
  t.after(() => document.removeEventListener(eventType, listener));
  const event = eventType === 'keydown'
    ? new h.view.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    : new h.view.window.Event('cancel', { bubbles: true, cancelable: true });
  await h.view.dispatch(dialog, event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(propagated, 0);
  assert.equal(h.view.container.querySelector('dialog') === null, true);
  assert.equal(h.view.window.document.activeElement === h.trigger, true);
});

test('only an actual backdrop click dismisses; image and ordinary keys preserve preview', async t => {
  const h = await preview(t), dialog = await h.open();
  await h.click(dialog.querySelector('img'));
  await h.view.dispatch(dialog, new h.view.window.KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
  assert.equal(h.view.container.querySelector('dialog') === dialog, true);
  assert.equal(dialog.open, true);
  await h.click(dialog);
  assert.equal(h.view.container.querySelector('dialog') === null, true);
  assert.equal(h.trigger.getAttribute('aria-expanded'), 'false');
});

test('a disconnected preview trigger is never focused during close or container unmount', async t => {
  const h = await preview(t), dialog = await h.open();
  const originalFocus = h.trigger.focus;
  let focusCalls = 0;
  h.runtime.replaceCapability(h.trigger, 'focus', function (...args) {
    focusCalls++; return originalFocus.apply(this, args);
  });
  // Detach the entire root container, never a React-owned child. React still
  // owns and can safely unmount its intact tree inside this container.
  h.view.container.remove();
  assert.equal(h.trigger.isConnected, false);
  await h.click(dialog.querySelector('button'));
  assert.equal(focusCalls, 0, 'cleanup must not even attempt focus on a disconnected trigger');
  await h.view.unmount();
  assert.equal(h.view.container.childNodes.length, 0);
  assert.equal(focusCalls, 0);
});

test('mobile safe-area declarations and Pi close glyph (genuine CSS/glyph retain)', async () => {
  const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.image-preview-dialog \{[\s\S]*?env\(safe-area-inset-top\)[\s\S]*?env\(safe-area-inset-right\)[\s\S]*?env\(safe-area-inset-bottom\)[\s\S]*?env\(safe-area-inset-left\)/);
  assert.match(css, /\.image-preview-close \{[\s\S]*?top: max\(12px, env\(safe-area-inset-top\)\)[\s\S]*?right: max\(12px, env\(safe-area-inset-right\)\)[\s\S]*?border-radius: 6px[\s\S]*?background: var\(--bg-panel\)/);
  assert.match(css, /@media \(pointer: coarse\) \{[\s\S]*?\.image-preview-close \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  const source = await readFile(new URL('./ImagePreview.tsx', import.meta.url), 'utf8');
  assert.match(source, /<path d="M6 6l12 12M18 6 6 18" \/>/);
});
