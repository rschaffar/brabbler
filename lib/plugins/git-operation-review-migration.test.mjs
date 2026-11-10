// Classified discovery bridge only. Temporary codec/tests never enter app inputs.
import '../../tools/migrations/git-operation-reviews/legacy-store.test.mjs';
import '../../tools/migrations/git-operation-reviews/metadata-refusal.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

test('application source graph never imports the temporary offline migration subtree', () => {
  const root = process.cwd(), tools = resolve(root, 'tools');
  const files = [];
  const walk = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const name = join(path, entry.name);
      if (entry.name === 'testing' || /\.(?:test|fixture)\./.test(entry.name)) continue;
      if (entry.isDirectory()) walk(name);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(name);
    }
  };
  for (const name of ['app', 'components', 'hooks', 'lib', 'plugins']) walk(join(root, name));
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = node => {
      const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
        : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require') ? node.arguments[0] : undefined;
      if (specifier && ts.isStringLiteral(specifier)) {
        const target = specifier.text.startsWith('@/') ? resolve(root, specifier.text.slice(2)) : resolve(dirname(file), specifier.text);
        assert.equal(target === tools || target.startsWith(tools + '/'), false, `runtime migration import: ${file}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});
