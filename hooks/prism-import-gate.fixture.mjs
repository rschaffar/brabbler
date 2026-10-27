// External chunk capability only. The actual default production loader waits
// for this module evaluation. On release, load the REAL package-owned full Prism
// entry; do not replace registrations, tokenization, React or hook decisions.
const capability = globalThis[Symbol.for('brabbler:test-prism-import-gate')];
if (!capability) throw new Error('Prism import gate was not installed before import');
capability.entered.resolve();
await capability.release.promise;
const actual = await capability.importActual();
// Preserve the real package result; a null default is not its module interface.
export default actual;
