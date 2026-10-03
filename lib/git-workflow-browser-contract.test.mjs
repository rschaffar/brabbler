import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

// Follow emitted value imports/re-exports, not erased DTO/type-only imports.
// Unlike the UI's Node test loaders, do not stub the server dependencies away.
function assertBrowserGraph(entry) {
  const visited = new Set();
  function visit(file, chain) {
    if (visited.has(file)) return;
    visited.add(file);
    const emitted = ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const source = ts.createSourceFile(file, emitted, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    function inspect(node) {
      let specifier;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
        && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === "require")
        && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
      if (specifier) {
        const trace = [...chain, specifier].join(" → ");
        assert.ok(!specifier.startsWith("node:") && !builtins.has(specifier), trace);
        assert.ok(!specifier.startsWith("@earendil-works/") && specifier !== "server-only", trace);
        if (specifier.startsWith(".") || specifier.startsWith("@/")) {
          const base = specifier.startsWith("@/") ? resolve(root, specifier.slice(2)) : resolve(dirname(file), specifier);
          if (!base.endsWith(".css")) {
            const dependency = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
              .find((candidate) => existsSync(candidate) && /\.(?:ts|tsx|js|mjs)$/.test(candidate));
            assert.ok(dependency, `Unresolved browser dependency: ${trace}`);
            visit(dependency, [...chain, specifier]);
          }
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
  visit(resolve(root, entry), [entry]);
}

for (const entry of [
  "components/GitCommitPanel.tsx", "components/GitActionDialog.tsx", "components/GitActionCard.tsx",
  "components/GitWorkflowHome.tsx", "components/GitWorkflowSettings.tsx", "components/git-workflow-drafts.ts",
  "lib/types.ts", "lib/git-action-types.ts", "lib/git-check-recipe.ts", "lib/git-workflow-settings.ts",
]) {
  test(`${entry} has no server IO in its emitted browser value graph`, () => assertBrowserGraph(entry));
}
