import { createHash } from "node:crypto";
import { scopedGitRead } from "./git-read-scope";
import { decodeDiffText } from "./git-file-context";
import { explorerBranchTip, explorerCheckoutIdentity, explorerObjectCommitFiles, explorerCommit, explorerCompareFile } from "./git-explorer";
import { isReviewSourcePath, isReviewSourceRange } from "./review-notebook";
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
interface Version { path: string; mode: string; oid: string; contents: string }
const identity = (file: Version | null) => file && { path: file.path, mode: file.mode, oid: file.oid, bytes: createHash("sha256").update(file.contents).digest("hex") };

/** Operation-local immutable evidence only. The caller independently admits cwd,
 * captures each branch and freshly guards ALL captures before publishing results.
 * No mutable probe or authority is cached; each apply constructs new readers.
 * Retention is bounded by one Git scope's output budget and this entry ceiling. */
export class ReferenceReads {
  private readonly values = new Map<string, unknown>();
  constructor(readonly cwd: string, private readonly check: () => void) {}
  private async reuse<T>(key: unknown[], load: () => Promise<T>): Promise<T> {
    this.check();
    const id = JSON.stringify(key);
    if (this.values.has(id)) return this.values.get(id) as T;
    const value = await load(); this.check();
    if (this.values.size >= 8192) problem("LIMIT", "Immutable evidence exceeds the operation-local entry bound");
    this.values.set(id, value); return value;
  }
  private async objectInfo(oid: string, type: "commit" | "tree" | "blob", limit: number) {
    fullOid(oid);
    return this.reuse(["object", oid, type, limit], async () => {
      const response = text(await scopedGitRead(this.cwd, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], 4096, undefined, `${oid}\n`));
      if (response === `${oid} missing\n`) problem("MISSING_OBJECT", `Local ${type} object is missing: ${oid}`);
      const match = /^([a-f0-9]+) (commit|tree|blob|tag) ([0-9]+)\n$/.exec(response);
      if (!match || match[1] !== oid) problem("UNAVAILABLE", "Incomplete Git object probe");
      if (match[2] !== type) problem("UNSUPPORTED", `Expected a ${type} object, not a tag or another type`);
      const size = Number(match[3]);
      if (!Number.isSafeInteger(size) || size > limit) problem("LIMIT", "Git object exceeds the analysis size bound");
      return size;
    });
  }
  async commit(oid: string) {
    return this.reuse(["commit", fullOid(oid)], async () => {
      await this.objectInfo(oid, "commit", 64 * 1024);
      const data = text(await scopedGitRead(this.cwd, ["cat-file", "commit", oid], 64 * 1024));
      const header = data.split("\n\n", 1)[0], tree = /^tree ([a-f0-9]+)$/m.exec(header)?.[1];
      if (!tree) problem("UNAVAILABLE", "Commit has no tree");
      await this.objectInfo(fullOid(tree), "tree", 2 * 1024 * 1024);
      const parents = [...header.matchAll(/^parent ([a-f0-9]+)$/gm)].map(match => fullOid(match[1]));
      if (parents.length > 16) problem("LIMIT", "Commit exceeds the parent-count bound");
      return { oid, tree, parents };
    });
  }
  private async blob(oid: string) {
    return this.reuse(["blob", fullOid(oid)], async () => {
      const size = await this.objectInfo(oid, "blob", 1024 * 1024);
      const bytes = await scopedGitRead(this.cwd, ["cat-file", "blob", oid], 1024 * 1024);
      const actual = createHash(oid.length === 40 ? "sha1" : "sha256").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      if (bytes.length !== size || actual !== oid) problem("UNAVAILABLE", "Git blob content does not match its immutable identity");
      return bytes;
    });
  }
  async version(oid: string | null, path: string): Promise<Version | null> {
    if (!isReviewSourcePath(path)) problem("INVALID", "Source requires a literal repository-relative path");
    if (!oid) return null;
    return this.reuse(["version", fullOid(oid), path], async () => {
      const info = await this.commit(oid);
      const raw = text(await scopedGitRead(this.cwd, ["ls-tree", "-z", info.tree, "--", path], 64 * 1024));
      if (!raw) return null;
      const entry = /^([0-7]{6}) (blob|tree|commit) ([a-f0-9]+)\t([^\0]+)\0$/.exec(raw);
      if (!entry || entry[4] !== path) problem("UNAVAILABLE", "Incomplete tree entry");
      if (entry[2] !== "blob" || !["100644", "100755"].includes(entry[1])) problem("UNSUPPORTED", "Source/diff evidence requires regular text files");
      const contents = await this.reuse(["text", fullOid(entry[3])], async () => decodeDiffText(await this.blob(entry[3])));
      return { path, mode: entry[1], oid: entry[3], contents };
    });
  }
  async firstParent(oid: string, path: string) {
    return this.reuse(["file-parent", oid, path], async () => {
      const meta = await this.commit(oid);
      const files = await this.reuse(["rename-inventory", oid], async () => {
        const files = await explorerObjectCommitFiles(this.cwd, oid, meta.parents);
        if (files.length > 256) problem("LIMIT", "Commit inventory exceeds 256 changed paths");
        return files;
      });
      const selected = files.find(file => file.path === path);
      const before = await this.version(meta.parents[0] ?? null, selected?.previousPath ?? path), after = await this.version(oid, path);
      return { changed: Boolean(selected), before: identity(before), after: identity(after) };
    });
  }
  async canonicalCommit(oid: string) {
    return this.reuse(["canonical-inventory", oid], async () => {
      const meta = await this.commit(oid);
      const policy = ["--raw", "--no-abbrev", "--no-renames", "--no-ext-diff", "--no-textconv", "--ignore-submodules=none", "-r", "-z"];
      const args = meta.parents.length ? ["diff", ...policy, meta.parents[0], oid, "--"] : ["diff-tree", "--root", "--no-commit-id", ...policy, oid, "--"];
      if (meta.parents[0]) await this.commit(meta.parents[0]);
      const raw = text(await scopedGitRead(this.cwd, args));
      if (raw && !raw.endsWith("\0")) problem("UNAVAILABLE", "Incomplete canonical inventory");
      const parts = raw ? raw.slice(0, -1).split("\0") : [], rows: string[][] = [];
      if (parts.length % 2 || parts.length > 512) problem("LIMIT", "Incomplete or over-256-path commit inventory");
      for (let i = 0; i < parts.length; i += 2) {
        this.check();
        const match = /^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]+) ([a-f0-9]+) ([ADMT])$/.exec(parts[i]);
        if (!match || !parts[i + 1]) problem("UNAVAILABLE", "Invalid canonical changed-path record");
        for (const [mode, blob] of [[match[1], match[3]], [match[2], match[4]]]) {
          fullOid(blob);
          if (mode === "000000") { if (!/^0+$/.test(blob)) problem("UNAVAILABLE", "Invalid absent file version"); continue; }
          if (!["100644", "100755", "120000"].includes(mode)) problem("UNSUPPORTED", "Whole-commit equality cannot certify submodule objects");
          await this.blob(blob);
        }
        rows.push([parts[i + 1], ...match.slice(1)]);
      }
      return rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    });
  }
  async reachability(repo: ReferenceRepository, oid: string) {
    return this.reuse(["reachability", repo.identity, repo.head, fullOid(oid)], async () => {
      try { await scopedGitRead(this.cwd, ["merge-base", "--is-ancestor", oid, repo.head], 4096); return "reachable" as const; }
      catch (error) { if ((error as { code?: unknown }).code === 1) return "unreachable-but-present" as const; throw error; }
    });
  }
  async admitCommit(repo: ReferenceRepository, oid: string) {
    return this.reuse(["admitted-commit", repo.identity, repo.branch, repo.head, oid], async () => { await explorerCommit(this.cwd, repo.head, oid, repo.branch); return true; });
  }
  async admitComparison(repo: ReferenceRepository, reference: Extract<GitEvidence, { kind: "compare" }>) {
    return this.reuse(["admitted-comparison", repo.identity, repo.branch, repo.head, reference.base, reference.candidate, reference.path], async () => {
      await explorerCompareFile(this.cwd, repo.head, reference.base, reference.candidate, repo.branch, repo.identity, reference.path, true); return true;
    });
  }
}
function lines(contents: string) { const result = contents.match(/[^\n]*(?:\n|$)/g) ?? []; if (result.at(-1) === "") result.pop(); return result; }
function excerpt(file: Version, start: number, end: number) {
  const all = lines(file.contents);
  if (!isReviewSourceRange(start, end) || end > all.length) problem("INVALID_RANGE", "Pinned range does not exist in this file version");
  return all.slice(start - 1, end).join("");
}
function preview(contents: string) {
  const bytes = Buffer.from(contents); let end = Math.min(bytes.length, 2048);
  // Do not turn a partial UTF-8 character into a larger replacement character.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return { text: bytes.subarray(0, end).toString("utf8"), truncated: bytes.length > end, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
/** Caller guards the complete batch before publishing. Source admission uses the
 * reader's path/range rules and shared text decoder, verified immutable blobs and
 * reachability to the captured branch. No working-file or HEAD substitution. */
export async function analyzeGitReference(original: GitEvidence, proposed: GitEvidence, repo: ReferenceRepository, signal: AbortSignal, reads: ReferenceReads, explicitRange = false) {
  if (reads.cwd !== repo.cwd) problem("INVALID", "Immutable reader belongs to another checkout");
  const oldOid = original.kind === "compare" ? original.candidate : original.oid;
  await reads.commit(oldOid);
  const availability = await reads.reachability(repo, oldOid);
  let status: "unchanged" | "moved" | "changed" = "unchanged";
  let axes: Record<string, string>, sourcePreview: { before: ReturnType<typeof preview>; after: ReturnType<typeof preview> } | undefined;
  const reviewReasons: string[] = [];
  if (original.kind === "source" && proposed.kind === "source") {
    const old = await reads.version(original.oid, original.path), next = await reads.version(proposed.oid, proposed.path);
    if (!old || !next) problem("MISSING_PATH", "Referenced source path is absent; supply an explicit source destination to change paths");
    const before = excerpt(old, original.start, original.end), nextLines = lines(next.contents);
    const atPosition = proposed.end <= nextLines.length ? excerpt(next, proposed.start, proposed.end) : null;
    if (explicitRange) {
      if (atPosition === null) problem("INVALID_RANGE", "Explicit destination range extends beyond the file");
      if (atPosition !== before) status = "changed";
    } else if (atPosition !== before) {
      const matches: number[] = [], width = original.end - original.start + 1;
      // Only a unique complete multi-line byte span can relocate a reference.
      if (width >= 2) {
        const offsets = [0]; for (const line of nextLines) { signal.throwIfAborted(); offsets.push(offsets.at(-1)! + line.length); }
        const starts = new Map(offsets.slice(0, -1).map((offset, i) => [offset, i]));
        let offset = next.contents.indexOf(before);
        while (offset >= 0 && matches.length < 2) {
          signal.throwIfAborted();
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
    const after = excerpt(next, proposed.start, proposed.end);
    if (await reads.reachability(repo, proposed.oid) !== "reachable") problem("NOT_FOUND", "Destination commit is not in the named local branch's history");
    const oldParent = await reads.firstParent(original.oid, original.path), newParent = await reads.firstParent(proposed.oid, proposed.path);
    axes = { excerpt: same(before, after), surroundingFile: same(identity(old), identity(next)), fileFirstParentMaterial: same(oldParent, newParent) };
    if (original.path !== proposed.path) reviewReasons.push("source-path-changed");
    if (original.start !== proposed.start || original.end !== proposed.end) reviewReasons.push("source-range-changed");
    if (status === "unchanged" && reviewReasons.length) status = "moved";
    if (axes.excerpt === "different") reviewReasons.push("excerpt-changed");
    if (axes.surroundingFile === "different") reviewReasons.push("surrounding-file-changed");
    if (axes.fileFirstParentMaterial === "different") reviewReasons.push("first-parent-material-changed");
    sourcePreview = { before: preview(before), after: preview(after) };
  } else if (original.kind === "commit" && proposed.kind === "commit") {
    await reads.admitCommit(repo, proposed.oid);
    axes = { completeFirstParentInventory: same(await reads.canonicalCommit(original.oid), await reads.canonicalCommit(proposed.oid)) };
    if (axes.completeFirstParentInventory !== "equal") { status = "changed"; reviewReasons.push("complete-first-parent-inventory-changed"); }
  } else if (original.kind === "compare" && proposed.kind === "compare") {
    await reads.commit(original.base); await reads.commit(proposed.base); await reads.commit(proposed.candidate);
    try { await scopedGitRead(repo.cwd, ["merge-base", "--is-ancestor", original.base, original.candidate], 4096); }
    catch { problem("UNAVAILABLE", "Old comparison ancestry is unavailable or reversed"); }
    await reads.admitComparison(repo, proposed);
    const before = [identity(await reads.version(original.base, original.path)), identity(await reads.version(original.candidate, original.path))];
    if (same(before[0], before[1]) === "equal") problem("INVALID", "Old comparison path did not change");
    const after = [identity(await reads.version(proposed.base, proposed.path)), identity(await reads.version(proposed.candidate, proposed.path))];
    axes = { endpointFileVersions: same(before, after) };
    if (axes.endpointFileVersions !== "equal") { status = "changed"; reviewReasons.push("comparison-endpoint-files-changed"); }
  } else problem("INVALID", "Reference kind cannot change");
  signal.throwIfAborted();
  return { status, proposed, availability, axes, evidenceScope: original.kind === "source" ? "source-excerpt" : original.kind === "commit" ? "whole-commit-first-parent" : "comparison-path",
    reviewReasons, ...(sourcePreview ? { sourcePreview } : {}), proseReviewRequired: reviewReasons.length > 0,
    tests: "Not executed; old test claims remain bound to their original candidate" };
}
