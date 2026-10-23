import { JSDOM } from 'jsdom';

/** Real isolated DOM for synchronous DOM algorithms, without React/global swaps.
 * Geometry supplied by callers is a numeric double, never browser layout proof. */
export function dom(t, html = '') {
  const window = new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window;
  t.after(() => window.close());
  return { window, document: window.document };
}
