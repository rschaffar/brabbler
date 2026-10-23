import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { dom } from './testing/dom.fixture.mjs';

const jiti = createJiti(import.meta.url, { fsCache: false });
const { findRenderedLineTarget, navigateToFileLine } = await jiti.import('./file-line-navigation.ts');

function geometry(element, { top, height }) {
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height });
  element.getBoundingClientRect = () => ({ top, bottom: top + height, height,
    left: 0, right: 100, width: 100, x: 0, y: top, toJSON() { return {}; } });
}

test('rendered selection prefers the smallest actual containing block and stays in its root', t => {
  const { document } = dom(t, `<div id="other" data-source-line-start="8" data-source-line-end="8"></div>
    <main id="file"><section id="outer" data-source-line-start="1" data-source-line-end="30">
      <p id="paragraph" data-source-line-start="7" data-source-line-end="12">
        <span id="small" data-source-line-start="8" data-source-line-end="9"></span>
      </p></section></main>`);
  assert.equal(findRenderedLineTarget(document.querySelector('#file'), 8), document.querySelector('#small'));
  assert.equal(findRenderedLineTarget(document.querySelector('#file'), 15), document.querySelector('#outer'));
});

test('blank lines use distance then span, with stable DOM order for equal candidates', t => {
  const { document } = dom(t, `<main id="file">
    <p id="first" data-source-line-start="7" data-source-line-end="8"></p>
    <p id="second" data-source-line-start="12" data-source-line-end="15"></p>
    <p id="equal" data-source-line-start="7" data-source-line-end="8"></p>
  </main>`);
  const root = document.querySelector('#file');
  assert.equal(findRenderedLineTarget(root, 10), document.querySelector('#first'));
  assert.equal(findRenderedLineTarget(root, 14), document.querySelector('#second'));
  assert.equal(findRenderedLineTarget(root, 100), document.querySelector('#second'));
});

test('source navigation highlights the exact range and adjusts only the actual file pane', t => {
  const { document, window } = dom(t, `<article id="chat"><p data-line-number="2" data-file-line-target="outside"></p>
    <main id="file">${[1, 2, 3, 4, 5].map(line => `<div data-line-number="${line}"${line === 1 ? ' data-file-line-target="old"' : ''}>line ${line}</div>`).join('')}</main>
  </article>`);
  const root = document.querySelector('#file'), chat = document.querySelector('#chat');
  geometry(root, { top: 100, height: 400 });
  geometry(root.querySelector('[data-line-number="2"]'), { top: 200, height: 20 });
  root.scrollTop = 40; chat.scrollTop = 70;
  window.scrollTo = () => assert.fail('must not scroll the page');
  chat.scrollIntoView = () => assert.fail('must not scroll the chat');
  root.querySelector('[data-line-number="2"]').scrollIntoView = () => assert.fail('must use the file pane, not ancestor scrolling');
  assert.equal(navigateToFileLine(root, { line: 2, endLine: 4 }, false), true);
  assert.deepEqual([...root.querySelectorAll('[data-file-line-target]')].map(node => Number(node.dataset.lineNumber)), [2, 3, 4]);
  assert.equal(root.scrollTop, 60, 'numeric geometry double proves pane assignment, not native layout');
  assert.equal(chat.scrollTop, 70);
  assert.equal(chat.firstElementChild.getAttribute('data-file-line-target'), 'outside');
});

test('rendered navigation replaces the old highlight and selects one smallest block', t => {
  const { document } = dom(t, `<main id="file"><p data-file-line-target="old"></p>
    <section data-source-line-start="1" data-source-line-end="30">
      <p id="target" data-source-line-start="7" data-source-line-end="9"></p>
    </section></main>`);
  const root = document.querySelector('#file'), target = document.querySelector('#target');
  geometry(root, { top: 30, height: 120 }); geometry(target, { top: 130, height: 20 });
  root.scrollTop = 20;
  assert.equal(navigateToFileLine(root, { line: 8, endLine: 20 }, true), true);
  assert.deepEqual([...root.querySelectorAll('[data-file-line-target]')], [target]);
  assert.equal(root.scrollTop, 90, 'short pane uses quarter-height padding');
});

test('missing targets clear prior highlights without scrolling or escaping the reader', t => {
  const { document } = dom(t, '<p data-line-number="99"></p><main id="file"><p data-file-line-target="old" data-line-number="1"></p></main>');
  const root = document.querySelector('#file'); root.scrollTop = 17;
  root.getBoundingClientRect = () => assert.fail('missing target must not inspect geometry');
  assert.equal(navigateToFileLine(root, { line: 99 }, false), false);
  assert.equal(root.querySelector('[data-file-line-target]'), null);
  assert.equal(root.scrollTop, 17);
  assert.equal(findRenderedLineTarget(root, 1), undefined);
  assert.equal(navigateToFileLine(root, { line: 1 }, true), false);
});
