// Architectural/input-dependency guards, not behavior, isolation or native-close evidence.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ROOTS, planFiles } from './test-runner.mjs';

// Deliberately bounded migration owners, including their current helper paths.
// Add future migrated owners/helpers explicitly; do not grandfather new sleeps by hash.
export const MIGRATED_OWNERS = Object.freeze([
  'lib/plugins/project-operations.test.mjs',
  'plugins/git-workflow/cleanup.test.mjs',
  'plugins/git-workflow/discard.test.mjs',
  'plugins/git-workflow/server.test.mjs',
  'plugins/git-workflow/project-management.test.mjs',
  'plugins/git-workflow/commit-gate.test.mjs',
  'plugins/git-workflow/commit-gate.fixture.mjs',
  'plugins/git-workflow/cleanup-access.fixture.mjs',
  'lib/testing/async.fixture.mjs',
  'lib/testing/react.fixture.mjs',
  'lib/testing/ignored-abort-fetch.fixture.mjs',
  'lib/testing/dom.fixture.mjs',
  'lib/activity-client-controller.test.mjs',
  'components/ActivityViews.behavior.test.mjs',
  'components/GitExplorer.stale-delivery.test.mjs',
  'components/SessionMoveDestinationPicker.stale-delivery.test.mjs',
  'hooks/useResizablePanel.test.mjs',
  'lib/file-line-navigation.test.mjs',
  'components/MarkdownBody.behavior.test.mjs',
  'components/MarkdownMedia.behavior.test.mjs',
  'components/markdown-dom.fixture.mjs',
  'components/FileViewer.behavior.test.mjs',
  'components/FileViewer.media-behavior.test.mjs',
  'components/FileWorkspace.behavior.test.mjs',
  'components/files-runtime.fixture.mjs',
  'components/ArchivedSessionNotice.behavior.test.mjs',
  'components/ToolDefinitionsPanel.behavior.test.mjs',
  'components/AgentSessionPanel.behavior.test.mjs',
  'components/SkillsConfig.behavior.test.mjs',
  'hooks/useStreamingSelector.behavior.test.mjs',
  'lib/testing/leaf-controls.fixture.mjs',
  'app/api/files/watch-route.test.mjs',
]);

// Audited behavioral owners, separate from scheduling and legitimate source/SSR
// guards. This catches literal source reads/extraction, not arbitrary dataflow or
// semantic coverage. Review their helpers too; moving a copy does not improve proof.
export const BEHAVIORAL_OWNERS = Object.freeze([
  'lib/activity-client-controller.test.mjs',
  'components/ActivityViews.behavior.test.mjs',
  'components/GitExplorer.stale-delivery.test.mjs',
  'components/SessionMoveDestinationPicker.stale-delivery.test.mjs',
  'hooks/useResizablePanel.test.mjs',
  'lib/file-line-navigation.test.mjs',
  'components/MarkdownBody.behavior.test.mjs',
  'components/MarkdownMedia.behavior.test.mjs',
  'components/FileViewer.behavior.test.mjs',
  'components/FileViewer.media-behavior.test.mjs',
  'components/FileWorkspace.behavior.test.mjs',
  'components/ArchivedSessionNotice.behavior.test.mjs',
  'components/ToolDefinitionsPanel.behavior.test.mjs',
  'components/AgentSessionPanel.behavior.test.mjs',
  'components/SkillsConfig.behavior.test.mjs',
  'hooks/useStreamingSelector.behavior.test.mjs',
  'app/api/files/watch-route.test.mjs',
]);
const code = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const typed = /\.(?:[cm]?ts|tsx)$/;
const support = name => /(?:^|\/)(?:testing|fixtures?|__fixtures__|__tests__)(?:\/|$)|\.(?:test|fixture)(?:\.|$)/.test(name);
const productionRoots = new Set([...ROOTS, 'bin']);
const productionFiles = new Set(['next.config.ts', 'postcss.config.mjs', 'tailwind.config.ts',
  'instrumentation.ts', 'instrumentation-node.ts', 'proxy.ts']);
export const isProductionSource = name => !support(name) &&
  (productionRoots.has(name.split('/')[0]) || productionFiles.has(name));

// JSON.parse alone silently overwrites duplicate hold keys. Keep raw authoring
// validation at the architectural guard boundary; planFiles still takes objects.
export function parseLiveManifest(source) {
  const value = JSON.parse(source);
  const tree = ts.parseJsonText('test-lanes.json', source);
  function walk(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const names = new Set();
      for (const property of node.properties) {
        const name = literal(property.name);
        if (names.has(name)) throw new Error(`Duplicate manifest JSON reference: ${name}`);
        names.add(name);
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(tree);
  return value;
}

export function auditLiveManifest(inventory, manifest) {
  const plan = planFiles(inventory, manifest); // Same validation/selection semantics as execution.
  const missing = plan.filter(file => !file.reviewed && !Object.hasOwn(manifest.holds ?? {}, file.path));
  if (missing.length) throw new Error(`Missing explicit classification or unresolved hold: ${missing.map(file => file.path).join(', ')}`);
  return plan;
}

// Scan source, not generated output/dependencies. In particular do NOT exclude TSX
// fixtures: typing inputs retain those even though *.test.mjs is excluded.
export function discoverDesignSources(root) {
  const sources = new Map();
  const ignored = new Set(['node_modules', '.git', '.next', '.codegraph', '.cache',
    'coverage', 'test-results', 'playwright-report']);
  function walk(relative) {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Design scan refuses symlink: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) {
        if (!ignored.has(name)) walk(relative ? `${relative}/${name}` : name);
      }
    } else if (stat.isFile() && code.test(relative)) sources.set(relative, fs.readFileSync(absolute, 'utf8'));
  }
  walk('');
  return sources;
}

const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
function memberName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) return literal(node.argumentExpression);
  return literal(node);
}
function moduleTarget(from, specifier) {
  const clean = specifier.split(/[?#]/, 1)[0];
  if (clean.startsWith('@/')) return path.posix.normalize(clean.slice(2));
  if (clean.startsWith('.')) return path.posix.normalize(path.posix.join(path.posix.dirname(from), clean));
  return clean; // Also recognizes direct lib/testing imports, without inventing package aliases.
}
function isRegisteredTest(target, tests) {
  return [target, `${target}.mjs`, `${target}/index.test.mjs`].some(name => tests.has(name));
}
function moduleSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return literal(node.moduleSpecifier);
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) return literal(node.moduleReference.expression);
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) return literal(node.argument.literal);
  if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      ['require', 'import'].includes(memberName(node.expression)))) return literal(node.arguments[0]);
}

export function inspectSource(name, source, { registeredTests = [], migratedOwners = MIGRATED_OWNERS,
  behavioralOwners = BEHAVIORAL_OWNERS } = {}) {
  const kind = name.endsWith('.tsx') ? ts.ScriptKind.TSX : name.endsWith('.jsx') ? ts.ScriptKind.JSX
    : typed.test(name) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, kind);
  const tests = new Set(registeredTests);
  const diagnostics = [];
  const report = (node, rule, message) => diagnostics.push({ path: name,
    line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, rule, message });
  const visit = (node, fn) => { fn(node); ts.forEachChild(node, child => visit(child, fn)); };
  for (const error of tree.parseDiagnostics) diagnostics.push({ path: name,
    line: tree.getLineAndCharacterOfPosition(error.start ?? 0).line + 1, rule: 'syntax',
    message: ts.flattenDiagnosticMessageText(error.messageText, '\n') });

  const promisedTimers = new Set();
  const timerNamespaces = new Set();
  const browserSleeps = new Set(['waitForTimeout']);
  const fileReads = new Set(['readFile', 'readFileSync']);
  visit(tree, node => {
    const specifier = moduleSpecifier(node);
    if (specifier !== undefined) {
      const target = moduleTarget(name, specifier);
      if (isProductionSource(name) && (support(target) || ['jsdom', 'node:test'].includes(specifier))) {
        report(node, 'production-test-import', `Production imports test support: ${specifier}`);
      }
      if (typed.test(name) && isRegisteredTest(target, tests)) report(node, 'typing-test-entrypoint', `Typing input imports registered test entrypoint: ${specifier}`);
      if (typed.test(name) && ['nix/test-lanes', 'nix/test-lanes.json'].includes(target)) {
        report(node, 'typing-scheduling-policy', 'Live scheduling metadata belongs to the Node runner, not the TypeScript input graph');
      }
    }
    if (ts.isImportDeclaration(node) && /^(?:node:)?fs(?:\/promises)?$/.test(literal(node.moduleSpecifier) ?? '')) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if (['readFile', 'readFileSync'].includes((item.propertyName ?? item.name).text)) fileReads.add(item.name.text);
      }
    }
    if (ts.isImportDeclaration(node) && /^(?:node:)?timers\/promises$/.test(literal(node.moduleSpecifier) ?? '')) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) timerNamespaces.add(bindings.name.text);
      if (node.importClause?.name) timerNamespaces.add(node.importClause.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if ((item.propertyName ?? item.name).text === 'setTimeout') promisedTimers.add(item.name.text);
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
      for (const item of node.name.elements) {
        if (memberName(item.propertyName ?? item.name) === 'waitForTimeout' && ts.isIdentifier(item.name)) browserSleeps.add(item.name.text);
      }
    }
  });
  const awaited = node => {
    let parent = node.parent;
    while (parent && ts.isParenthesizedExpression(parent)) parent = parent.parent;
    return parent && ts.isAwaitExpression(parent);
  };
  const promisedTimer = node => ts.isIdentifier(node.expression) ? promisedTimers.has(node.expression.text)
    : memberName(node.expression) === 'setTimeout' &&
      (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) &&
      timerNamespaces.has(node.expression.expression.getText(tree));
  // Deliberately not a blanket setTimeout ban: a named watchdog that rejects a
  // missing native event is not an elapsed-time assertion or a settling sleep.
  // Recognize the common inline await-new-Promise(resolve => setTimeout(resolve))
  // form, but do not infer behavior of arbitrary callbacks/production schedulers.
  const inlineDelay = node => {
    if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'Promise') return false;
    const executor = node.arguments?.[0];
    if (!executor || !(ts.isArrowFunction(executor) || ts.isFunctionExpression(executor))) return false;
    const resolve = executor.parameters[0]?.name;
    if (!resolve || !ts.isIdentifier(resolve)) return false;
    let found = false;
    visit(executor.body, child => {
      if (ts.isCallExpression(child) && memberName(child.expression) === 'setTimeout' &&
          child.arguments[0] && ts.isIdentifier(child.arguments[0]) && child.arguments[0].text === resolve.text) found = true;
    });
    return found;
  };
  const browser = name.startsWith('e2e/');
  const migrated = migratedOwners.includes(name);
  const behavioral = behavioralOwners.includes(name);
  const codeRead = node => {
    const value = literal(node);
    if (value !== undefined) return /\.(?:[cm]?[jt]sx?|css)(?:[?#].*)?$/.test(value) && !support(moduleTarget(name, value));
    if ((ts.isNewExpression(node) && memberName(node.expression) === 'URL') ||
        (ts.isCallExpression(node) && ['join', 'resolve', 'fileURLToPath'].includes(memberName(node.expression)))) {
      return Array.from(node.arguments ?? []).some(codeRead);
    }
    return false;
  };
  const calls = [];
  visit(tree, node => {
    if (ts.isCallExpression(node)) {
      const callee = memberName(node.expression) ?? '';
      if (behavioral && fileReads.has(callee) && node.arguments[0] && codeRead(node.arguments[0])) {
        report(node, 'behavior-source-read', 'Import production behavior; keep implementation-source assertions in an explicitly reviewed architecture/presentation owner');
      }
      if (behavioral && ['Function', 'eval', 'runInNewContext', 'runInContext', 'runInThisContext', 'compileFunction'].includes(callee)) {
        report(node, 'behavior-extracted-runtime', 'Behavioral owners must not replace production/React execution with an extracted runtime; whole-module capability fixtures have a separate reviewed scope');
      }
      if (browser && browserSleeps.has(callee)) calls.push({ node, rule: 'browser-sleep' });
      else if (migrated && awaited(node) && (promisedTimer(node) || /^(?:sleep|delay)(?:Ms)?$/i.test(callee))) {
        calls.push({ node, rule: 'settling-sleep' });
      }
    } else if (behavioral && ts.isNewExpression(node) && memberName(node.expression) === 'Function') {
      report(node, 'behavior-extracted-runtime', 'Import the production rule or mount its actual React owner instead of evaluating a copied/extracted function');
    } else if (migrated && awaited(node) && inlineDelay(node)) calls.push({ node, rule: 'settling-sleep' });
  });
  // Exemptions are one call per annotated line, not a file allowlist. Put a real
  // timing/native-deadline proof rationale immediately before the call's line:
  //   // test-design-timing-proof: <specific contract that requires elapsed time>
  const lines = source.split(/\r?\n/);
  for (const { node, rule } of calls) {
    const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line;
    const reason = lines[line - 1]?.match(/^\s*\/\/\s*test-design-timing-proof:\s*(\S.*)$/)?.[1];
    const peers = calls.filter(call => tree.getLineAndCharacterOfPosition(call.node.getStart(tree)).line === line);
    if (!reason || peers.length !== 1) report(node, rule, 'Use an owned barrier/clock; an elapsed-time proof needs its own preceding test-design-timing-proof rationale');
  }
  return diagnostics;
}
