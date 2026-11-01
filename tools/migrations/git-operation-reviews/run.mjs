import * as fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { holdRoot, inspect, inventory, withParent, stat, hashFd, exclusive, atomic, assertNoAttributes, assertOutputDisjoint, directoryObject, lock, sha, refuse, fixedReason } from './io.mjs';
import { json, utf8, equal } from './json.mjs';
import { inventoryBundles } from './codec.mjs';
import { convertSession, convertStandalone, session, preservation, sdkPrivateValidation } from './convert.mjs';
import { sdkVersion, data, reader } from './target.mjs';
const base = dirname(fileURLToPath(import.meta.url));
// Explicit local runtime-helper closure of target.mjs. In particular process ->
// git-exec -> command-env is executed on every Git child, not merely type data.
// Include the imported pure context/question/atomic leaves too; never import an
// application registry/bootstrap just to compute this frozen identity.
export const LOCAL_HELPERS = Object.freeze([
  'lib/plugins/review-metadata.ts', 'lib/plugins/review-reference.ts', 'lib/plugins/ui.ts', 'lib/operation-receipts.ts', 'lib/interaction-receipts.ts',
  'lib/plugins/project-operation-store.ts', 'lib/plugins/project-acknowledgment.ts', 'plugins/git-workflow/review-data.ts', 'plugins/git-workflow/review-reader.ts',
  'plugins/git-workflow/process.ts', 'lib/git-exec.ts', 'bin/command-env.js', 'lib/paths.ts', 'plugins/git-workflow/checkout-safety.ts',
  'lib/git-file-context.ts', 'lib/diff-context.ts', 'lib/ask-user.ts', 'lib/question-set.ts', 'lib/atomic-file.ts',
]);
export function toolIdentity() {
  const files = fs.readdirSync(base).filter(n => /\.(mjs|ts)$/.test(n) && !/\.(test|fixture)\./.test(n)).sort().map(n => [n, sha(fs.readFileSync(join(base, n)))]);
  for (const p of LOCAL_HELPERS) files.push([p, sha(fs.readFileSync(resolve(base, '../../..', p)))]);
  return sha(JSON.stringify({ files, sdkVersion, node: process.versions.node, format: data.GIT_REVIEW_FORMAT }));
}
function artifactRoot(path, create, assertDirectory) {
  const root = holdRoot(path, { create, assertDirectory });
  const s = fs.fstatSync(root.dir.fd);
  if ((s.mode & 0o777) !== 0o700 || s.uid !== process.geteuid() || s.gid !== process.getegid()) { root.close(); refuse('output-not-private'); }
  return root;
}
function artifactDirectory(root, name) {
  fs.mkdirSync(root.dir.at(name), { mode: 0o700 }); root.dir.sync();
}
function serialize(value) { return Buffer.from(JSON.stringify(value)); }
function sourceRoots(config) {
  if (!Array.isArray(config.sessions) || !config.sessions.length || !Object.hasOwn(config, 'operations') || !config.legacy || !config.output) refuse('explicit-roots-required');
  const selected = [...config.sessions.map((path, i) => ({ key: `sessions${i}`, kind: 'session', path })),
    ...(config.operations === null ? [] : [{ key: 'operations', kind: 'standalone', path: config.operations, optional: true }]), { key: 'legacy', kind: 'legacy', path: config.legacy }];
  const paths = [...selected.map(r => r.path), config.output];
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    if (paths[i] === paths[j] || paths[i].startsWith(paths[j] + '/') || paths[j].startsWith(paths[i] + '/')) refuse('overlapping-roots');
  }
  const roots = [];
  try {
    for (const spec of selected) {
      const root = holdRoot(spec.path, { absent: spec.optional });
      roots.push({ ...spec, root, identity: root?.identity ?? null, absent: !root });
    }
    const physical = roots.filter(r => !r.absent).map(r => r.identity);
    if (new Set(physical).size !== physical.length) refuse('aliased-input-roots');
    return roots;
  } catch (e) { for (const r of roots) r.root?.close(); throw e; }
}
function directoryChain(dir) {
  const ids = []; for (let d = dir; d; d = d.parent) ids.unshift(d.id); return ids;
}
function outputBoundary(roots, memberships) {
  const directories = new Set(), ancestors = new Set();
  for (const [index, spec] of roots.entries()) {
    if (!spec.root) continue;
    for (const d of memberships[index].directories) {
      const id = directoryObject(d.identity);
      if (directories.has(id)) refuse('aliased-input-roots'); directories.add(id);
    }
    for (const id of directoryChain(spec.root.dir)) ancestors.add(directoryObject(id));
  }
  return (dir, final) => assertOutputDisjoint(directoryChain(dir), directories, ancestors, final);
}
function admissions(config) {
  const admitted = config.repositories ?? [], mappings = config.mappings ?? [];
  if (!Array.isArray(admitted) || !Array.isArray(mappings) || new Set(admitted).size !== admitted.length) refuse('invalid-admissions');
  const result = admitted.map(path => ({ from: path, to: path }));
  for (const map of mappings) {
    if (!map || Object.keys(map).length !== 2 || typeof map.from !== 'string' || !map.from.startsWith('/') || !admitted.includes(map.to)
      || result.some(a => a.from === map.from)) refuse('mapping-not-explicitly-admitted'); result.push({ from: map.from, to: map.to });
  }
  return result;
}
function rootSnapshot(spec, ignored = new Set()) {
  if (!spec.root) {
    const probe = holdRoot(spec.path, { absent: true }); if (probe) { probe.close(); refuse('absent-root-created'); }
    return { ...spec, root: undefined, membership: null, files: [] };
  }
  const membership = inventory(spec.root, ignored), files = membership.files.map(path => ({ path, ...inspect(spec.root, path) }));
  const fields = { ...spec }; delete fields.root; return { ...fields, membership, files };
}
function unchanged(expected, actual, fileChanges = new Map()) {
  if (expected.identity !== actual.identity || !equal(expected.membership, actual.membership)) refuse('input-membership-or-root-changed');
  for (const [i, file] of expected.files.entries()) {
    const target = fileChanges.get(file.path) ?? file;
    if (!equal(target, actual.files[i])) refuse('input-file-changed');
  }
}
function headerIdentity(bytes) {
  // Header ownership is independent of later graph/body validity. A blocked
  // sibling file with the same saved ID must still block the otherwise valid
  // owner; never let successful conversion alone define the identity inventory.
  let start = 0;
  while (start < bytes.length) {
    const lf = bytes.indexOf(10, start), end = lf < 0 ? bytes.length : lf;
    const text = utf8(bytes.subarray(start, end)); start = end + 1;
    if (!text.trim()) continue;
    const value = json(text).value;
    return value.type === 'session' && typeof value.id === 'string' ? value.id : undefined;
  }
}
function recordedLocators(bundles, owners) {
  // Reuse ONLY the metadata already admitted by the complete codec pass. These
  // are exact inert recorded strings, not physical paths to open or normalize.
  const groups = new Map(), referenced = new Set();
  for (const [id, bundle] of bundles.decoded) {
    const locator = bundle.payload.operation.checkout;
    const group = groups.get(locator) ?? { locator, bundles: new Set(), referenced: new Set(), owners: new Set(), occurrences: 0 };
    group.bundles.add(id); groups.set(locator, group);
  }
  for (const owner of owners) for (const occurrence of owner.plan?.occurrences ?? []) {
    const id = occurrence.original?.id, bundle = bundles.decoded.get(id); if (!bundle) continue;
    const group = groups.get(bundle.payload.operation.checkout); group.referenced.add(id); group.owners.add(owner.key); group.occurrences++; referenced.add(id);
  }
  return { source: 'validated-legacy-bundle-operation.checkout', authority: 'inert-recorded-locators-not-admissions',
    scope: 'Selected validated bundles including scoped unreferenced candidates; no prose/path probes or blocked-owner inference.',
    locators: [...groups.values()].sort((a, b) => a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0).map(g => ({ locator: g.locator,
      validatedBundles: g.bundles.size, referencedBundles: g.referenced.size, unreferencedCandidateBundles: [...g.bundles].filter(id => !referenced.has(id)).length,
      convertedReferenceOccurrences: g.occurrences, convertedOwners: g.owners.size })) };
}
function summary(manifest) {
  const classifications = {}, reasons = {}, proposalAvailability = {}, resultAvailability = {};
  for (const owner of manifest.owners) for (const occurrence of owner.plan?.occurrences ?? []) {
    for (const [key, counts] of [['proposalAvailability', proposalAvailability], ['resultAvailability', resultAvailability]]) {
      const reason = occurrence[key] ?? 'already-target-or-not-assessed'; counts[reason] = (counts[reason] ?? 0) + 1;
    }
  }
  for (const f of manifest.owners) { classifications[f.classification] = (classifications[f.classification] ?? 0) + 1; if (f.reason) reasons[f.reason] = (reasons[f.reason] ?? 0) + 1; }
  return { version: 1, owners: manifest.owners.length, files: manifest.roots.reduce((n, r) => n + r.files.length, 0), classifications, reasons, proposalAvailability, resultAvailability,
    occurrences: manifest.owners.reduce((n, f) => n + (f.plan?.occurrences.length ?? 0), 0), bundles: manifest.bundles.reduce((map, b) => ({ ...map, [b.classification]: (map[b.classification] ?? 0) + 1 }), {}),
    blocks: manifest.blocks.length, recordedCheckoutLocatorCount: manifest.recordedCheckoutLocators.count, atomicity: 'per-file-not-dataset', dryRunOriginalByteInvariant: true, repositoriesAdmitted: manifest.admissions.length };
}
export async function dryRun(config, hooks = {}) {
  const roots = sourceRoots(config); let output, unlock;
  try {
    const admitted = admissions(config), admissionRoots = [...new Set(admitted.map(a => a.to))].map(path => {
      const root = holdRoot(path, { absent: true });
      try { return { path, identity: root?.identity ?? null }; } finally { root?.close(); }
    });
    // Inventory before any output mkdir/lock/artifact. Check every existing
    // output ancestor before a missing component can be created through an alias.
    const before = roots.map(r => rootSnapshot(r)), boundary = outputBoundary(roots, before.map(r => r.membership));
    output = artifactRoot(config.output, true, boundary);
    if (output.dir.names().length) refuse('output-not-empty');
    unlock = lock(output);
    for (const name of ['staged', 'originals', 'backups', 'validation']) artifactDirectory(output, name);
    const legacy = roots.find(r => r.key === 'legacy'), bundles = inventoryBundles(legacy.root), owners = [], blocks = [], headerIds = new Map();
    for (const spec of roots.filter(r => r.kind !== 'legacy')) {
      for (const file of before.find(r => r.key === spec.key).files) {
        const key = `${spec.key}:${file.path}`, index = owners.length;
        const owner = { key, root: spec.key, path: file.path, classification: 'unchanged', original: file,
          staged: `staged/${index}`, originalCopy: `originals/${index}`, backup: `backups/${index}`,
          installTemp: `.git-review-migration-${cryptoId()}.tmp`, restoreTemp: `.git-review-restore-${cryptoId()}.tmp` };
        owners.push(owner);
        if (spec.kind === 'session' && !file.path.endsWith('.jsonl')) { owner.reason = 'non-session-file-preserved'; continue; }
        if (spec.kind === 'standalone' && (!file.path.endsWith('.json') || file.path.includes('/'))) { owner.classification = 'blocked'; owner.reason = 'unrecognized-standalone-file'; continue; }
        const current = inspect(spec.root, file.path, true); const bytes = current.data; delete current.data;
        if (!equal(file, { path: file.path, ...current })) refuse('input-changed-before-conversion');
        if (spec.kind === 'session') {
          try { const id = headerIdentity(bytes); if (id !== undefined) { const group = headerIds.get(id) ?? []; group.push(owner); headerIds.set(id, group); } }
          catch { /* The strict converter below reports the exact fixed refusal. */ }
        }
        try {
          const converted = spec.kind === 'session' ? await convertSession(bytes, bundles, admitted) : await convertStandalone(bytes, file.path, bundles, admitted);
          owner.plan = converted.plan;
          if (sha(converted.output) === file.sha256) { owner.classification = owner.plan.occurrences.length ? 'already-target' : 'unchanged'; continue; }
          owner.classification = 'convertible'; owner.target = { sha256: sha(converted.output), bytes: converted.output.length, mode: file.mode };
          withParent(spec.root, file.path, (dir, name) => { const fd = dir.file(name); try { assertNoAttributes(fd); } finally { fs.closeSync(fd); } });
          withParent(output, owner.staged, (dir, name) => exclusive(dir, name, converted.output, 0o600, hooks, 'stage'));
          withParent(output, owner.originalCopy, (dir, name) => exclusive(dir, name, bytes));
          if (spec.kind === 'session') {
            // SDK open appends LF to any unterminated physical tail (including
            // whitespace). Give it separate LF-framed validation copies, NEVER
            // the byte-exact staging/original artifacts installed or backed up.
            const lf = value => value.at(-1) === 10 ? value : Buffer.concat([value, Buffer.from('\n')]);
            const beforeSdk = lf(bytes), afterSdk = lf(converted.output), beforeName = `validation/${index}.before.jsonl`, afterName = `validation/${index}.after.jsonl`;
            withParent(output, beforeName, (dir, name) => exclusive(dir, name, beforeSdk));
            withParent(output, afterName, (dir, name) => exclusive(dir, name, afterSdk));
            withParent(output, beforeName, (oldDir, oldName) => withParent(output, afterName, (newDir, newName) => {
              const oldFd = oldDir.file(oldName), newFd = newDir.file(newName);
              try { sdkPrivateValidation(oldFd, newFd, output.dir.fd, beforeSdk, afterSdk); oldDir.checkFile(oldName, oldFd); newDir.checkFile(newName, newFd); }
              finally { fs.closeSync(oldFd); fs.closeSync(newFd); }
            }));
            owner.plan.validation.sdkOpen = 'separate-LF-framed-private-copies';
          }
          withParent(output, owner.originalCopy, (dir, name) => { const fd = dir.file(name); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } dir.sync(); });
          withParent(output, owner.staged, dir => dir.sync());
        } catch (e) { owner.classification = 'blocked'; owner.reason = fixedReason(e); delete owner.target; delete owner.plan; }
        hooks.barrier?.('owner-staged', { key });
      }
    }
    for (const group of headerIds.values()) if (group.length > 1) for (const owner of group) {
      if (owner.reason) owner.otherReasons = [owner.reason];
      owner.classification = 'blocked'; owner.reason = 'ambiguous-session-header-id'; delete owner.target;
    }
    const referenced = new Set(owners.flatMap(o => o.plan?.occurrences.map(r => r.original?.id).filter(Boolean) ?? []));
    for (const report of bundles.reports) if (referenced.has(report.path) && report.classification === 'unreferenced') report.classification = 'referenced';
    for (const owner of owners) if (owner.classification === 'blocked') blocks.push({ key: owner.key, path: owner.path, reason: owner.reason, ...(owner.otherReasons ? { otherReasons: owner.otherReasons } : {}) });
    for (const report of bundles.reports) if (report.classification === 'blocked' || report.classification === 'pending') blocks.push({ key: `legacy:${report.path}`, path: report.path, reason: report.reason });
    for (const [i, root] of roots.entries()) unchanged(before[i], rootSnapshot(root));
    const locatorReport = recordedLocators(bundles, owners), locatorBytes = serialize(locatorReport);
    exclusive(output.dir, 'recorded-locators.json', locatorBytes); output.dir.sync();
    const manifest = { version: 1, contract: 'git-review-migration/v1', tool: toolIdentity(), node: process.versions.node, sdk: sdkVersion, targetFormat: data.GIT_REVIEW_FORMAT,
      output: config.output, outputIdentity: output.identity, operations: config.operations, roots: before, admissions: admitted, admissionRoots, owners, bundles: bundles.reports, blocks,
      recordedCheckoutLocators: { path: 'recorded-locators.json', sha256: sha(locatorBytes), bytes: locatorBytes.length, count: locatorReport.locators.length } };
    const bytes = serialize(manifest), confirmation = sha(bytes);
    exclusive(output.dir, 'manifest.json', bytes, 0o600, hooks, 'manifest'); output.dir.sync();
    atomic(output.dir, 'journal.json', serialize({ version: 1, manifest: confirmation, files: {}, status: 'planned' }), hooks);
    exclusive(output.dir, 'report.json', serialize(summary(manifest))); output.dir.sync();
    return { confirmation, ...summary(manifest) };
  } finally { unlock?.(); output?.close(); for (const r of roots) r.root?.close(); }
}
function cryptoId() { return globalThis.crypto.randomUUID(); }
function readJson(root, path) { return json(utf8(inspect(root, path, true).data)).value; }
function verifyArtifact(root, path, expected) {
  const file = inspect(root, path);
  if (file.sha256 !== expected.sha256 || file.bytes !== expected.bytes || file.mode !== 0o600) refuse('private-artifact-mismatch'); return file;
}
function hashMatches(file, expected) { return file.sha256 === expected.sha256 && file.bytes === expected.bytes && file.mode === expected.mode; }
function tempRelative(owner, temp) { const dir = owner.path.includes('/') ? owner.path.slice(0, owner.path.lastIndexOf('/') + 1) : ''; return dir + temp; }
function journalWrite(run, hooks) { atomic(run.output.dir, 'journal.json', serialize(run.journal), hooks); }
function openRun(outputPath, confirm, modifying, stopped, hooks) {
  const output = artifactRoot(outputPath, false); let unlock, roots;
  try {
    const bytes = inspect(output, 'manifest.json', true).data, hash = sha(bytes), manifest = json(utf8(bytes)).value;
    if (modifying && (stopped !== true || confirm !== hash)) refuse('stopped-writer-attestation-and-exact-confirmation-required');
    if (manifest.version !== 1 || manifest.contract !== 'git-review-migration/v1' || manifest.tool !== toolIdentity() || manifest.output !== outputPath || manifest.outputIdentity !== output.identity) refuse('manifest-contract-mismatch');
    roots = sourceRoots({ sessions: manifest.roots.filter(r => r.kind === 'session').map(r => r.path), operations: manifest.operations, legacy: manifest.roots.find(r => r.kind === 'legacy').path, output: outputPath });
    const boundary = outputBoundary(roots, roots.map(r => r.root ? inventory(r.root) : null));
    boundary(output.dir, true);
    unlock = lock(output);
    const journal = readJson(output, 'journal.json');
    if (journal.version !== 1 || journal.manifest !== hash || !objectRecord(journal.files)) refuse('journal-binding-mismatch');
    // All destinations are from the immutable manifest, not journal path strings.
    const known = new Set(manifest.owners.filter(o => o.target).map(o => o.key));
    if (Object.keys(journal.files).some(k => !known.has(k))) refuse('journal-unknown-owner');
    return { output, unlock, manifest, journal, roots, hash, hooks };
  } catch (e) { for (const r of roots ?? []) r.root?.close(); unlock?.(); output.close(); throw e; }
}
function objectRecord(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function closeRun(run) { for (const r of run.roots) r.root?.close(); run.unlock(); run.output.close(); }
function preflight(run) {
  const states = new Map();
  for (const spec of run.roots) {
    const expected = run.manifest.roots.find(r => r.key === spec.key);
    if (spec.identity !== expected.identity) refuse('source-root-changed');
    const changed = new Map(), ignored = new Set();
    for (const owner of run.manifest.owners.filter(o => o.root === spec.key && o.target)) {
      const state = run.journal.files[owner.key], current = inspect(spec.root, owner.path);
      const original = { ...owner.original }; delete original.path;
      let status;
      if (equal(current, original)) status = 'original';
      else if (state?.state === 'restored' && hashMatches(current, owner.original) && equal(current, state.current)) status = 'restored';
      else if (state?.state === 'installed' && hashMatches(current, owner.target) && equal(current, state.current)) status = 'installed';
      else if (state?.state === 'install-intent' && hashMatches(current, owner.target) && current.identity === state.temporary.identity) status = 'installed-intent';
      else if (state?.state === 'restore-intent' && hashMatches(current, owner.original) && current.identity === state.temporary.identity) status = 'restored-intent';
      else if (state?.state === 'restore-intent' && equal(current, state.before)) status = 'installed';
      else refuse('changed-or-newer-owner-bytes');
      if (['installed', 'installed-intent', 'restored', 'restored-intent'].includes(status)) changed.set(owner.path, { path: owner.path, ...current });
      states.set(owner.key, { status, current });
      for (const temp of [owner.installTemp, owner.restoreTemp]) {
        const relative = tempRelative(owner, temp);
        try {
          const actual = inspect(spec.root, relative), expectedBytes = temp === owner.installTemp ? owner.target : owner.original;
          if (!hashMatches(actual, expectedBytes)) refuse('temporary-file-changed');
          if (state?.temporary && state.temporary.path === temp && actual.identity !== state.temporary.identity) refuse('temporary-identity-changed');
          ignored.add(relative);
        } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
    }
    unchanged(expected, rootSnapshot(spec, ignored), changed);
  }
  return states;
}
function membershipOnly(run) {
  for (const spec of run.roots) {
    if (!spec.root) continue;
    const ignored = new Set();
    for (const owner of run.manifest.owners.filter(o => o.root === spec.key && o.target)) {
      for (const temp of [owner.installTemp, owner.restoreTemp]) {
        const relative = tempRelative(owner, temp);
        try { const s = inspect(spec.root, relative); if (!hashMatches(s, temp === owner.installTemp ? owner.target : owner.original)) refuse('temporary-file-changed'); ignored.add(relative); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
    }
    if (!equal(run.manifest.roots.find(r => r.key === spec.key).membership, inventory(spec.root, ignored))) refuse('input-membership-or-root-changed');
  }
}
function artifacts(run, requireBackups) {
  verifyArtifact(run.output, 'recorded-locators.json', run.manifest.recordedCheckoutLocators);
  for (const owner of run.manifest.owners.filter(o => o.target)) {
    verifyArtifact(run.output, owner.staged, owner.target); verifyArtifact(run.output, owner.originalCopy, owner.original);
    if (requireBackups || run.journal.files[owner.key]?.backup) verifyArtifact(run.output, owner.backup, owner.original);
  }
}
async function validateAdmissions(run) {
  for (const expected of run.manifest.admissionRoots) {
    const root = holdRoot(expected.path, { absent: true });
    try { if ((root?.identity ?? null) !== expected.identity) refuse('admitted-root-changed'); } finally { root?.close(); }
  }
  if (!run.manifest.admissions.length) return;
  const checked = new Set(), access = { assertAllowed: async path => {
    if (!run.manifest.admissions.some(a => a.to === path)) refuse('repository-not-admitted');
  } };
  for (const owner of run.manifest.owners.filter(o => o.target)) {
    const bytes = inspect(run.output, owner.staged, true).data;
    const records = owner.root === 'operations' ? json(utf8(bytes)).value.reviewMetadata ?? []
      : session(bytes).entries.filter(e => e.customType === 'brabbler:operation-review').map(e => e.data);
    for (const record of records) {
      const p = data.readGitReviewPayload(record.payload), captured = p?.kind === 'proposal' && p.source.kind === 'git' ? p.source.captured : p?.kind === 'settlement' ? p.result?.captured : undefined;
      if (!captured) continue;
      const key = sha(JSON.stringify(captured)); if (checked.has(key)) continue;
      await reader.assertGitReviewAvailable(captured, access); checked.add(key);
    }
  }
}
function reconcile(run, states, hooks) {
  for (const [key, state] of states) if (state.status.endsWith('-intent')) {
    run.journal.files[key] = { ...run.journal.files[key], state: state.status === 'installed-intent' ? 'installed' : 'restored', current: state.current };
    const owner = run.manifest.owners.find(o => o.key === key), spec = run.roots.find(r => r.key === owner.root);
    withParent(spec.root, owner.path, dir => dir.sync()); journalWrite(run, hooks);
  }
}
function durableBackup(root, path, expected, hooks) {
  withParent(root, path, (dir, name) => {
    const fd = dir.file(name);
    try {
      const before = stat(fd);
      if (before.mode !== 0o600 || before.bytes !== expected.bytes || hashFd(fd) !== expected.sha256) refuse('private-artifact-mismatch');
      dir.checkFile(name, fd); if (!equal(before, stat(fd))) refuse('private-artifact-changed');
      fs.fsyncSync(fd); hooks.barrier?.('backup-file-synced');
      dir.checkFile(name, fd); if (!equal(before, stat(fd))) refuse('private-artifact-changed');
      hooks.barrier?.('backup-before-directory-fsync'); dir.sync(); hooks.barrier?.('backup-directory-synced');
      dir.checkFile(name, fd); if (!equal(before, stat(fd))) refuse('private-artifact-changed');
    } finally { fs.closeSync(fd); }
  });
}
function backup(run, owner, hooks) {
  const spec = run.roots.find(r => r.key === owner.root), state = run.journal.files[owner.key];
  if (state?.backup) { durableBackup(run.output, owner.backup, owner.original, hooks); return; }
  const source = inspect(spec.root, owner.path, true); delete source.path;
  const bytes = source.data; delete source.data;
  if (!equal(source, Object.fromEntries(Object.entries(owner.original).filter(([k]) => k !== 'path')))) refuse('changed-before-backup');
  withParent(spec.root, owner.path, (dir, name) => { const fd = dir.file(name); try { assertNoAttributes(fd); } finally { fs.closeSync(fd); } });
  try { withParent(run.output, owner.backup, (dir, name) => exclusive(dir, name, bytes, 0o600, hooks, 'backup')); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  // EEXIST may be an interruption before either durability barrier. Cached hash
  // equality is not enough: verify/sync/recheck the SAME held FD, then its parent.
  durableBackup(run.output, owner.backup, owner.original, hooks);
  run.journal.files[owner.key] = { state: 'backup-ready', backup: true }; journalWrite(run, hooks); hooks.barrier?.('backup-ready', { key: owner.key });
}
function install(run, owner, restoring, hooks) {
  const spec = run.roots.find(r => r.key === owner.root), expected = restoring ? owner.original : owner.target, artifact = restoring ? owner.backup : owner.staged;
  const bytes = inspect(run.output, artifact, true).data, temporary = restoring ? owner.restoreTemp : owner.installTemp;
  return withParent(spec.root, owner.path, (dir, name) => {
    const before = inspect(spec.root, owner.path);
    const expectedBefore = restoring ? run.journal.files[owner.key]?.current ?? run.journal.files[owner.key]?.before
      : Object.fromEntries(Object.entries(owner.original).filter(([k]) => k !== 'path'));
    if (!equal(before, expectedBefore)) refuse('changed-before-install');
    let temp;
    try { exclusive(dir, temporary, bytes, expected.mode, hooks, restoring ? 'restore' : 'install'); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    const fd = dir.file(temporary);
    try { assertNoAttributes(fd); fs.fsyncSync(fd); temp = { ...stat(fd), sha256: hashFd(fd), path: temporary }; dir.checkFile(temporary, fd); }
    finally { fs.closeSync(fd); }
    if (!hashMatches(temp, expected)) refuse('temporary-file-changed');
    dir.sync();
    run.journal.files[owner.key] = { ...run.journal.files[owner.key], state: restoring ? 'restore-intent' : 'install-intent', before, temporary: temp };
    journalWrite(run, hooks); hooks.barrier?.(restoring ? 'restore-intent' : 'install-intent', { key: owner.key });
    // Recheck every public edge and exact current file immediately before rename.
    if (!equal(inspect(spec.root, owner.path), before)) refuse('changed-before-rename');
    const tempNow = inspect(spec.root, tempRelative(owner, temporary));
    if (!equal(tempNow, Object.fromEntries(Object.entries(temp).filter(([k]) => k !== 'path')))) refuse('temporary-identity-changed');
    dir.check(); fs.renameSync(dir.at(temporary), dir.at(name)); hooks.barrier?.(restoring ? 'restore-renamed' : 'install-renamed', { key: owner.key });
    dir.sync(); hooks.barrier?.('parent-synced', { key: owner.key });
    const current = inspect(spec.root, owner.path);
    if (!hashMatches(current, expected) || current.identity !== temp.identity) refuse('installed-file-changed');
    run.journal.files[owner.key] = { ...run.journal.files[owner.key], state: restoring ? 'restored' : 'installed', current };
    journalWrite(run, hooks); hooks.barrier?.(restoring ? 'restored' : 'installed', { key: owner.key });
  });
}
export async function operate(mode, options, hooks = {}) {
  if (!['apply', 'resume', 'restore', 'check'].includes(mode)) refuse('unknown-mode');
  const run = openRun(options.output, options.confirm, mode !== 'check', options.writersStopped, hooks);
  try {
    if (mode !== 'check' && run.manifest.blocks.length && options.retainBlocked !== true) refuse('unresolved-blocks-retain-explicitly-required');
    const states = preflight(run);
    artifacts(run, mode === 'restore' || Object.values(run.journal.files).some(s => ['installed', 'install-intent', 'restore-intent', 'restored'].includes(s.state)));
    if (mode === 'check') {
      for (const owner of run.manifest.owners.filter(o => o.target)) {
        const state = states.get(owner.key);
        if (!['installed', 'installed-intent', 'restored', 'restored-intent', 'original'].includes(state.status)) refuse('unrecognized-file-state');
        const original = inspect(run.output, owner.originalCopy, true).data;
        if (state.status.startsWith('installed') && owner.root.startsWith('sessions')) {
          const source = run.roots.find(r => r.key === owner.root), current = inspect(source.root, owner.path, true).data;
          const oracle = { ...preservation(session(original), session(current), owner.plan), sdkOpen: 'separate-LF-framed-private-copies' };
          if (!equal(oracle, owner.plan.validation)) refuse('check-preservation-mismatch');
        }
        if (state.status.startsWith('installed') && owner.root === 'operations') {
          const source = run.roots.find(r => r.key === owner.root), current = inspect(source.root, owner.path, true).data;
          if (sha(current) !== owner.target.sha256) refuse('check-standalone-mismatch');
        }
      }
      const counts = countStates(states), pending = counts.original ?? 0;
      return { manifest: run.hash, ...summary(run.manifest), states: counts,
        status: run.journal.status === 'restored' ? 'restored' : pending ? 'incomplete' : 'verified-installed-or-unchanged' };
    }
    if (mode !== 'restore') await validateAdmissions(run);
    reconcile(run, states, hooks);
    if (mode !== 'restore') {
      if ([...states.values()].some(s => s.status.startsWith('restored'))) refuse('restored-run-cannot-reapply');
      // Every backup must be durable and verified BEFORE the first replacement.
      for (const owner of run.manifest.owners.filter(o => o.target)) if (states.get(owner.key).status === 'original') backup(run, owner, hooks);
      artifacts(run, true); hooks.barrier?.('all-backups-ready');
      for (const owner of run.manifest.owners.filter(o => o.target)) if (states.get(owner.key).status === 'original') {
        membershipOnly(run); install(run, owner, false, hooks);
      }
      run.journal.status = 'installed'; journalWrite(run, hooks);
    } else {
      for (const owner of run.manifest.owners.filter(o => o.target)) {
        const status = states.get(owner.key).status;
        if (status.startsWith('installed')) { membershipOnly(run); install(run, owner, true, hooks); }
      }
      run.journal.status = 'restored'; journalWrite(run, hooks);
    }
    const final = preflight(run); artifacts(run, true);
    return { manifest: run.hash, ...summary(run.manifest), states: countStates(final), status: run.journal.status };
  } finally { closeRun(run); }
}
function countStates(states) { const counts = {}; for (const state of states.values()) counts[state.status] = (counts[state.status] ?? 0) + 1; return counts; }
