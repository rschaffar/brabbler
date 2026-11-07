import { createHash } from "node:crypto";
import { scopedGitRead } from "./git-read-scope";
import { readGitTreeFile } from "./git-file-context";
import { explorerBranchTip, explorerCheckoutIdentity, explorerObjectCommitFiles, explorerSource, explorerCommit, explorerCompareFile } from "./git-explorer";
import type { Evidence } from "./guided-review";

export type GitEvidence = Extract<Evidence, { kind: "source" | "commit" | "compare" }>;
export interface ReferenceRepository { cwd: string; branch: string; head: string; identity: string }
export class ReferenceProblem extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export function fullOid(value: string) { if (!oidPattern.test(value)) throw new ReferenceProblem("INVALID", "Use full lowercase commit IDs"); return value; }
function problem(code: string, message: string): never { throw new ReferenceProblem(code, message); }
const text = (bytes: Buffer) => new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(bytes);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (a: unknown, b: unknown) => digest(a) === digest(b) ? "equal" as const : "different" as const;
export async function captureReferenceRepository(cwd: string, branch: string): Promise<ReferenceRepository> {
  const head = await explorerBranchTip(cwd, branch), identity = await explorerCheckoutIdentity(cwd);
  await explorerBranchTip(cwd, branch, head);
  if (identity !== await explorerCheckoutIdentity(cwd)) problem("STALE", "Repository identity changed");
  return { cwd, branch, head, identity };
}
export async function guardReferenceRepository(repo: ReferenceRepository) {
  await explorerBranchTip(repo.cwd, repo.branch, repo.head);
  if (await explorerCheckoutIdentity(repo.cwd) !== repo.identity) problem("STALE", "Repository identity changed");
}
async function objectInfo(cwd: string, oid: string, type: "commit" | "tree" | "blob", limit: number) {
  fullOid(oid);
  const response = text(await scopedGitRead(cwd, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], 4096, undefined, `${oid}\n`));
  if (response === `${oid} missing\n`) problem("MISSING_OBJECT", `Local ${type} object is missing: ${oid}`);
  const match = /^([a-f0-9]+) (commit|tree|blob|tag) ([0-9]+)\n$/.exec(response);
  if (!match || match[1] !== oid) problem("UNAVAILABLE", "Incomplete Git object probe");
  if (match[2] !== type) problem("UNSUPPORTED", `Expected a ${type} object, not a tag or another type`);
  const size = Number(match[3]);
  if (!Number.isSafeInteger(size) || size > limit) problem("LIMIT", "Git object exceeds the analysis size bound");
  return size;
}
async function commit(cwd: string, oid: string) {
  await objectInfo(cwd, oid, "commit", 64 * 1024);
  const data = text(await scopedGitRead(cwd, ["cat-file", "commit", oid], 64 * 1024));
  const header = data.split("\n\n", 1)[0], tree = /^tree ([a-f0-9]+)$/m.exec(header)?.[1];
  if (!tree) problem("UNAVAILABLE", "Commit has no tree");
  await objectInfo(cwd, fullOid(tree), "tree", 2 * 1024 * 1024);
  const parents = [...header.matchAll(/^parent ([a-f0-9]+)$/gm)].map(match => fullOid(match[1]));
  if (parents.length > 16) problem("LIMIT", "Commit exceeds the parent-count bound");
  return { oid, tree, parents };
}
interface Version { path: string; mode: string; oid: string; contents: string }
const identity = (file: Version | null) => file && { path: file.path, mode: file.mode, oid: file.oid, bytes: createHash("sha256").update(file.contents).digest("hex") };
function verifyBlob(oid: string, bytes: Buffer, size: number) {
  const actual = createHash(oid.length === 40 ? "sha1" : "sha256").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (bytes.length !== size || actual !== oid) problem("UNAVAILABLE", "Git blob content does not match its immutable identity");
}
async function version(cwd: string, oid: string | null, path: string, signal: AbortSignal): Promise<Version | null> {
  if (!oid) return null;
  const info = await commit(cwd, oid);
  const raw = text(await scopedGitRead(cwd, ["ls-tree", "-z", info.tree, "--", path], 64 * 1024));
  if (!raw) return null;
  const entry = /^([0-7]{6}) (blob|tree|commit) ([a-f0-9]+)\t([^\0]+)\0$/.exec(raw);
  if (!entry || entry[4] !== path) problem("UNAVAILABLE", "Incomplete tree entry");
  if (entry[2] !== "blob" || !["100644", "100755"].includes(entry[1])) problem("UNSUPPORTED", "Source/diff evidence requires regular text files");
  const size = await objectInfo(cwd, entry[3], "blob", 1024 * 1024);
  const file = await readGitTreeFile(cwd, oid, path, signal);
  if (!file) problem("UNAVAILABLE", "File disappeared while reading its immutable snapshot");
  verifyBlob(entry[3], Buffer.from(file.contents), size);
  return { path, mode: entry[1], oid: entry[3], contents: file.contents };
}
async function firstParent(cwd: string, oid: string, path: string, signal: AbortSignal) {
  const meta = await commit(cwd, oid), files = await explorerObjectCommitFiles(cwd, oid, meta.parents);
  if (files.length > 256) problem("LIMIT", "Commit inventory exceeds 256 changed paths");
  const selected = files.find(file => file.path === path);
  const before = await version(cwd, meta.parents[0] ?? null, selected?.previousPath ?? path, signal);
  const after = await version(cwd, oid, path, signal);
  return { changed: Boolean(selected), before: identity(before), after: identity(after) };
}
async function canonicalCommit(cwd: string, oid: string) {
  const meta = await commit(cwd, oid);
  const policy = ["--raw", "--no-abbrev", "--no-renames", "--no-ext-diff", "--no-textconv", "--ignore-submodules=none", "-r", "-z"];
  const args = meta.parents.length ? ["diff", ...policy, meta.parents[0], oid, "--"] : ["diff-tree", "--root", "--no-commit-id", ...policy, oid, "--"];
  if (meta.parents[0]) await commit(cwd, meta.parents[0]);
  const raw = text(await scopedGitRead(cwd, args));
  if (raw && !raw.endsWith("\0")) problem("UNAVAILABLE", "Incomplete canonical inventory");
  const parts = raw ? raw.slice(0, -1).split("\0") : [], rows: string[][] = [], blobs = new Set<string>();
  if (parts.length % 2 || parts.length > 512) problem("LIMIT", "Incomplete or over-256-path commit inventory");
  for (let i = 0; i < parts.length; i += 2) {
    const match = /^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]+) ([a-f0-9]+) ([ADMT])$/.exec(parts[i]);
    if (!match || !parts[i + 1]) problem("UNAVAILABLE", "Invalid canonical changed-path record");
    for (const [mode, oid] of [[match[1], match[3]], [match[2], match[4]]]) {
      fullOid(oid);
      if (mode === "000000") { if (!/^0+$/.test(oid)) problem("UNAVAILABLE", "Invalid absent file version"); continue; }
      if (!["100644", "100755", "120000"].includes(mode)) problem("UNSUPPORTED", "Whole-commit equality cannot certify submodule objects");
      if (!blobs.has(oid)) {
        const size = await objectInfo(cwd, oid, "blob", 1024 * 1024);
        verifyBlob(oid, await scopedGitRead(cwd, ["cat-file", "blob", oid], 1024 * 1024), size); blobs.add(oid);
      }
    }
    rows.push([parts[i + 1], ...match.slice(1)]);
  }
  return rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}
function lines(contents: string) { const result = contents.match(/[^\n]*(?:\n|$)/g) ?? []; if (result.at(-1) === "") result.pop(); return result; }
function excerpt(file: Version, start: number, end: number) {
  const all = lines(file.contents);
  if (start < 1 || end < start || end - start >= 400 || end > all.length) problem("INVALID_RANGE", "Pinned range does not exist in this file version");
  return all.slice(start - 1, end).join("");
}
async function oldReachability(cwd: string, oid: string, head: string) {
  try { await scopedGitRead(cwd, ["merge-base", "--is-ancestor", oid, head], 4096); return "reachable" as const; }
  catch (error) { if ((error as { code?: unknown }).code === 1) return "unreachable-but-present" as const; throw error; }
}
/** All material is immutable and independently admitted by the caller. Normal
 * reader validation still owns NEW destinations; old unreachable objects only
 * supply analysis, never a reachability grant. No subject/patch-id inference. */
export async function analyzeGitReference(original: GitEvidence, proposed: GitEvidence, repo: ReferenceRepository, signal: AbortSignal) {
  await guardReferenceRepository(repo);
  const oldOid = original.kind === "compare" ? original.candidate : original.oid;
  await commit(repo.cwd, oldOid);
  const availability = await oldReachability(repo.cwd, oldOid, repo.head);
  let status: "unchanged" | "moved" | "changed" = "unchanged";
  let axes: Record<string, string>;
  if (original.kind === "source" && proposed.kind === "source") {
    const old = await version(repo.cwd, original.oid, original.path, signal), next = await version(repo.cwd, proposed.oid, proposed.path, signal);
    if (!old || !next) problem("MISSING_PATH", "Referenced source path is absent; path remapping is not inferred");
    const before = excerpt(old, original.start, original.end), nextLines = lines(next.contents);
    const atPosition = proposed.end <= nextLines.length ? excerpt(next, proposed.start, proposed.end) : null;
    if (atPosition !== before) {
      const matches: number[] = [], width = original.end - original.start + 1;
      // Match complete multi-line byte spans at line boundaries; one-line or
      // repeated matches never authorize an inferred relocation.
      if (width >= 2) {
        const offsets = [0]; for (const line of nextLines) offsets.push(offsets.at(-1)! + line.length);
        const starts = new Map(offsets.slice(0, -1).map((offset, i) => [offset, i]));
        let offset = next.contents.indexOf(before);
        while (offset >= 0 && matches.length < 2) {
          const line = starts.get(offset);
          if (line !== undefined && offsets[line + width] === offset + before.length) matches.push(line + 1);
          offset = next.contents.indexOf(before, offset + 1);
        }
      }
      if (matches.length > 1) problem("AMBIGUOUS", "Excerpt has multiple possible locations");
      if (matches.length === 1) { proposed = { ...proposed, start: matches[0], end: matches[0] + width - 1 }; status = "moved"; }
      else if (atPosition !== null) status = "changed";
      else problem("INVALID_RANGE", "No valid destination range or unique multi-line relocation");
    }
    await explorerSource(repo.cwd, repo.head, proposed.oid, proposed.path, proposed.start, proposed.end, repo.branch);
    const oldParent = await firstParent(repo.cwd, original.oid, original.path, signal), newParent = await firstParent(repo.cwd, proposed.oid, proposed.path, signal);
    axes = { excerpt: same(before, excerpt(next, proposed.start, proposed.end)), surroundingFile: same(identity(old), identity(next)), fileFirstParentMaterial: same(oldParent, newParent) };
  } else if (original.kind === "commit" && proposed.kind === "commit") {
    await explorerCommit(repo.cwd, repo.head, proposed.oid, repo.branch);
    const before = await canonicalCommit(repo.cwd, original.oid), after = await canonicalCommit(repo.cwd, proposed.oid);
    axes = { completeFirstParentInventory: same(before, after) }; if (axes.completeFirstParentInventory !== "equal") status = "changed";
  } else if (original.kind === "compare" && proposed.kind === "compare") {
    await commit(repo.cwd, original.base); await commit(repo.cwd, proposed.base); await commit(repo.cwd, proposed.candidate);
    try { await scopedGitRead(repo.cwd, ["merge-base", "--is-ancestor", original.base, original.candidate], 4096); }
    catch { problem("UNAVAILABLE", "Old comparison ancestry is unavailable or reversed"); }
    // Reader checks both reachable endpoints, ancestry, complete changed-path
    // membership and text snapshots. Authored comparisons stay delete/add.
    await explorerCompareFile(repo.cwd, repo.head, proposed.base, proposed.candidate, repo.branch, repo.identity, proposed.path, true);
    const before = [identity(await version(repo.cwd, original.base, original.path, signal)), identity(await version(repo.cwd, original.candidate, original.path, signal))];
    if (same(before[0], before[1]) === "equal") problem("INVALID", "Old comparison path did not change");
    const after = [identity(await version(repo.cwd, proposed.base, proposed.path, signal)), identity(await version(repo.cwd, proposed.candidate, proposed.path, signal))];
    axes = { endpointFileVersions: same(before, after) }; if (axes.endpointFileVersions !== "equal") status = "changed";
  } else problem("INVALID", "Reference kind cannot change");
  await guardReferenceRepository(repo);
  signal.throwIfAborted();
  return { status, proposed, availability, axes, proseReviewRequired: status !== "unchanged" || Object.values(axes).includes("different"), tests: "Not executed; old test claims remain bound to their original candidate" };
}
