// Dependency evaluation capture, deliberately before the entry's later Jiti
// and named boundary-API imports. No import-time native operation. Removing or
// delaying the FIRST bootstrap import leaves this actual function unfenced,
// even though syncBuiltinESMExports later updates live named-import bindings.
import { writeFileSync } from 'node:fs';
const capturedDuringDependencyInitialization = writeFileSync;
export function esmInitializationWriteProbe(path) {
  capturedDuringDependencyInitialization(path, 'owned private ESM ordering control\n');
}
