import { execFile, spawn } from "node:child_process";
import { mkdtemp, lstat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { gitExecEnv } from "./git-exec";
import { preflightGitPreparation, GitPreparationError, type GitPreparationSnapshot } from "./git-preparation";
import { selectCanonicalGitResources, withGitProjectReview } from "./git-project-resources";
import type { GitReviewRepository } from "./git-review";

const exec = promisify(execFile);
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_MESSAGE = 256 * 1024;
export class GitPreparationCandidateConflict extends Error {
  readonly code = "conflict";
  constructor() { super("Candidate merge has conflicts; no checkout or ref was changed"); this.name = "GitPreparationCandidateConflict"; }
}
type Bound = Exclude<GitReviewRepository, string>;
const hooksKey = Symbol.for("pi-web:git-preparation-candidate:empty-hooks");
function block(code: GitPreparationError["code"], message: string): never { throw new GitPreparationError(code, message); }
function objectId(value: string): string {
  if (!OID.test(value)) block("history", "Git returned an invalid object ID");
  return value;
}
async function emptyHooks(): Promise<string> {
  const global = globalThis as unknown as Record<symbol, Promise<string> | undefined>;
  return global[hooksKey] ??= mkdtemp(join(tmpdir(), "pi-web-candidate-hooks-"));
}
async function context(repo: Bound): Promise<{ prefix: string[]; env: NodeJS.ProcessEnv }> {
  return { prefix: ["--no-optional-locks", "-C", repo.cwd, `--git-dir=${repo.gitDir}`, `--work-tree=${repo.cwd}`,
    "-c", "core.fsmonitor=false", "-c", `core.hooksPath=${await emptyHooks()}`,
    "-c", "commit.gpgsign=false", "-c", "core.attributesFile=/dev/null"],
  env: { ...gitExecEnv(), GIT_COMMON_DIR: repo.commonDir, GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_ATTR_NOSYSTEM: "1", GIT_PAGER: "cat" } };
}
async function git(repo: Bound, ...args: string[]): Promise<string> {
  const { prefix, env } = await context(repo);
  const { stdout } = await exec("git", [...prefix, ...args], { encoding: "utf8", env, timeout: 30_000, maxBuffer: 1024 * 1024 });
  return stdout;
}
async function rawCommit(repo: Bound, id: string): Promise<Buffer> {
  const { prefix, env } = await context(repo);
  const { stdout } = await exec("git", [...prefix, "cat-file", "commit", objectId(id)],
    { encoding: "buffer", env, timeout: 30_000, maxBuffer: MAX_MESSAGE + 4096 });
  return stdout as Buffer;
}
function person(value: string): { name: string; email: string; date: string } {
  const match = /^([^<>\x00-\x1f\x7f]+) <([^<>\x00-\x1f\x7f]+)> ([0-9]+) ([+-](?:0[0-9]|1[0-4])[0-5][0-9])$/.exec(value);
  if (!match) block("history", "Unsupported commit identity");
  return { name: match[1], email: match[2], date: `@${match[3]} ${match[4]}` };
}
function parseCommit(raw: Buffer, expected: { oid: string; parentOid: string; treeOid: string }) {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); }
  catch { return block("history", "Unsupported commit encoding"); }
  const boundary = text.indexOf("\n\n");
  if (boundary < 0 || raw.length > MAX_MESSAGE || text.includes("\0")) block("history", "Unsupported commit object");
  const lines = text.slice(0, boundary).split("\n");
  // No gpgsig, mergetag, encoding, multiline or unknown headers are silently discarded.
  if (lines.length !== 4 || lines[0] !== `tree ${expected.treeOid}` ||
      lines[1] !== `parent ${expected.parentOid}` || !lines[2].startsWith("author ") ||
      !lines[3].startsWith("committer ")) block("history", "Signed or unsupported commit headers");
  return { author: person(lines[2].slice(7)), committer: person(lines[3].slice(10)),
    message: raw.subarray(Buffer.byteLength(text.slice(0, boundary)) + 2) };
}
async function commitTree(repo: Bound, tree: string, parent: string, old: ReturnType<typeof parseCommit>): Promise<string> {
  const { prefix, env } = await context(repo);
  Object.assign(env, { GIT_AUTHOR_NAME: old.author.name, GIT_AUTHOR_EMAIL: old.author.email,
    GIT_AUTHOR_DATE: old.author.date, GIT_COMMITTER_NAME: old.committer.name,
    GIT_COMMITTER_EMAIL: old.committer.email, GIT_COMMITTER_DATE: old.committer.date });
  return await new Promise<string>((resolve, reject) => {
    const child = spawn("git", [...prefix, "commit-tree", objectId(tree), "-p", objectId(parent), "--no-gpg-sign", "-F", "-"],
      { env, stdio: ["pipe", "pipe", "ignore"], timeout: 30_000 });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; if (output.length > 128) child.kill(); });
    child.stdin.on("error", () => { /* exit/close reports a generic error */ });
    child.stdin.end(old.message);
    child.on("error", reject);
    child.on("close", (code) => code === 0 && OID.test(output.trim()) ? resolve(output.trim()) : reject(new Error("commit-tree failed")));
  });
}
async function assertSafe(repo: Bound, trees: string[]): Promise<void> {
  // Check default global attribute locations as well as explicit settings. Git
  // does not report these implicit files in `config --list`, and merge-tree can
  // silently use merge=union from one. All candidate subprocesses also disable
  // global and system attributes, so an external file appearing mid-call cannot
  // change replay semantics. This planner only supports Linux bound repositories.
  const { env } = await context(repo);
  const xdg = env.XDG_CONFIG_HOME;
  const home = env.HOME;
  if (xdg && !isAbsolute(xdg) || home && !isAbsolute(home) || !xdg && !home) {
    block("unavailable", "Global Git attributes location unavailable");
  }
  for (const file of [xdg && join(xdg, "git", "attributes"), home && join(home, ".config", "git", "attributes")]) {
    if (!file) continue;
    try { await lstat(file); block("unavailable", "Global Git attributes are unsupported"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  // Inspect *all* config records, not only effective values: a shadowed custom
  // driver/hook/attributesFile is still an unsupported configuration. Forced
  // values above ensure reads and object writes cannot invoke local hooks.
  const safeHooks = await emptyHooks();
  for (const record of (await git(repo, "config", "--list", "--null")).split("\0")) {
    if (!record) continue;
    const split = record.indexOf("\n");
    if (split < 0) block("unavailable", "Unsupported Git configuration");
    const name = record.slice(0, split).toLowerCase(), value = record.slice(split + 1);
    if (name === "core.hookspath" && value === safeHooks || name === "core.fsmonitor" && value === "false" ||
        name === "commit.gpgsign" && value === "false" || name === "core.attributesfile" && value === "/dev/null" ||
        name === "core.autocrlf" && (value === "false" || value === "input")) continue;
    // Inactive global includeIf and signing-key metadata do not execute with
    // --no-gpg-sign; any *active* included unsafe setting still appears here.
    if (/^(filter\.|merge\.|diff\.|index\.|extensions\.|core\.(?:hookspath|fsmonitor|attributesfile|external|sparsecheckout|splitindex|worktree|ignorecase|protecthfs|protectntfs|eol|autocrlf|symlinks)|commit\.|i18n\.commitencoding)/.test(name)) {
      block("unavailable", "Unsupported Git configuration for candidate preparation");
    }
  }
  for (const dir of new Set([repo.gitDir, repo.commonDir])) {
    for (const file of [join(dir, "info", "attributes")]) {
      try { await lstat(file); block("unavailable", "Git attributes are unsupported"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const hookDir = join(dir, "hooks");
    try {
      const info = await lstat(hookDir);
      if (!info.isDirectory() || info.isSymbolicLink()) block("unavailable", "Repository hooks are unsupported");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    for (const name of await readdir(hookDir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []; throw error;
    })) {
      if (name.endsWith(".sample")) continue;
      const info = await lstat(join(hookDir, name));
      if (info.isFile() || info.isSymbolicLink()) block("unavailable", "Repository hooks are unsupported");
    }
  }
  for (const tree of new Set(trees)) {
    const output = await git(repo, "ls-tree", "-r", "-z", objectId(tree));
    for (const entry of output.split("\0")) {
      if (!entry) continue;
      const path = entry.slice(entry.indexOf("\t") + 1);
      if (path === ".gitattributes" || path.endsWith("/.gitattributes") || entry.startsWith("160000 ")) {
        block("unavailable", "Attributes or submodules are unsupported");
      }
    }
  }
}

export interface GitPreparationCandidate {
  status: "candidate" | "already-prepared";
  oldSourceOid: string;
  newSourceOid: string;
  targetOid: string;
  /** Object IDs only; not an execution handle or an approval. An OID may already be reachable. */
  comparison: { oldBaseOid: string; oldTipOid: string; newBaseOid: string; newTipOid: string;
    commits: { oldOid: string; newOid: string; oldTreeOid: string; newTreeOid: string;
      /** The replay retained a first-parent commit even though its tree equals its new parent's tree. */
      emptyAfterReplay: boolean }[] };
}

/** Unexposed candidate-only stage. The snapshot is a consistency assertion, not
 * authority: discover selected physical resources and all refs again before and
 * after object writes. New objects may remain on refusal, but commit-tree may
 * also reuse an existing reachable OID. No intent, checkout/index/ref update,
 * permission or executable token is produced.
 * Publication outside this repository is unknowable; local evidence blocks.
 */
export async function planGitPreparationCandidate(snapshot: GitPreparationSnapshot, agentDir = getAgentDir()): Promise<GitPreparationCandidate> {
  try {
    if (!snapshot?.source?.projectRoot || !snapshot.source.cwd || !snapshot.target?.cwd ||
        !snapshot.source.branch || !snapshot.target.branch) block("invalid-selection", "Fresh preparation preflight required");
    const request = { source: { repositoryPath: snapshot.source.projectRoot, checkoutPath: snapshot.source.cwd,
      workspaceBranch: snapshot.source.branch }, target: { repositoryPath: snapshot.target.projectRoot,
      checkoutPath: snapshot.target.cwd, workspaceBranch: snapshot.target.branch } };
    const fresh = async () => preflightGitPreparation(request, agentDir);
    const matches = (candidate: GitPreparationSnapshot) => JSON.stringify(candidate) === JSON.stringify(snapshot);
    const before = await fresh();
    if (!matches(before)) block("ref-moved", "Preparation preflight is stale or not server-authenticated");
    const result = (commits: GitPreparationCandidate["comparison"]["commits"], tip: string): GitPreparationCandidate => ({
      status: commits.length ? "candidate" : "already-prepared", oldSourceOid: before.source.oid,
      newSourceOid: tip, targetOid: before.target.oid,
      comparison: { oldBaseOid: before.mergeBaseOid, oldTipOid: before.source.oid,
        newBaseOid: before.target.oid, newTipOid: tip, commits },
    });
    if (before.status === "already-prepared") return result([], before.source.oid);
    const source = await selectCanonicalGitResources(request.source);
    const target = await selectCanonicalGitResources(request.target);
    return await withGitProjectReview(source, async (sourceContext) => withGitProjectReview(target, async (targetContext) => {
      if (typeof sourceContext === "string" || typeof targetContext === "string") block("unavailable", "Bound Git directories required");
      const sourceRepo = sourceContext as Bound, targetRepo = targetContext as Bound;
      if (!matches(await fresh())) block("ref-moved", "Repository changed before candidate creation");
      // base and target are commits, not trees; resolve their exact tree IDs.
      const trees = [objectId((await git(sourceRepo, "rev-parse", `${before.mergeBaseOid}^{tree}`)).trim()),
        objectId((await git(targetRepo, "rev-parse", `${before.target.oid}^{tree}`)).trim()),
        ...before.rewriteSeries.map((c) => c.treeOid)];
      await assertSafe(sourceRepo, trees);
      await assertSafe(targetRepo, trees);
      const rewritten: GitPreparationCandidate["comparison"]["commits"] = [];
      let parent = before.target.oid;
      let parentTree = trees[1];
      for (const old of before.rewriteSeries) {
        const metadata = parseCommit(await rawCommit(sourceRepo, old.oid), old);
        let output: string;
        try { output = await git(sourceRepo, "merge-tree", "--write-tree", "--merge-base", old.parentOid, parent, old.oid); }
        catch (error) {
          if (typeof error === "object" && error !== null && "code" in error && error.code === 1) {
            throw new GitPreparationCandidateConflict();
          }
          throw error;
        }
        const tree = objectId(output.split("\n")[0]);
        const emptyAfterReplay = tree === parentTree;
        // Preserve even an empty replay as an explicit first-parent commit; the
        // agent must assess this content-equivalent change before later actions.
        await assertSafe(sourceRepo, [tree]);
        const created = await commitTree(sourceRepo, tree, parent, metadata);
        // Never treat commit-tree stdout alone as evidence of the returned object;
        // its OID may already have been reachable before this call.
        const actual = parseCommit(await rawCommit(sourceRepo, created), { oid: created, parentOid: parent, treeOid: tree });
        if (!actual.message.equals(metadata.message) ||
            JSON.stringify(actual.author) !== JSON.stringify(metadata.author) ||
            JSON.stringify(actual.committer) !== JSON.stringify(metadata.committer)) {
          block("history", "Candidate commit differs from original metadata");
        }
        rewritten.push({ oldOid: old.oid, newOid: created, oldTreeOid: old.treeOid, newTreeOid: tree, emptyAfterReplay });
        parent = created;
        parentTree = tree;
      }
      await assertSafe(sourceRepo, [...trees, ...rewritten.map((c) => c.newTreeOid)]);
      await assertSafe(targetRepo, [...trees, ...rewritten.map((c) => c.newTreeOid)]);
      if (!matches(await fresh())) block("ref-moved", "Repository changed during candidate creation");
      await assertSafe(sourceRepo, [...trees, ...rewritten.map((c) => c.newTreeOid)]);
      await assertSafe(targetRepo, [...trees, ...rewritten.map((c) => c.newTreeOid)]);
      if (!matches(await fresh())) block("ref-moved", "Repository changed during final candidate inspection");
      return result(rewritten, parent);
    }));
  } catch (error) {
    if (error instanceof GitPreparationError || error instanceof GitPreparationCandidateConflict) throw error;
    // Neither stderr, merge-tree's conflict path list, nor raw commit metadata reaches the model.
    block("unavailable", "Candidate preparation failed or physical resources changed; inspect checkout manually");
  }
}
