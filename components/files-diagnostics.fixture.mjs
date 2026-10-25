// Presentation only: retain the original exception graph in errors/cause. Never
// inspect arbitrary objects, DOM/fibers, custom iterators or stringify reporters.
export function boundedErrors(error) {
  try {
    const seen = new WeakSet(), lines = [];
    let remaining = 12;
    const get = (value, key) => { try { return value[key]; } catch { return undefined; } };
    const text = (value, cap) => typeof value === 'string' ? value.slice(0, cap) : '';
    const visit = (value, path, depth) => {
      if (remaining-- <= 0) return;
      if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
        lines.push(`${path}: ${typeof value === 'string' ? value.slice(0, 240) : typeof value}`); return;
      }
      if (seen.has(value)) { lines.push(`${path}: [cycle]`); return; }
      seen.add(value);
      lines.push(`${path}: ${text(get(value, 'name'), 80) || 'Error'}: ${text(get(value, 'message'), 320)}`);
      const stack = text(get(value, 'stack'), 1800);
      if (stack) lines.push(stack.split('\n').slice(0, 6).map(line => line.slice(0, 220)).join('\n'));
      if (depth >= 4) return;
      const cause = get(value, 'cause');
      if (cause !== undefined) visit(cause, `${path}.cause`, depth + 1);
      const errors = get(value, 'errors');
      if (Array.isArray(errors)) {
        const length = get(errors, 'length');
        for (let i = 0; i < Math.min(typeof length === 'number' ? length : 0, 4); i++) visit(get(errors, i), `${path}.errors[${i}]`, depth + 1);
      }
    };
    visit(error, 'error', 0);
    return lines.join('\n').slice(0, 7000);
  } catch { return 'Error diagnostics unavailable (original exception retained)'; }
}

export async function withFilesDiagnostics(label, run) {
  try { return await run(); }
  catch (error) {
    // No async reporter or ignored rejecting observer. The awaited caller owns
    // this wrapper; primary and all original nested/cleanup errors remain intact.
    throw new AggregateError([error], `${label}\n${boundedErrors(error)}`, { cause: error });
  }
}
