// Strict JSON with token coordinates. No regex/UUID/prose replacement.
import { refuse } from './io.mjs';
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export function utf8(bytes) {
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) refuse('unsupported-bom');
  try { return decoder.decode(bytes); } catch { refuse('invalid-utf8'); }
}
export function json(text) {
  let i = 0;
  const space = () => { while (/[ \t\r\n]/.test(text[i] ?? 'x')) i++; };
  function string() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') { try { return JSON.parse(text.slice(start, i)); } catch { refuse('invalid-json'); } }
    }
    refuse('invalid-json');
  }
  function value() {
    space(); const start = i, token = text[i]; let result, properties, items;
    if (token === '{') {
      i++; properties = new Map(); result = Object.create(null); space();
      while (text[i] !== '}') {
        if (text[i] !== '"') refuse('invalid-json');
        const keyStart = i, key = string(); if (properties.has(key)) refuse('duplicate-json-key');
        space(); if (text[i++] !== ':') refuse('invalid-json');
        const node = value(); result[key] = node.value; properties.set(key, { ...node, keyStart }); space();
        if (text[i] === '}') break;
        if (text[i++] !== ',') refuse('invalid-json'); space(); if (text[i] === '}') refuse('invalid-json');
      }
      if (text[i++] !== '}') refuse('invalid-json');
    } else if (token === '[') {
      i++; items = []; result = []; space();
      while (text[i] !== ']') {
        const node = value(); result.push(node.value); items.push(node); space();
        if (text[i] === ']') break;
        if (text[i++] !== ',') refuse('invalid-json'); space(); if (text[i] === ']') refuse('invalid-json');
      }
      if (text[i++] !== ']') refuse('invalid-json');
    } else if (token === '"') result = string();
    else {
      const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i));
      if (!match) refuse('invalid-json'); i += match[0].length;
      result = JSON.parse(match[0]); if (typeof result === 'number' && !Number.isFinite(result)) refuse('nonfinite-json');
    }
    return { start, end: i, value: result, properties, items };
  }
  const root = value(); space(); if (i !== text.length) refuse('invalid-json'); return root;
}
export function pointer(node, path) {
  for (const key of path) { node = node?.properties?.get(key); if (!node) refuse('missing-json-pointer'); }
  return node;
}
export function patch(text, edits) {
  let end = text.length, out = '';
  for (const e of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    if (e.start < 0 || e.end < e.start || e.end > end) refuse('overlapping-token-edits');
    out = e.text + text.slice(e.end, end) + out; end = e.start;
  }
  return text.slice(0, end) + out;
}
export function sourceEdits(node, cardPath, reference) {
  const card = pointer(node, cardPath), edits = [], allowed = [];
  if (card.properties.has('review')) {
    const token = card.properties.get('review'); edits.push({ start: token.start, end: token.end, text: JSON.stringify(reference) }); allowed.push([...cardPath, 'review']);
  } else if (card.properties.has('patch')) {
    const token = card.properties.get('patch');
    edits.push({ start: token.keyStart, end: token.end, text: `"review":${JSON.stringify(reference)}` });
    allowed.push([...cardPath, 'patch'], [...cardPath, 'review']);
  } else {
    edits.push({ start: card.end - 1, end: card.end - 1, text: `${card.properties.size ? ',' : ''}"review":${JSON.stringify(reference)}` }); allowed.push([...cardPath, 'review']);
  }
  // Deletions are merged into adjacent property groups; never remove descriptive
  // patchBefore/patchAfter labels or an arbitrary nested similarly named value.
  const entries = [...card.properties], removed = new Set(['patch', 'patchContext'].filter(k => card.properties.has(k) && (k !== 'patch' || card.properties.has('review'))));
  for (let i = 0; i < entries.length;) {
    if (!removed.has(entries[i][0])) { i++; continue; }
    const first = i; while (i < entries.length && removed.has(entries[i][0])) i++;
    const previous = first > 0, next = i < entries.length;
    edits.push({ start: previous ? entries[first - 1][1].end : entries[first][1].keyStart,
      end: next ? (previous ? entries[i - 1][1].end : entries[i][1].keyStart) : entries[i - 1][1].end, text: '' });
    for (let n = first; n < i; n++) allowed.push([...cardPath, entries[n][0]]);
  }
  return { edits, allowed };
}
export function lines(bytes) {
  const result = []; let start = 0, number = 1;
  while (start < bytes.length) {
    const lf = bytes.indexOf(10, start), end = lf < 0 ? bytes.length : lf + 1;
    const delimiter = lf < 0 ? '' : lf > start && bytes[lf - 1] === 13 ? '\r\n' : '\n';
    const text = utf8(bytes.subarray(start, end - delimiter.length));
    result.push({ text, delimiter, number: number++, node: text.trim() ? json(text) : null }); start = end;
  }
  return result;
}
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const equal = (a, b) => {
  if (a === b) return true;
  if (!object(a) && !Array.isArray(a) || !object(b) && !Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
};
