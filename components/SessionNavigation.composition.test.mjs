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
