import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { devNull } from "node:os";
import { samePath, toNativePath } from "../../lib/paths";
import { readGitFileContext } from "../../lib/git-file-context";
import { GIT_RENAME_ARGS, gitFilePathspecs, isGitRenameStatus, nestedRenameRoot } from "../../lib/git-rename";
import { directoryIdentity } from "./checkout-safety";
import { gitOutput, gitText } from "./process";
import { isCapturedGitReview, isGitReviewComparison, isGitReviewOid, type CapturedGitReview, type GitReviewComparison, type GitReviewRelation } from "./review-data";

export const GIT_REVIEW_PAGE_SIZE = 40;
export const GIT_REVIEW_PREVIEW_BYTES = 256 * 1024;
export class GitReviewReadError extends Error {
  constructor(readonly code: "INVALID" | "ACCESS_DENIED" | "UNAVAILABLE", message: string) { super(message); }
}
/** Supplied by the independently authorizing host, never by a browser payload.
 * Saved repository metadata and object IDs alone grant no filesystem access. */
export interface GitReviewAccess { assertAllowed(checkout: string): Promise<void> }
export interface GitReviewFile {
  id: number; path: string; previousPath?: string; status: string;
  oldMode: string; newMode: string; oldOid: string; newOid: string;
}
const invalid = () => new GitReviewReadError("INVALID", "Invalid saved Git review or file selection.");
const unavailable = () => new GitReviewReadError("UNAVAILABLE", "The captured repository or Git objects are unavailable.");
// Canonical path/version equality stays delete/add, independent of presentation.
// Never recurse into submodules or let external drivers/config change the read.
// Display inventories and downloads add the explicit bounded rename policy.
const policy = [`-O${devNull}`, "--no-ext-diff", "--no-textconv", "--no-renames", "--no-relative", "--ignore-submodules=none", "--submodule=short"];
const patchPolicy = [...policy, "--binary", "--full-index", "--no-color", "--diff-algorithm=myers", "--no-indent-heuristic",
  "--src-prefix=a/", "--dst-prefix=b/", "--unified=3"];
function integer(value: number) { if (!Number.isSafeInteger(value) || value < 0) throw invalid(); }
function physical(path: string) {
  if (!isAbsolute(path) || !samePath(realpathSync(path), path)) throw unavailable();
  return path;
}
function pathOutput(value: string) {
  if (!value.endsWith("\n")) throw unavailable();
  return toNativePath(value.slice(0, -1)); // Preserve legal trailing spaces/newlines in POSIX paths.
}
async function commonDirectory(cwd: string, signal?: AbortSignal) {
  return pathOutput(await gitText(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"], undefined, undefined, signal));
}
async function tree(cwd: string, oid: string, signal?: AbortSignal) {
  if (!isGitReviewOid(oid)) throw invalid();
  const kind = (await gitText(cwd, ["cat-file", "-t", oid], undefined, undefined, signal)).trim();
  if (kind !== "tree" && kind !== "commit") throw unavailable();
  const result = (await gitText(cwd, ["rev-parse", "--verify", `${oid}^{tree}`], undefined, undefined, signal)).trim();
  if (!isGitReviewOid(result) || result.length !== oid.length) throw unavailable();
  return result;
}
/** Called only in already-authorized preparation, not by a historical GET. Writes
 * no files, refs or objects. The candidate tree is supplied by existing preflight. */
export async function captureGitReview(cwd: string, comparison: GitReviewComparison, signal?: AbortSignal): Promise<CapturedGitReview> {
  if (!isGitReviewComparison(comparison)) throw invalid();
  physical(cwd);
  const common = physical(await commonDirectory(cwd, signal)), identity = directoryIdentity(common);
  const registrations = (await gitText(cwd, ["worktree", "list", "--porcelain", "-z"], undefined, undefined, signal)).split("\0");
  const primary = registrations.find(row => row.startsWith("worktree "))?.slice(9);
  if (!primary || !isAbsolute(primary)) throw unavailable();
  const trees = { before: await tree(cwd, comparison.before, signal), after: await tree(cwd, comparison.after, signal) };
  if (directoryIdentity(common) !== identity || !samePath(await commonDirectory(cwd, signal), common)) throw unavailable();
  return { version: 1, repository: { commonDirectory: common, identity, checkout: cwd, primaryCheckout: toNativePath(primary), bindingOrigin: "captured" }, comparison: { ...comparison }, trees };
}
async function guard(cwd: string, captured: CapturedGitReview, access: GitReviewAccess, signal?: AbortSignal) {
  signal?.throwIfAborted();
  try { await access.assertAllowed(cwd); }
  catch (error) {
    if (error instanceof GitReviewReadError && error.code === "UNAVAILABLE") throw error;
    throw new GitReviewReadError("ACCESS_DENIED", "Access to this review repository is denied.");
  }
  physical(cwd);
  const common = physical(await commonDirectory(cwd, signal));
  if (!samePath(common, captured.repository.commonDirectory) || directoryIdentity(common) !== captured.repository.identity) throw unavailable();
  const root = pathOutput(await gitText(cwd, ["rev-parse", "--show-toplevel"], undefined, undefined, signal));
  if (!samePath(root, cwd)) throw unavailable();
  if (await tree(cwd, captured.comparison.before, signal) !== captured.trees.before
    || await tree(cwd, captured.comparison.after, signal) !== captured.trees.after) throw unavailable();
  // Identity is checked after asynchronous object reads too. External writers
  // remain uncoordinated; this is not a repository-wide lock or atomic snapshot.
  if (directoryIdentity(common) !== captured.repository.identity || !samePath(await commonDirectory(cwd, signal), common)) throw unavailable();
}
async function checkout(captured: CapturedGitReview, access: GitReviewAccess, signal?: AbortSignal) {
  if (!isCapturedGitReview(captured)) throw invalid();
  let denied = false;
  for (const candidate of new Set([captured.repository.checkout, captured.repository.primaryCheckout])) {
    try { await guard(candidate, captured, access, signal); return candidate; }
    catch (error) {
      signal?.throwIfAborted();
      if (error instanceof GitReviewReadError && error.code === "ACCESS_DENIED") denied = true;
    }
  }
  if (denied) throw new GitReviewReadError("ACCESS_DENIED", "Access denied: no allowed checkout of this review repository is available.");
  throw unavailable();
}
/** Also used before execution revalidation can regenerate a missing candidate. */
export async function assertGitReviewAvailable(captured: CapturedGitReview, access: GitReviewAccess, signal?: AbortSignal, fileId?: number) {
  const cwd = await checkout(captured, access, signal);
  await assertChangedBlobs(cwd, captured, signal);
  // Download admission must validate the SAME native selection before headers;
  // gitReviewPatch repeats selection/guards at streaming time, without a cache.
  if (fileId !== undefined) {
    const file = await selected(cwd, captured, fileId, signal);
    if (nestedRenameRoot(file)) {
      // Nested exclusions can reach native argv limits. Exercise the exact command
      // (with content output disabled) before headers, never truncate exclusions.
      const args = await patchArgs(cwd, captured, file, signal);
      args.splice(args.indexOf("--"), 0, "--no-patch");
      await gitText(cwd, args, undefined, undefined, signal);
    }
  }
  await guard(cwd, captured, access, signal);
}
async function* framedRecords(source: AsyncIterable<Uint8Array>, delimiter = 0) {
  let pending = Buffer.alloc(0);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  for await (const raw of source) {
    const chunk = Buffer.from(raw); let start = 0;
    for (let end = chunk.indexOf(delimiter); end !== -1; end = chunk.indexOf(delimiter, start)) {
      const bytes = Buffer.concat([pending, chunk.subarray(start, end)]);
      try { yield decoder.decode(bytes); } catch { throw unavailable(); }
      pending = Buffer.alloc(0); start = end + 1;
    }
    if (start < chunk.length) pending = Buffer.concat([pending, chunk.subarray(start)]);
  }
  if (pending.length) throw unavailable(); // Never accept a truncated final record.
}
async function* inventory(cwd: string, captured: CapturedGitReview, signal?: AbortSignal, renames = true): AsyncGenerator<GitReviewFile> {
  const source = gitOutput(cwd, ["diff", ...policy, ...(renames ? GIT_RENAME_ARGS : []),
    "--raw", "--no-abbrev", "-z", captured.trees.before, captured.trees.after, "--"], { signal });
  yield* parseGitReviewInventory(source, captured.trees.before.length, renames);
}
/** The raw stream has a header plus one path, or a scored rename's two paths. */
export async function* parseGitReviewInventory(source: AsyncIterable<Uint8Array>, oidLength: number, renames = true): AsyncGenerator<GitReviewFile> {
  let header: string | undefined, previousPath: string | undefined, id = 0;
  for await (const part of framedRecords(source)) {
    if (header === undefined) { header = part; continue; }
    const match = /^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}|[a-f0-9]{64}) ([a-f0-9]{40}|[a-f0-9]{64}) ([AMDTC]|R\d{3})$/.exec(header);
    if (!match || match[0] !== header || !part || part.includes("\0") || match[3].length !== oidLength || match[4].length !== match[3].length) throw unavailable();
    const rename = match[5].startsWith("R");
    if (rename) {
      if (!renames || !isGitRenameStatus(match[5])) throw unavailable();
      if (previousPath === undefined) { previousPath = part; continue; }
      if (previousPath === part) throw unavailable();
    }
    yield { id: id++, path: part, status: rename ? "R" : match[5], ...(rename ? { previousPath } : {}),
      oldMode: match[1], newMode: match[2], oldOid: match[3], newOid: match[4] };
    header = undefined; previousPath = undefined;
  }
  if (header !== undefined) throw unavailable();
}
async function assertChangedBlobs(cwd: string, captured: CapturedGitReview, signal?: AbortSignal) {
  let sent = 0, received = 0;
  async function* input() {
    for await (const file of inventory(cwd, captured, signal, false)) {
      for (const [mode, oid] of [[file.oldMode, file.oldOid], [file.newMode, file.newOid]]) {
        // Gitlinks refer to another repository: never fetch/check their target here.
        if (mode === "000000" || mode === "160000") continue;
        if (!["100644", "100755", "120000"].includes(mode) || /^0+$/.test(oid)) throw unavailable();
        sent++; yield Buffer.from(oid + "\n");
      }
    }
  }
  for await (const line of framedRecords(gitOutput(cwd, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], { input: input(), signal }), 10)) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64}) blob$/.test(line)) throw unavailable();
    received++;
  }
  if (sent !== received) throw unavailable();
}
export async function gitReviewPage(captured: CapturedGitReview, access: GitReviewAccess, start = 0, signal?: AbortSignal) {
  integer(start);
  const cwd = await checkout(captured, access, signal), files: GitReviewFile[] = [];
  let total = 0;
  for await (const file of inventory(cwd, captured, signal)) {
    if (file.id >= start && files.length < GIT_REVIEW_PAGE_SIZE) files.push(file);
    total++;
  }
  if (start > total) throw invalid();
  await guard(cwd, captured, access, signal);
  return { files, total, next: start + files.length < total ? start + files.length : null };
}
async function selected(cwd: string, captured: CapturedGitReview, id: number, signal?: AbortSignal) {
  integer(id);
  let found: GitReviewFile | undefined;
  // Drain even after selection: a Git failure cannot turn partial inventory into
  // a valid file authority, and processOutput owns cancellation/child closure.
  for await (const file of inventory(cwd, captured, signal)) if (file.id === id) found = file;
  if (!found) throw invalid();
  return found;
}
async function patchArgs(cwd: string, captured: CapturedGitReview, file?: GitReviewFile, signal?: AbortSignal): Promise<string[]> {
  const paths = file ? await gitFilePathspecs(file, inventory(cwd, captured, signal)) : [];
  // Never discover a different pair by re-running detection on a globally unpaired entry.
  const renames = !file || file.previousPath ? GIT_RENAME_ARGS : [];
  return [...(file ? ["--no-literal-pathspecs"] : []), "diff", ...patchPolicy, ...renames,
    captured.trees.before, captured.trees.after, "--", ...paths];
}
/** Exact bytes from immutable trees. No aggregate buffer, persisted cache or
 * operation-size ceiling; early return/cancellation joins the native read child. */
export async function* gitReviewPatch(captured: CapturedGitReview, access: GitReviewAccess, fileId?: number, signal?: AbortSignal): AsyncGenerator<Buffer> {
  const cwd = await checkout(captured, access, signal);
  const file = fileId === undefined ? undefined : await selected(cwd, captured, fileId, signal);
  await guard(cwd, captured, access, signal);
  yield* gitOutput(cwd, await patchArgs(cwd, captured, file, signal), { signal });
  await guard(cwd, captured, access, signal);
}
export async function gitReviewPreview(captured: CapturedGitReview, access: GitReviewAccess, fileId: number, offset = 0, signal?: AbortSignal) {
  integer(offset);
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of gitReviewPatch(captured, access, fileId, signal)) {
    const start = Math.max(0, offset - bytes), end = Math.min(chunk.length, offset + GIT_REVIEW_PREVIEW_BYTES - bytes);
    if (end > start) chunks.push(chunk.subarray(start, end));
    bytes += chunk.length;
    if (!Number.isSafeInteger(bytes)) throw unavailable();
  }
  if (offset > bytes) throw invalid();
  const length = Math.min(GIT_REVIEW_PREVIEW_BYTES, bytes - offset);
  return { text: Buffer.concat(chunks).toString("utf8"), bytes, offset, next: offset + length < bytes ? offset + length : null,
    complete: offset === 0 && bytes <= GIT_REVIEW_PREVIEW_BYTES };
}
export async function gitReviewContext(captured: CapturedGitReview, access: GitReviewAccess, fileId: number, signal?: AbortSignal) {
  const cwd = await checkout(captured, access, signal), file = await selected(cwd, captured, fileId, signal);
  await guard(cwd, captured, access, signal);
  const context = await readGitFileContext(cwd, captured.trees.before, captured.trees.after, file.path, file.previousPath, signal);
  await guard(cwd, captured, access, signal);
  return context;
}
async function changeDigest(captured: CapturedGitReview, access: GitReviewAccess, signal?: AbortSignal) {
  const cwd = await checkout(captured, access, signal), hash = createHash("sha256");
  await assertChangedBlobs(cwd, captured, signal);
  for await (const { path, status, oldMode, newMode, oldOid, newOid } of inventory(cwd, captured, signal, false)) {
    hash.update(JSON.stringify([path, status, oldMode, newMode, oldOid, newOid]) + "\n");
  }
  await guard(cwd, captured, access, signal);
  return hash.digest("hex");
}
/** Compare changed file versions/modes, not commit IDs or semantic patch text.
 * Missing objects are unknown, never equality; access denial remains denial. */
export async function gitReviewRelation(proposal: CapturedGitReview, result: CapturedGitReview, access: GitReviewAccess, signal?: AbortSignal): Promise<GitReviewRelation> {
  if (!isCapturedGitReview(proposal) || !isCapturedGitReview(result)) throw invalid();
  if (!samePath(proposal.repository.commonDirectory, result.repository.commonDirectory) || proposal.repository.identity !== result.repository.identity) throw invalid();
  try {
    return await changeDigest(proposal, access, signal) === await changeDigest(result, access, signal) ? "same" : "different";
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof GitReviewReadError && (error.code === "INVALID" || error.code === "ACCESS_DENIED")) throw error;
    return "unknown";
  }
}
