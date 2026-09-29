// Deterministic module-local fault injection. Jiti caches imported builtin
// bindings, so patching the process-global fs object does not test these reads.
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import ts from "typescript";
import { fileURLToPath } from "node:url";
export function bindingTestModule(name, imports) {
  const filename = fileURLToPath(new URL(name, import.meta.url));
  const loaded = new Module(filename);
  loaded.filename = filename;
  const realRequire = createRequire(import.meta.url);
  loaded.require = (id) => Object.hasOwn(imports, id) ? imports[id] : realRequire(id);
  loaded._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
  return loaded.exports;
}
