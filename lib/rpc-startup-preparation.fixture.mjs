// Only successful pinned-Jiti transformation text is reusable. Source reads,
// resolution, dependency evaluation and the RPC owner initializer stay fresh.
import { createJiti } from 'jiti';
import { types } from 'node:util';

const defaultTransform = createJiti(import.meta.url, { fsCache: false, moduleCache: false }).options.transform;
const fields = new Set(['source', 'filename', 'ts', 'async', 'jsx', 'interopDefault', 'retainLines', 'babel']);
const flags = ['ts', 'async', 'interopDefault', 'retainLines'];
const maxEntries = 256, maxBytes = 8 * 1024 * 1024;

function supported(options) {
  if (!options || types.isProxy(options) || Object.getPrototypeOf(options) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(options);
  if (Reflect.ownKeys(descriptors).some(key => !fields.has(key) || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) return false;
  if (typeof options.source !== 'string' || typeof options.filename !== 'string') return false;
  if (flags.some(key => options[key] !== undefined && typeof options[key] !== 'boolean')) return false;
  if (options.jsx !== undefined && options.jsx !== false) return false;
  // Custom Babel configuration/plugins and input maps can consult mutable files
  // or callbacks. Delegate them rather than pretending JSON is a complete key.
  if (!options.babel || types.isProxy(options.babel) || Object.getPrototypeOf(options.babel) !== Object.prototype || Reflect.ownKeys(options.babel).length) return false;
  return !options.source.includes('sourceMappingURL');
}

export function createRpcStartupPreparation() {
  const prepared = new Map(); let bytes = 0;
  return jiti => {
    const transform = jiti.options.transform;
    if (transform !== defaultTransform || jiti.options.debug) return;
    jiti.options.transform = function (options) {
      if (!supported(options) || process.env.BABEL_SHOW_CONFIG_FOR || process.env.DEBUG || process.env.NODE_DEBUG) return transform.call(this, options);
      // The callback already receives effective filename/source/TS/async/interop
      // options. The implementation is fixed by the captured default callback;
      // these environment inputs are additional pinned-Babel configuration.
      const key = JSON.stringify([options, process.env.NODE_ENV, process.env.BABEL_ENV,
        process.env.BABEL_8_BREAKING, process.env.BABEL_TYPES_8_BREAKING]);
      const hit = prepared.get(key);
      if (hit) return { code: hit.code };
      const result = transform.call(this, options);
      if (typeof result?.code !== 'string' || Reflect.ownKeys(result).length !== 1 || !Object.hasOwn(result, 'code')) return result;
      const size = Buffer.byteLength(key) + Buffer.byteLength(result.code);
      if (size > maxBytes) return result;
      while (prepared.size >= maxEntries || bytes + size > maxBytes) {
        const oldest = prepared.keys().next().value;
        bytes -= prepared.get(oldest).size; prepared.delete(oldest);
      }
      prepared.set(key, { code: result.code, size }); bytes += size;
      return result;
    };
  };
}
