import crypto from "node:crypto";
import path from "node:path";
import { GUIDED_LIMITS, notebookMetadataRanges, parseNotebookChapter, parseNotebookIndex, validateNotebook, type GuidedNotebook, type GuidedStep } from "./guided-review";
import { readNotebookBytes, NotebookReadError } from "./guided-review-server";
import { loadEditableFile, saveEditableFile } from "./file-edit";
import { notebookPage, type NotebookPageOptions } from "./notebook-report";

export interface NotebookFile {
  path: string;
  source: string;
  revision: string;
  editIdentity?: string;
  writable: boolean;
}
export interface AuthoringNotebook {
  notebook: GuidedNotebook;
  manifest: NotebookFile;
  chapters: NotebookFile[];
}
/** Serializable concurrency binding, not authority. Every call independently admits paths. */
export interface NotebookStepBinding {
  indexPath: string;
  notebookId: string;
  manifestRevision: string;
  chapterPath: string;
  chapterRevision: string;
  stepId: string;
}
export interface NotebookWriteAccess {
  roots: Set<string>;
  /** Must synchronously refuse removed read/edit grants and cancellation before effects. */
  assertWrite: () => void;
}
const conflict = (): never => { throw new NotebookReadError("Notebook changed or binding does not match; inspect again before editing", 409); };
export const notebookDigest = (source: string | Buffer) => crypto.createHash("sha256").update(source).digest("hex");

function readFile(file: string, roots: Set<string>, folder: string): NotebookFile {
  const bytes = readNotebookBytes(file, roots, GUIDED_LIMITS.documentBytes, folder);
  // Keep BOM/newlines in the edit source. The preview decoder may intentionally
  // hide a BOM, but that must not silently change bytes outside the selected step.
  const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (source.includes("\0")) throw new NotebookReadError("Binary notebook text is unsupported");
  const snapshot = loadEditableFile(file, roots);
  if (snapshot.revision !== notebookDigest(bytes)) conflict();
  return { path: file, source, revision: snapshot.revision, editIdentity: snapshot.editIdentity, writable: snapshot.writable };
}
/** No discovery, assets, Git reads or legacy history. Exactly the declared bounded package. */
export function readAuthoringNotebook(indexPath: string, roots: Set<string>): AuthoringNotebook {
  if (!path.isAbsolute(indexPath) || path.normalize(indexPath) !== indexPath || path.basename(indexPath) !== "index.md") throw new NotebookReadError("Use an absolute normalized notebook index.md path");
  const folder = path.dirname(indexPath), manifest = readFile(indexPath, roots, folder);
  const index = parseNotebookIndex(manifest.source);
  if (!index) throw new NotebookReadError("No notebook manifest found");
  let bytes = Buffer.byteLength(manifest.source);
  const chapters = index.chapters.map(chapter => {
    const file = readFile(path.join(folder, chapter.path), roots, folder);
    bytes += Buffer.byteLength(file.source);
    if (bytes > GUIDED_LIMITS.packageBytes) throw new NotebookReadError("Notebook exceeds 2 MiB", 413);
    return file;
  });
  const notebook = validateNotebook({ index, chapters: index.chapters.map((chapter, i) => ({ ...chapter, steps: parseNotebookChapter(chapters[i].source) })) });
  return { notebook, manifest, chapters };
}
export function locateNotebookStep(package_: AuthoringNotebook, stepId: string) {
  const chapterIndex = package_.notebook.chapters.findIndex(chapter => chapter.steps.some(step => step.id === stepId));
  if (chapterIndex < 0) throw new NotebookReadError("Step not found; inspect the current notebook", 409);
  const chapter = package_.notebook.chapters[chapterIndex], file = package_.chapters[chapterIndex];
  const stepIndex = chapter.steps.findIndex(step => step.id === stepId), step = chapter.steps[stepIndex];
  const markers = notebookMetadataRanges(file.source).filter(marker => marker.language === "brabbler-step");
  const start = markers[stepIndex].start, end = markers[stepIndex + 1]?.start ?? file.source.length;
  const binding: NotebookStepBinding = {
    indexPath: package_.manifest.path, notebookId: package_.notebook.index.id, manifestRevision: package_.manifest.revision,
    chapterPath: file.path, chapterRevision: file.revision, stepId,
  };
  return { chapterIndex, stepIndex, step, file, start, end, binding, source: file.source.slice(start, end) };
}
export const notebookPackageIdentity = (package_: AuthoringNotebook) => [package_.manifest, ...package_.chapters].map(file => ({ path: file.path, revision: file.revision, editIdentity: file.editIdentity, writable: file.writable }));
export function inspectNotebook(indexPath: string, roots: Set<string>, stepId?: string, inventory?: NotebookPageOptions & { revision?: string }) {
  if (stepId !== undefined && inventory !== undefined) throw new Error("Choose a selected step or target inventory, not both");
  const package_ = readAuthoringNotebook(indexPath, roots);
  if (inventory !== undefined) {
    if ((inventory.offset ?? 0) > 0 && inventory.revision === undefined) throw new Error("Continue notebook inventory with its revision");
    const revision = notebookDigest(JSON.stringify(notebookPackageIdentity(package_)));
    if (inventory.revision !== undefined && inventory.revision !== revision) throw new Error("Notebook inventory changed; inspect again before paging");
    const targets = package_.notebook.chapters.flatMap(chapter => chapter.steps.flatMap(step => step.targets.map(reference => ({ chapterPath: chapter.path, stepId: step.id, targetId: reference.id, reference }))));
    const summary = { targets: targets.length, gitTargets: targets.filter(target => ["source", "commit", "compare"].includes(target.reference.kind)).length };
    return notebookPage(targets, inventory, (targets, page) => ({ indexPath, notebookId: package_.notebook.index.id, title: package_.notebook.index.title, revision,
      diagnostics: [] as string[], targets, page, summary }));
  }
  const selected = stepId === undefined ? undefined : locateNotebookStep(package_, stepId);
  return {
    indexPath, notebookId: package_.notebook.index.id, title: package_.notebook.index.title,
    manifestRevision: package_.manifest.revision, diagnostics: [] as string[],
    chapters: package_.notebook.chapters.map(chapter => ({ id: chapter.id, title: chapter.title, path: chapter.path,
      steps: chapter.steps.map(step => ({ id: step.id, title: step.title, targetCount: step.targets.length })) })),
    ...(selected ? { selected: { source: selected.source, references: selected.step.targets, binding: selected.binding, writable: selected.file.writable } } : {}),
  };
}
export function assertNotebookBinding(actual: NotebookStepBinding, expected: NotebookStepBinding): void {
  if (!expected || Object.keys(actual).some(key => actual[key as keyof NotebookStepBinding] !== expected[key as keyof NotebookStepBinding])) conflict();
}
/** Validate the whole resulting package, including parsed neighbor identities and
 * effective bodies: an unclosed fence must not absorb the following step. */
export function validateNotebookChapterChange(package_: AuthoringNotebook, chapterIndex: number, source: string, changedSteps: Set<string>) {
  if (Buffer.byteLength(source) > GUIDED_LIMITS.documentBytes || source.includes("\0") || Buffer.from(source).toString("utf8") !== source) throw new NotebookReadError("Replacement must be bounded valid UTF-8 notebook text");
  const chapter = package_.notebook.chapters[chapterIndex], steps = parseNotebookChapter(source);
  if (steps.length !== chapter.steps.length || steps.some((step, i) => step.id !== chapter.steps[i].id)) throw new NotebookReadError("Replacement changes neighboring step boundaries or identities");
  for (let i = 0; i < steps.length; i++) if (!changedSteps.has(steps[i].id) && JSON.stringify(steps[i]) !== JSON.stringify(chapter.steps[i])) throw new NotebookReadError("Replacement changes an unrelated step");
  const total = Buffer.byteLength(package_.manifest.source) + package_.chapters.reduce((sum, file, i) => sum + Buffer.byteLength(i === chapterIndex ? source : file.source), 0);
  if (total > GUIDED_LIMITS.packageBytes) throw new NotebookReadError("Notebook exceeds 2 MiB", 413);
  validateNotebook({ index: package_.notebook.index, chapters: package_.notebook.chapters.map((old, i) => i === chapterIndex ? { ...old, steps } : old) });
  return steps;
}
export function updateNotebookStep(indexPath: string, stepId: string, binding: NotebookStepBinding, source: string, access: NotebookWriteAccess) {
  access.assertWrite();
  const package_ = readAuthoringNotebook(indexPath, access.roots), selected = locateNotebookStep(package_, stepId);
  assertNotebookBinding(selected.binding, binding);
  const single = parseNotebookChapter(source), first = notebookMetadataRanges(source)[0];
  if (single.length !== 1 || single[0].id !== stepId || first?.language !== "brabbler-step" || first.start !== 0) throw new NotebookReadError("Supply exactly the inspected complete step, with its original ID and leading brabbler-step fence");
  const replacement = selected.file.source.slice(0, selected.start) + source + selected.file.source.slice(selected.end);
  validateNotebookChapterChange(package_, selected.chapterIndex, replacement, new Set([stepId]));
  // Synchronous check/parse/save uses the existing cooperating-writer CAS. There
  // is no await here; arbitrary external writers remain outside its exclusion.
  access.assertWrite();
  const saved = saveEditableFile(selected.file.path, access.roots, replacement, selected.file.revision, selected.file.editIdentity);
  return { status: "updated" as const, path: selected.file.path, stepId, previousRevision: selected.file.revision, revision: saved.revision };
}

export function sameNotebookStep(a: GuidedStep, b: GuidedStep) { return JSON.stringify(a) === JSON.stringify(b); }
