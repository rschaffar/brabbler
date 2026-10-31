import { randomUUID } from 'node:crypto';
import { sha, refuse, holdRoot, hashFd } from './io.mjs';
import { lines, json, utf8, pointer, patch, sourceEdits, equal, object } from './json.mjs';
import { uuid, legacyReference, matchBundle } from './codec.mjs';
import { data, metadata, reader, gitText, sdk, validateOperationReceipt, readInteractionReceipt, validateSavedProjectAcknowledgment, validateProjectReviewMetadata } from './target.mjs';
const OP = 'brabbler:operation-receipt', INTERACTION = 'brabbler:interaction-receipt';
const terminal = phase => ['succeeded', 'failed', 'cancelled'].includes(phase);
function requireValue(condition, reason) { if (!condition) refuse(reason); }
function newId(ids, entry = false) {
  let id; do { id = entry ? randomUUID().replaceAll('-', '').slice(0, 8) : randomUUID(); } while (ids.has(id)); ids.add(id); return id;
}
export function session(bytes) {
  const rows = lines(bytes), meaningful = rows.filter(r => r.node), header = meaningful[0]?.node.value;
  requireValue(header?.type === 'session' && typeof header.id === 'string' && typeof header.cwd === 'string', 'invalid-session-header');
  requireValue(header.version === 3, 'unsupported-session-version');
  const entries = meaningful.slice(1).map(r => r.node.value), byId = new Map(), rowById = new Map(), children = new Map();
  for (const row of meaningful.slice(1)) {
    const e = row.node.value;
    requireValue(e.type !== 'session' && typeof e.type === 'string' && typeof e.id === 'string' && e.id.length > 0 && !byId.has(e.id)
      && (e.parentId === null || typeof e.parentId === 'string') && typeof e.timestamp === 'string' && Number.isFinite(Date.parse(e.timestamp)), 'invalid-or-duplicate-entry');
    requireValue(e.parentId === null || byId.has(e.parentId), 'dangling-or-forward-parent');
    byId.set(e.id, e); rowById.set(e.id, row);
    const peers = children.get(e.parentId) ?? []; peers.push(e.id); children.set(e.parentId, peers);
    for (const key of e.type === 'compaction' ? ['firstKeptEntryId'] : ['label', 'context_edit'].includes(e.type) ? ['targetId'] : e.type === 'branch_summary' ? ['fromId'] : []) {
      requireValue(typeof e[key] === 'string' && byId.has(e[key]), 'dangling-graph-target');
      if (e.type === 'context_edit' || e.type === 'compaction') requireValue(ancestor(byId, e.id, e[key]), 'off-branch-context-target');
    }
  }
  return { rows, header, entries, byId, rowById, children };
}
function ancestor(byId, leaf, id) {
  for (let e = byId.get(leaf); e; e = byId.get(e.parentId)) if (e.id === id) return true;
  return false;
}
function occurrence(entry, kind = 'session') {
  let card, cardPath, receipt, interaction;
  if (kind === 'standalone') {
    requireValue(typeof entry.pluginId === 'string', 'malformed-review-owner');
    if (entry.receipt === undefined) return null;
    receipt = entry.receipt; card = receipt?.card; cardPath = ['receipt', 'card'];
  }
  else if (entry.type === 'custom' && entry.customType === OP) { receipt = entry.data; card = receipt?.card; cardPath = ['data', 'card']; }
  else if (entry.type === 'custom' && entry.customType === INTERACTION) { interaction = entry.data; card = interaction?.request; cardPath = ['data', 'request']; if (card?.method !== 'plugin_card') return null; }
  else return null;
  requireValue(object(receipt ?? interaction), 'malformed-review-owner');
  const pluginId = kind === 'standalone' ? entry.pluginId : receipt?.pluginId ?? card?.pluginId;
  requireValue(typeof pluginId === 'string', 'malformed-review-owner');
  if (kind === 'standalone') requireValue([receipt?.pluginId, card?.pluginId].every(id => id === undefined || id === pluginId), 'standalone-plugin-owner-mismatch');
  if (pluginId !== 'git-workflow') return null;
  requireValue(object(card), 'malformed-git-card');
  if (receipt) {
    validateOperationReceipt(receipt);
    if (kind === 'session') requireValue(Number.isSafeInteger(receipt.sequence) && receipt.sequence > 0, 'invalid-receipt-sequence');
  } else requireValue(!!readInteractionReceipt(interaction), 'invalid-interaction-receipt');
  if (card.review?.version === 2) return { card, cardPath, receipt, interaction, target: true, operationId: card.operationId };
  if (card.review !== undefined) requireValue(legacyReference(card.review), 'unsupported-or-corrupt-reference');
  else requireValue(typeof card.patch === 'string' || card.patch === undefined && card.patchContext === undefined, 'unsupported-inline-source');
  requireValue(card.operationId === undefined || uuid(card.operationId), 'invalid-card-operation-id');
  const operationId = receipt?.operationId ?? card.operationId;
  if (card.review) requireValue(card.review.operationId === operationId && card.operationId === operationId, 'review-operation-mismatch');
  return { card, cardPath, receipt, interaction, operationId, generatedOperationId: operationId === undefined };
}
// Frozen legacy tool grammar, not today's settings/defaults. Worktree actions
// are explicit invocation fields; other tool names supply their native action.
const invocations = {
  commit: { name: 'git_commit', required: ['checkout', 'mode', 'message'], optional: ['files'] },
  merge: { name: 'git_merge', required: ['checkout', 'featureBranch'], optional: ['targetBranch', 'mergeMethod'] },
  rebase: { name: 'git_rebase', required: ['checkout', 'featureBranch'], optional: ['targetBranch'] },
  createWorktree: { name: 'git_worktree', required: ['action', 'checkout', 'branch', 'baseBranch', 'path'], optional: [] },
  attachWorktree: { name: 'git_worktree', required: ['action', 'checkout', 'branch', 'baseBranch', 'path'], optional: [] },
  removeWorktree: { name: 'git_worktree', required: ['action', 'checkout', 'path'], optional: [] },
  cleanupFeature: { name: 'git_cleanup', required: ['checkout', 'featureBranch', 'featureTip', 'integrationCommit', 'removeWorktree', 'deleteBranch', 'artifactRoots'], optional: ['targetBranch', 'worktreePath'] },
};
function invocation(model, e, o, proposal) {
  const call = o.receipt?.toolCallId;
  if (!call) return { reason: 'invocation-not-recorded' };
  const matches = [];
  for (let p = model.byId.get(e.parentId); p; p = model.byId.get(p.parentId)) {
    if (p.type === 'message' && p.message?.role === 'assistant' && Array.isArray(p.message.content)) {
      for (const item of p.message.content) if (item.type === 'toolCall' && item.id === call) matches.push({ entry: p, item });
    }
  }
  if (!matches.length) return { reason: 'invocation-not-recorded' };
  requireValue(matches.length === 1, 'ambiguous-tool-call');
  const action = proposal.operation?.action, contract = invocations[action];
  if (!contract) return { reason: 'invocation-action-unavailable' };
  const toolName = contract.name, a = matches[0], args = a.item.arguments;
  requireValue(a.item.name === toolName && object(args), 'contradictory-invocation');
  for (const [key, value] of Object.entries(args)) requireValue([...contract.required, ...contract.optional].includes(key)
    && Object.hasOwn(proposal.operation, key) && equal(value, proposal.operation[key]), 'invocation-argument-mismatch');
  const required = [...contract.required, ...(action === 'commit' && proposal.operation.mode === 'files' ? ['files'] : [])];
  if (required.some(key => !Object.hasOwn(args, key))) return { reason: 'invocation-arguments-incomplete', invocation: a.entry.id };
  const results = []; let cursor = e.id;
  while ((model.children.get(cursor) ?? []).length === 1) {
    cursor = model.children.get(cursor)[0]; const next = model.byId.get(cursor);
    if (next.type === 'message' && next.message?.role === 'assistant') break;
    if (next.type === 'custom' && next.customType === OP && next.data?.toolCallId === call && terminal(next.data.phase)) break;
    if (next.type === 'message' && next.message?.role === 'toolResult' && next.message.toolCallId === call) {
      requireValue(next.message.toolName === toolName, 'tool-result-name-mismatch'); results.push(next);
    }
  }
  requireValue(results.length <= 1, 'ambiguous-tool-result');
  if (!results.length) return { reason: 'branch-local-result-not-recorded', invocation: a.entry.id };
  const result = results[0], details = result.message.details;
  if (!object(details)) return { reason: 'result-details-not-recorded', result: result.id, invocation: a.entry.id };
  requireValue(details.operationId === o.operationId && details.action === action, 'tool-result-owner-mismatch');
  return { details, result: result.id, invocation: a.entry.id, reason: details.receiptPersisted === true ? undefined : 'terminal-persistence-unproven' };
}
export async function capture(proposal, comparison, admissions, report) {
  const locator = proposal.operation?.checkout;
  const admission = admissions.find(a => a.from === locator);
  if (!admission) return { unavailable: { reason: 'legacy-binding-not-captured', comparison } };
  const root = holdRoot(admission.to, { absent: true });
  if (!root) return { unavailable: { reason: 'repository-unavailable', comparison } };
  try {
    root.check();
    let format;
    try { format = (await gitText(admission.to, ['rev-parse', '--show-object-format'])).trim(); }
    catch { return { unavailable: { reason: 'repository-unavailable', comparison } }; }
    requireValue(['sha1', 'sha256'].includes(format) && comparison.before.length === (format === 'sha1' ? 40 : 64), 'object-format-mismatch');
    for (const [key, oid] of Object.entries(comparison)) {
      let type;
      try { type = (await gitText(admission.to, ['cat-file', '-t', oid])).trim(); }
      catch { return { unavailable: { reason: 'objects-unavailable', comparison } }; }
      requireValue(type === (proposal.operation.action === 'commit' && !report && key === 'after' ? 'tree' : 'commit'), 'endpoint-object-type');
    }
    const missing = () => { root.check(); return { unavailable: { reason: 'objects-unavailable', comparison } }; };
    if (report?.commit) {
      let content;
      try { content = await gitText(admission.to, ['cat-file', '-p', report.commit.oid]); }
      catch { return missing(); }
      const headers = content.slice(0, content.indexOf('\n\n')).split('\n');
      requireValue(headers.find(l => l.startsWith('tree '))?.slice(5) === report.commit.tree
        && equal(headers.filter(l => l.startsWith('parent ')).map(l => l.slice(7)), report.commit.parents), 'postflight-object-contradiction');
      if (proposal.operation.action === 'merge' || proposal.operation.action === 'rebase') {
        const target = report.refs.target.before, feature = report.refs.feature.before;
        const original = proposal.source.kind === 'git' ? proposal.source.captured.comparison : proposal.source.unavailable.comparison;
        for (const oid of new Set([target, feature, original.before])) {
          requireValue(data.isGitReviewOid(oid), 'invalid-postflight-dependency');
          let type;
          try { type = (await gitText(admission.to, ['cat-file', '-t', oid])).trim(); }
          catch { return missing(); }
          requireValue(type === 'commit', 'endpoint-object-type');
        }
        let base;
        try { base = (await gitText(admission.to, ['merge-base', target, feature])).trim(); }
        catch (error) { if (error.status === 1) refuse('proposal-base-contradiction'); return missing(); }
        requireValue(base === original.before, 'proposal-base-contradiction');
        // Merge must retain BOTH selected histories (including FF/no-op), not
        // merely contain the feature. Rebase must integrate its saved target.
        for (const before of proposal.operation.action === 'merge' ? [feature, target] : [target]) {
          try { await gitText(admission.to, ['merge-base', '--is-ancestor', before, comparison.after]); }
          catch (error) { if (error.status === 1) refuse('postflight-ancestry-contradiction'); return missing(); }
        }
      }
    }
    try {
      const captured = await reader.captureGitReview(admission.to, comparison);
      captured.repository.bindingOrigin = 'offline-admitted'; root.check();
      return { captured };
    } catch {
      root.check(); return { unavailable: { reason: 'objects-unavailable', comparison } };
    }
  } finally { root.close(); }
}
function resultBasis(proposal, report) {
  if (proposal.kind !== 'proposal' || !report || !['commit', 'merge', 'rebase'].includes(proposal.operation.action)) return;
  const action = proposal.operation.action, names = action === 'commit' ? ['subject'] : ['feature', 'target'];
  if (!object(report.refs) || names.some(n => !object(report.refs[n]))) return;
  const basis = { action, refs: Object.fromEntries(names.map(n => [n, { branch: report.refs[n].branch, before: report.refs[n].before }])) };
  if (action === 'commit') basis.candidateTree = proposal.source.kind === 'git' ? proposal.source.captured.comparison.after : proposal.source.unavailable.comparison?.after;
  if (action === 'merge') basis.mergeMethod = proposal.nativeArgs.includes('--ff-only') ? 'ff-only' : proposal.nativeArgs.includes('--no-ff') ? 'non-ff' : undefined;
  if (!data.matchesGitReviewResultBasis(proposal, basis)) return;
  return basis;
}
async function settlement(o, proposal, ref, proof, admissions) {
  const outcome = { phase: o.receipt.phase, effectStarted: o.receipt.effectStarted };
  for (const key of ['completed', 'checksStarted']) {
    const saved = o.receipt[key], reported = proof.details?.[key];
    if (saved !== undefined) requireValue(typeof saved === 'boolean', 'invalid-outcome-fact');
    if (reported !== undefined) requireValue(typeof reported === 'boolean', 'invalid-result-fact');
    if (saved !== undefined && reported !== undefined) requireValue(saved === reported, 'contradictory-outcome');
    if (saved !== undefined || reported !== undefined) outcome[key] = saved ?? reported;
  }
  const effects = o.receipt.completedEffects ?? proof.details?.effects;
  if (o.receipt.completedEffects && proof.details?.effects) requireValue(equal(o.receipt.completedEffects, proof.details.effects), 'contradictory-effects');
  if (effects !== undefined) outcome.effects = effects;
  const attempted = o.receipt.attemptedEffect ?? proof.details?.attemptedEffect;
  if (attempted !== undefined) outcome.attemptedEffect = attempted;
  if (proof.details?.effectStarted !== undefined) requireValue(proof.details.effectStarted === outcome.effectStarted, 'contradictory-effect-start');
  const payload = { version: 1, kind: 'settlement', proposal: ref, outcome, relation: 'unknown', unavailableResult: { reason: 'result-unproven' } };
  const postflight = proof.details?.postflight;
  if (postflight !== undefined && proposal.operation) {
    requireValue(object(postflight) && postflight.version === 1, 'unsupported-postflight');
    if (postflight.action !== undefined) {
      requireValue(postflight.action === proposal.operation.action, 'unsupported-postflight'); payload.postflight = postflight;
    }
  }
  // An incomplete source cannot supply an independent native action/basis. Its
  // complete owner-local result remains byte-identical in the original record.
  const basis = resultBasis(proposal, payload.postflight);
  let mapped;
  try { mapped = basis && data.gitReviewResult(basis, postflight); } catch { refuse('invalid-postflight'); }
  if (mapped && !proof.reason && outcome.completed === true && outcome.effectStarted === true && outcome.phase === 'succeeded') {
    payload.resultBasis = basis;
    // P2 requires a captured proposal to admit an actual comparison. When that
    // prerequisite is unavailable, preserve qualified OIDs without extra graph
    // materialization reads (which may themselves depend on missing history).
    const available = proposal.source.kind === 'git' ? await capture(proposal, mapped.comparison, admissions, postflight)
      : { unavailable: { reason: proposal.source.unavailable.reason, comparison: mapped.comparison,
        ...(proposal.source.unavailable.repository ? { repository: proposal.source.unavailable.repository } : {}) } };
    if (available.captured && proposal.source.kind === 'git') {
      payload.result = { captured: available.captured, commit: mapped.commit, label: mapped.label }; delete payload.unavailableResult;
      payload.relation = await reader.gitReviewRelation(proposal.source.captured, available.captured, { assertAllowed: async p => {
        requireValue(admissions.some(a => a.to === p), 'repository-not-admitted');
      } });
    } else payload.unavailableResult = available.unavailable ?? { reason: 'objects-unavailable', comparison: mapped.comparison };
  }
  requireValue(!!data.readGitReviewPayload(payload) && data.resolveGitReviewSettlement(proposal, payload), 'invalid-target-settlement');
  return payload;
}
function envelope(operationId, payload, ids) { return metadata.snapshotOperationReview('git-workflow', operationId, data.GIT_REVIEW_FORMAT, payload, newId(ids)); }
async function proposalFor(o, bundles, admissions) {
  if (o.card.review) {
    const value = bundles.decoded.get(o.card.review.id);
    if (!value) {
      requireValue(!bundles.reports.some(r => r.path === o.card.review.id), 'referenced-bundle-blocked');
      return { payload: { version: 1, kind: 'legacy-unavailable', unavailable: { reason: 'legacy-endpoints-missing', detail: 'Legacy bundle missing.' } }, source: 'legacy-bundle-missing' };
    }
    matchBundle(value, o.card.review);
    const payload = structuredClone(value.payload);
    if (payload.source.unavailable.comparison) {
      const availability = await capture(payload, payload.source.unavailable.comparison, admissions);
      payload.source = availability.captured ? { kind: 'git', captured: availability.captured } : { kind: 'unavailable', unavailable: availability.unavailable };
    }
    return { payload, witness: value.witness, source: 'validated-bundle', digest: value.digest };
  }
  const details = Object.fromEntries(['title', 'subtitle', 'text', 'markdown', 'scope', 'fields', 'sections', 'patchBefore', 'patchAfter', 'requiredAcknowledgment']
    .filter(k => Object.hasOwn(o.card, k)).map(k => [k, o.card[k]]));
  const payload = { version: 1, kind: 'legacy-unavailable', unavailable: { reason: 'legacy-endpoints-missing',
    detail: o.card.patch === undefined ? 'Source metadata was not recorded.' : 'Inline source did not record structured endpoints.' }, details };
  requireValue(!!data.readGitReviewPayload(payload), 'unsupported-inline-details');
  return { payload, source: o.card.patch === undefined ? 'legacy-source-not-recorded' : 'inline-endpoints-unavailable' };
}
function validateReferences(model) {
  for (const entry of model.entries) {
    if (entry.type === 'custom' && entry.customType === metadata.OPERATION_REVIEW_TYPE) {
      const record = metadata.readOperationReview(entry.data);
      requireValue(!!record && (record.pluginId !== 'git-workflow' || !!data.readGitReviewPayload(record.payload)), 'invalid-target-record');
    }
    const o = occurrence(entry); if (!o?.target) continue;
    const record = metadata.findOperationReview(model.entries, 'git-workflow', o.card.review, entry.id);
    requireValue(!!record && record.format === data.GIT_REVIEW_FORMAT, 'target-reference-not-ancestral');
    const payload = data.readGitReviewPayload(record.payload); requireValue(!!payload, 'invalid-target-payload');
    if (payload.kind === 'settlement') {
      const linked = metadata.findOperationReview(model.entries, 'git-workflow', payload.proposal, entry.id), proposal = data.readGitReviewPayload(linked?.payload);
      requireValue(proposal && proposal.kind !== 'settlement' && data.resolveGitReviewSettlement(proposal, payload), 'invalid-target-link');
    }
  }
}
export async function convertSession(bytes, bundles, admissions = []) {
  const model = session(bytes), ids = new Set(model.entries.map(e => e.id)), proposals = new Map(), insertions = [], occurrences = [], changedRows = new Map();
  for (const entry of model.entries) if (entry.type === 'custom' && entry.customType === metadata.OPERATION_REVIEW_TYPE) {
    requireValue(uuid(entry.data?.id) && !ids.has(entry.data.id), 'target-record-id-collision'); ids.add(entry.data.id);
  }
  validateReferences(model);
  for (const entry of model.entries) {
    const o = occurrence(entry); if (!o) continue;
    if (o.target) { occurrences.push({ entryId: entry.id, pointer: '/' + o.cardPath.join('/') + '/review', classification: 'already-target', reference: o.card.review }); continue; }
    if (!o.operationId) o.operationId = newId(ids);
    const sourceKey = sha(JSON.stringify([o.operationId, o.card.review ?? { inline: o.card }]));
    let previous = entry.parentId, found;
    while (previous !== null) { found = proposals.get(previous)?.get(sourceKey); if (found) break; previous = model.byId.get(previous).parentId; }
    const added = []; let parentId = entry.parentId;
    const add = record => {
      const node = { type: 'custom', customType: metadata.OPERATION_REVIEW_TYPE, id: newId(ids, true), parentId, timestamp: entry.timestamp, data: record };
      added.push(node); insertions.push({ id: node.id, parentId, anchor: entry.id, recordId: record.id, sha256: record.sha256 }); parentId = node.id;
    };
    let decoded;
    if (!found) {
      decoded = await proposalFor(o, bundles, admissions); const record = envelope(o.operationId, decoded.payload, ids); add(record);
      found = { record, payload: decoded.payload }; proposals.set(entry.id, new Map([[sourceKey, found]]));
    }
    let record = found.record, proof;
    if (o.receipt && terminal(o.receipt.phase)) {
      proof = invocation(model, entry, o, found.payload);
      record = envelope(o.operationId, await settlement(o, found.payload, metadata.operationReviewReference(found.record), proof, admissions), ids); add(record);
    }
    const row = model.rowById.get(entry.id), edits = sourceEdits(row.node, o.cardPath, metadata.operationReviewReference(record)), allowed = edits.allowed;
    if (parentId !== entry.parentId) { const token = pointer(row.node, ['parentId']); edits.edits.push({ start: token.start, end: token.end, text: JSON.stringify(parentId) }); allowed.push(['parentId']); }
    if (o.generatedOperationId) { const token = pointer(row.node, o.cardPath); edits.edits.push({ start: token.end - 1, end: token.end - 1, text: `,"operationId":${JSON.stringify(o.operationId)}` }); allowed.push([...o.cardPath, 'operationId']); }
    const text = patch(row.text, edits.edits), delimiter = row.delimiter || '\n';
    changedRows.set(row, added.map(e => JSON.stringify(e) + delimiter).join('') + text + row.delimiter);
    occurrences.push({ entryId: entry.id, pluginId: 'git-workflow', pointer: '/' + o.cardPath.join('/') + '/review', original: o.card.review ?? (o.card.patch === undefined ? { sourceNotRecorded: true } : { inline: true, sha256: sha(o.card.patch) }), operationId: o.operationId,
      stage: o.receipt ? { phase: o.receipt.phase, sequence: o.receipt.sequence, toolCallId: o.receipt.toolCallId } : { requestId: o.interaction.request.id },
      proposalAvailability: found.payload.kind === 'proposal' ? found.payload.source.kind === 'git' ? 'offline-admitted' : found.payload.source.kind === 'unavailable' ? found.payload.source.unavailable.reason : 'resources' : found.payload.unavailable.reason,
      resultAvailability: record.payload.kind === 'settlement' ? record.payload.result ? 'offline-admitted' : record.payload.unavailableResult?.reason ?? 'not-recorded' : 'not-applicable',
      generatedOperationId: o.generatedOperationId, classification: 'converted', reference: metadata.operationReviewReference(record), proposal: metadata.operationReviewReference(found.record),
      allowed, ...(decoded ? { source: decoded.source, metadataDigest: decoded.digest, witness: decoded.witness } : {}),
      ...(proof ? { proof: { invocation: proof.invocation, result: proof.result, reason: proof.reason ?? 'exact-local-result',
        facts: Object.fromEntries(Object.keys(record.payload.outcome).map(k => [k, { entryId: ['phase', 'effectStarted'].includes(k) || Object.hasOwn(o.receipt, k === 'effects' ? 'completedEffects' : k) ? entry.id : proof.result,
          pointer: ['phase', 'effectStarted'].includes(k) || Object.hasOwn(o.receipt, k === 'effects' ? 'completedEffects' : k) ? `/data/${k === 'effects' ? 'completedEffects' : k}` : `/message/details/${k}` }])) } } : {}) });
  }
  if (!changedRows.size) return { output: bytes, plan: { ownerId: model.header.id, insertions, occurrences,
    validation: { unchangedBytes: true, leaf: model.entries.at(-1)?.id ?? null } } };
  const output = Buffer.from(model.rows.map(row => changedRows.get(row) ?? row.text + row.delimiter).join(''));
  const target = session(output); validateReferences(target);
  const plan = { ownerId: model.header.id, insertions, occurrences, validation: preservation(model, target, { insertions, occurrences }) };
  return { output, plan };
}
function removePath(value, path) { let object = value; for (const key of path.slice(0, -1)) object = object?.[key]; if (object) delete object[path.at(-1)]; }
export function preservation(original, target, plan) {
  const inserted = new Set(plan.insertions.map(i => i.id)), entries = target.entries.filter(e => !inserted.has(e.id));
  requireValue(equal(original.entries.map(e => e.id), entries.map(e => e.id)), 'original-entry-order-changed');
  requireValue(original.rows[0].text === target.rows[0].text && original.rows[0].delimiter === target.rows[0].delimiter, 'header-bytes-changed');
  const changed = new Map(plan.occurrences.filter(o => o.classification === 'converted').map(o => [o.entryId, o]));
  // After independent raw-byte proof, reuse opaque parsed values for the oracle.
  // This is not a context implementation/cache: BOTH sides still run the actual
  // SDK projector at every leaf/branch point/reference. Avoid rehashing unbounded
  // identical provider messages for every historical receipt in a long session.
  const canonical = new Map(target.byId);
  for (const [index, old] of original.entries.entries()) {
    const next = entries[index];
    let p = next.parentId; while (inserted.has(p)) p = target.byId.get(p).parentId;
    requireValue(p === old.parentId, 'graph-splice-mismatch');
    const occurrence = changed.get(old.id);
    if (!occurrence) {
      const a = original.rowById.get(old.id), b = target.rowById.get(old.id);
      requireValue(a.text === b.text && a.delimiter === b.delimiter, 'opaque-line-bytes-changed'); canonical.set(old.id, old);
    } else {
      const maskedOld = structuredClone(old), maskedNew = structuredClone(next);
      for (const path of occurrence.allowed) { removePath(maskedOld, path); removePath(maskedNew, path); }
      requireValue(equal(maskedOld, maskedNew), 'nonreference-field-changed');
    }
  }
  const points = original.entries.filter(e => (original.children.get(e.id) ?? []).length !== 1 || plan.occurrences.some(o => o.entryId === e.id)).map(e => e.id);
  const projections = [], messageHashes = new WeakMap(), targetEntries = target.entries.map(e => canonical.get(e.id));
  function projectionHash(projection) {
    const hashes = projection.messages.map(message => {
      if (messageHashes.has(message)) return messageHashes.get(message);
      const hash = sha(JSON.stringify(message)); messageHashes.set(message, hash); return hash;
    });
    return sha(JSON.stringify([hashes, projection.thinkingLevel, projection.model]));
  }
  for (const id of points) {
    const a = projectionHash(sdk.buildSessionContext(original.entries, id, original.byId)), b = projectionHash(sdk.buildSessionContext(targetEntries, id, canonical));
    requireValue(a === b, 'sdk-model-projection-changed');
    // Receipt order/ancestry/sequence/phase/responses were independently preserved.
    projections.push({ entryId: id, sha256: a });
  }
  requireValue(original.entries.at(-1)?.id === target.entries.at(-1)?.id, 'physical-leaf-changed');
  return { graph: 'exact-splice', nonReference: 'exact', modelProjection: projections, leaf: original.entries.at(-1)?.id ?? null };
}
export function sdkPrivateValidation(originalFd, stagedFd, outputDirectoryFd, originalBytes, outputBytes) {
  // Only held PRIVATE copies, never an original state descriptor or live agent.
  const originalFile = `/proc/self/fd/${originalFd}`, stagedFile = `/proc/self/fd/${stagedFd}`, privateDirectory = `/proc/self/fd/${outputDirectoryFd}/validation`;
  const before = hashFd(stagedFd), manager = sdk.SessionManager.open(stagedFile, privateDirectory);
  const old = sdk.SessionManager.open(originalFile, privateDirectory);
  requireValue(manager.getLeafId() === old.getLeafId(), 'sdk-reopened-leaf-changed');
  requireValue(hashFd(originalFd) === sha(originalBytes) && hashFd(stagedFd) === before && before === sha(outputBytes), 'sdk-rewrote-private-input');
}
function validateStandaloneReferences(record) {
  if (record.pluginId !== 'git-workflow') return;
  for (const review of record.reviewMetadata ?? []) {
    requireValue(review.format === data.GIT_REVIEW_FORMAT, 'unsupported-target-format');
    const payload = data.readGitReviewPayload(review.payload); requireValue(!!payload, 'invalid-target-payload');
    if (payload.kind === 'settlement') {
      const linked = record.reviewMetadata.find(r => r.id === payload.proposal.id && r.operationId === payload.proposal.operationId);
      const proposal = data.readGitReviewPayload(linked?.payload);
      requireValue(proposal && proposal.kind !== 'settlement' && data.resolveGitReviewSettlement(proposal, payload), 'invalid-target-link');
    }
  }
}
export async function convertStandalone(bytes, filename, bundles, admissions = []) {
  // Old-locator maps are session CONTENT mappings, not standalone owner moves.
  admissions = admissions.filter(a => a.from === a.to);
  const text = utf8(bytes), node = json(text), record = node.value;
  requireValue(record.version === 1 && uuid(record.id) && filename === record.id + '.json' && record.requestId === record.id
    && /^[a-f0-9]{64}$/.test(record.inputDigest) && ['project', 'anchor', 'cwd'].every(k => typeof record[k] === 'string'), 'invalid-standalone-owner');
  requireValue(!['card', 'review', 'patch', 'patchContext'].some(k => Object.hasOwn(record, k)), 'unsupported-standalone-source-owner');
  if (record.receipt !== undefined) validateOperationReceipt(record.receipt);
  validateSavedProjectAcknowledgment(record); validateProjectReviewMetadata(record); validateStandaloneReferences(record);
  const o = occurrence(record, 'standalone');
  if (!o || o.target) return { output: bytes, plan: { ownerId: record.id, occurrences: o ? [{ classification: 'already-target', reference: o.card.review }] : [], ownerAccess: 'not-assessed' } };
  requireValue(uuid(o.operationId), 'invalid-standalone-operation-id');
  const ids = new Set([record.id, o.operationId, ...(record.reviewMetadata ?? []).map(r => r.id)]), decoded = await proposalFor(o, bundles, admissions);
  const proposal = envelope(o.operationId, decoded.payload, ids), records = [...(record.reviewMetadata ?? []), proposal]; let selected = proposal, proof;
  if (o.receipt && terminal(o.receipt.phase)) {
    const details = record.result?.details;
    const action = decoded.payload.operation?.action;
    if (object(details)) requireValue(details.operationId === o.operationId
      && (action === undefined || details.action === undefined || details.action === action), 'standalone-result-owner-mismatch');
    proof = { ...(object(details) ? { details } : {}), reason: action === undefined || details?.action === undefined ? 'result-action-unavailable'
      : details.receiptPersisted === true ? undefined : 'terminal-persistence-unproven' };
    selected = envelope(o.operationId, await settlement(o, decoded.payload, metadata.operationReviewReference(proposal), proof, admissions), ids); records.push(selected);
  }
  const edits = sourceEdits(node, o.cardPath, metadata.operationReviewReference(selected));
  if (node.properties.has('reviewMetadata')) { const t = node.properties.get('reviewMetadata'); edits.edits.push({ start: t.start, end: t.end, text: JSON.stringify(records) }); }
  else edits.edits.push({ start: node.end - 1, end: node.end - 1, text: `,"reviewMetadata":${JSON.stringify(records)}` });
  const output = Buffer.from(patch(text, edits.edits)), target = json(utf8(output)).value;
  validateOperationReceipt(target.receipt); validateSavedProjectAcknowledgment(target); validateProjectReviewMetadata(target); validateStandaloneReferences(target);
  const a = structuredClone(record), b = structuredClone(target);
  for (const path of [...edits.allowed, ['reviewMetadata']]) { removePath(a, path); removePath(b, path); }
  requireValue(equal(a, b), 'standalone-evidence-changed');
  return { output, plan: { ownerId: record.id, ownerAccess: 'not-assessed', occurrences: [{ pointer: '/receipt/card/review', original: o.card.review ?? { inline: true },
    classification: 'converted', proposalAvailability: decoded.payload.kind === 'proposal' ? decoded.payload.source.kind === 'git' ? 'offline-admitted' : decoded.payload.source.unavailable?.reason ?? 'resources' : decoded.payload.unavailable.reason,
    resultAvailability: selected.payload.kind === 'settlement' ? selected.payload.result ? 'offline-admitted' : selected.payload.unavailableResult?.reason ?? 'not-recorded' : 'not-applicable',
    reference: metadata.operationReviewReference(selected), proposal: metadata.operationReviewReference(proposal), allowed: edits.allowed,
    source: decoded.source, metadataDigest: decoded.digest, witness: decoded.witness, proof: proof?.reason ?? 'exact-local-result' }] } };
}
