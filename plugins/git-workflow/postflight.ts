import { createHash } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { samePath, toNativePath } from "../../lib/paths";
import { pluginProjectIdentityAsync } from "../../lib/plugins/settings";
import { directoryIdentity, refuseFilters } from "./checkout-safety";
import { holdCleanupParent, supportsNestedCleanup, type CleanupDirectoryIdentity } from "./cleanup-path";
import { operationMarkerPaths, OPERATION_MARKERS } from "./operation-paths";
import { gitText as git, gitOutput, records } from "./process";

export type ReportAction = "commit" | "merge" | "rebase" | "cleanupFeature";
interface RefObservation { tip: string; symbolic: string }
interface CheckoutAnchor { path: string; identity: string; gitDirectory: string; gitIdentity: string; branch: string | null; tip: string }
export interface PostflightBaseline {
  action: ReportAction; cwd: string; repository: string; repositoryIdentity: string;
  checkouts: CheckoutAnchor[]; registrations: Registration[]; refs: Record<string, { branch: string; before: string }>;
  candidateTree?: string; mergeMethod?: "ff-only" | "non-ff";
  cleanup?: { featureTip: string; integrationCommit: string; path?: string; removeWorktree: boolean; deleteBranch: boolean; artifacts: string[];
    parent?: { path: string; identity: string }; ancestorIdentities?: CleanupDirectoryIdentity[] };
}
export interface CheckoutStatus {
  clean: boolean; staged: number; unstaged: number; untracked: number; conflicted: number; digest: string;
}
interface CheckoutObservation { path: string; branch: string | null; tip: string; status: CheckoutStatus; operationMarkers: string[]; hiddenIndexFlags: boolean }
interface CommitObservation { oid: string; tree: string; parents: string[]; parentCount: number; author: { name: string; email: string }; signed: boolean; metadataTruncated: boolean }
type Registration = { path: string; branch?: string; head?: string; metadata: string[] };
export interface PostflightReport {
  version: 1; action: ReportAction; nativeOutcome: "completed" | "started" | "not-started"; finalization?: "completed" | "failed" | "not-run";
  verification: "verified" | "failed" | "unavailable" | "not-run";
  observedAt: string; scope: string; disposition?: "no-op" | "fast-forward" | "non-fast-forward"; refs: Record<string, { branch: string; before: string; after?: string }>;
  checkouts: CheckoutObservation[]; commit?: CommitObservation; relationships: Record<string, boolean>;
  issues: string[]; checks: Array<{ name: string; status: string; cwd: string }>; checksOmitted?: number;
  effects?: { completed: number; samples: string[]; omitted: number; attempted?: string };
  resources?: { artifacts: { selected: number; absent: number; present: number; unknown: number }; worktree?: { path: string; presence: string; registered: boolean }; branch?: { name: string; presence: string } };
  cleanupReady?: { featureBranch: string; featureTip: string; integrationCommit: string; targetBranch: string; worktreePath?: string };
}
const SCOPE = "Selected local refs/checkouts only; optimistic post-effect observations, not an atomic snapshot or new authority. Clean excludes ignored files. Checks are pre-effect, not merged-result acceptance.";
const boundedError = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1000);

async function observedHead(cwd: string) {
  let branch: string | null = null;
  try { branch = (await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim(); }
  catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
  return { branch, tip: (await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"])).trim() };
}
async function readRef(cwd: string, branch: string): Promise<RefObservation | undefined> {
  const name = `refs/heads/${branch}`;
  let symbolic = "";
  try { symbolic = (await git(cwd, ["symbolic-ref", "--quiet", name])).trim(); }
  catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
  const row = (await git(cwd, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)", name]))
    .split("\n").map(line => line.split("\0")).find(fields => fields[0] === name);
  // Enumeration can omit dangling symrefs. They exist, but cannot prove absence.
  if (symbolic) return { tip: row?.[1] ?? "", symbolic };
  if (row) return { tip: row[1], symbolic: row[2] };
  try { await git(cwd, ["show-ref", "--verify", "--quiet", name]); }
  catch (error) { if ((error as { status?: number }).status === 1) return undefined; throw error; }
  throw new Error("Selected ref could not be enumerated safely");
}
async function registrations(cwd: string) {
  const result: Registration[] = [];
  const text = await git(cwd, ["worktree", "list", "--porcelain", "-z"]);
  for (const row of text.split("\0\0").filter(Boolean)) {
    const fields = row.split("\0");
    result.push({ path: toNativePath(fields.find(field => field.startsWith("worktree "))!.slice(9)),
      branch: fields.find(field => field.startsWith("branch refs/heads/"))?.slice(18),
      head: fields.find(field => field.startsWith("HEAD "))?.slice(5),
      metadata: fields.filter(field => !field.startsWith("HEAD ")) });
  }
  return result;
}
async function anchor(path: string): Promise<CheckoutAnchor> {
  const identity = directoryIdentity(path);
  const gitDirectory = toNativePath((await git(path, ["rev-parse", "--path-format=absolute", "--git-dir"])).trim());
  return { path, identity, gitDirectory, gitIdentity: directoryIdentity(gitDirectory), ...await observedHead(path) };
}
export async function capturePostflight(input: {
  action: ReportAction; cwd: string; paths: string[]; refs?: PostflightBaseline["refs"];
  candidateTree?: string; mergeMethod?: PostflightBaseline["mergeMethod"]; cleanup?: PostflightBaseline["cleanup"];
}): Promise<PostflightBaseline> {
  const repository = await pluginProjectIdentityAsync(input.cwd);
  if (!repository) throw new Error("Git observation repository is unavailable");
  const { paths, ...rest } = input;
  const checkouts: CheckoutAnchor[] = [];
  for (const path of [...new Set(paths)]) checkouts.push(await anchor(path));
  const refs = input.refs ?? {};
  const selectedRegistrations = (await registrations(input.cwd)).filter(row => checkouts.some(item => samePath(item.path, row.path)) || Object.values(refs).some(ref => ref.branch === row.branch));
  const cleanup = input.cleanup ? { ...input.cleanup, ...(input.cleanup.path ? { parent: { path: dirname(input.cleanup.path), identity: directoryIdentity(dirname(input.cleanup.path)) } } : {}) } : undefined;
  return { ...rest, repository, repositoryIdentity: directoryIdentity(repository), checkouts, registrations: selectedRegistrations, refs, ...(cleanup ? { cleanup } : {}) };
}
async function guard(baseline: PostflightBaseline, checkout: CheckoutAnchor) {
  if (directoryIdentity(baseline.repository) !== baseline.repositoryIdentity || directoryIdentity(checkout.path) !== checkout.identity
    || directoryIdentity(checkout.gitDirectory) !== checkout.gitIdentity) throw new Error("Selected Git physical identity changed");
  if (await pluginProjectIdentityAsync(checkout.path) !== baseline.repository
    || !samePath(toNativePath((await git(checkout.path, ["rev-parse", "--show-toplevel"])).trim()), checkout.path)
    || !samePath(toNativePath((await git(checkout.path, ["rev-parse", "--path-format=absolute", "--git-dir"])).trim()), checkout.gitDirectory)) {
    throw new Error("Selected Git repository or checkout changed");
  }
  if (existsSync(join(baseline.repository, "info", "grafts"))) throw new Error("Legacy Git grafts are unsupported");
  try { if ((await git(checkout.path, ["config", "--get", "core.sparseCheckout"])).trim() === "true") throw new Error("Sparse checkout is unsupported"); }
  catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
}

/** Counts porcelain-v1 records, never filenames. Rename/copy has a second NUL record. */
export async function summarizeStatus(source: AsyncIterable<Uint8Array>): Promise<CheckoutStatus> {
  const hash = createHash("sha256"); let bytes = 0;
  async function* hashed() { for await (const chunk of source) { hash.update(chunk); bytes += chunk.byteLength; yield chunk; } }
  let staged = 0, unstaged = 0, untracked = 0, conflicted = 0, originalPath = false;
  for await (const row of records(hashed())) {
    if (originalPath) { originalPath = false; continue; }
    if (row.length < 4 || row[2] !== " ") throw new Error("Invalid Git status framing");
    const code = row.slice(0, 2);
    if (code === "??") untracked++;
    else {
      if (["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(code)) conflicted++;
      if (code[0] !== " ") staged++;
      if (code[1] !== " ") unstaged++;
      originalPath = /[RC]/.test(code);
    }
  }
  if (originalPath) throw new Error("Incomplete Git rename status");
  return { clean: bytes === 0, staged, unstaged, untracked, conflicted, digest: bytes ? hash.digest("hex") : "" };
}
async function observeCheckout(baseline: PostflightBaseline, expected: CheckoutAnchor): Promise<CheckoutObservation> {
  await guard(baseline, expected);
  await refuseFilters(expected.path, gitOutput(expected.path, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]));
  const paths = await operationMarkerPaths(expected.path);
  const operationMarkers = OPERATION_MARKERS.filter((_, index) => existsSync(toNativePath(paths[index])));
  let hiddenIndexFlags = false;
  for await (const row of records(gitOutput(expected.path, ["ls-files", "-v", "-z"]))) if (/^[a-zS]/.test(row)) hiddenIndexFlags = true;
  const status = await summarizeStatus(gitOutput(expected.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
  return { path: expected.path, ...await observedHead(expected.path), status, operationMarkers, hiddenIndexFlags };
}
async function commit(cwd: string, oid: string): Promise<CommitObservation> {
  const result: CommitObservation = { oid, tree: "", parents: [], parentCount: 0, author: { name: "", email: "" }, signed: false, metadataTruncated: false };
  let header = true, line = Buffer.alloc(0), length = 0;
  // Raw headers never invoke a configured signature verifier. Drain message
  // bytes without retaining its lines, even for a giant single-line message.
  const accept = () => {
    const text = line.toString("utf8");
    if (length === 0) header = false;
    else if (text.startsWith("tree ")) result.tree = text.slice(5);
    else if (text.startsWith("parent ")) { result.parentCount++; if (result.parents.length < 8) result.parents.push(text.slice(7)); else result.metadataTruncated = true; }
    else if (/^gpgsig(?:-sha256)? /.test(text)) result.signed = true;
    else if (text.startsWith("author ")) {
      const match = /^author (.*) <([^>]*)> -?\d+ [+-]\d+$/.exec(text);
      if (match && length <= 4096) {
        result.author = { name: match[1].slice(0, 240), email: match[2].slice(0, 320) };
        result.metadataTruncated ||= match[1].length > 240 || match[2].length > 320;
      } else { result.author = { name: text.slice(7, 247), email: "" }; result.metadataTruncated = true; }
    }
    line = Buffer.alloc(0); length = 0;
  };
  for await (const chunk of gitOutput(cwd, ["cat-file", "-p", oid])) {
    let start = 0;
    while (header && start < chunk.length) {
      const end = chunk.indexOf(10, start), stop = end === -1 ? chunk.length : end;
      const part = chunk.subarray(start, stop); length += part.length;
      if (line.length < 4096) line = Buffer.concat([line, part.subarray(0, 4096 - line.length)]);
      if (end === -1) break;
      accept(); start = end + 1;
    }
  }
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(result.tree)) throw new Error("Invalid commit metadata");
  return result;
}
async function ancestor(cwd: string, older: string, newer: string) {
  try { await git(cwd, ["merge-base", "--is-ancestor", older, newer]); return true; }
  catch (error) { if ((error as { status?: number }).status === 1) return false; throw error; }
}
/** Shallow presence only. Refuse a replaced ancestor; do not follow links or read contents. */
function presence(root: { path: string; identity: string }, relativePath: string, ancestors: CleanupDirectoryIdentity[] = []): "absent" | "present" | "unknown" {
  let held: ReturnType<typeof holdCleanupParent> | undefined;
  try {
    if (directoryIdentity(root.path) !== root.identity) return "unknown";
    if (!supportsNestedCleanup() && !relativePath.includes("/")) {
      let missing = false;
      try { lstatSync(join(root.path, relativePath)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") missing = true; else throw error; }
      return directoryIdentity(root.path) === root.identity ? missing ? "absent" : "present" : "unknown";
    }
    held = holdCleanupParent(root.path, relativePath, [{ path: "", identity: root.identity.split(":") }, ...ancestors.filter(item => item.path !== "")]);
    let missing = false;
    try { lstatSync(held.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") missing = true; else throw error; }
    held.validate(); // Negative observations must validate the same held ancestors.
    return missing ? "absent" : "present"; // A leaf symlink is never followed.
  } catch { return "unknown"; }
  finally { held?.close(); }
}

export const nativePostflightAccess = { guard, registrations, readRef, observeCheckout, commit, ancestor, presence };

export async function collectPostflight(baseline: PostflightBaseline, nativeOutcome: PostflightReport["nativeOutcome"], checks: PostflightReport["checks"] = [], access = nativePostflightAccess): Promise<PostflightReport> {
  const { guard, registrations, readRef, observeCheckout, commit, ancestor } = access;
  const report: PostflightReport = { version: 1, action: baseline.action, nativeOutcome,
    verification: "unavailable", observedAt: new Date().toISOString(), scope: SCOPE,
    refs: structuredClone(baseline.refs), checkouts: [], relationships: {}, issues: [], checks: checks.slice(0, 24).map(check => ({ ...check, name: check.name.slice(0, 240) })),
    ...(checks.length > 24 ? { checksOmitted: checks.length - 24 } : {}) };
  try {
    const selected = baseline.checkouts.find(item => samePath(item.path, baseline.cwd))!;
    await guard(baseline, selected);
    const beforeRegistrations = await registrations(baseline.cwd);
    const selectedRows = (rows: Registration[]) => rows.filter(row => baseline.checkouts.some(item => samePath(item.path, row.path)) || Object.values(baseline.refs).some(ref => ref.branch === row.branch));
    if (!baseline.cleanup && JSON.stringify(selectedRows(beforeRegistrations).map(row => row.metadata)) !== JSON.stringify(baseline.registrations.map(row => row.metadata))) report.issues.push("Selected worktree registration changed since capture");
    const refs: Record<string, RefObservation | undefined> = {};
    for (const [key, value] of Object.entries(baseline.refs)) {
      refs[key] = await readRef(baseline.cwd, value.branch);
      if (refs[key]?.tip) report.refs[key].after = refs[key]!.tip;
      if (refs[key]?.symbolic) report.issues.push(`Selected ${key} ref is symbolic`);
    }
    for (const expected of baseline.checkouts) {
      const registered = beforeRegistrations.some(row => samePath(row.path, expected.path));
      if (baseline.cleanup?.removeWorktree && expected.path === baseline.cleanup.path && !registered) continue;
      const observation = await observeCheckout(baseline, expected);
      report.checkouts.push(observation);
      if (observation.branch !== expected.branch) report.issues.push("Selected checkout branch changed");
      if (observation.hiddenIndexFlags) report.issues.push("Selected checkout has hidden index flags");
      if (observation.operationMarkers.length) report.issues.push("Selected checkout has Git operation markers");
    }
    const current = report.checkouts.find(item => samePath(item.path, baseline.cwd))!;
    report.commit = await commit(baseline.cwd, current.tip);
    let rereadResources: (() => PostflightReport["resources"]) | undefined;
    const feature = refs.feature?.tip, target = refs.target?.tip;
    const featureBefore = baseline.refs.feature?.before, targetBefore = baseline.refs.target?.before;
    if (baseline.action === "merge" && feature && target && featureBefore && targetBefore) {
      report.relationships.featureUnchanged = feature === featureBefore;
      report.relationships.targetMatchesCheckout = target === current.tip;
      report.relationships.featureIntegrated = await ancestor(baseline.cwd, featureBefore, target);
      report.relationships.targetHistoryRetained = await ancestor(baseline.cwd, targetBefore, target);
      report.relationships.featureTreeMatchesResult = report.commit.tree === (await git(baseline.cwd, ["rev-parse", `${featureBefore}^{tree}`])).trim();
      const noOp = target === targetBefore && await ancestor(baseline.cwd, featureBefore, targetBefore);
      const ff = baseline.mergeMethod === "ff-only" && target === featureBefore && await ancestor(baseline.cwd, targetBefore, featureBefore);
      const nonFF = baseline.mergeMethod === "non-ff" && report.commit.parentCount === 2
        && report.commit.parents[0] === targetBefore && report.commit.parents[1] === featureBefore;
      report.relationships.expectedIntegrationShape = noOp || ff || nonFF;
      // FF/no-op can legitimately retain an existing signed commit.
      if (nonFF && !noOp) report.relationships.newCommitUnsigned = !report.commit.signed;
      report.disposition = noOp ? "no-op" : ff ? "fast-forward" : nonFF ? "non-fast-forward" : undefined;
    } else if (baseline.action === "commit") {
      report.relationships.subjectMatchesCheckout = refs.subject?.tip === current.tip;
      report.relationships.newCommitUnsigned = !report.commit.signed;
      report.relationships.expectedParent = report.commit.parentCount === 1 && report.commit.parents[0] === selected.tip;
      report.relationships.candidateTreeMatches = report.commit.tree === baseline.candidateTree;
    } else if (baseline.action === "rebase" && feature && target && targetBefore) {
      report.relationships.targetUnchanged = target === targetBefore;
      report.relationships.featureMatchesCheckout = feature === current.tip;
      report.relationships.targetIntegrated = await ancestor(baseline.cwd, targetBefore, feature);
    } else if (baseline.action === "cleanupFeature" && baseline.cleanup) {
      const cleanup = baseline.cleanup;
      const removed = baseline.checkouts.find(item => item.path === cleanup.path);
      const registered = beforeRegistrations.some(row => row.path === cleanup.path);
      rereadResources = () => {
        const pathPresence = cleanup.path && cleanup.parent ? access.presence(cleanup.parent, cleanup.path.slice(cleanup.parent.path.length + 1)) : undefined;
        const artifacts = { selected: cleanup.artifacts.length, absent: 0, present: 0, unknown: 0 };
        // Verified worktree absence also proves its selected artifacts absent.
        if (pathPresence === "absent" && !registered) artifacts.absent = artifacts.selected;
        else for (const path of cleanup.artifacts) artifacts[removed ? access.presence(removed, path, cleanup.ancestorIdentities) : "unknown"]++;
        return { artifacts, ...(cleanup.path ? { worktree: { path: cleanup.path, presence: pathPresence ?? "unknown", registered } } : {}),
          branch: { name: baseline.refs.feature.branch, presence: refs.feature ? "present" : "absent" } };
      };
      report.resources = rereadResources()!;
      const { artifacts, worktree } = report.resources;
      if (cleanup.removeWorktree) report.relationships.worktreeRemoved = worktree?.presence === "absent" && !registered;
      if (cleanup.deleteBranch) report.relationships.branchRemoved = !refs.feature;
      else report.relationships.featureUnchanged = feature === cleanup.featureTip;
      report.relationships.artifactsRemoved = artifacts.absent === artifacts.selected;
      report.relationships.integrationReachable = !!target && await ancestor(baseline.cwd, cleanup.integrationCommit, target);
    }
    for (const [key, before] of Object.entries(refs)) {
      if (JSON.stringify(before) !== JSON.stringify(await readRef(baseline.cwd, baseline.refs[key].branch))) report.issues.push("Selected ref changed during observation");
    }
    for (const observation of report.checkouts) {
      const expected = baseline.checkouts.find(item => item.path === observation.path)!;
      const after = await observeCheckout(baseline, expected);
      if (JSON.stringify(after) !== JSON.stringify(observation)) report.issues.push("Selected checkout changed during observation");
    }
    if (JSON.stringify(selectedRows(beforeRegistrations)) !== JSON.stringify(selectedRows(await registrations(baseline.cwd)))) report.issues.push("Selected worktree registration changed during observation");
    if (rereadResources && JSON.stringify(rereadResources()) !== JSON.stringify(report.resources)) report.issues.push("Selected cleanup resource changed during observation");
    // Close after final status/registration reads; external writers remain free
    // to change state after this optimistic observation returns.
    for (const observation of report.checkouts) await guard(baseline, baseline.checkouts.find(item => item.path === observation.path)!);
    for (const [key, before] of Object.entries(refs)) {
      if (JSON.stringify(before) !== JSON.stringify(await readRef(baseline.cwd, baseline.refs[key].branch))) report.issues.push("Selected ref changed at observation settlement");
    }
    if (nativeOutcome === "completed") {
      for (const [name, holds] of Object.entries(report.relationships)) {
        if (!holds && name !== "featureTreeMatchesResult") report.issues.push(`Postcondition not satisfied: ${name}`);
      }
      const mustBeClean = report.checkouts.filter(item => baseline.action === "merge" || baseline.action === "rebase"
        || baseline.action === "cleanupFeature" && item.path === baseline.cleanup?.path);
      if (mustBeClean.some(item => !item.status.clean)) report.issues.push("Selected source checkout is not clean");
      if ((baseline.action === "merge" || baseline.action === "rebase") && (!feature || !target)) report.issues.push("Selected ref is missing");
      report.verification = report.issues.length ? "failed" : "verified";
    } else report.verification = "not-run";
    if (report.verification === "verified" && baseline.action === "merge") {
      report.cleanupReady = { featureBranch: baseline.refs.feature.branch, featureTip: featureBefore!, integrationCommit: target!, targetBranch: baseline.refs.target.branch,
        ...(baseline.checkouts.find(item => item.branch === baseline.refs.feature.branch) ? { worktreePath: baseline.checkouts.find(item => item.branch === baseline.refs.feature.branch)!.path } : {}) };
    }
  } catch (error) { report.issues.push(boundedError(error)); report.verification = "unavailable"; }
  report.issues = [...new Set(report.issues)].slice(0, 12);
  return report;
}

export function unobservedPostflight(action: ReportAction, issue: string): PostflightReport {
  return { version: 1, action, nativeOutcome: "not-started", verification: "not-run", observedAt: new Date().toISOString(), scope: SCOPE,
    refs: {}, checkouts: [], relationships: {}, issues: [issue.slice(0, 1000)], checks: [] };
}

export function postflightReceiptSummary(text: string, report: PostflightReport): string {
  if (text.length <= 15000) return text;
  // Preserve outcome/IDs before optional locations and excerpts. No partial JSON.
  const compact = { ...report, scope: "Compact outcome; full selected resources are in the saved exact review. Full observations are in the tool result. Not new authority.",
    refs: Object.fromEntries(Object.entries(report.refs).map(([key, ref]) => [key, { ...ref, branch: ref.branch.slice(0, 240) }])),
    checkouts: report.checkouts.map(checkout => ({ branch: checkout.branch?.slice(0, 240) ?? null, tip: checkout.tip, status: checkout.status, operationMarkers: checkout.operationMarkers, hiddenIndexFlags: checkout.hiddenIndexFlags })),
    checks: report.checks.map(check => ({ name: check.name.slice(0, 80), status: check.status })),
    issues: report.issues.map(issue => issue.slice(0, 240)), cleanupReady: undefined, resources: report.resources ? {
      ...report.resources, worktree: report.resources.worktree ? { ...report.resources.worktree, path: "See tool result" } : undefined,
      branch: report.resources.branch ? { ...report.resources.branch, name: report.resources.branch.name.slice(0, 240) } : undefined,
    } : undefined, displayCompacted: true };
  const heading = `${report.action} native outcome: ${report.nativeOutcome}; postflight: ${report.verification}.\nDo not repeat a completed native effect. Saved observations are not execution authority.\n`;
  const rendered = heading + JSON.stringify(compact);
  if (rendered.length <= 15000) return rendered;
  // JSON escaping can expand even capped strings. Retain valid JSON and the
  // native outcome/IDs instead of making terminal persistence fail on size.
  return heading + JSON.stringify({ version: report.version, action: report.action, nativeOutcome: report.nativeOutcome,
    finalization: report.finalization, verification: report.verification, observedAt: report.observedAt,
    refs: Object.fromEntries(Object.entries(report.refs).map(([key, ref]) => [key, { before: ref.before, after: ref.after }])),
    commit: report.commit ? { oid: report.commit.oid, tree: report.commit.tree } : undefined,
    issueCount: report.issues.length, resources: report.resources?.artifacts,
    displayCompacted: true, note: "Full selected resources are in the saved exact review; full observations are in the tool result." });
}

export function postflightText(report: PostflightReport, output: string, warning?: string) {
  const heading = `${report.action} native outcome: ${report.nativeOutcome}; postflight: ${report.verification}.`;
  const safety = report.nativeOutcome === "completed" && (report.verification !== "verified" || warning)
    ? "Native effect completed, but post-effect reporting failed or verification is incomplete. Do not repeat the operation." : "";
  return [heading, safety, warning, `Postflight report: ${JSON.stringify(report)}`, output ? `Native output (bounded excerpt):\n${output.slice(-2000)}` : ""].filter(Boolean).join("\n");
}
