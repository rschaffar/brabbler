// Frozen v1 bundle admission. Patch bodies are streamed/hash-drained, never decoded.
import * as fs from 'node:fs';
import { inspect, stat, sameStat, hashFd, readFd, refuse, sha } from './io.mjs';
import { json, utf8, object, equal } from './json.mjs';
import { data } from './target.mjs';
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const keys = (v, names) => object(v) && Object.keys(v).every(k => names.includes(k));
const count = n => Number.isSafeInteger(n) && n >= 0;
export function legacyReference(ref) {
  return keys(ref, ['version', 'id', 'operationId', 'sha256', 'entries', 'bytes']) && Object.keys(ref).length === 6
    && ref.version === 1 && uuid(ref.id) && uuid(ref.operationId) && /^[a-f0-9]{64}$/.test(ref.sha256) && count(ref.entries) && ref.entries > 0 && count(ref.bytes);
}
function range(fd, size, position) {
  const bytes = Buffer.alloc(size); let offset = 0;
  while (offset < size) { const n = fs.readSync(fd, bytes, offset, size - offset, position + offset); if (!n) refuse('bundle-incomplete'); offset += n; }
  return bytes;
}
export function bundle(root, id) {
  if (!uuid(id)) refuse('bundle-invalid-id');
  const dir = root.dir.child(id), handles = [];
  try {
    if (!equal(dir.names(), ['data', 'entries', 'manifest.json', 'offsets'])) refuse('bundle-member-layout');
    for (const name of ['manifest.json', 'data', 'entries', 'offsets']) handles.push(dir.file(name));
    const [mf, df, ef, of] = handles, before = handles.map(stat);
    if (before[0].bytes > 4096) refuse('bundle-manifest-size');
    const manifest = json(utf8(readFd(mf))).value;
    if (!keys(manifest, ['version', 'pluginId', 'operationId', 'entries', 'bytes', 'sha256']) || Object.keys(manifest).length !== 6) refuse('bundle-manifest-shape');
    const ref = { ...manifest }; delete ref.pluginId;
    if (!legacyReference({ ...ref, id })) refuse('bundle-manifest-shape');
    if (manifest.pluginId !== 'git-workflow') refuse('bundle-unsupported-plugin');
    if (before[1].bytes !== manifest.bytes || !Number.isSafeInteger(manifest.entries * 8) || before[3].bytes !== manifest.entries * 8) refuse('bundle-size');
    const hashes = [hashFd(df), hashFd(ef), hashFd(of)];
    if (sha(JSON.stringify(hashes)) !== manifest.sha256) refuse('bundle-aggregate-hash');
    let offset = 0, covered = 0, metadata;
    for (let i = 0; i < manifest.entries; i++) {
      const startBig = range(of, 8, i * 8).readBigUInt64BE();
      if (startBig > BigInt(Number.MAX_SAFE_INTEGER)) refuse('bundle-offset-address');
      const start = Number(startBig), nextBig = i + 1 < manifest.entries ? range(of, 8, (i + 1) * 8).readBigUInt64BE() : BigInt(before[2].bytes);
      if (nextBig > BigInt(Number.MAX_SAFE_INTEGER)) refuse('bundle-offset-address');
      const end = Number(nextBig);
      if (start !== offset || end <= start || end > before[2].bytes || end - start > 128 * 1024) refuse('bundle-index-framing');
      const raw = range(ef, end - start, start);
      if (raw.at(-1) !== 10 || raw.subarray(0, -1).includes(10)) refuse('bundle-index-framing');
      const entry = json(utf8(raw)).value;
      if (!keys(entry, ['id', 'label', 'kind', 'start', 'bytes', 'sha256']) || Object.keys(entry).length !== 6 || entry.id !== i
        || typeof entry.label !== 'string' || !entry.label || entry.label.length > 16384 || !['text', 'patch'].includes(entry.kind)
        || !count(entry.start) || entry.start !== covered || !count(entry.bytes) || !count(covered + entry.bytes) || covered + entry.bytes > manifest.bytes
        || !/^[a-f0-9]{64}$/.test(entry.sha256)) refuse('bundle-entry-shape');
      if (hashFd(df, entry.start, entry.bytes) !== entry.sha256) refuse('bundle-entry-hash');
      if (i === 0) {
        if (entry.kind !== 'text' || entry.label !== 'Exact operation, checks and captured state') refuse('bundle-metadata-layout');
        metadata = json(utf8(range(df, entry.bytes, entry.start))).value;
      } else if (entry.kind !== 'patch') refuse('bundle-patch-layout');
      covered += entry.bytes; offset = end;
    }
    if (covered !== manifest.bytes || offset !== before[2].bytes) refuse('bundle-unindexed-suffix');
    const { details, witness } = normalize(metadata, manifest.operationId);
    const payload = { version: 1, kind: 'proposal', operation: metadata.operation, fingerprint: metadata.fingerprint,
      cwd: metadata.operation.checkout, nativeArgs: metadata.args, checks: metadata.checks,
      source: { kind: 'unavailable', unavailable: metadata.comparison ? { reason: 'legacy-binding-not-captured', comparison: metadata.comparison }
        : { reason: 'unsupported-legacy', detail: 'Structured resource capture was not recorded.' } }, details };
    if (!data.readGitReviewPayload(payload)) refuse('bundle-metadata-schema');
    for (let i = 0; i < handles.length; i++) { dir.checkFile(['manifest.json', 'data', 'entries', 'offsets'][i], handles[i]); if (!sameStat(before[i], stat(handles[i]))) refuse('bundle-changed'); }
    return { manifest, payload, witness, digest: sha(JSON.stringify(metadata)), files: before.map((s, i) => ({ ...s, path: `${id}/${['manifest.json', 'data', 'entries', 'offsets'][i]}`, sha256: i === 0 ? hashFd(mf) : hashes[i - 1] })) };
  } finally { for (const fd of handles) fs.closeSync(fd); dir.close(); }
}
export function matchBundle(value, ref) {
  if (!legacyReference(ref)) refuse('legacy-reference-shape');
  const m = value.manifest;
  for (const key of ['version', 'operationId', 'sha256', 'entries', 'bytes']) if (m[key] !== ref[key]) refuse('bundle-reference-mismatch');
}
/** Rendered-equality elision only. The recipe has offsets/basis names, not a second
 * JSON/message archive. Its reconstruction is checked before emitting any record. */
export function normalize(meta, operationId) {
  if (!keys(meta, ['operation', 'fingerprint', 'comparison', 'args', 'checks', 'presentation']) || !object(meta.operation)
    || !Array.isArray(meta.args) || !Array.isArray(meta.checks) || !object(meta.presentation)
    || meta.presentation.operationId !== operationId || meta.comparison !== undefined && !data.isGitReviewComparison(meta.comparison)) refuse('bundle-metadata-layout');
  const presentation = meta.presentation, details = Object.create(null), recipe = [];
  const allowed = ['title', 'subtitle', 'text', 'markdown', 'scope', 'fields', 'sections', 'patchBefore', 'patchAfter', 'requiredAcknowledgment'];
  if (!keys(presentation, [...allowed, 'operationId', 'actions', 'allowDetails', 'sessionLinks'])) refuse('presentation-unsupported-fields');
  if (presentation.sessionLinks !== undefined) refuse('presentation-session-links');
  for (const key of allowed) if (Object.hasOwn(presentation, key) && key !== 'sections') details[key] = presentation[key];
  const basis = { operation: JSON.stringify(meta.operation, null, 2), message: meta.operation.message,
    args: `Git arguments: ${JSON.stringify(meta.args)}`,
    checkRows: ['Required checks (shell commands, may have side effects):', ...meta.checks.map(c => `${c.name}: ${c.command}`),
      meta.operation.action === 'commit' ? 'Checks run in the selected checkout, including its current staged/unstaged contents.' : 'Checks run in the feature checkout.'].join('\n\n') };
  const sections = [];
  for (const [index, section] of (presentation.sections ?? []).entries()) {
    if (section.title === 'Commit message' && equal(section, { title: 'Commit message', text: basis.message, code: true })) {
      recipe.push({ index, kind: 'message-section' }); continue;
    }
    if (section.title === 'Required checks' && equal(section, { title: 'Required checks', fields: meta.checks.map(c => ({ label: c.name, value: c.command, code: true })) })) {
      recipe.push({ index, kind: 'checks-section' }); continue;
    }
    if (section.title !== 'Technical details') { sections.push(section); recipe.push({ index, kind: 'retained', output: sections.length - 1 }); continue; }
    if (typeof section.text !== 'string' || !section.text.startsWith(basis.operation + '\n\n') || !section.text.endsWith(basis.args)) refuse('presentation-normalization-template');
    const text = section.text, cuts = [{ start: 0, end: basis.operation.length + 2, basis: 'operation', suffix: '\n\n' }];
    // Length-aware bounded marker equality; marker text inside the message cannot
    // terminate it. Multiple exact matching placements are ambiguous and block.
    for (const [key, rendered] of [
      ['message', basis.message === undefined ? undefined : `Exact message:\n${basis.message}`],
      ['checkRows', meta.checks.length ? basis.checkRows : undefined],
    ]) {
      if (rendered === undefined) continue;
      const needle = `\n\n${rendered}\n\n`, positions = []; let from = basis.operation.length;
      while ((from = text.indexOf(needle, from)) !== -1) { positions.push(from); from += needle.length; }
      if (positions.length !== 1) refuse('presentation-normalization-ambiguous');
      cuts.push({ start: positions[0], end: positions[0] + needle.length - 2, basis: key, prefix: '\n\n', ...(key === 'message' ? { prefix: '\n\nExact message:\n' } : {}) });
    }
    cuts.push({ start: text.length - basis.args.length, end: text.length, basis: 'args' }); cuts.sort((a, b) => a.start - b.start);
    let at = 0, residual = '', reconstructed = ''; const chunks = [];
    for (const cut of cuts) {
      if (cut.start < at) refuse('presentation-normalization-overlap');
      const retained = text.slice(at, cut.start); residual += retained; chunks.push({ residual: retained.length }); reconstructed += retained;
      const rendering = (cut.prefix ?? '') + basis[cut.basis] + (cut.suffix ?? '');
      if (rendering !== text.slice(cut.start, cut.end)) refuse('presentation-normalization-equality');
      chunks.push({ basis: cut.basis, prefix: cut.prefix ?? '', suffix: cut.suffix ?? '' }); reconstructed += rendering; at = cut.end;
    }
    residual += text.slice(at); reconstructed += text.slice(at); chunks.push({ residual: text.length - at });
    if (reconstructed !== text) refuse('presentation-reconstruction');
    sections.push({ ...section, text: residual }); recipe.push({ index, kind: 'technical', output: sections.length - 1, chunks, originalSha256: sha(text) });
  }
  if (Object.hasOwn(presentation, 'sections')) details.sections = sections;
  // Full presentation is reconstructible from structured values + residual + the
  // bounded historical controls kept only in this private witness.
  const omitted = Object.fromEntries(Object.entries(presentation).filter(([k]) => !allowed.includes(k)));
  const witness = { version: 1, presentationSha256: sha(JSON.stringify(presentation)), omitted, recipe };
  const restored = { ...details, ...omitted };
  if (presentation.sections) restored.sections = recipe.map(r => {
    if (r.kind === 'message-section') return { title: 'Commit message', text: basis.message, code: true };
    if (r.kind === 'checks-section') return { title: 'Required checks', fields: meta.checks.map(c => ({ label: c.name, value: c.command, code: true })) };
    const section = sections[r.output]; if (r.kind !== 'technical') return section;
    let position = 0, text = '';
    for (const chunk of r.chunks) {
      if (chunk.basis) text += chunk.prefix + basis[chunk.basis] + chunk.suffix;
      else { text += section.text.slice(position, position + chunk.residual); position += chunk.residual; }
    }
    return { ...section, text };
  });
  if (!equal(restored, presentation)) refuse('presentation-reconstruction');
  return { details, witness };
}
export function inventoryBundles(root) {
  const reports = [], decoded = new Map();
  for (const id of root.dir.names()) {
    if (/^\.[0-9a-f-]+\.pending$/.test(id)) { reports.push({ path: id, classification: 'pending', reason: 'legacy-pending' }); continue; }
    if (!uuid(id)) { reports.push({ path: id, classification: 'blocked', reason: 'bundle-unrecognized-name' }); continue; }
    try { const value = bundle(root, id); decoded.set(id, value); reports.push({ path: id, classification: 'unreferenced', sha256: value.manifest.sha256 }); }
    catch (e) { reports.push({ path: id, classification: 'blocked', reason: e.reason ?? 'bundle-validation-failed' }); }
  }
  return { reports, decoded };
}
export function fingerprintBundles(root, selected) { return selected.map(item => ({ path: item.path, ...inspect(root, item.path) })); }
