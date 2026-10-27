// External chunk capability only: after release return the actual package API.
// Production MermaidBlock retains its initialize/parse/render/catch/publication chain.
const capability = globalThis[Symbol.for('pi-web:test-mermaid-import-gate')];
if (!capability) throw new Error('Mermaid import gate must be installed before import');
capability.entered.resolve();
await capability.release.promise;
export default await capability.importActual();
