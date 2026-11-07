import path from "node:path";
import { statSync } from "node:fs";
import { isFilePathAllowed, isExistingFilePathAllowed } from "./file-access";
import { saveEditableFile } from "./file-edit";
import { samePath } from "./paths";
import { notebookMetadataRanges } from "./guided-review";
import { readAuthoringNotebook, notebookDigest, validateNotebookChapterChange, type AuthoringNotebook } from "./notebook-authoring";
import { withGitReadScope, GitReadLimitError } from "./git-read-scope";
import { GitExplorerError } from "./git-explorer";
import { DiffContextError } from "./git-file-context";
import { analyzeGitReference, captureReferenceRepository, guardReferenceRepository, fullOid, ReferenceProblem, type GitEvidence, type ReferenceRepository } from "./notebook-reference-git";

export interface ReferenceMapping { cwd: string; targetIds: string[]; pairs: { oldOid: string; newOid: string }[] }
export interface ReferenceAccess { roots: Set<string>; assertRead: () => void; assertWrite?: () => void; signal?: AbortSignal }
export interface ReferenceBinding { version: 1; digest: string }
interface Target { chapterIndex: number; stepId: string; reference: AuthoringNotebook["notebook"]["chapters"][number]["steps"][number]["targets"][number] }
type Resolution = Awaited<ReturnType<typeof analyzeGitReference>>;
export type ReferenceResult = { targetId: string; stepId: string; path: string; original: Target["reference"]; writable: boolean } & (
  { status: "unresolved"; problem: { code: string; message: string } } |
  Resolution & { repository: ReferenceRepository }
);
const diagnostic = (error: unknown) => error instanceof ReferenceProblem || error instanceof GitExplorerError ? { code: error.code, message: error.message }
  : error instanceof GitReadLimitError ? { code: "LIMIT", message: error.message }
  : error instanceof DiffContextError ? { code: error.status === 413 ? "LIMIT" : "UNAVAILABLE", message: error.message }
  : { code: "UNAVAILABLE", message: `Local evidence read failed${error && typeof error === "object" && "code" in error && /^(?:E[A-Z_]+|[0-9]+)$/.test(String(error.code)) ? ` (${error.code})` : ""}; no reference edit was inferred` };
function admit(cwd: string, access: ReferenceAccess) {
  access.assertRead();
  if (!path.isAbsolute(cwd) || path.normalize(cwd) !== cwd || !isFilePathAllowed(cwd, access.roots) || !isExistingFilePathAllowed(cwd, access.roots) || !statSync(cwd).isDirectory()) throw new ReferenceProblem("DENIED", "Repository requires independent physical-root admission");
}
function packageIdentity(package_: AuthoringNotebook) {
  return [package_.manifest, ...package_.chapters].map(file => ({ path: file.path, revision: file.revision, editIdentity: file.editIdentity, writable: file.writable }));
}
function allTargets(package_: AuthoringNotebook): Map<string, Target> {
  const targets = new Map<string, Target>();
  package_.notebook.chapters.forEach((chapter, chapterIndex) => chapter.steps.forEach(step => step.targets.forEach(reference => targets.set(reference.id, { chapterIndex, stepId: step.id, reference }))));
  return targets;
}
function validateMappings(mappings: ReferenceMapping[]) {
  if (!Array.isArray(mappings) || !mappings.length || mappings.length > 8) throw new Error("Supply 1–8 explicit repository mappings");
  let targets = 0;
  for (const mapping of mappings) {
    if (!mapping || typeof mapping.cwd !== "string" || mapping.cwd.length > 4096 || !Array.isArray(mapping.targetIds) || !mapping.targetIds.length || !Array.isArray(mapping.pairs) || !mapping.pairs.length || mapping.pairs.length > 64) throw new Error("Invalid bounded repository mapping");
    targets += mapping.targetIds.length;
    if (targets > 32 || mapping.targetIds.some(id => typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id))) throw new Error("Select at most 32 explicit stable target IDs");
    for (const pair of mapping.pairs) { fullOid(pair.oldOid); fullOid(pair.newOid); }
  }
}
function mapped(reference: GitEvidence, mapping: ReferenceMapping): GitEvidence {
  const resolve = (oldOid: string) => {
    const pairs = mapping.pairs.filter(pair => pair.oldOid === oldOid);
    if (pairs.length !== 1 || mapping.pairs.filter(pair => pair.newOid === pairs[0].newOid).length !== 1) throw new ReferenceProblem("AMBIGUOUS_MAPPING", "Require one-to-one explicit mappings; missing, repeated, split and squashed mappings remain unresolved");
    return pairs[0].newOid;
  };
  return reference.kind === "compare" ? { ...reference, base: resolve(reference.base), candidate: resolve(reference.candidate) } : { ...reference, oid: resolve(reference.oid) };
}
function replacementFence(source: string, targetId: string, reference: GitEvidence) {
  const range = notebookMetadataRanges(source).find(range => range.language !== "brabbler-step" && JSON.parse(range.value).id === targetId);
  if (!range) throw new ReferenceProblem("INVALID", "Pinned metadata fence is missing");
  const openingEnd = source.indexOf("\n", range.start) + 1, closingStart = source.lastIndexOf("\n", range.end - 1) + 1;
  const opening = source.slice(range.start, openingEnd), closing = source.slice(closingStart, range.end);
  const marker = /^ {0,3}(`{3,}|~{3,})/.exec(opening)?.[1];
  if (!marker || closingStart < openingEnd || !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t\\r]*$`).test(closing)) throw new ReferenceProblem("INVALID", "Reference edits require an explicitly closed metadata fence");
  const nl = opening.endsWith("\r\n") ? "\r\n" : "\n";
  return { start: range.start, end: range.end, text: opening + JSON.stringify(reference, null, 2).replace(/\n/g, nl) + nl + closing };
}
async function analyze(indexPath: string, mappings: ReferenceMapping[], access: ReferenceAccess, signal: AbortSignal) {
  const check = () => { signal.throwIfAborted(); access.assertRead(); };
  check(); validateMappings(mappings);
  const package_ = readAuthoringNotebook(indexPath, access.roots), targets = allTargets(package_), selected = new Map<string, ReferenceMapping[]>();
  for (const mapping of mappings) for (const id of mapping.targetIds) selected.set(id, [...selected.get(id) ?? [], mapping]);
  const results: ReferenceResult[] = [];
  for (const [targetId, candidates] of selected) {
    check();
    const target = targets.get(targetId);
    // Unknown IDs cannot bind a safe destination. Refuse rather than invent a
    // chapter/step identity in a serializable plan.
    if (!target) throw new Error(`Notebook target does not exist: ${targetId}`);
    const file = package_.chapters[target.chapterIndex];
    const base = { targetId, stepId: target.stepId, path: file.path, original: target.reference, writable: file.writable };
    try {
      if (candidates.length !== 1) throw new ReferenceProblem("AMBIGUOUS_MAPPING", "Target appears in multiple mappings");
      const mapping = candidates[0], original = target.reference;
      if (mappings.filter(other => samePath(other.cwd, mapping.cwd)).length !== 1) throw new ReferenceProblem("AMBIGUOUS_MAPPING", "Use one combined mapping per checkout; partitioned mappings cannot bypass split/squash refusal");
      if (original.kind === "file" || original.kind === "web") throw new ReferenceProblem("NOT_GIT", "Only explicit Git evidence can be refreshed");
      if (!samePath(original.cwd, mapping.cwd)) throw new ReferenceProblem("REPOSITORY_MISMATCH", "Mapping does not name this reference's exact checkout");
      const proposed = mapped(original, mapping);
      admit(mapping.cwd, access);
      const repository = await captureReferenceRepository(mapping.cwd, original.branch);
      const resolution = await analyzeGitReference(original, proposed, repository, signal);
      replacementFence(file.source, targetId, resolution.proposed);
      check(); admit(mapping.cwd, access);
      results.push({ ...base, ...resolution, repository });
    } catch (error) { check(); results.push({ ...base, status: "unresolved", problem: diagnostic(error) }); }
  }
  check();
  // Recheck the entire package after asynchronous Git work. Captured bytes and
  // old results cannot authorize overwriting an intervening chapter/manifest edit.
  if (JSON.stringify(packageIdentity(package_)) !== JSON.stringify(packageIdentity(readAuthoringNotebook(indexPath, access.roots)))) throw new Error("Notebook changed during analysis; inspect again");
  const binding: ReferenceBinding = { version: 1, digest: notebookDigest(JSON.stringify({ indexPath, mappings, files: packageIdentity(package_), results })) };
  return { package_, results, binding };
}
export async function analyzeNotebookReferences(indexPath: string, mappings: ReferenceMapping[], access: ReferenceAccess) {
  return withGitReadScope(access.signal, access.assertRead, async signal => {
    const { results, binding } = await analyze(indexPath, mappings, access, signal);
    return { indexPath, mappings, binding, results, notice: "Analysis is not authority or test evidence. Apply only explicitly accepted targets after inspecting affected prose; no Git mutations are performed." };
  });
}
export async function applyNotebookReferences(indexPath: string, mappings: ReferenceMapping[], binding: ReferenceBinding, acceptedTargets: string[], access: ReferenceAccess) {
  const check = () => { access.signal?.throwIfAborted(); access.assertRead(); if (!access.assertWrite) throw new Error("Reference application requires edit permission"); access.assertWrite(); };
  check();
  if (!binding || binding.version !== 1 || !/^[a-f0-9]{64}$/.test(binding.digest) || !Array.isArray(acceptedTargets) || !acceptedTargets.length || acceptedTargets.length > 32 || new Set(acceptedTargets).size !== acceptedTargets.length) throw new Error("Supply the analysis binding and explicit unique accepted target IDs");
  return withGitReadScope(access.signal, check, async signal => {
    const analyzed = await analyze(indexPath, mappings, access, signal);
    if (analyzed.binding.digest !== binding.digest) throw new Error("Reference analysis changed; inspect/analyze again before applying");
    const selected = acceptedTargets.map(id => {
      const result = analyzed.results.find(result => result.targetId === id);
      if (!result || result.status === "unresolved") throw new Error(`Target has no validated proposal: ${id}`);
      if (!result.writable) throw new Error("Selected chapter is not writable");
      return result;
    });
    const prepared = analyzed.package_.chapters.flatMap((file, chapterIndex) => {
      const changes = selected.filter(result => result.path === file.path && JSON.stringify(result.original) !== JSON.stringify(result.proposed));
      if (!changes.length) return [];
      const edits = changes.map(result => replacementFence(file.source, result.targetId, result.proposed)).sort((a, b) => b.start - a.start);
      let source = file.source;
      for (const edit of edits) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
      validateNotebookChapterChange(analyzed.package_, chapterIndex, source, new Set(changes.map(result => result.stepId)));
      return [{ file, source, changes }];
    });
    // Preflight the combined projected package too: formatting multiple fences
    // can cumulatively exceed the package bound even when each file fits alone.
    let projected = analyzed.package_;
    for (const item of prepared) {
      const index = projected.chapters.findIndex(file => file.path === item.file.path);
      const steps = validateNotebookChapterChange(projected, index, item.source, new Set(item.changes.map(change => change.stepId)));
      projected = { ...projected, chapters: projected.chapters.map((file, i) => i === index ? { ...file, source: item.source } : file),
        notebook: { ...projected.notebook, chapters: projected.notebook.chapters.map((chapter, i) => i === index ? { ...chapter, steps } : chapter) } };
    }
    const expected = packageIdentity(analyzed.package_);
    const completed: { path: string; targetIds: string[]; previousRevision: string; revision: string }[] = [];
    for (let i = 0; i < prepared.length; i++) {
      const item = prepared[i]; let attempted = false;
      try {
        signal.throwIfAborted(); check();
        for (const change of item.changes) { admit(change.repository.cwd, access); await guardReferenceRepository(change.repository); }
        signal.throwIfAborted(); check();
        const current = readAuthoringNotebook(indexPath, access.roots);
        if (JSON.stringify(packageIdentity(current)) !== JSON.stringify(expected)) throw new Error("Notebook changed before this file's save");
        const chapterIndex = current.chapters.findIndex(file => file.path === item.file.path), file = current.chapters[chapterIndex];
        validateNotebookChapterChange(current, chapterIndex, item.source, new Set(item.changes.map(result => result.stepId)));
        signal.throwIfAborted(); check();
        attempted = true;
        const saved = saveEditableFile(file.path, access.roots, item.source, file.revision, file.editIdentity);
        completed.push({ path: file.path, targetIds: item.changes.map(result => result.targetId), previousRevision: file.revision, revision: saved.revision });
        expected[chapterIndex + 1] = { ...expected[chapterIndex + 1], revision: saved.revision };
      } catch (error) {
        return { status: completed.length ? "partial" as const : "refused" as const, completed,
          failed: { path: item.file.path, outcome: attempted ? "unknown; reread before retry" : "not written by this operation", message: error instanceof Error ? error.message : "Reference application stopped" },
          unattempted: prepared.slice(i + 1).map(item => item.file.path), notice: "No rollback or replay. Reread changed/uncertain files and analyze anew before continuing." };
      }
    }
    return { status: "applied" as const, completed, unchangedTargets: selected.filter(result => JSON.stringify(result.original) === JSON.stringify(result.proposed)).map(result => result.targetId), unattempted: [], notice: "Metadata only. Reload guide; no Git operation or tests were executed." };
  });
}
