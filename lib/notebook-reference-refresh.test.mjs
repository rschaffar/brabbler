import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { analyzeNotebookReferences: analyze, applyNotebookReferences: apply } = await jiti.import('./notebook-reference-refresh.ts');
const { notebookMetadataRanges, GUIDED_LIMITS } = await jiti.import('./guided-review.ts');
const { inspectNotebook, updateNotebookStep } = await jiti.import('./notebook-authoring.ts');
const fence = (lang, data, nl = '\n') => '```' + lang + nl + JSON.stringify(data) + nl + '```' + nl;
function files(root) {
  const result = [];
  function walk(dir) { for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name), stat = fs.lstatSync(file);
    if (stat.isDirectory()) walk(file);
    else result.push([path.relative(root, file), stat.mode, stat.isSymbolicLink() ? fs.readlinkSync(file) : createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
  } }
  walk(root); return result;
}
function prose(source) {
  for (const range of notebookMetadataRanges(source).filter(r => r.language !== 'brabbler-step').reverse()) source = source.slice(0, range.start) + source.slice(range.end);
  return source;
}
function fixture(t, { nl = '\n', before = 'header\nold alpha\nold beta\ntail\n', after = 'header\nalpha\nbeta\ntail\n' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-refresh-')), cwd = path.join(root, 'repo'), guide = path.join(root, 'guide');
  fs.mkdirSync(cwd); fs.mkdirSync(guide); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  const source = path.join(cwd, 'src.txt');
  git('init', '-qb', 'main'); fs.writeFileSync(source, before); git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(source, after); git('add', '.'); git('commit', '-qm', 'repeated subject'); const oldOid = git('rev-parse', 'HEAD');
  function rewrite(body = after, parent = base, title = 'rewritten') {
    fs.writeFileSync(source, body); git('add', '-A'); const tree = git('write-tree');
    const oid = git('commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', title); git('update-ref', 'refs/heads/main', oid); return oid;
  }
  const newOid = rewrite(), indexPath = path.join(guide, 'index.md'), roots = new Set([root]), access = { roots, assertRead() {}, assertWrite() {} };
  const common = { version: 1, title: 'Pinned evidence', cwd, branch: 'main' };
  const target = (id = 'source', changes = {}) => ({ ...common, kind: 'source', id, oid: oldOid, path: 'src.txt', start: 2, end: 3, ...changes });
  let chapters = [];
  function writeGuide(groups = [[target()]]) {
    chapters = groups.map((_, i) => path.join(guide, `chapter${i + 1}.md`));
    fs.writeFileSync(indexPath, fence('brabbler-notebook', { version: 1, id: 'guide', title: 'Guide', chapters: groups.map((_, i) => ({ id: `chapter${i + 1}`, title: `Chapter ${i + 1}`, path: `chapter${i + 1}.md` })) }, nl));
    groups.forEach((targets, i) => fs.writeFileSync(chapters[i], '\ufeffPreface é🦋' + nl + nl + fence('brabbler-step', { version: 1, id: `step${i + 1}`, title: 'Explain the change' }, nl)
      + 'Keep this explanation and its tested-candidate claim.' + nl + nl
      + targets.map(target => fence(target.kind === 'compare' || target.kind === 'file' || target.kind === 'web' ? 'brabbler-evidence' : 'brabbler-review', target, nl)).join('')
      + nl + 'Unrelated trailing prose without final newline'));
  }
  writeGuide(); fs.mkdirSync(path.join(guide, 'review-data')); fs.writeFileSync(path.join(guide, 'review-data', 'sentinel'), '{malformed private history');
  const mapping = (targetIds = ['source'], pairs = [{ oldOid, newOid }], repo = cwd) => [{ cwd: repo, targetIds, pairs }];
  return { root, cwd, guide, git, source, before, after, base, oldOid, newOid, rewrite, indexPath, access, roots, target, writeGuide, mapping, chapters: () => chapters };
}
for (const nl of ['\n', '\r\n']) test(`inspect, targeted edit, analysis and metadata-only refresh preserve all unrelated bytes ${JSON.stringify(nl)}`, async t => {
  const f = fixture(t, { nl });
  const inspected = inspectNotebook(f.indexPath, f.roots, 'step1').selected;
  updateNotebookStep(f.indexPath, 'step1', inspected.binding, inspected.source.replace('Keep this explanation', 'Clarified explanation'), { roots: f.roots, assertWrite() {} });
  const original = fs.readFileSync(f.chapters()[0], 'utf8'), beforeGit = files(f.cwd), history = fs.readFileSync(path.join(f.guide, 'review-data', 'sentinel'));
  const analyzed = await analyze(f.indexPath, f.mapping(), f.access), result = analyzed.results[0];
  assert.equal(result.status, 'unchanged', JSON.stringify(result)); assert.equal(result.availability, 'unreachable-but-present');
  assert.deepEqual(result.axes, { excerpt: 'equal', surroundingFile: 'equal', fileFirstParentMaterial: 'equal' });
  const applied = await apply(f.indexPath, f.mapping(), analyzed.binding, ['source'], f.access);
  assert.equal(applied.status, 'applied'); assert.equal(applied.completed.length, 1);
  const saved = fs.readFileSync(f.chapters()[0], 'utf8'); assert.equal(prose(saved), prose(original)); assert.match(saved, new RegExp(f.newOid));
  assert.deepEqual(files(f.cwd), beforeGit); assert.deepEqual(fs.readFileSync(path.join(f.guide, 'review-data', 'sentinel')), history);
  assert.match(result.tests, /Not executed/); assert.match(saved, /tested-candidate claim/);
  await assert.rejects(apply(f.indexPath, f.mapping(), analyzed.binding, ['source'], f.access), /analysis changed/);
  assert.equal(fs.readFileSync(f.chapters()[0], 'utf8'), saved, 'missing acknowledgement cannot replay an old proposal');
});
test('complete multi-chapter workflow updates multiple selected fences and preserves an unselected fence exactly', async t => {
  const f = fixture(t); f.writeGuide([[f.target('one'), f.target('two'), f.target('unselected')], [f.target('three')]]);
  const selected = inspectNotebook(f.indexPath, f.roots, 'step2').selected;
  updateNotebookStep(f.indexPath, 'step2', selected.binding, selected.source.replace('Keep this explanation', 'Requested targeted revision'), { roots: f.roots, assertWrite() {} });
  const before = f.chapters().map(file => fs.readFileSync(file, 'utf8'));
  const untouched = notebookMetadataRanges(before[0]).find(range => range.language !== 'brabbler-step' && JSON.parse(range.value).id === 'unselected');
  const maps = f.mapping(['one', 'two', 'three']), plan = await analyze(f.indexPath, maps, f.access);
  const result = await apply(f.indexPath, maps, plan.binding, ['one', 'two', 'three'], f.access);
  assert.equal(result.status, 'applied'); assert.equal(result.completed.length, 2);
  for (const [i, file] of f.chapters().entries()) assert.equal(prose(fs.readFileSync(file, 'utf8')), prose(before[i]));
  assert.ok(fs.readFileSync(f.chapters()[0], 'utf8').includes(before[0].slice(untouched.start, untouched.end)));
  assert.equal(inspectNotebook(f.indexPath, f.roots, 'step1').selected.references.filter(ref => ref.oid === f.newOid).length, 2);
});
test('all-file preflight refuses cumulative metadata growth before saving any chapter', async t => {
  const f = fixture(t), one = f.target('one'), two = f.target('two'); f.writeGuide([[one], [two], ...Array.from({ length: 7 }, () => [])]);
  const growth = Buffer.byteLength(JSON.stringify(one, null, 2)) - Buffer.byteLength(JSON.stringify(one));
  const current = fs.statSync(f.indexPath).size + f.chapters().reduce((sum, file) => sum + fs.statSync(file).size, 0);
  let pad = GUIDED_LIMITS.packageBytes - growth - 1 - current;
  for (const file of f.chapters()) { const added = Math.min(pad, GUIDED_LIMITS.documentBytes - fs.statSync(file).size - 1024); fs.appendFileSync(file, 'x'.repeat(added)); pad -= added; }
  assert.equal(pad, 0); const before = files(f.guide), maps = f.mapping(['one', 'two']), plan = await analyze(f.indexPath, maps, f.access);
  await assert.rejects(apply(f.indexPath, maps, plan.binding, ['one', 'two'], f.access), /exceeds 2 MiB/); assert.deepEqual(files(f.guide), before);
});
for (const kind of ['split', 'squash']) test(`partitioned ${kind} mappings cannot bypass checkout-wide ambiguity refusal`, async t => {
  const f = fixture(t), other = fixture(t); f.roots.add(other.root);
  f.writeGuide([[f.target('one'), f.target('two', { oid: kind === 'split' ? f.oldOid : f.base }), other.target('independent')]]);
  const mappings = [
    ...f.mapping(['one']),
    ...f.mapping(['two'], [{ oldOid: kind === 'split' ? f.oldOid : f.base, newOid: kind === 'split' ? f.base : f.newOid }]),
    ...other.mapping(['independent']),
  ];
  const result = await analyze(f.indexPath, mappings, f.access);
  assert.deepEqual(result.results.slice(0, 2).map(result => result.problem.code), ['AMBIGUOUS_MAPPING', 'AMBIGUOUS_MAPPING']);
  assert.equal(result.results[2].status, 'unchanged');
});
test('canonical checkout aliases cannot partition correspondence', async t => {
  const f = fixture(t); f.writeGuide([[f.target('one'), f.target('two')]]);
  const maps = [...f.mapping(['one']), { ...f.mapping(['two'])[0], cwd: f.cwd + '/.' }];
  assert.deepEqual((await analyze(f.indexPath, maps, f.access)).results.map(result => result.problem.code), ['AMBIGUOUS_MAPPING', 'AMBIGUOUS_MAPPING']);
});
test('real local rebase consumes only explicit old/new correspondence, never repeated subjects', async t => {
  const f = fixture(t);
  f.git('update-ref', 'refs/heads/main', f.oldOid); f.git('switch', '-qc', 'upstream', f.base);
  fs.writeFileSync(path.join(f.cwd, 'unrelated.txt'), 'new base context\n'); f.git('add', '.'); f.git('commit', '-qm', 'repeated subject');
  f.git('switch', 'main'); f.git('rebase', 'upstream'); const next = f.git('rev-parse', 'HEAD');
  assert.notEqual(next, f.oldOid);
  const mappings = f.mapping(['source'], [{ oldOid: f.oldOid, newOid: next }]), result = await analyze(f.indexPath, mappings, f.access);
  assert.equal(result.results[0].status, 'unchanged'); assert.equal(result.results[0].proposed.oid, next);
});
test('unique complete multi-line relocation distinguishes excerpt, location and changed surrounding/first-parent material', async t => {
  const f = fixture(t), next = f.rewrite('prefix\n' + f.after);
  const result = (await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: f.oldOid, newOid: next }]), f.access)).results[0];
  assert.equal(result.status, 'moved'); assert.equal(result.proposed.start, 3); assert.equal(result.proposed.end, 4);
  assert.equal(result.axes.excerpt, 'equal'); assert.equal(result.axes.surroundingFile, 'different'); assert.equal(result.axes.fileFirstParentMaterial, 'different'); assert.equal(result.proseReviewRequired, true);
});
test('same excerpt at same coordinates never claims unchanged surrounding file or first-parent diff', async t => {
  const f = fixture(t), next = f.rewrite(f.after.replace('tail', 'changed tail'));
  const result = (await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: f.oldOid, newOid: next }]), f.access)).results[0];
  assert.equal(result.status, 'unchanged'); assert.equal(result.axes.excerpt, 'equal'); assert.equal(result.axes.surroundingFile, 'different'); assert.equal(result.proseReviewRequired, true);
});
test('duplicate relocated excerpts stay unresolved, but changed valid ranges remain explicit prose-review proposals', async t => {
  const f = fixture(t); let next = f.rewrite('prefix\nprefix\nalpha\nbeta\nseparator\nalpha\nbeta\n');
  let result = (await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: f.oldOid, newOid: next }]), f.access)).results[0];
  assert.equal(result.status, 'unresolved'); assert.equal(result.problem.code, 'AMBIGUOUS');
  next = f.rewrite('header\nchanged alpha\nchanged beta\ntail\n');
  result = (await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: f.oldOid, newOid: next }]), f.access)).results[0];
  assert.equal(result.status, 'changed'); assert.equal(result.axes.excerpt, 'different'); assert.equal(result.proseReviewRequired, true);
});
test('one-line matches never relocate and CRLF/BOM/final-LF changes are byte changes', async t => {
  const f = fixture(t, { after: '\ufeffheader\nalpha\nbeta' });
  f.writeGuide([[f.target('source', { start: 2, end: 2 })]]);
  let next = f.rewrite('prefix\nDIFFERENT\nalpha\nbeta');
  let result = (await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: f.oldOid, newOid: next }]), f.access)).results[0];
  assert.equal(result.status, 'changed'); assert.equal(result.proposed.start, 2);
  f.writeGuide([[f.target('source', { start: 1, end: 3 })]]); next = f.rewrite('header\r\nalpha\r\nbeta\r\n');
  result = (await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: f.oldOid, newOid: next }]), f.access)).results[0];
  assert.equal(result.status, 'changed'); assert.equal(result.axes.excerpt, 'different');
});
test('missing objects, invalid destinations and non-bijective maps do not suppress independent valid edits', async t => {
  const f = fixture(t); f.writeGuide([[f.target()], [f.target('missing', { oid: 'f'.repeat(40) })]]);
  const mappings = f.mapping(['source', 'missing'], [{ oldOid: f.oldOid, newOid: f.newOid }, { oldOid: 'f'.repeat(40), newOid: f.base }]);
  const analyzed = await analyze(f.indexPath, mappings, f.access);
  assert.equal(analyzed.results[0].status, 'unchanged'); assert.equal(analyzed.results[1].problem.code, 'MISSING_OBJECT');
  const second = fs.readFileSync(f.chapters()[1]);
  assert.equal((await apply(f.indexPath, mappings, analyzed.binding, ['source'], f.access)).status, 'applied');
  assert.deepEqual(fs.readFileSync(f.chapters()[1]), second);
  for (const pairs of [[{ oldOid: f.oldOid, newOid: f.newOid }, { oldOid: f.oldOid, newOid: f.base }], [{ oldOid: f.oldOid, newOid: f.newOid }, { oldOid: f.base, newOid: f.newOid }]]) {
    f.writeGuide(); assert.equal((await analyze(f.indexPath, f.mapping(['source'], pairs), f.access)).results[0].problem.code, 'AMBIGUOUS_MAPPING');
  }
});
test('normal destination branch/range admission rejects tags, expressions, unreachable commits and absent paths', async t => {
  const f = fixture(t); f.git('tag', 'main', f.oldOid);
  for (const changes of [{ branch: 'main^{commit}' }, { path: 'absent.txt' }, { start: 400, end: 401 }]) {
    f.writeGuide([[f.target('source', changes)]]); assert.equal((await analyze(f.indexPath, f.mapping(), f.access)).results[0].status, 'unresolved');
  }
  f.writeGuide(); assert.equal((await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: f.oldOid, newOid: f.oldOid }]), f.access)).results[0].status, 'unresolved');
});
test('complete canonical commit equality includes both sides and modes, not merely resulting source or matching subjects', async t => {
  const f = fixture(t), target = { version: 1, kind: 'commit', id: 'source', title: 'Whole commit', cwd: f.cwd, branch: 'main', oid: f.oldOid }; f.writeGuide([[target]]);
  assert.equal((await analyze(f.indexPath, f.mapping(), f.access)).results[0].axes.completeFirstParentInventory, 'equal');
  fs.chmodSync(f.source, 0o755); const mode = f.rewrite();
  assert.equal((await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: f.oldOid, newOid: mode }]), f.access)).results[0].axes.completeFirstParentInventory, 'different');
  const changedParent = f.rewrite('different base\n'); const sameEnd = f.rewrite(f.after, changedParent);
  assert.equal((await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: f.oldOid, newOid: sameEnd }]), f.access)).results[0].axes.completeFirstParentInventory, 'different');
});
test('root-commit equality uses the empty tree and object availability, not parent expressions', async t => {
  const f = fixture(t); const old = f.rewrite(f.after, null, 'root one'), next = f.rewrite(f.after, null, 'root two');
  f.writeGuide([[{ version: 1, kind: 'commit', id: 'source', title: 'Root', cwd: f.cwd, branch: 'main', oid: old }]]);
  assert.equal((await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: old, newOid: next }]), f.access)).results[0].axes.completeFirstParentInventory, 'equal');
});
test('merge-commit inventory uses only its first parent; incomplete inventories remain unresolved', async t => {
  const f = fixture(t); f.git('switch', '-qc', 'side', f.base); fs.writeFileSync(path.join(f.cwd, 'side.txt'), 'side\n'); f.git('add', '.'); f.git('commit', '-qm', 'side'); const side = f.git('rev-parse', 'HEAD');
  f.git('switch', 'main'); f.git('merge', '--no-ff', '-qm', 'merge', 'side'); const old = f.git('rev-parse', 'HEAD');
  const next = f.git('commit-tree', `${old}^{tree}`, '-p', f.newOid, '-p', side, '-m', 'rewritten merge'); f.git('update-ref', 'refs/heads/main', next);
  const target = { version: 1, kind: 'commit', id: 'source', title: 'Merge', cwd: f.cwd, branch: 'main', oid: old }; f.writeGuide([[target]]);
  const maps = f.mapping(['source'], [{ oldOid: old, newOid: next }]);
  assert.equal((await analyze(f.indexPath, maps, f.access)).results[0].axes.completeFirstParentInventory, 'equal');
  for (let i = 0; i < 257; i++) fs.writeFileSync(path.join(f.cwd, `extra-${i}`), `extra ${i}\n`);
  const many = f.rewrite(); assert.equal((await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: old, newOid: many }]), f.access)).results[0].problem.code, 'LIMIT');
});
test('authored comparisons retain endpoint/delete-add semantics and reject reversed or unchanged paths', async t => {
  const f = fixture(t), compare = { version: 1, kind: 'compare', id: 'source', title: 'Range', cwd: f.cwd, branch: 'main', base: f.base, candidate: f.oldOid, path: 'src.txt' };
  f.writeGuide([[compare]]); const maps = f.mapping(['source'], [{ oldOid: f.base, newOid: f.base }, { oldOid: f.oldOid, newOid: f.newOid }]);
  assert.equal((await analyze(f.indexPath, maps, f.access)).results[0].axes.endpointFileVersions, 'equal');
  const reversed = f.mapping(['source'], [{ oldOid: f.base, newOid: f.newOid }, { oldOid: f.oldOid, newOid: f.base }]);
  assert.equal((await analyze(f.indexPath, reversed, f.access)).results[0].status, 'unresolved');
  f.writeGuide([[{ ...compare, base: f.oldOid }]]);
  assert.equal((await analyze(f.indexPath, f.mapping(), f.access)).results[0].status, 'unresolved');
});
test('source first-parent context follows the admitted rename pair; comparisons still name old/new separately', async t => {
  const f = fixture(t); f.git('update-ref', 'refs/heads/main', f.base); f.git('reset', '--hard', f.base);
  f.git('mv', 'src.txt', 'renamed.txt'); f.git('commit', '-qm', 'rename'); const old = f.git('rev-parse', 'HEAD');
  const next = f.git('commit-tree', `${old}^{tree}`, '-p', f.base, '-m', 'rewritten rename'); f.git('update-ref', 'refs/heads/main', next);
  f.writeGuide([[f.target('source', { oid: old, path: 'renamed.txt' }), { version: 1, kind: 'compare', id: 'oldPath', title: 'Deletion', cwd: f.cwd, branch: 'main', base: f.base, candidate: old, path: 'src.txt' }]]);
  const maps = f.mapping(['source', 'oldPath'], [{ oldOid: old, newOid: next }, { oldOid: f.base, newOid: f.base }]);
  const result = await analyze(f.indexPath, maps, f.access); assert.equal(result.results[0].axes.fileFirstParentMaterial, 'equal'); assert.equal(result.results[1].axes.endpointFileVersions, 'equal');
});
for (const mutation of ['manifest', 'chapter', 'branch', 'repository']) test(`apply refuses changed ${mutation} bindings before any save`, async t => {
  const f = fixture(t), analyzed = await analyze(f.indexPath, f.mapping(), f.access);
  if (mutation === 'manifest') fs.appendFileSync(f.indexPath, '\nChanged manifest\n');
  if (mutation === 'chapter') fs.appendFileSync(f.chapters()[0], '\nNewer prose\n');
  if (mutation === 'branch') f.git('update-ref', 'refs/heads/main', f.base);
  if (mutation === 'repository') { fs.renameSync(f.cwd, f.cwd + '-old'); fs.cpSync(f.cwd + '-old', f.cwd, { recursive: true }); }
  const before = files(f.guide); await assert.rejects(apply(f.indexPath, f.mapping(), analyzed.binding, ['source'], f.access), /analysis changed/); assert.deepEqual(files(f.guide), before);
});
test('same OIDs in another checkout, symlink aliases and revoked roots cannot redirect evidence', async t => {
  const f = fixture(t), other = path.join(f.root, 'other'); fs.cpSync(f.cwd, other, { recursive: true });
  assert.equal((await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: f.oldOid, newOid: f.newOid }], other), f.access)).results[0].problem.code, 'REPOSITORY_MISMATCH');
  const alias = path.join(f.root, 'alias'); fs.symlinkSync(f.cwd, alias, 'dir'); f.writeGuide([[f.target('source', { cwd: alias })]]);
  assert.equal((await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: f.oldOid, newOid: f.newOid }], alias), f.access)).results[0].status, 'unresolved');
  f.writeGuide(); const access = { ...f.access, roots: new Set([f.guide]) };
  assert.equal((await analyze(f.indexPath, f.mapping(), access)).results[0].problem.code, 'DENIED');
});
test('first saved chapter, second external conflict, and later untouched files are reported without replay/rollback', async t => {
  const f = fixture(t); f.writeGuide([[f.target('one')], [f.target('two')], [f.target('three')]]);
  const maps = f.mapping(['one', 'two', 'three']), analyzed = await analyze(f.indexPath, maps, f.access), before = f.chapters().map(file => fs.readFileSync(file, 'utf8')); let changed = false;
  const access = { ...f.access, assertWrite() {
    if (!changed && fs.readFileSync(f.chapters()[0], 'utf8').includes(f.newOid)) { changed = true; fs.appendFileSync(f.chapters()[1], '\nExternal newer write'); }
  } };
  const result = await apply(f.indexPath, maps, analyzed.binding, ['one', 'two', 'three'], access);
  assert.equal(result.status, 'partial'); assert.deepEqual(result.completed.map(file => file.path), [f.chapters()[0]]);
  assert.equal(result.failed.path, f.chapters()[1]); assert.match(result.failed.outcome, /not written/); assert.deepEqual(result.unattempted, [f.chapters()[2]]);
  assert.equal(fs.readFileSync(f.chapters()[1], 'utf8'), before[1] + '\nExternal newer write'); assert.equal(fs.readFileSync(f.chapters()[2], 'utf8'), before[2]);
  assert.equal(prose(fs.readFileSync(f.chapters()[0], 'utf8')), prose(before[0]));
});
test('a lost second native save acknowledgement reports unknown, never rolls back, and refuses stale replay', async t => {
  const f = fixture(t); f.writeGuide([[f.target('one')], [f.target('two')], [f.target('three')]]);
  const maps = f.mapping(['one', 'two', 'three']), plan = await analyze(f.indexPath, maps, f.access), third = fs.readFileSync(f.chapters()[2]);
  const rename = fs.renameSync; const fault = t.mock.method(fs, 'renameSync', (from, to) => { rename(from, to); if (to === f.chapters()[1]) throw new Error('Controlled post-rename lost acknowledgement'); });
  let result; try { result = await apply(f.indexPath, maps, plan.binding, ['one', 'two', 'three'], f.access); } finally { fault.mock.restore(); }
  assert.equal(result.status, 'partial'); assert.equal(result.completed.length, 1); assert.equal(result.failed.path, f.chapters()[1]); assert.match(result.failed.outcome, /unknown/);
  assert.deepEqual(result.unattempted, [f.chapters()[2]]); assert.match(fs.readFileSync(f.chapters()[1], 'utf8'), new RegExp(f.newOid)); assert.deepEqual(fs.readFileSync(f.chapters()[2]), third);
  const saved = files(f.guide); await assert.rejects(apply(f.indexPath, maps, plan.binding, ['one', 'two', 'three'], f.access), /analysis changed/); assert.deepEqual(files(f.guide), saved);
});
for (const kind of ['branch', 'repository']) test(`late ${kind} change after one save stops the remaining file`, async t => {
  const f = fixture(t); f.writeGuide([[f.target('one')], [f.target('two')]]); const maps = f.mapping(['one', 'two']);
  const plan = await analyze(f.indexPath, maps, f.access), second = fs.readFileSync(f.chapters()[1]); let changed = false;
  const access = { ...f.access, assertWrite() { if (!changed && fs.readFileSync(f.chapters()[0], 'utf8').includes(f.newOid)) {
    changed = true;
    if (kind === 'branch') f.git('update-ref', 'refs/heads/main', f.base);
    else { fs.renameSync(f.cwd, f.cwd + '-old'); fs.cpSync(f.cwd + '-old', f.cwd, { recursive: true }); }
  } } };
  const result = await apply(f.indexPath, maps, plan.binding, ['one', 'two'], access);
  assert.equal(result.status, 'partial'); assert.equal(result.completed.length, 1); assert.match(result.failed.outcome, /not written/); assert.deepEqual(fs.readFileSync(f.chapters()[1]), second);
});
test('late edit revocation after the first file preserves its actual result and stops later files', async t => {
  const f = fixture(t); f.writeGuide([[f.target('one')], [f.target('two')]]); const maps = f.mapping(['one', 'two']);
  const analyzed = await analyze(f.indexPath, maps, f.access), second = fs.readFileSync(f.chapters()[1]);
  const result = await apply(f.indexPath, maps, analyzed.binding, ['one', 'two'], { ...f.access, assertWrite() { if (fs.readFileSync(f.chapters()[0], 'utf8').includes(f.newOid)) throw new Error('Edit revoked'); } });
  assert.equal(result.status, 'partial'); assert.equal(result.completed.length, 1); assert.match(result.failed.message, /Edit revoked/); assert.deepEqual(fs.readFileSync(f.chapters()[1]), second);
});
test('binary/invalid UTF-8, symlinks, missing blobs and object bounds remain unresolved, never equal', async t => {
  const f = fixture(t);
  for (const body of [Buffer.from([0, 1]), Buffer.from([0xff]), 'x'.repeat(1024 * 1024 + 1)]) {
    const next = f.rewrite(body); const result = (await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: f.oldOid, newOid: next }]), f.access)).results[0]; assert.equal(result.status, 'unresolved');
  }
  fs.unlinkSync(f.source); fs.symlinkSync('missing-private-target', f.source); f.git('add', '-A'); const next = f.git('commit-tree', f.git('write-tree'), '-p', f.base, '-m', 'symlink'); f.git('update-ref', 'refs/heads/main', next);
  assert.equal((await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: f.oldOid, newOid: next }]), f.access)).results[0].problem.code, 'UNSUPPORTED');
  fs.unlinkSync(f.source); const regular = f.rewrite(); const blob = f.git('rev-parse', `${regular}:src.txt`); fs.unlinkSync(path.join(f.cwd, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
  assert.equal((await analyze(f.indexPath, f.mapping(['source'], [{ oldOid: f.oldOid, newOid: regular }]), f.access)).results[0].problem.code, 'MISSING_OBJECT');
});
test('repository-configured diff/textconv/fsmonitor/signature helpers and order files are never used', async t => {
  const f = fixture(t), helper = path.join(f.root, 'helper'), marker = path.join(f.root, 'helper-executed');
  fs.writeFileSync(helper, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected'); process.exit(23);\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(f.cwd, '.gitattributes'), 'src.txt diff=fixture\n');
  for (const key of ['diff.external', 'diff.fixture.command', 'diff.fixture.textconv', 'core.fsmonitor', 'gpg.program']) f.git('config', key, helper);
  f.git('config', 'log.showSignature', 'true'); f.git('config', 'diff.orderFile', path.join(f.root, 'does-not-exist'));
  const before = files(f.cwd), result = (await analyze(f.indexPath, f.mapping(), f.access)).results[0];
  assert.equal(result.status, 'unchanged', JSON.stringify(result)); assert.equal(fs.existsSync(marker), false); assert.deepEqual(files(f.cwd), before);
});
test('read-only analysis, strict map bounds and pre-abort start no effects', async t => {
  const f = fixture(t), before = files(f.root), readonly = { roots: f.roots, assertRead() {} };
  const analyzed = await analyze(f.indexPath, f.mapping(), readonly);
  await assert.rejects(apply(f.indexPath, f.mapping(), analyzed.binding, ['source'], readonly), /edit permission/);
  await assert.rejects(analyze(f.indexPath, f.mapping(Array.from({ length: 33 }, () => 'source')), f.access), /at most 32/);
  await assert.rejects(analyze(f.indexPath, f.mapping(['source'], [{ oldOid: 'HEAD', newOid: f.newOid }]), f.access), /full lowercase/);
  const controller = new AbortController(); controller.abort(new Error('Cancelled before reads'));
  await assert.rejects(analyze(f.indexPath, f.mapping(), { ...f.access, signal: controller.signal }), /Cancelled before reads/);
  assert.deepEqual(files(f.root), before);
});
