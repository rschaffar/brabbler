import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isFilePathAllowed, isExistingFilePathAllowed } from "./file-access";
import { samePath } from "./paths";
import { readNotebook, readNotebookBytes, NotebookReadError } from "./guided-review-server";
import { strictJsonObject, parseNotebookIndex, stepProse } from "./guided-review";
import { explorerLog, explorerSource, explorerCommit, explorerCompare, explorerCompareFile } from "./git-explorer";
import { notebookAssetLimit, notebookAssetMime } from "./guided-review-assets";
import { REVIEW_LIMITS, batches, emptyReviewState, reduceReview, validateReply, validateSnapshot, type Material, type ReviewOperation, type ReviewSnapshot, type ReviewTip } from "./notebook-review";

function contentJson(value: unknown) { return JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v); }
export const reviewDigest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export class ReviewStoreError extends Error {
  constructor(message: string, readonly status = 409, readonly possiblyCommitted = false) { super(message); }
}
type Identity = { file: string; dev: number; ino: number };
export interface ReviewAuthorization { index: string; roots: Set<string>; folders: Identity[]; notebookId: string; directory: string; indexIdentity: Identity; indexDigest: string }
function captureDirectory(file: string, roots: Set<string>, writable: boolean): Identity {
  if (!path.isAbsolute(file) || !isFilePathAllowed(file, roots) || !isExistingFilePathAllowed(file, roots) || !samePath(file, fs.realpathSync(file))) throw new ReviewStoreError("Review directory access denied (no reference-only write authority)", 403);
  const st = fs.lstatSync(file);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new ReviewStoreError("Expected a physical directory", 403);
  if (writable && !(st.mode & 0o222)) throw new ReviewStoreError("Review directory is read-only", 403);
  fs.accessSync(file, fs.constants.R_OK | fs.constants.X_OK | (writable ? fs.constants.W_OK : 0));
  return { file, dev: st.dev, ino: st.ino };
}
export function authorizeReview(index: string, roots: Set<string>): ReviewAuthorization {
  // Independent root check; never accepts a transcript-only index as authority.
  const folder = captureDirectory(path.dirname(index), roots, false);
  const st = fs.lstatSync(index), indexBytes = readNotebookBytes(index, roots, 256 * 1024, folder.file);
  const parsed = parseNotebookIndex(new TextDecoder("utf-8", { fatal: true }).decode(indexBytes));
  if (!parsed || path.basename(index) !== "index.md") throw new ReviewStoreError("Expected notebook index.md", 400);
  return { index, roots, folders: [folder], notebookId: parsed.id, directory: path.join(folder.file, "review-data"), indexIdentity: { file: index, dev: st.dev, ino: st.ino }, indexDigest: reviewDigest(indexBytes) };
}
export function revalidateReview(auth: ReviewAuthorization, writable = false) {
  const index = fs.lstatSync(auth.index);
  if (!index.isFile() || index.dev !== auth.indexIdentity.dev || index.ino !== auth.indexIdentity.ino || reviewDigest(readNotebookBytes(auth.index, auth.roots, 256 * 1024, path.dirname(auth.index))) !== auth.indexDigest) throw new ReviewStoreError("Notebook index identity changed; reload");
  for (const identity of auth.folders) { const now = captureDirectory(identity.file, auth.roots, writable); if (identity.dev !== now.dev || identity.ino !== now.ino) throw new ReviewStoreError("Review directory identity changed", 409); }
}
function directory(auth: ReviewAuthorization, file: string, create: boolean): boolean {
  revalidateReview(auth, create);
  try { fs.lstatSync(file); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    if (!create) return false;
    // Only literal single-level children, never recursive mkdir or chmod of existing paths.
    try { fs.mkdirSync(file, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    syncDirectory(path.dirname(file));
  }
  const id = captureDirectory(file, auth.roots, create), previous = auth.folders.find(f => f.file === file);
  if (previous && (previous.dev !== id.dev || previous.ino !== id.ino)) throw new ReviewStoreError("Review directory replaced");
  if (!previous) auth.folders.push(id);
  return true;
}
function syncDirectory(file: string, sync: (fd: number) => void = fs.fsyncSync) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { sync(fd); } finally { fs.closeSync(fd); }
}
function inventory(file: string, maximum: number) {
  const names: string[] = [], dir = fs.opendirSync(file);
  try { for (;;) { const entry = dir.readSync(); if (!entry) break; if (names.length >= maximum) throw new ReviewStoreError("Review inventory quota exceeded", 413); if (!entry.isFile() && !entry.isDirectory()) throw new ReviewStoreError("Unsafe review directory entry"); names.push(entry.name); } }
  finally { dir.closeSync(); }
  return names;
}
function layout(auth: ReviewAuthorization, create: boolean) {
  if (!directory(auth, auth.directory, create)) return false;
  const names = inventory(auth.directory, 3);
  if (names.some(n => !["reviewer", "replies", "imported-replies"].includes(n))) throw new ReviewStoreError("Unknown review-data entry; bytes preserved");
  for (const name of ["reviewer", "replies", "imported-replies"]) {
    const folder = path.join(auth.directory, name);
    if (directory(auth, folder, create) && name !== "reviewer") for (const entry of inventory(folder, REVIEW_LIMITS.revisions + 16)) {
      const valid = name === "replies" ? /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\.json$/.test(entry) : /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}-[a-f0-9]{64}\.json$/.test(entry) || /^\.stage-[a-f0-9-]{36}$/.test(entry);
      if (!valid || !fs.lstatSync(path.join(folder, entry)).isFile()) throw new ReviewStoreError("Unknown/unsafe reply entry; bytes preserved");
    }
  }
  return true;
}
export function readReview(auth: ReviewAuthorization): ReviewTip {
  revalidateReview(auth);
  const tip: ReviewTip = { sequence: 0, digest: "", state: emptyReviewState(), directory: auth.directory, notebookId: auth.notebookId };
  if (!layout(auth, false)) return tip;
  const folder = path.join(auth.directory, "reviewer");
  if (!fs.existsSync(folder)) return tip;
  const names = inventory(folder, REVIEW_LIMITS.revisions + 16).filter(n => {
    if (/^\.stage-[a-f0-9-]{36}$/.test(n)) {
      if (!fs.lstatSync(path.join(folder, n)).isFile()) throw new ReviewStoreError("Unsafe private stage");
      return false; // Known private stages have no authority. Never clean another writer's bytes.
    }
    return true;
  }).sort();
  if (names.some(n => !/^\d{10}\.json$/.test(n))) throw new ReviewStoreError("Unknown/staged review history entry; preserve and inspect before recovery");
  let total = 0;
  for (const name of names) {
    if (name !== `${String(tip.sequence + 1).padStart(10, "0")}.json` || tip.sequence >= REVIEW_LIMITS.revisions) throw new ReviewStoreError("Review history hole/quota; bytes preserved");
    const bytes = readNotebookBytes(path.join(folder, name), auth.roots, REVIEW_LIMITS.snapshotBytes, auth.directory);
    total += bytes.length; if (total > REVIEW_LIMITS.historyBytes) throw new ReviewStoreError("Review history exceeds 64 MiB", 413);
    const value = validateSnapshot(strictJsonObject(new TextDecoder("utf-8", { fatal: true }).decode(bytes), REVIEW_LIMITS.snapshotBytes));
    if (value.sequence !== tip.sequence + 1 || value.previous !== tip.digest || value.notebookId !== auth.notebookId || value.state.events.length !== tip.state.events.length + 1
      || JSON.stringify(value.state.events.slice(0, -1)) !== JSON.stringify(tip.state.events) || value.state.events.at(-1)?.submissionId !== value.submissionId) throw new ReviewStoreError("Review history chain conflict; bytes preserved");
    const event = value.state.events.at(-1)!;
    if (JSON.stringify(reduceReview(tip.state, event.operation, event.submissionId, event.material)) !== JSON.stringify(value.state)) throw new ReviewStoreError("Invalid reviewer history");
    tip.sequence = value.sequence; tip.digest = reviewDigest(bytes); tip.state = value.state;
  }
  for (const event of tip.state.events) if (event.operation.kind === "import") {
    const op = event.operation, file = path.join(auth.directory, "imported-replies", `${op.batchId}-${op.digest}.json`);
    const bytes = readNotebookBytes(file, auth.roots, REVIEW_LIMITS.replyBytes, auth.directory);
    if (reviewDigest(bytes) !== op.digest || JSON.stringify(validateReply(strictJsonObject(bytes.toString("utf8"), REVIEW_LIMITS.replyBytes))) !== JSON.stringify(op.reply)) throw new ReviewStoreError("Imported historical reply bytes changed");
  }
  revalidateReview(auth);
  return tip;
}
/** Explicit current-step inspection only; branch authority labels are excluded from content identity. */
export async function inspectReviewMaterial(auth: ReviewAuthorization, stepId: string): Promise<Material> {
  revalidateReview(auth);
  const notebook = readNotebook(auth.index, auth.roots), chapter = notebook.chapters.find(c => c.steps.some(s => s.id === stepId)), step = chapter?.steps.find(s => s.id === stepId);
  if (!step) throw new ReviewStoreError("Step deleted/unavailable", 404);
  let remainingAssetBytes = 32 * 1024 * 1024;
  const unavailable: string[] = [];
  const targets: Material["targets"] = [];
  for (const definition of step.targets) {
    const identity = { ...definition } as Record<string, unknown>; delete identity.branch; delete identity.title; delete identity.priority;
    let bytes = "";
    if (definition.kind === "file") {
      try {
        const file = path.join(path.dirname(auth.index), definition.path), mime = notebookAssetMime(definition.path);
        if (remainingAssetBytes <= 1) throw new Error("Current-step asset read budget exhausted");
        // Reserve the bounded reader's one-byte overflow sentinel too. On any
        // failed read conservatively spend the remaining budget: a growing or
        // interrupted file must not let subsequent targets consume another cap.
        const maximum = Math.min(mime ? notebookAssetLimit(mime) : 256 * 1024, remainingAssetBytes - 1);
        let content: Buffer;
        try { content = readNotebookBytes(file, auth.roots, maximum, path.dirname(auth.index)); }
        catch (error) { remainingAssetBytes = 0; throw error; }
        remainingAssetBytes -= content.length;
        bytes = reviewDigest(content);
      } catch { unavailable.push(`${definition.id}: local asset Unavailable (including exhausted 32 MiB read budget)`); targets.push({ definition, fingerprint: null }); continue; }
    } else if (definition.kind !== "web") {
      try {
        const physical = captureDirectory(definition.cwd, auth.roots, false);
        const { head } = await explorerLog(definition.cwd, 0, undefined, definition.branch);
        if (definition.kind === "source") await explorerSource(definition.cwd, head, definition.oid, definition.path, definition.start, definition.end, definition.branch);
        else if (definition.kind === "commit") await explorerCommit(definition.cwd, head, definition.oid, definition.branch);
        else { const comparison = await explorerCompare(definition.cwd, head, definition.base, definition.candidate, definition.branch); await explorerCompareFile(definition.cwd, head, definition.base, definition.candidate, definition.branch, comparison.identity, definition.path); }
        const now = captureDirectory(definition.cwd, auth.roots, false);
        if (physical.dev !== now.dev || physical.ino !== now.ino) throw new Error("Repository identity changed");
      } catch { unavailable.push(`${definition.id}: immutable object/authority Unavailable`); targets.push({ definition, fingerprint: null }); continue; }
    }
    targets.push({ definition, fingerprint: reviewDigest(contentJson(identity) + bytes), ...(definition.kind === "file" ? { contentDigest: bytes } : {}) });
  }
  // Explicit current-step inspection only. Missing authority/objects never fabricate changed content.
  const prose = stepProse(step.markdown).replace(/\r\n?/g, "\n").split("\n").map(l => l.trimEnd()).join("\n").trim();
  const guidanceFingerprint = reviewDigest(contentJson([step.title, prose, step.targets.map(t => { const identity = { ...t } as Record<string, unknown>; delete identity.branch; delete identity.title; delete identity.priority; return identity; }).sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0), step.questions ?? []]));
  const base = reviewDigest(contentJson([step.title, prose, targets.map(t => [t.definition.id, t.fingerprint]).sort()]));
  const questions = (step.questions ?? []).map(definition => ({ definition, fingerprint: reviewDigest(contentJson([unavailable.length ? `${guidanceFingerprint}:unavailable` : base, definition])) }));
  const fingerprint = unavailable.length ? null : reviewDigest(contentJson([base, questions.map(q => [q.definition.id, q.fingerprint]).sort()]));
  revalidateReview(auth);
  return { stepId, title: step.title, chapterPath: chapter!.path, prose, guidanceFingerprint, fingerprint, questions, targets, unavailable };
}
/** Native hooks are passive failure/race witnesses; defaults execute the same filesystem operations. */
export interface ReviewStoreObserver { beforeLink?: () => void; afterLink?: () => void; beforeInstall?: () => void; fsync?: (fd: number) => void; write?: (fd: number, bytes: Buffer, offset: number) => number }
function exclusiveInstall(auth: ReviewAuthorization, folder: string, name: string, bytes: Buffer, expected: (ownedStage: string) => void, observer?: ReviewStoreObserver) {
  revalidateReview(auth, true);
  if (inventory(folder, REVIEW_LIMITS.revisions + 16).length + 2 > REVIEW_LIMITS.revisions + 16) throw new ReviewStoreError("Review inventory has no capacity for a private stage and pending install", 413);
  const stage = path.join(folder, `.stage-${randomUUID()}`), target = path.join(folder, name);
  let linked = false, owned: Identity | null = null;
  try {
    const fd = fs.openSync(stage, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); const identity = fs.fstatSync(fd); owned = { file: stage, dev: identity.dev, ino: identity.ino };
    try { let offset = 0; while (offset < bytes.length) { const n = observer?.write ? observer.write(fd, bytes, offset) : fs.writeSync(fd, bytes, offset); if (!n) throw new Error("Short review write"); offset += n; } (observer?.fsync ?? fs.fsyncSync)(fd); }
    finally { fs.closeSync(fd); }
    revalidateReview(auth, true); observer?.beforeLink?.(); revalidateReview(auth, true); expected(path.basename(stage));
    // No overwrite rename and NO exclusive-copy fallback. Unsupported filesystems fail explicitly.
    const staged = fs.lstatSync(stage);
    if (!staged.isFile() || staged.dev !== owned.dev || staged.ino !== owned.ino || reviewDigest(readNotebookBytes(stage, auth.roots, REVIEW_LIMITS.snapshotBytes, auth.directory)) !== reviewDigest(bytes)) throw new ReviewStoreError("Private stage changed");
    observer?.beforeInstall?.(); revalidateReview(auth, true);
    fs.linkSync(stage, target); linked = true;
    observer?.afterLink?.(); revalidateReview(auth, true); syncDirectory(folder, observer?.fsync);
  } catch (e) {
    throw new ReviewStoreError(linked ? "Possibly committed: reload and reconcile submission ID before retry" : (e as NodeJS.ErrnoException).code === "EEXIST" ? "Conflict: another writer claimed this revision" : `Recording refused: ${e instanceof Error ? e.message : "filesystem failure"}`, 409, linked);
  } finally {
    if (owned) { try { revalidateReview(auth, true); const now = fs.lstatSync(stage); if (now.dev !== owned.dev || now.ino !== owned.ino) throw new Error("Private stage replaced"); fs.unlinkSync(stage); syncDirectory(folder); } catch { /* Retain owned stage rather than clean through a changed identity. */ } }
  }
}
export async function appendReview(auth: ReviewAuthorization, expected: { sequence: number; digest: string }, submissionId: string, operation: ReviewOperation, observer?: ReviewStoreObserver): Promise<ReviewTip> {
  revalidateReview(auth, true);
  const before = readReview(auth);
  const prior = before.state.events.find(e => e.submissionId === submissionId);
  if (prior) { if (JSON.stringify(prior.operation) !== JSON.stringify(operation)) throw new ReviewStoreError("Submission ID reused with different operation"); return before; }
  if (before.sequence !== expected.sequence || before.digest !== expected.digest) throw new ReviewStoreError("Conflict: review history advanced; reload without discarding draft");
  if (!before.sequence && operation.kind !== "enable") throw new ReviewStoreError("Explicit Enable review recording is required", 403);
  if (before.sequence >= REVIEW_LIMITS.revisions) throw new ReviewStoreError("Review revision quota reached", 413);
  const stepId = operation.kind === "feedback" ? (before.state.events.some(e => e.operation.kind === "feedback" && e.operation.item.id === operation.item.id) ? null : operation.item.anchor.stepId) : "stepId" in operation ? operation.stepId : null;
  const material = stepId && operation.kind !== "resume" ? await inspectReviewMaterial(auth, stepId) : null;
  revalidateReview(auth, true);
  if (operation.kind === "resume" && !readNotebook(auth.index, auth.roots).chapters.some(c => c.steps.some(s => s.id === operation.stepId))) throw new ReviewStoreError("Resume step deleted/unavailable");
  const state = reduceReview(before.state, operation, submissionId, material);
  if (operation.kind === "prepare" && operation.batch.replyPath !== path.join(auth.directory, "replies", `${operation.batch.id}.json`)) throw new ReviewStoreError("Reply destination must be the fixed batch sidecar", 400);
  const snapshot: ReviewSnapshot = { version: 1, notebookId: auth.notebookId, sequence: before.sequence + 1, previous: before.digest, submissionId, state };
  const bytes = Buffer.from(JSON.stringify(snapshot)); if (bytes.length > REVIEW_LIMITS.snapshotBytes) throw new ReviewStoreError("Snapshot exceeds 2 MiB", 413);
  layout(auth, true);
  const folder = path.join(auth.directory, "reviewer");
  const check = (stage: string) => {
    const current = readReview(auth);
    if (current.sequence !== before.sequence || current.digest !== before.digest) throw new ReviewStoreError("Conflict: review history changed during staging");
    const names = inventory(folder, REVIEW_LIMITS.revisions + 16).filter(n => n !== stage);
    let total = bytes.length;
    for (const name of names) total += fs.lstatSync(path.join(folder, name)).size;
    if (total > REVIEW_LIMITS.historyBytes) throw new ReviewStoreError("Review history exceeds 64 MiB", 413);
  };
  exclusiveInstall(auth, folder, `${String(snapshot.sequence).padStart(10, "0")}.json`, bytes, check, observer);
  try { const after = readReview(auth); if (!after.state.events.some(e => e.submissionId === submissionId) || after.sequence < snapshot.sequence) throw new Error("Lost appended revision"); return after; }
  catch { throw new ReviewStoreError("Possibly committed: post-link history validation failed; reload to reconcile", 409, true); }
}
export async function importReviewReply(auth: ReviewAuthorization, tip: { sequence: number; digest: string }, submissionId: string, batchId: string, text?: string) {
  const before = readReview(auth), prior = before.state.events.find(e => e.submissionId === submissionId);
  if (!prior && (before.sequence !== tip.sequence || before.digest !== tip.digest)) throw new ReviewStoreError("Conflict: review history advanced; no reply bytes installed");
  const batch = batches(before.state).find(b => b.id === batchId);
  if (!batch) throw new ReviewStoreError("Orphan reply batch", 400);
  const raw = text === undefined ? readNotebookBytes(path.join(auth.directory, "replies", `${batchId}.json`), auth.roots, REVIEW_LIMITS.replyBytes, auth.directory) : Buffer.from(text);
  const reply = validateReply(strictJsonObject(new TextDecoder("utf-8", { fatal: true }).decode(raw), REVIEW_LIMITS.replyBytes)), hash = reviewDigest(raw);
  const operation: ReviewOperation = { kind: "import", batchId, digest: hash, reply };
  if (prior) {
    if (JSON.stringify(prior.operation) !== JSON.stringify(operation)) throw new ReviewStoreError("Submission ID reused with different reply bytes/operation");
    return before;
  }
  // Validate before installing immutable bytes. Agent fields cannot become reviewer operations.
  reduceReview(before.state, operation, submissionId, null);
  revalidateReview(auth, true); layout(auth, true);
  const folder = path.join(auth.directory, "imported-replies"), name = `${batchId}-${hash}.json`;
  if (fs.existsSync(path.join(folder, name))) {
    if (!readNotebookBytes(path.join(folder, name), auth.roots, REVIEW_LIMITS.replyBytes, auth.directory).equals(raw)) throw new ReviewStoreError("Immutable reply copy changed");
  } else exclusiveInstall(auth, folder, name, raw, () => revalidateReview(auth, true));
  return appendReview(auth, tip, submissionId, operation);
}
export function reviewError(error: unknown) {
  return { message: error instanceof Error && (!("code" in error) || error instanceof ReviewStoreError) ? error.message : "Review data unavailable (missing or unsafe filesystem entry)", status: error instanceof ReviewStoreError || error instanceof NotebookReadError ? error.status : 400, possiblyCommitted: error instanceof ReviewStoreError && error.possiblyCommitted };
}
