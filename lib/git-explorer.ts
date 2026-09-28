import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { promisify } from "node:util";
// @ts-expect-error Native Node tests require the .ts suffix; Next resolves it too.
import { gitExecEnv } from "./git-exec.ts";
// @ts-expect-error Native Node tests require the .ts suffix; Next resolves it too.
import { samePath, toNativePath } from "./paths.ts";

const exec = promisify(execFile);
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const PAGE_SIZE = 40;
const MAX_SKIP = 20_000;
const MAX_META_BYTES = 256 * 1024;
const MAX_REF_BYTES = 2 * 1024 * 1024;
const MAX_PATCH_BYTES = 1024 * 1024;

export class GitExplorerError extends Error {
  readonly code: "INVALID" | "STALE" | "NOT_FOUND" | "TOO_LARGE" | "UNAVAILABLE";
  constructor(code: GitExplorerError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export interface ExplorerCommit {
  oid: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  /** Local tag names at this commit, for display only; never history roots. */
  tags: string[];
}

export interface ExplorerFile { path: string; status: string }

function requireOid(oid: string): string {
  if (!OID.test(oid)) throw new GitExplorerError("INVALID", "Invalid commit ID");
  return oid;
}

async function git(cwd: string, args: string[], limit = MAX_META_BYTES): Promise<string> {
  try {
    const { stdout } = await exec("git", ["-C", cwd, "--no-pager", ...args], {
      env: { ...gitExecEnv(), GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_LITERAL_PATHSPECS: "1", GIT_PAGER: "cat",
        // Missing partial-clone objects must fail locally, never trigger a fetch.
        GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" },
      encoding: "utf8", maxBuffer: limit, timeout: 15_000,
    });
    return stdout;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        throw new GitExplorerError("TOO_LARGE", "Git output exceeds the size limit");
      }
      // show-ref reports an empty tag namespace with exit 1, not success. Do not
      // swallow other failures (including exit 1 with diagnostics or partial output).
      if (args.length === 3 && args[0] === "show-ref" && args[1] === "--tags" && args[2] === "--dereference" &&
        error.code === 1 && "stdout" in error && error.stdout === "" && "stderr" in error && error.stderr === "") return "";
    }
    throw new GitExplorerError("UNAVAILABLE", "Git history is unavailable");
  }
}

/** This is a physical checkout, never an arbitrary ancestor's repository or a bare repository. */
export async function explorerCheckout(cwd: string): Promise<{ head: string; branch: string }> {
  try {
    if (!samePath(cwd, realpathSync(cwd))) throw new Error("symlink");
    const root = toNativePath((await git(cwd, ["rev-parse", "--show-toplevel"])).trim());
    if (!samePath(root, cwd)) throw new Error("subdirectory");
    const head = requireOid((await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"])).trim());
    // --short can return "heads/main" when a tag is also named "main".
    const ref = (await git(cwd, ["symbolic-ref", "--quiet", "HEAD"])).trim();
    if (!ref.startsWith("refs/heads/")) throw new Error("detached");
    return { head, branch: ref.slice("refs/heads/".length) };
  } catch {
    throw new GitExplorerError("UNAVAILABLE", "Select a worktree root on a local branch");
  }
}

async function localRefs(cwd: string): Promise<{ branch: string; oid: string }[]> {
  // Only literal local branch refs are eligible as history roots; never resolve a client revision expression.
  const output = await git(cwd, ["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/heads"], MAX_REF_BYTES);
  return output.trimEnd().split("\n").filter(Boolean).map((line) => {
    const [ref, oid] = line.split("\0");
    if (!ref?.startsWith("refs/heads/") || !oid) throw new GitExplorerError("UNAVAILABLE", "Invalid local branch list");
    return { branch: ref.slice("refs/heads/".length), oid: requireOid(oid) };
  });
}

/** One bounded local read fully peels even nested annotated tags, without signature checks. */
async function decorateTags(cwd: string, commits: ExplorerCommit[]): Promise<void> {
  const output = await git(cwd, ["show-ref", "--tags", "--dereference"], MAX_REF_BYTES);
  const tags = new Map<string, string>();
  for (const line of output.split("\n").filter(Boolean)) {
    // Ref names cannot contain ASCII spaces/newlines, but may contain commas,
    // slashes or Unicode whitespace. Do not trim names or parse decorations.
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) refs\/tags\/([^\n]+)$/.exec(line);
    if (!match) throw new GitExplorerError("UNAVAILABLE", "Invalid local tag list");
    // show-ref emits an annotated tag's fully peeled row immediately after its base row.
    const name = match[2].endsWith("^{}") ? match[2].slice(0, -3) : match[2];
    tags.set(name, match[1]);
  }
  const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
  for (const [tag, oid] of tags) {
    // Only decorate known page commits. Tree/blob targets and unreachable tags
    // cannot add objects to the history or authorize detail/patch reads.
    byOid.get(oid)?.tags.push(tag);
  }
}

async function branchTip(cwd: string, branch: string, expectedHead?: string): Promise<string> {
  const tip = (await localRefs(cwd)).find((ref) => ref.branch === branch)?.oid;
  if (!tip) throw new GitExplorerError(expectedHead ? "STALE" : "NOT_FOUND", "Local branch changed; refresh history");
  if (expectedHead !== undefined && tip !== requireOid(expectedHead)) {
    throw new GitExplorerError("STALE", "Local branch changed; refresh history");
  }
  return tip;
}

async function anchored(cwd: string, expectedHead: string, branch?: string, checkoutBranch?: string): Promise<void> {
  requireOid(expectedHead);
  const checkout = await explorerCheckout(cwd);
  if (branch) {
    await branchTip(cwd, branch, expectedHead);
  } else if (checkout.head !== expectedHead || (checkoutBranch !== undefined && checkout.branch !== checkoutBranch)) {
    throw new GitExplorerError("STALE", "Worktree branch or HEAD changed; refresh history");
  }
}

async function reachable(cwd: string, head: string, oid: string): Promise<void> {
  requireOid(oid);
  try {
    await git(cwd, ["merge-base", "--is-ancestor", oid, head]);
  } catch {
    throw new GitExplorerError("NOT_FOUND", "Commit is not in this worktree's history");
  }
}

export async function explorerLog(cwd: string, skip = 0, expectedHead?: string, selectedBranch?: string) {
  if (!Number.isSafeInteger(skip) || skip < 0 || skip > MAX_SKIP) throw new GitExplorerError("INVALID", "Invalid history page");
  const checkout = await explorerCheckout(cwd);
  const branch = selectedBranch ?? checkout.branch;
  const head = await branchTip(cwd, branch, expectedHead);
  if (expectedHead !== undefined && !selectedBranch && checkout.head !== requireOid(expectedHead)) {
    throw new GitExplorerError("STALE", "Worktree HEAD changed; refresh history");
  }
  // NUL delimits fields and records even when subjects or authors contain unusual punctuation.
  const output = await git(cwd, ["log", "-z", "--topo-order", "--no-show-signature", `--skip=${skip}`, `--max-count=${PAGE_SIZE + 1}`,
    "--format=%H%x00%P%x00%an%x00%aI%x00%s", head], MAX_META_BYTES);
  await anchored(cwd, head, selectedBranch, checkout.branch);
  const fields = output ? output.split("\0") : [];
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 5 !== 0) throw new GitExplorerError("UNAVAILABLE", "Invalid Git history output");
  const commits: ExplorerCommit[] = [];
  for (let i = 0; i < fields.length; i += 5) {
    commits.push({ oid: requireOid(fields[i]), parents: fields[i + 1] ? fields[i + 1].split(" ").map(requireOid) : [],
      author: fields[i + 2], date: fields[i + 3], subject: fields[i + 4], tags: [] });
  }
  // Keep branch-picker authority separate from display-only local tag metadata.
  const refs = await localRefs(cwd);
  const page = commits.slice(0, PAGE_SIZE);
  await decorateTags(cwd, page);
  await anchored(cwd, head, selectedBranch, checkout.branch);
  return { head, branch, refs, commits: page, nextSkip: commits.length > PAGE_SIZE ? skip + PAGE_SIZE : null };
}

async function commitFiles(cwd: string, oid: string, parents: string[]): Promise<ExplorerFile[]> {
  const args = parents.length
    ? ["diff", "--name-status", "--no-renames", "-z", parents[0], oid, "--"]
    : ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "--no-renames", "-z", oid, "--"];
  const output = await git(cwd, args);
  const parts = output.split("\0");
  if (parts.at(-1) === "") parts.pop();
  if (parts.length % 2 !== 0) throw new GitExplorerError("UNAVAILABLE", "Invalid changed-file list");
  const files: ExplorerFile[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    if (!/^[AMDTCU]$/.test(parts[i]) || !parts[i + 1]) throw new GitExplorerError("UNAVAILABLE", "Invalid changed-file list");
    files.push({ status: parts[i], path: parts[i + 1] });
  }
  return files;
}

/** Inspect only a commit reachable from the captured local branch tip (or legacy checkout HEAD). Merge diffs use the first parent. */
export async function explorerCommit(cwd: string, head: string, oid: string, branch?: string) {
  await anchored(cwd, head, branch);
  await reachable(cwd, head, oid);
  const output = await git(cwd, ["show", "-s", "--format=%H%x00%P%x00%an%x00%aI%x00%B", oid]);
  const parts = output.split("\0");
  if (parts.length !== 5) throw new GitExplorerError("UNAVAILABLE", "Invalid Git commit output");
  const parents = parts[1] ? parts[1].split(" ").map(requireOid) : [];
  const files = await commitFiles(cwd, oid, parents);
  await anchored(cwd, head, branch);
  return { oid: requireOid(parts[0]), parents, author: parts[2], date: parts[3], message: parts[4].trimEnd(), files };
}

/** A single file's committed patch, selected from this commit's server-derived file list. */
export async function explorerPatch(cwd: string, head: string, oid: string, path: string, branch?: string) {
  const commit = await explorerCommit(cwd, head, oid, branch);
  if (!commit.files.some((file) => file.path === path)) throw new GitExplorerError("NOT_FOUND", "File was not changed by this commit");
  const args = commit.parents.length
    ? ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=3", commit.parents[0], oid, "--", path]
    : ["diff-tree", "--root", "--no-commit-id", "-p", "-r", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=3", oid, "--", path];
  const patch = await git(cwd, args, MAX_PATCH_BYTES);
  await anchored(cwd, head, branch);
  return { oid, path, patch, hasBinaryChanges: /^(?:Binary files .+ differ|GIT binary patch)$/m.test(patch) };
}
