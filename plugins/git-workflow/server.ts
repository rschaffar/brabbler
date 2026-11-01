import { idle } from "./operation-idle";
import { refuseFilters } from "./checkout-safety";
import { capturePostflight, collectPostflight, postflightText, postflightReceiptSummary, unobservedPostflight, type ReportAction, type PostflightBaseline, type PostflightReport } from "./postflight";
import { gitText as git, gitOutput, gitEnvironment, records, outputDigest, run, withPreparationSignal } from "./process";
import { spawn } from "node:child_process";
import { gitReviewProposal, gitReviewSettlement, compactGitCard, type GitCardPresentation } from "./review";
import { GIT_REVIEW_FORMAT, type GitReviewProposal, type GitReviewResources } from "./review-data";
import { assertGitReviewAvailable } from "./review-reader";
import type { OperationReviewReference } from "../../lib/plugins/review-metadata";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { samePath, toNativePath } from "../../lib/paths";
import { allowFileRoot } from "../../lib/file-access";
import { onPluginSettingsChange, pluginProjectIdentity, pluginProjectIdentityAsync, readPluginSettings } from "../../lib/plugins/settings";
import type { PluginCard, PluginCardField, PluginCardSection, PluginSession, PluginUiContext, PluginOperationReceipt, RequiredCheck } from "../../lib/plugins/types";
import { actions, gitWorkflowManifest, type GitAction, type GitSettings } from "./manifest";
import { validateBrowserDiscardOperation, type BrowserDiscardOperation } from "./discard";
import { invocationPolicy, operationAuthorization, relevantPolicy } from "./operation-rules";
import { browserDiscardCard, cleanupCard } from "./resource-cards";

import { captureCleanup, captureBrowserDiscard, createCleanupBudget, performCleanup, performBrowserDiscard, type CleanupBudget, type CleanupAccess, type CleanupOperation, type CleanupSnapshot, type CleanupGitTransaction, type WorktreeRecord } from "./cleanup";

export type GitOperation =
  | { action: "commit"; checkout: string; mode: "staged" | "files"; files?: string[]; message: string }
  | { action: "rebase" | "merge"; checkout: string; featureBranch: string; targetBranch?: string; mergeMethod?: "ff-only" | "non-ff" }
  | { action: "createWorktree" | "attachWorktree"; checkout: string; branch: string; baseBranch: string; path: string }
  | { action: "removeWorktree"; checkout: string; path: string }
  | CleanupOperation;
/** Internal exact-review union; browser discard is deliberately absent from GitOperation. */
export type ReviewedGitOperation = GitOperation | BrowserDiscardOperation;
interface GitExecutionOptions { readonly browserConfirmation?: true; readonly presentation?: GitCardPresentation }
interface Snapshot { fingerprint: string; card: PluginCard; checks: RequiredCheck[]; args: string[]; cwd: string; comparison?: { before: string; after: string }; cleanup?: CleanupSnapshot; postflight?: PostflightBaseline; resources?: GitReviewResources }
async function branchTip(cwd: string, branch: string): Promise<string> {
  if (!branch || branch.startsWith("-") || branch === "HEAD") throw new Error("Select an explicit local branch");
  await git(cwd, ["check-ref-format", `refs/heads/${branch}`]);
  return (await git(cwd, ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`])).trim();
}
async function head(cwd: string) {
  return { branch: (await git(cwd, ["symbolic-ref", "--short", "HEAD"])).trim(), tip: (await git(cwd, ["rev-parse", "HEAD"])).trim() };
}
/** Reporting may observe a detached invocation checkout without relaxing agent eligibility. */
async function observedHead(cwd: string) {
  let branch: string | null = null;
  try { branch = (await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim(); }
  catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
  return { branch, tip: (await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"])).trim() };
}
function status(cwd: string): Promise<string> { return outputDigest(gitOutput(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])); }
async function worktrees(cwd: string): Promise<WorktreeRecord[]> {
  return (await git(cwd, ["worktree", "list", "--porcelain", "-z"])).split("\0\0").filter(Boolean).map((record) => {
    const fields = record.split("\0");
    return { path: toNativePath(fields.find((value) => value.startsWith("worktree "))!.slice(9)),
      branch: fields.find((value) => value.startsWith("branch refs/heads/"))?.slice(18),
      head: fields.find((value) => value.startsWith("HEAD "))?.slice(5), detached: fields.includes("detached"),
      locked: fields.find((value) => value === "locked" || value.startsWith("locked ")),
      prunable: fields.find((value) => value === "prunable" || value.startsWith("prunable ")) };
  });
}
async function checkout(selected: string, repositoryCwd?: string): Promise<string> {
  if (!isAbsolute(selected)) throw new Error("Select an absolute registered checkout path");
  const physical = realpathSync(selected);
  const identity = await pluginProjectIdentityAsync(physical);
  if (!identity || (repositoryCwd && identity !== await pluginProjectIdentityAsync(repositoryCwd))
    || !(await worktrees(physical)).some((entry) => samePath(entry.path, physical))) throw new Error("Selected checkout is not registered in the selected repository");
  if (!samePath(toNativePath((await git(physical, ["rev-parse", "--show-toplevel"])).trim()), physical)) throw new Error("Select the checkout root");
  await idle(physical);
  if (existsSync(toNativePath((await git(physical, ["rev-parse", "--path-format=absolute", "--git-path", "info/grafts"])).trim()))) throw new Error("Legacy Git grafts are unsupported");
  // Even git status can invoke clean filters. Refuse before any content-based
  // preflight so an Ask/decline never executes project filter commands.
  await refuseFilters(physical, gitOutput(physical, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]));
  return physical;
}
function settings(cwd: string, session?: PluginSession, op?: ReviewedGitOperation, browserConfirmation = false): GitSettings {
  const snapshot = readPluginSettings(gitWorkflowManifest, cwd, undefined, session);
  if (!snapshot.enabled) throw new Error("Git Workflow plugin is disabled");
  return invocationPolicy(snapshot.effective as unknown as GitSettings, op, browserConfirmation);
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function physicalPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  return join(physicalPath(dirname(path)), basename(path));
}
async function fileSelection(cwd: string, files: string[] | undefined): Promise<string[]> {
  if (!files?.length || new Set(files).size !== files.length) throw new Error("Select distinct whole files");
  for (const file of files) {
    if (!file || file.includes("\0") || isAbsolute(file) || file.split(/[\\/]/).some((part) => part === ".." || part === ".git")
      || relative(cwd, resolve(cwd, file)).startsWith("..")) throw new Error("Invalid selected file path");
    if (existsSync(join(cwd, file)) && lstatSync(join(cwd, file)).isDirectory()) throw new Error("Select files, not directories");
    const parent = physicalPath(resolve(cwd, file, ".."));
    if (relative(cwd, parent).startsWith("..")) throw new Error("Selected file escapes checkout");
    // A tracked deletion is a valid whole-file selection. Refuse absent/untracked typo paths.
    if (!existsSync(join(cwd, file))) await git(cwd, ["ls-files", "--error-unmatch", "--", file]);
  }
  await refuseFilters(cwd, `${files.join("\0")}\0`);
  return files;
}
function cleanupAccess(ui: Partial<PluginUiContext>, rejectUnignoredUntracked = false): CleanupAccess {
  return { rejectUnignoredUntracked, git, records: (cwd, args) => records(gitOutput(cwd, args)), checkout, branchTip, worktrees, project: pluginProjectIdentityAsync,
    inUse: (path) => { if (!ui.isDirectoryInUse) throw new Error("Cleanup requires live directory-use inspection"); return ui.isDirectoryInUse(path); } };
}
async function preview(callerCwd: string, op: ReviewedGitOperation, policy: GitSettings, ui: Partial<PluginUiContext> = {}, budget?: CleanupBudget, rejectUnignoredUntracked = false): Promise<Snapshot> {
  if (op.action === "discardResources") {
    const cleanup = await captureBrowserDiscard(callerCwd, op, policy, cleanupAccess(ui, true), budget);
    return { fingerprint: digest([cleanup.fingerprint, op, cleanup.lossEvidence!, relevantPolicy(policy, op.action)]), cleanup,
      cwd: cleanup.cwd, args: [], checks: [], resources: { kind: "cleanup", snapshot: cleanup }, card: browserDiscardCard(op, policy, cleanup) };
  }
  if (op.action === "cleanupFeature") {
    if (!op.removeWorktree && !op.deleteBranch && !op.artifactRoots.length) throw new Error("Choose at least one cleanup resource");
    const cleanup = await captureCleanup(callerCwd, op, policy, cleanupAccess(ui, rejectUnignoredUntracked), budget);
    const postflight = await capturePostflight({ action: "cleanupFeature", cwd: cleanup.cwd, paths: [cleanup.cwd, ...(cleanup.path ? [cleanup.path] : [])],
      refs: { feature: { branch: op.featureBranch, before: op.featureTip }, target: { branch: cleanup.target, before: await branchTip(cleanup.cwd, cleanup.target) } },
      cleanup: { featureTip: op.featureTip, integrationCommit: op.integrationCommit, path: cleanup.path, removeWorktree: op.removeWorktree,
        deleteBranch: op.deleteBranch, artifacts: cleanup.artifacts.map(item => item.path), ancestorIdentities: cleanup.artifactParentIdentities } });
    return { fingerprint: digest([cleanup.fingerprint, relevantPolicy(policy, op.action)]), cleanup, postflight,
      cwd: cleanup.cwd, args: [], checks: [], resources: { kind: "cleanup", snapshot: cleanup }, card: cleanupCard(op, cleanup) };
  }
  const cwd = await checkout(op.checkout);
  const current = await head(cwd);
  const rows: string[] = [JSON.stringify(op, null, 2), `Checkout: ${cwd}`, `Branch: ${current.branch}`, `HEAD: ${current.tip}`,
    "Native Git operation is unsigned and hook-free. Stronger user/repository instructions still apply."];
  const fields: PluginCardField[] = [{ label: "Checkout", value: cwd, code: true }, { label: "Branch", value: current.branch, code: true }];
  const sections: PluginCardSection[] = [];
  const notices = ["Native Git operation is unsigned and hook-free. Stronger user/repository instructions still apply."];
  let args: string[] = [];
  let comparison: Snapshot["comparison"];
  let postflight: PostflightBaseline | undefined;
  let resources: GitReviewResources | undefined;
  let checks: RequiredCheck[] = [];
  const registrations = await worktrees(cwd);
  // Merge approval binds only its two branch registrations. Other sessions may
  // commit, rebase or manage unrelated worktrees without changing this proposal.
  const selectedRegistrations = op.action === "merge"
    ? registrations.filter((entry) => samePath(entry.path, cwd) || entry.branch === op.featureBranch || entry.branch === policy.targetBranch)
    : registrations;
  const state: unknown[] = [cwd, pluginProjectIdentity(cwd), current, await status(cwd), selectedRegistrations];
  if (op.action === "commit") {
    if (!op.message.trim() || op.message.includes("\0")) throw new Error("An exact nonempty commit message is required");
    checks = policy.commitChecks;
    fields.push({ label: "Selection", value: op.mode === "files" ? "Selected whole files, including unstaged content" : "Complete staged set" });
    sections.push({ title: "Commit message", text: op.message, code: true });
    const files = op.mode === "files" ? await fileSelection(cwd, op.files) : undefined;
    if (op.mode !== "staged" && op.mode !== "files") throw new Error("Invalid commit mode");
    if (op.mode === "staged" && op.files !== undefined) throw new Error("Staged mode commits the complete staged set, not selected paths");
    const scratch = mkdtempSync(join(tmpdir(), "brabbler-git-preview-"));
    try {
      const index = join(scratch, "index");
      const original = toNativePath((await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trim());
      state.push(existsSync(original) ? await outputDigest(createReadStream(original)) : null);
      if (files) {
        // --only builds from HEAD; unrelated staging is not part of this candidate.
        await git(cwd, ["read-tree", current.tip], index);
        // HEAD may restore attributes staged for deletion in the real index.
        // Check the actual candidate-index attribute view before content reads.
        await refuseFilters(cwd, `${files.join("\0")}\0`, index);
        await git(cwd, ["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], index, `${files.join("\0")}\0`);
      } else if (existsSync(original)) copyFileSync(original, index);
      else await git(cwd, ["read-tree", current.tip], index);
      const tree = (await git(cwd, ["write-tree"], index)).trim();
      if (tree === (await git(cwd, ["rev-parse", `${current.tip}^{tree}`])).trim()) throw new Error("No selected changes to commit");
      comparison = { before: current.tip, after: tree };
      state.push(tree);
      rows.push(`Candidate tree: ${tree}`, `Exact message:\n${op.message}`);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
    args = ["commit", "--no-gpg-sign", "--cleanup=verbatim", ...(files ? ["--only"] : [])];
    postflight = await capturePostflight({ action: "commit", cwd, paths: [cwd], candidateTree: comparison!.after,
      refs: { subject: { branch: current.branch, before: current.tip } } });
    state.push(postflight);
  } else if (op.action === "rebase" || op.action === "merge") {
    if (!policy.targetBranch) throw new Error("Configure a target local branch first");
    if (op.featureBranch === policy.targetBranch) throw new Error("Feature and target must differ");
    const feature = await branchTip(cwd, op.featureBranch);
    const target = await branchTip(cwd, policy.targetBranch);
    const operationBranch = op.action === "rebase" ? op.featureBranch : policy.targetBranch;
    if (current.branch !== operationBranch) {
      const requiredCheckout = (await worktrees(cwd)).find((entry) => entry.branch === operationBranch);
      const hint = requiredCheckout ? `Use checkout: ${JSON.stringify(requiredCheckout.path)}.`
        : `The required branch has no registered checkout; arrange one explicitly before invoking git_${op.action}.`;
      throw new Error(`git_${op.action} checkout must be the registered checkout of ${op.action === "merge" ? "target" : "feature"} branch ${JSON.stringify(operationBranch)}, not selected branch ${JSON.stringify(current.branch)} at ${JSON.stringify(cwd)}. ${hint}`);
    }
    if (await status(cwd)) throw new Error("Selected checkout must be clean, including untracked files");
    const sourceCheckout = (await worktrees(cwd)).find((entry) => entry.branch === (op.action === "merge" ? op.featureBranch : policy.targetBranch));
    if (sourceCheckout) {
      const source = await checkout(sourceCheckout.path, cwd);
      if (await status(source)) throw new Error("Other selected branch checkout must be clean");
      state.push(source, await head(source));
    }
    state.push(feature, target);
    fields.push({ label: "Feature → target", value: `${op.featureBranch} → ${policy.targetBranch}`, code: true });
    notices.push("Diffs show feature changes since the merge base, not a predicted rebase/merge result.");
    rows.push(`Feature: ${op.featureBranch} ${feature}`, `Target: ${policy.targetBranch} ${target}`,
      "Patch shows feature changes since the merge base, not a predicted rebase/merge result.");
    const base = (await git(cwd, ["merge-base", target, feature])).trim();
    comparison = { before: base, after: feature };
    if (op.action === "rebase") {
      args = ["rebase", "--no-autostash", "--no-update-refs", "--no-rebase-merges", "--no-gpg-sign", target];
      postflight = await capturePostflight({ action: "rebase", cwd, paths: [cwd, ...(sourceCheckout ? [sourceCheckout.path] : [])],
        refs: { feature: { branch: op.featureBranch, before: feature }, target: { branch: policy.targetBranch, before: target } } });
      state.push(postflight);
    } else {
      checks = policy.mergeChecks;
      fields.push({ label: "Merge method", value: policy.mergeMethod === "ff-only" ? "Fast-forward only" : "Non-fast-forward merge" });
      rows.push(`Merge method: ${policy.mergeMethod}`, "Checks run in the selected feature checkout before merging; no automatic rebase.");
      if (checks.length && !sourceCheckout) throw new Error("Required merge checks need the feature's registered clean checkout");
      args = ["-c", `branch.${policy.targetBranch}.mergeOptions=`, "merge", policy.mergeMethod === "ff-only" ? "--ff-only" : "--no-ff", "--commit", "--no-edit", "--no-gpg-sign", feature];
      postflight = await capturePostflight({ action: "merge", cwd, paths: [cwd, ...(sourceCheckout ? [sourceCheckout.path] : [])],
        refs: { feature: { branch: op.featureBranch, before: feature }, target: { branch: policy.targetBranch, before: target } }, mergeMethod: policy.mergeMethod });
      state.push(postflight);
    }
  } else if (op.action === "createWorktree" || op.action === "attachWorktree") {
    if (await status(cwd)) throw new Error("Source checkout must be clean");
    if (!isAbsolute(op.path) || existsSync(op.path)) throw new Error("Choose a new absolute worktree destination");
    const parent = resolve(op.path, "..");
    const physicalParent = physicalPath(parent);
    const destination = resolve(physicalParent, basename(op.path));
    const common = pluginProjectIdentity(cwd)!;
    // Limit creation to the existing allowed repository-adjacent worktree container.
    const main = (await worktrees(cwd))[0].path;
    const container = `${main}-worktrees`;
    if (!samePath(resolve(destination, ".."), container) || relative(common, destination).startsWith("..") === false) throw new Error(`Destination must be directly inside ${container}`);
    await git(cwd, ["check-ref-format", `refs/heads/${op.branch}`]);
    const base = await branchTip(cwd, op.baseBranch);
    const baseCheckout = (await worktrees(cwd)).find((entry) => entry.branch === op.baseBranch);
    if (baseCheckout && await status(await checkout(baseCheckout.path, cwd))) throw new Error("Base checkout must be clean");
    const exists = (await git(cwd, ["for-each-ref", "--format=%(refname)", `refs/heads/${op.branch}`])).split("\n").includes(`refs/heads/${op.branch}`);
    if (op.action === "createWorktree" && exists) throw new Error("Create requires a new branch");
    if (op.action === "attachWorktree" && (op.baseBranch !== op.branch || !exists)) throw new Error("Attach requires the explicitly selected existing branch as base");
    state.push(base, destination);
    resources = { kind: "worktree", checkout: cwd, head: current, registrations, base: { branch: op.baseBranch, tip: base } };
    fields.push({ label: "Base branch", value: op.baseBranch, code: true }, { label: "Worktree branch", value: op.branch, code: true },
      { label: "Destination", value: destination, code: true });
    rows.push(`Base: ${op.baseBranch} ${base}`, `Destination: ${destination}`);
    args = op.action === "createWorktree" ? ["worktree", "add", "-b", op.branch, destination, base] : ["worktree", "add", destination, op.branch];
  } else if (op.action === "removeWorktree") {
    const selected = (await worktrees(cwd)).find((entry) => samePath(entry.path, op.path));
    // A session may live outside Git, or below a linked checkout's root.
    const callerRoot = pluginProjectIdentity(callerCwd) === pluginProjectIdentity(cwd)
      ? realpathSync(toNativePath((await git(callerCwd, ["rev-parse", "--show-toplevel"])).trim())) : null;
    if (!selected || samePath(selected.path, (await worktrees(cwd))[0].path) || samePath(selected.path, cwd)
      || (callerRoot && samePath(selected.path, callerRoot))) throw new Error("Select another registered linked worktree; never the main or caller checkout");
    const physical = await checkout(selected.path, cwd);
    if (await status(physical) || await outputDigest(gitOutput(physical, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]))) throw new Error("Removal requires a clean worktree with no ignored files; force removal is not provided");
    state.push(physical, await head(physical));
    resources = { kind: "worktree", checkout: cwd, head: current, registrations, selected };
    fields.push({ label: "Remove worktree", value: physical, code: true });
    notices.push("Only this worktree directory is removed. Branch and session history remain.");
    rows.push(`Remove only: ${physical}`, "Branch and session history remain. No automatic cleanup.");
    args = ["worktree", "remove", physical];
  } else throw new Error("Unknown Git action");
  if (checks.length) rows.push("Required checks (shell commands, may have side effects):", ...checks.map((check) => `${check.name}: ${check.command}`),
    op.action === "commit" ? "Checks run in the selected checkout, including its current staged/unstaged contents." : "Checks run in the feature checkout.");
  if (checks.length) {
    sections.push({ title: "Required checks", fields: checks.map((check) => ({ label: check.name, value: check.command, code: true })) });
    notices.push("Checks are shell commands and may have side effects.", op.action === "commit"
      ? "Checks run in the selected checkout, including its current staged/unstaged contents; they do not certify a separately exported candidate tree."
      : "Checks run in the selected feature checkout before merging, not on a predicted merged result.");
  }
  sections.push({ title: "Operation notes", text: notices.join("\n"), notice: true });
  rows.push(`Git arguments: ${JSON.stringify(args)}`);
  sections.push({ title: "Technical details", text: rows.join("\n\n"), code: true, collapsible: true });
  // Bind only applicable settings, not unrelated action permissions.
  state.push(relevantPolicy(policy, op.action));
  return { fingerprint: digest(state), cwd, args, checks, comparison, postflight, resources,
    card: { title: { commit: "Git commit", rebase: "Git rebase", merge: "Git merge", createWorktree: "Create Git worktree", attachWorktree: "Attach Git worktree", removeWorktree: "Remove Git worktree" }[op.action],
      subtitle: "Approval required", fields, sections,
      scope: `Approves the entire ${op.action === "commit" ? "commit candidate" : "selected operation"}${checks.length ? " and the listed checks" : ""}${comparison ? ", not just an expanded file or displayed page" : ""}.`,
      patchBefore: op.action === "commit" ? "HEAD" : "Merge base", patchAfter: op.action === "commit" ? "Candidate" : "Selected feature",
      actions: [{ id: "reject", label: "Reject" }, { id: "approve", primary: true,
        label: { commit: "Approve commit", rebase: "Approve rebase", merge: "Approve merge", createWorktree: "Create worktree", attachWorktree: "Attach worktree", removeWorktree: "Remove worktree" }[op.action] }] } };
}
/** Agent entry point: browser-only actions cannot acquire authority here, even via untyped callers. */
export async function executeGitOperation(callerCwd: string, operation: GitOperation, ui: Partial<PluginUiContext>, signal?: AbortSignal, session?: PluginSession, toolCallId?: string, onProgress?: (text: string) => void, options?: GitExecutionOptions) {
  if (!actions.includes(operation.action as GitAction)) throw new Error("Unsupported agent Git action; manual discard requires the browser project adapter");
  return executeOperation(callerCwd, operation, ui, signal, session, toolCallId, onProgress, options);
}
/** A prepared native transaction owns ref locks through direct-ref verification.
 * No cancellation/timeout kills the native child; failed verification aborts it,
 * and the caller waits for close before releasing its directory reservation. */
async function runPreparedRefTransaction(args: string[], cwd: string, transaction: CleanupGitTransaction): Promise<string> {
  const child = spawn("git", args, { cwd, env: gitEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "", failure: unknown, verification: Promise<void> | undefined;
  let commitSent = false;
  const settled = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("error", (error) => { failure ??= error; });
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  child.stdin.on("error", (error) => { failure ??= error; });
  child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-65536); });
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = (stdout + chunk.toString()).slice(-65536);
    if (!verification && /(?:^|\n)prepare: ok\r?\n/.test(stdout)) {
      verification = (async () => {
        try {
          if (failure) throw failure;
          await transaction.verifyPrepared();
          if (failure) throw failure;
          if (child.stdin.destroyed || !child.stdin.writable) throw new Error("Prepared Git transaction closed before commit; inspect repository");
          child.stdin.end("commit\0");
          commitSent = true;
        } catch (error) {
          failure ??= error;
          // Explicit start makes EOF abort too, including an early child exit.
          child.stdin.end("abort\0");
        }
      })().catch((error) => { failure ??= error; child.stdin.destroy(); });
    }
  });
  try { child.stdin.write(transaction.input); }
  catch (error) { failure ??= error; child.stdin.end(); }
  const result = await settled;
  await verification;
  if (failure) throw failure;
  if (result.code !== 0) throw Object.assign(new Error(`Command failed: git exited ${result.code ?? result.signal}\n${stderr}`), { status: result.code });
  if (!commitSent || !/(?:^|\n)commit: ok\r?\n/.test(stdout)) throw new Error("Git ref transaction did not confirm commit; inspect repository before retry");
  return stdout;
}
/** Browser-only entry point. No session overrides, policy-authorized dispatch, or explicit artifact roots. */
export async function executeBrowserDiscard(callerCwd: string, operation: BrowserDiscardOperation, ui: Partial<PluginUiContext>, signal?: AbortSignal, onProgress?: (text: string) => void) {
  return executeOperation(callerCwd, validateBrowserDiscardOperation(operation), ui, signal, undefined, undefined, onProgress, { browserConfirmation: true });
}
async function executeOperation(callerCwd: string, operation: ReviewedGitOperation, ui: Partial<PluginUiContext>, signal?: AbortSignal, session?: PluginSession, toolCallId?: string, onProgress?: (text: string) => void, options?: GitExecutionOptions) {
  const op = structuredClone(operation);
  const resourceOperation = op.action === "cleanupFeature" || op.action === "discardResources";
  const currentSettings = () => settings(op.checkout, session, op, options?.browserConfirmation);
  let started = false;
  let checksStarted = false;
  let completed = false;
  let finalized = false;
  let baseline: PostflightBaseline | undefined;
  let postflight: PostflightReport | undefined;
  let checkCwd: string | undefined;
  let receipt: PluginOperationReceipt | undefined;
  let proposal: GitReviewProposal | undefined, proposalReference: OperationReviewReference | undefined;
  let settlementAttempted = false;
  const effects: string[] = [];
  let lastInventoryPolicyCheck = 0;
  const cleanupBudget = createCleanupBudget(() => {
    signal?.throwIfAborted();
    if (Date.now() - lastInventoryPolicyCheck > 500) {
      lastInventoryPolicyCheck = Date.now();
      if (!started) onProgress?.(`Inventory: ${cleanupBudget.entries} entries, ${cleanupBudget.bytes} bytes checked. No new authority is granted by this scan.`);
      if (currentSettings()[op.action] === "deny") throw new Error("Operation denied during inventory");
    }
  });
  let attemptedEffect: string | undefined;
  const annotatePostflight = () => {
    if (!postflight) return;
    postflight.finalization = completed ? finalized ? "completed" : "failed" : "not-run";
    postflight.effects = { completed: effects.length, samples: effects.slice(0, 12).map(effect => effect.slice(0, 240)), omitted: Math.max(0, effects.length - 12),
      ...(attemptedEffect ? { attempted: attemptedEffect.slice(0, 1000) } : {}) };
    if (postflight.finalization === "failed") delete postflight.cleanupReady;
  };
  const record = (phase: PluginOperationReceipt["phase"], summary?: string) => {
    if (!receipt || !ui.operationReceipt) throw new Error("Git operations require durable Brabbler operation receipts");
    receipt = { ...receipt, phase, effectStarted: started, completedEffects: [...effects], attemptedEffect, ...(summary ? { summary: postflight ? postflightReceiptSummary(summary, postflight) : summary.slice(0, 16000) } : {}) };
    ui.operationReceipt(gitWorkflowManifest.id, structuredClone(receipt));
  };
  const saveSettlement = async (phase: "succeeded" | "failed" | "cancelled") => {
    if (settlementAttempted || !receipt || !proposal || !proposalReference || !ui.saveOperationReview) return;
    settlementAttempted = true; // Saving/reporting failure never retries a native effect or metadata append.
    let resourceResult;
    if (proposal.source.kind === "resources" && started) {
      try { resourceResult = { head: await observedHead(proposal.cwd), registrations: await worktrees(proposal.cwd) }; }
      catch { /* Recorded effects remain facts; missing observations stay absent. */ }
    }
    const payload = await gitReviewSettlement(proposal, proposalReference,
      { phase, effectStarted: started, completed, checksStarted, effects: [...effects], ...(attemptedEffect ? { attemptedEffect } : {}) }, postflight, resourceResult);
    const review = await ui.saveOperationReview(gitWorkflowManifest.id, receipt.operationId, GIT_REVIEW_FORMAT, payload);
    receipt.card = { ...receipt.card, review };
  };
  try {
    // Foreign repositories never inherit caller/session overrides. Deny still
    // precedes preview and checks. Identity is supplied by the host, not the model.
    const policy = currentSettings();
    if (policy[op.action] === "deny") throw new Error(`${op.action} is denied by current settings`);
    onProgress?.("Capturing exact Git state; large repositories are processed incrementally. Stop cancels preparation.");
    const snapshot = await withPreparationSignal(signal, () => preview(callerCwd, op, policy, ui, cleanupBudget, options?.browserConfirmation));
    baseline = snapshot.postflight;
    const origin = readPluginSettings(gitWorkflowManifest, op.checkout, undefined, session);
    if (origin.effective[op.action] !== policy[op.action]) throw new Error("Policy changed during preparation");
    const operationId = randomUUID();
    snapshot.card.operationId = operationId;
    if (!ui.saveOperationReview) throw new Error("Git operations require durable Brabbler review metadata");
    proposal = await gitReviewProposal(op, snapshot, signal);
    const review = proposalReference = await ui.saveOperationReview(gitWorkflowManifest.id, operationId, GIT_REVIEW_FORMAT, proposal);
    snapshot.card = { ...compactGitCard(snapshot.card, options?.presentation), review };
    const artifactApproval = !!snapshot.cleanup?.unapprovedArtifacts.length;
    const { subtitle, ...authorization } = operationAuthorization(policy[op.action], origin.sources[op.action], artifactApproval, !!options?.browserConfirmation);
    const { mode } = authorization;
    if (options?.browserConfirmation || artifactApproval || mode === "allow") snapshot.card.subtitle = subtitle;
    receipt = { version: 1, operationId, ...(toolCallId ? { toolCallId } : {}), card: snapshot.card, phase: "prepared", effectStarted: false,
      authorization: { ...authorization, revision: digest(origin) },
      checks: snapshot.checks.map((check) => ({ name: check.name.slice(0, 240), status: "pending" })) };
    record("prepared");
    onProgress?.("Exact operation metadata saved. Awaiting authorization/checks; historical content depends on captured Git objects.");
    if (signal?.aborted) throw new Error("Cancelled before execution");
    if (mode === "ask") {
      if (!ui.pluginCard) throw new Error("Ask requires the live Brabbler browser UI");
      const cancellation = new AbortController();
      const unsubscribe = onPluginSettingsChange((id) => {
        if (id !== gitWorkflowManifest.id) return;
        try {
          const current = currentSettings();
          if (digest(relevantPolicy(current, op.action)) !== digest(relevantPolicy(policy, op.action))) cancellation.abort();
        } catch { cancellation.abort(); }
      });
      let answer: string | null;
      try { answer = await ui.pluginCard(gitWorkflowManifest.id, snapshot.card,
        signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal); }
      finally { unsubscribe(); }
      receipt.authorization.decision = answer === "approve" ? "user-approved" : "not-approved";
      if (answer !== "approve") throw new Error("Operation not approved or settings changed");
    }
    record("authorized");
    const revalidate = async () => {
      if (signal?.aborted) throw new Error("Cancelled before native effect");
      const current = currentSettings();
      // Check ORIGINAL objects before files-preview can recreate a missing tree
      // with the same OID, concealing expiry under the old approval.
      if (proposal?.source.kind === "git") await assertGitReviewAvailable(proposal.source.captured, { assertAllowed: async () => {} }, signal);
      if (current[op.action] === "deny" || (await withPreparationSignal(signal, () => preview(callerCwd, op, current, ui, cleanupBudget, options?.browserConfirmation))).fingerprint !== snapshot.fingerprint
        || digest(relevantPolicy(currentSettings(), op.action)) !== digest(relevantPolicy(policy, op.action))) throw new Error("Stale operation: relevant settings or repository state changed; invoke again");
    };
    // Cleanup owns a single full revalidation per effect, under its directory
    // reservation. Do not rescan dependency trees at every generic checkpoint.
    if (!resourceOperation) await revalidate();
    checkCwd = op.action === "merge" ? (await worktrees(snapshot.cwd)).find((entry) => entry.branch === op.featureBranch)?.path : snapshot.cwd;
    for (const [index, check] of snapshot.checks.entries()) {
      await revalidate();
      receipt.checks[index].status = "running";
      record("checking");
      checksStarted = true;
      try { await run(check.command, [], checkCwd!, true, undefined, signal, check.timeoutMs); receipt.checks[index].status = "passed"; }
      catch (error) { receipt.checks[index].status = "failed"; throw error; }
      record("checking");
    }
    if (!resourceOperation) await revalidate();
    const scratch = mkdtempSync(join(tmpdir(), "brabbler-git-effect-"));
    let output: string;
    let releaseReservation: (() => void) | undefined;
    try {
      if (snapshot.cleanup?.path) {
        if (!ui.reserveDirectory) throw new Error("Cleanup requires managed directory reservation support");
        releaseReservation = ui.reserveDirectory(snapshot.cleanup.path);
      }
      const args = [...snapshot.args];
      if (op.action === "commit") {
        const messagePath = join(scratch, "message");
        writeFileSync(messagePath, op.message);
        args.splice(1, 0, "-F", messagePath);
        if (op.mode === "files") {
          const paths = join(scratch, "paths");
          writeFileSync(paths, `${op.files!.join("\0")}\0`);
          args.push(`--pathspec-from-file=${paths}`, "--pathspec-file-nul");
        }
      }
      // A durable executing stage is required BEFORE the first native mutation.
      // If persistence fails, started stays false and no Git effect is dispatched.
      record("executing");
      if (!resourceOperation) { await revalidate(); started = true; }
      if (op.action === "createWorktree" || op.action === "attachWorktree") mkdirSync(resolve(op.path, ".."), { recursive: true });
      const commandArgs = ["-c", `core.hooksPath=${scratch}`, "-c", "core.fsmonitor=false", "-c", "commit.gpgSign=false", "-c", "rebase.autoStash=false", "-c", "merge.autoStash=false", "-C", snapshot.cwd, ...args];
      if (op.action === "cleanupFeature" || op.action === "discardResources") {
        const resourceOp = op;
        const effectArguments = [policy, cleanupAccess(ui, options?.browserConfirmation), snapshot.cleanup!, () => {
          if (signal?.aborted) throw new Error("Cancelled; remaining cleanup resources retained");
          const current = currentSettings();
          if (digest(relevantPolicy(current, op.action)) !== digest(relevantPolicy(policy, op.action))) throw new Error("Cleanup policy changed; remaining resources retained");
        }, (args: string[], transaction?: CleanupGitTransaction) => transaction
          ? runPreparedRefTransaction([...commandArgs, ...args], snapshot.cwd, transaction)
          : run("git", [...commandArgs, ...args], snapshot.cwd), effects,
          (description: string) => {
            const previousAttempt = attemptedEffect;
            attemptedEffect = description;
            try { record("executing"); } catch (error) { attemptedEffect = previousAttempt; throw error; }
            started = true;
          }, cleanupBudget,
          () => record("executing")] as const;
        output = await withPreparationSignal(signal, () => resourceOp.action === "cleanupFeature"
          ? performCleanup(callerCwd, resourceOp, ...effectArguments)
          : performBrowserDiscard(callerCwd, resourceOp, ...effectArguments));
        if (op.action === "cleanupFeature") completed = true;
      } else if (op.action === "commit" && op.mode === "files") {
        // Own Git's native index.lock only during effects. The private index keeps
        // unrelated staged entries; commit --only reconciles selected entries.
        const original = toNativePath((await git(snapshot.cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trim());
        const lockPath = `${original}.lock`;
        const fd = openSync(lockPath, "wx", 0o600);
        const ownedLock = fstatSync(fd);
        let installed = false;
        const privateIndex = join(scratch, "index");
        try {
          await revalidate();
          if (existsSync(original)) copyFileSync(original, privateIndex);
          else await git(snapshot.cwd, ["read-tree", "HEAD"], privateIndex);
          await run("git", ["-c", "core.fsmonitor=false", "-C", snapshot.cwd, "add", "-A", `--pathspec-from-file=${join(scratch, "paths")}`, "--pathspec-file-nul"], snapshot.cwd, false, privateIndex);
          const before = (await head(snapshot.cwd)).tip;
          try { output = await run("git", commandArgs, snapshot.cwd, false, privateIndex); completed = true; }
          finally {
            // Even an output/exit failure can follow a completed commit. Preserve
            // its reconciled index when HEAD actually advanced; never reset HEAD.
            if ((await head(snapshot.cwd)).tip !== before) {
              writeFileSync(fd, readFileSync(privateIndex));
              renameSync(lockPath, original);
              installed = true;
            }
          }
        } finally {
          closeSync(fd);
          if (!installed && existsSync(lockPath)) {
            const currentLock = lstatSync(lockPath);
            if (currentLock.ino === ownedLock.ino && currentLock.dev === ownedLock.dev) rmSync(lockPath);
          }
        }
      } else { output = await run("git", commandArgs, snapshot.cwd); if (baseline) completed = true; }
    } finally {
      const failures: unknown[] = [];
      try { releaseReservation?.(); } catch (error) { failures.push(error); }
      try { rmSync(scratch, { recursive: true, force: true }); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, `Git post-effect finalization failed: ${failures.map(error => error instanceof Error ? error.message : String(error)).join("; ").slice(0, 1000)}`);
    }
    completed = true;
    finalized = true;
    if (!baseline && (op.action === "merge" || op.action === "rebase")) await idle(snapshot.cwd);
    if (op.action === "createWorktree" || op.action === "attachWorktree") allowFileRoot(op.path);
    if (baseline) postflight = await collectPostflight(baseline, "completed", receipt.checks.map(check => ({ ...check, cwd: checkCwd ?? snapshot.cwd })));
    annotatePostflight();
    const result = postflight ? postflightText(postflight, output) : `${op.action} completed.\n${output.slice(0, 12000)}\nObserved HEAD: ${JSON.stringify(await observedHead(snapshot.cwd))}`;
    await saveSettlement("succeeded");
    record("succeeded", result);
    return { ...(postflight && postflight.verification !== "verified" ? { isError: true } : {}), content: [{ type: "text" as const, text: result }],
      details: { action: op.action, completed: true, operationId, effects, ...(postflight ? { postflight, receiptPersisted: true } : {}) } };
  } catch (error) {
    let observed = "";
    if (baseline && started) postflight ??= await collectPostflight(baseline, completed ? "completed" : "started", receipt?.checks.map(check => ({ ...check, cwd: checkCwd ?? baseline!.cwd })));
    if (!postflight && ["commit", "merge", "rebase", "cleanupFeature"].includes(op.action)) {
      postflight = unobservedPostflight(op.action as ReportAction, error instanceof Error ? error.message : String(error));
      postflight.checks = (receipt?.checks ?? []).slice(0, 24).map(check => ({ ...check, cwd: checkCwd ?? baseline?.cwd ?? op.checkout }));
      if ((receipt?.checks.length ?? 0) > 24) postflight.checksOmitted = receipt!.checks.length - 24;
    }
    annotatePostflight();
    if (started && !postflight) {
      try { observed = `\nObserved HEAD: ${JSON.stringify(await observedHead(op.checkout))}\nStatus digest (empty means clean): ${await status(op.checkout)}\nWorktrees: ${JSON.stringify(await worktrees(op.checkout))}`; }
      catch { observed = "\nObserved state could not be read; inspect repository manually."; }
    }
    let text = `${error instanceof Error ? error.message : String(error)}${completed ? "\nNative effect completed, but post-effect reporting failed. Do not repeat the operation." : started ? "\nNative effect started; partial changes or conflict state may remain. No rollback or retry was performed." : checksStarted ? "\nRequired checks started and may have side effects; Git effect did not start." : "\nGit effect did not start."}${attemptedEffect ? `\nLast dispatched cleanup step: ${attemptedEffect}` : ""}${effects.length ? `\nCompleted cleanup steps:\n${effects.join("\n")}` : ""}${observed}`.slice(0, 15000);
    if (postflight) text = postflightText(postflight, error instanceof Error ? error.message : String(error), completed
      ? "Post-effect finalization or receipt reporting failed; inspect the reported facts before further mutations."
      : started ? "Native effect started; partial changes or conflict state may remain. No rollback or retry was performed."
      : checksStarted ? "Required checks started and may have side effects; Git effect did not start." : "Git effect did not start.");
    let receiptPersisted = false;
    if (receipt) {
      const terminalPhase = completed ? "succeeded" : receipt.authorization.decision === "not-approved" || signal?.aborted && !started ? "cancelled" : "failed";
      try {
        await saveSettlement(terminalPhase);
        record(terminalPhase, text); receiptPersisted = true;
      }
      catch {
        // A presentation bug must not be retried verbatim as the failure card.
        // This minimal record reports outcome only; it never grants authority.
        receipt.card = { title: "Git operation outcome", operationId: receipt.operationId, review: receipt.card.review,
          text: "The full operation card could not be persisted. See the tool result for the observed outcome.", actions: [] };
        try { record(terminalPhase, text); receiptPersisted = true; }
        catch { text += "\nTerminal receipt could not be persisted; saved outcome remains unknown. Inspect the repository before any retry."; }
      }
    }
    return { isError: true, content: [{ type: "text" as const, text }],
      details: { action: op.action, completed, effectStarted: started, checksStarted, operationId: receipt?.operationId, effects, ...(postflight ? { postflight, receiptPersisted } : {}) } };
  }
}
