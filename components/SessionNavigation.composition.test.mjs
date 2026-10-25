import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Deliberately bounded architecture/default-connection guard. Mounted owners
// execute the real hooks/controls/Sidebar; unchanged installed browser chains
// retain whole-shell router, keyboard, responsive/scroll and native transport.
// No callback bodies or effects are extracted/evaluated here.
test('AppShell uses the mounted navigation coordinator, default Sidebar and real controls without an alternate navigation implementation', async () => {
  const source = await readFile(new URL('./AppShell.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('AppShell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements = new Map(), calls = [], declarations = new Map();
  const visit = node => {
    if (ts.isCallExpression(node)) calls.push(node.expression.getText(ast));
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declarations.set(node.name.text, node);
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(ast); const list = elements.get(name) ?? []; list.push(node); elements.set(name, list);
    }
    ts.forEachChild(node, visit);
  }; visit(ast);
  for (const hook of ['useNavigationState', 'useSessionNavigation', 'useSessionAutoName']) assert.equal(calls.includes(hook), true, hook);
  assert.equal(elements.get('SessionNavigationSidebar')?.length, 1);
  const attrs = node => new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(prop => [prop.name.getText(ast), prop.initializer?.getText(ast)]));
  const sidebar = attrs(elements.get('SessionNavigationSidebar')[0]);
  assert.equal(sidebar.get('state'), '{navigationState}'); assert.equal(sidebar.get('navigation'), '{navigation}');
  assert.equal(elements.has('SessionSidebar'), false, 'no parallel default Sidebar connection');
  for (const name of ['SessionAutoNameButton', 'OverviewNavigationButtons']) assert.ok(elements.has(name), name);
  const chat = attrs(elements.get('ChatWindow')[0]);
  assert.equal(elements.get('ChatWindow')[0].attributes.properties.some(prop => ts.isJsxSpreadAttribute(prop) && prop.expression.getText(ast) === 'chatBinding'), true);
  assert.equal(calls.includes('useSessionNavigationChatBinding'), true);
  assert.equal(chat.get('onAgentEnd'), '{handleAgentEnd}');
  // The same-fiber notification adapter now owns the callback declaration.
  // Guard both actual edges, rather than accepting an unrelated hook call.
  const adapters = [];
  const findAdapter = node => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)
      && node.initializer && ts.isCallExpression(node.initializer)
      && node.initializer.expression.getText(ast) === 'useShellNotifications') adapters.push(node);
    ts.forEachChild(node, findAdapter);
  }; findAdapter(ast);
  assert.equal(adapters.length, 1, 'one default notification adapter');
  const adapter = adapters[0];
  assert.equal(adapter.name.elements.some(item => item.name.getText(ast) === 'handleAgentEnd'
    && (!item.propertyName || item.propertyName.getText(ast) === 'handleAgentEnd')), true);
  const input = adapter.initializer.arguments[0];
  assert.equal(ts.isObjectLiteralExpression(input), true);
  assert.equal(input.properties.some(item => ts.isShorthandPropertyAssignment(item)
    && item.name.text === 'handleSessionSettled'), true, 'pass the actual settled-session owner');
  const notificationSource = await readFile(new URL('./useShellNotifications.ts', import.meta.url), 'utf8');
  const notificationAst = ts.createSourceFile('useShellNotifications.ts', notificationSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hook = notificationAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useShellNotifications');
  assert.ok(hook?.body, 'actual notification hook declaration');
  const callbacks = [];
  const findCallback = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'handleAgentEnd') callbacks.push(node);
    ts.forEachChild(node, findCallback);
  }; findCallback(hook.body);
  assert.equal(callbacks.length, 1);
  const settledCalls = [];
  const scan = node => { if (ts.isCallExpression(node)) settledCalls.push(node.expression.getText(notificationAst)); ts.forEachChild(node, scan); };
  scan(callbacks[0]);
  assert.equal(settledCalls.filter(name => name === 'handleSessionSettled').length, 1, 'adapter calls the actual settled-session owner once');
  const returned = hook.body.statements.findLast(ts.isReturnStatement)?.expression;
  assert.equal(Boolean(returned && ts.isObjectLiteralExpression(returned)
    && returned.properties.some(item => ts.isShorthandPropertyAssignment(item) && item.name.text === 'handleAgentEnd')), true, 'default shell receives that owned callback');
});

// Behavioral helper ownership, separate from the architecture case above. No
// Panel props, copied badge rule, whole-AppShell fixture or SDK startup is used.
test('actual Agents family producer uses only current running descendants, otherwise the deduplicated full family', async () => {
  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url, { fsCache: false });
  const { getSessionFamily, getAgentsBadge } = await jiti.import('../lib/session-family.ts');
  // Only fields consumed by the actual family helper; these are policy rows,
  // never native session identities or a promise of persisted status authority.
  const root = { id: 'root', modified: '2026-01-01' };
  const a = { id: 'child-a', modified: '2026-01-02', relation: { kind: 'subagent', parentSessionId: 'root' } };
  const b = { id: 'child-b', modified: '2026-01-03', relation: { kind: 'subagent', parentSessionId: 'child-a' } };
  const c = { id: 'child-c', modified: '2026-01-04', relation: { kind: 'subagent', parentSessionId: 'root' } };
  const rows = [root, a, b, c,
    { id: 'other-root', modified: '2026-01-05' },
    { id: 'foreign', modified: '2026-01-06', relation: { kind: 'subagent', parentSessionId: 'other-root' } },
    { id: 'fork', modified: '2026-01-07', parentSession: '/saved/root.jsonl' }];
  for (const selected of ['root', 'child-a', 'child-b', 'child-c']) {
    const family = getSessionFamily(rows, selected);
    assert.equal(family?.root.id, 'root', 'selected descendant keeps its actual root family');
    assert.equal(family.subagents.map(row => row.id).sort().join(','), 'child-a,child-b,child-c');
    for (const [phase, ids, running, count] of [
      ['root/foreign/queue-only are not running descendants', ['root', 'foreign', 'queue-only'], false, 3],
      ['nested descendant runs', ['root', 'foreign', 'child-b'], true, 1],
      ['two descendants run', ['root', 'child-a', 'child-b', 'foreign'], true, 2],
      ['all descendants idle in the current snapshot', [], false, 3],
      ['running resumes', ['child-c'], true, 1],
    ]) {
      const badge = getAgentsBadge(family.subagents, new Set(ids));
      assert.equal(badge.running, running, `${selected}: ${phase}: running`);
      assert.equal(badge.count, count, `${selected}: ${phase}: count`);
    }
    const duplicate = getAgentsBadge([...family.subagents, a], new Set(['child-a']));
    assert.equal(duplicate.running, true);
    assert.equal(duplicate.count, 1, 'duplicate catalogue identity is not another running subagent');
    const idleDuplicate = getAgentsBadge([...family.subagents, a], new Set());
    assert.equal(idleDuplicate.running, false);
    assert.equal(idleDuplicate.count, 3, 'duplicate catalogue identity is not another idle descendant');
  }
  assert.equal(getAgentsBadge([], new Set(['root'])).count, 0);
  assert.equal(getAgentsBadge([], new Set(['root'])).running, false);
  assert.equal(getSessionFamily(rows, 'foreign')?.root.id, 'other-root');
  assert.equal(getSessionFamily(rows, 'fork')?.subagents.length, 0, 'fork is not a subagent descendant');
});
