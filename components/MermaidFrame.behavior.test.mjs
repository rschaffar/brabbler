import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { markdownDom } from './markdown-dom.fixture.mjs';
const jiti = createJiti(import.meta.url, { fsCache: false });

// Actual transport + real DOM frame removal; external MessageChannel only.
// jsdom executes no child scripts/layout. Installed Chromium proves that a real
// evaluated Mermaid realm is destroyed, including after many unique diagrams.
for (const outcome of ['success', 'error', 'cancel', 'revoked']) test(`default diagram frame releases DOM/ports on ${outcome}`, async t => {
  let f, handle;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'MessageChannel');
  t.after(async () => {
    handle?.cancel();
    await Promise.allSettled(handle ? [handle.promise] : []);
    await f?.dispose();
    if (original) Object.defineProperty(globalThis, 'MessageChannel', original); else delete globalThis.MessageChannel;
  });
  f = markdownDom(t);
  const view = await f.mount(createElement('div'));
  const channels = [];
  class Port {
    onmessage = null;
    sent = [];
    closed = false;
    postMessage(value) { this.sent.push(value); }
    close() { this.closed = true; }
  }
  class Channel { constructor() { this.port1 = new Port(); this.port2 = new Port(); channels.push(this); } }
  Object.defineProperty(globalThis, 'MessageChannel', { configurable: true, writable: true, value: Channel });
  const { startMermaidFrame } = await jiti.import('../lib/mermaid-render-client.ts');
  let permitted = true;
  const input = { code: 'flowchart TD\nPrivateLabel --> Result', dark: true, allowImages: false, isAllowed: () => permitted };
  handle = startMermaidFrame(input);
  const result = outcome === 'success' ? handle.promise : assert.rejects(handle.promise);
  const frame = view.window.document.querySelector('iframe[data-mermaid-renderer]');
  assert.equal(Boolean(frame), true);
  assert.equal(frame.srcdoc.includes('PrivateLabel'), false, 'diagram text is never interpolated into executable HTML');
  assert.equal(frame.srcdoc.includes("img-src 'none'"), true);
  const channel = channels[0];
  const receive = channel.port1.onmessage;
  let sent;
  Object.defineProperty(frame.contentWindow, 'postMessage', { configurable: true, value(...args) { sent = args; } });
  frame.onload();
  assert.equal(sent[0].code, input.code);
  assert.equal(sent[1], view.window.location.origin);
  assert.equal(sent[2][0] === channel.port2, true, 'only the dedicated capability is transferred');
  if (outcome === 'revoked') permitted = false;
  if (outcome === 'cancel') handle.cancel();
  else if (outcome === 'error') receive({ data: { type: 'error' } });
  else {
    receive({ data: { type: 'parsed' } });
    if (outcome === 'success') {
      assert.deepEqual(channel.port1.sent, [{ type: 'render' }]);
      receive({ data: { type: 'result', svg: '<svg/>' } });
    }
  }
  if (outcome === 'success') assert.equal(await result, '<svg/>'); else await result;
  assert.equal(view.window.document.querySelector('iframe[data-mermaid-renderer]') === null, true, 'terminal promise settles only after frame removal');
  assert.equal(frame.isConnected, false);
  assert.equal(channel.port1.closed && channel.port2.closed, true);
  assert.equal(channel.port1.onmessage, null);
  assert.equal(frame.onload, null);
  assert.equal(frame.onerror, null);
  assert.equal(input.code, '', 'transport drops the complete source after disposal');
  handle.cancel();
  receive({ data: { type: 'result', svg: '<svg>late</svg>' } });
  assert.equal(view.window.document.querySelectorAll('iframe[data-mermaid-renderer]').length, 0);
});
