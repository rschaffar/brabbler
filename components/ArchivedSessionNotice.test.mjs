import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { exact, click, button } from './navigation-runtime.fixture.mjs';
import { shellHarness, session } from './navigation-cases.fixture.mjs';

test('default archive binding reaches the real restore control and updates catalogue/selection without closing/remounting chat', async t => {
  const h = await shellHarness(t, { route(request) {
    exact(request, '/api/sessions/root', {}, { method: 'PATCH', body: { archived: false }, headers: { 'Content-Type': 'application/json' } }); return {};
  } });
  await h.select(session('root', '/repo', { archived: true }));
  await h.command(c => c.navigation.handleSessionsChange([session('root', '/repo', { archived: true })]));
  const key = h.current.state.sessionKey, refresh = h.current.state.refreshKey;
  await click(h.view, button(h.view, 'Restore session')); await h.settled();
  assert.equal(h.current.state.selectedSession.id, 'root'); assert.equal(h.current.state.selectedSession.archived, false);
  assert.equal(h.current.state.sessionCatalog[0].archived, false); assert.equal(h.current.state.sessionKey, key);
  assert.equal(h.current.state.refreshKey, refresh + 1);
  assert.equal([...h.view.container.querySelectorAll('button')].some(node => node.textContent.trim() === 'Restore session'), false);
});

test('narrow default-composition guard only: shell archive binding is spread into real ChatWindow, which forwards to the real notice', async () => {
  // Full ChatWindow/SSE/AppShell composition remains the unchanged installed
  // archive + mobile-sidebar browser chains. This guard claims wiring only,
  // not callback/effect semantics (owned above and by the existing leaf mount).
  const parse = async name => ts.createSourceFile(name, await readFile(new URL(name, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements = (source, name) => { const found = []; const visit = node => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === name) found.push(node);
    ts.forEachChild(node, visit);
  }; visit(source); return found; };
  const shell = await parse('./AppShell.tsx'), chat = await parse('./ChatWindow.tsx');
  const window = elements(shell, 'ChatWindow'); assert.equal(window.length, 1);
  assert.equal(window[0].attributes.properties.some(prop => ts.isJsxSpreadAttribute(prop) && ts.isCallExpression(prop.expression) && prop.expression.expression.getText(shell) === 'sessionNavigationArchiveBinding'), true);
  const notices = elements(chat, 'ArchivedSessionNotice'); assert.equal(notices.length, 1);
  const attrs = new Map(notices[0].attributes.properties.filter(ts.isJsxAttribute).map(prop => [prop.name.getText(chat), prop.initializer?.getText(chat)]));
  assert.equal(attrs.get('rootSessionId'), '{archivedRootSessionId}');
  assert.equal(attrs.get('busy'), '{sessionBusy || isCompacting || archiveActionBusy}');
  assert.equal(attrs.get('onRestored'), '{onSessionRestored}');
});
