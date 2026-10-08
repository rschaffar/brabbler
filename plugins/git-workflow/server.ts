import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { gitExecEnv } from "../../lib/git-exec";
import { samePath, toNativePath } from "../../lib/paths";
import { allowFileRoot } from "../../lib/file-access";
import { onPluginSettingsChange, pluginProjectIdentity, readPluginSettings } from "../../lib/plugins/settings";
import type { PluginCard, PluginCardField, PluginCardSection, PluginSession, PluginUiContext, PluginOperationReceipt, RequiredCheck } from "../../lib/plugins/types";
import { gitWorkflowManifest, type GitAction, type GitSettings } from "./manifest";
import { registerGitPatchContext } from "./context";
import { captureCleanup, createCleanupBudget, performCleanup, type CleanupBudget, type CleanupAccess, type CleanupOperation, type CleanupSnapshot } from "./cleanup";

export type GitOperation =
  | { action: "commit"; checkout: string; mode: "staged" | "files"; files?: string[]; message: string }
  | { action: "rebase" | "merge"; checkout: string; featureBranch: string; targetBranch?: string; mergeMethod?: "ff-only" | "non-ff" }
  | { action: "createWorktree" | "attachWorktree"; checkout: string; branch: string; baseBranch: string; path: string }
  | { action: "removeWorktree"; checkout: string; path: string }
  | CleanupOperation;
interface Snapshot { fingerprint: string; card: PluginCard; checks: RequiredCheck[]; args: string[]; cwd: string; comparison?: { before: string; after: string }; cleanup?: CleanupSnapshot }
const MAX_OUTPUT = 2 * 1024 * 1024;
function env(index?: string) {
  return { ...gitExecEnv(index), GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1", GIT_LITERAL_PATHSPECS: "1",
    GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true" };
}
function git(cwd: string, args: string[], index?: string, input?: string): string {
  return execFileSync("git", ["-C", cwd, "--no-optional-locks", "-c", "core.fsmonitor=false", ...args], {
    env: env(index), encoding: "utf8", maxBuffer: MAX_OUTPUT, timeout: 15_000, input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
}
function branchTip(cwd: string, branch: string): string {
  if (!branch || branch.startsWith("-") || branch === "HEAD") throw new Error("Select an explicit local branch");
  git(cwd, ["check-ref-format", `refs/heads/${branch}`]);
  return git(cwd, ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]).trim();
}
function head(cwd: string) {
  return { branch: git(cwd, ["symbolic-ref", "--short", "HEAD"]).trim(), tip: git(cwd, ["rev-parse", "HEAD"]).trim() };
}
function status(cwd: string): string { return git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]); }
function assertIdle(cwd: string) {
  for (const name of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) {
    if (existsSync(toNativePath(git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", name]).trim()))) throw new Error(`Conflicting Git operation: ${name}`);
  }
  if (git(cwd, ["config", "--get", "core.sparseCheckout"]).trim() === "true") throw new Error("Sparse checkout is unsupported");
}
// config --get exits 1 for absent keys.
function idle(cwd: string) {
  try { assertIdle(cwd); } catch (error) {
    if ((error as { status?: number }).status !== 1) throw error;
  }
  const flags = git(cwd, ["ls-files", "-v", "-z"]).split("\0").filter(Boolean);
  if (flags.some((entry) => /^[a-zS]/.test(entry))) throw new Error("Hidden index flags are unsupported");
}
function worktrees(cwd: string): Array<{ path: string; branch?: string; locked?: string; prunable?: string }> {
  return git(cwd, ["worktree", "list", "--porcelain", "-z"]).split("\0\0").filter(Boolean).map((record) => {
    const fields = record.split("\0");
    return { path: toNativePath(fields.find((value) => value.startsWith("worktree "))!.slice(9)),
      branch: fields.find((value) => value.startsWith("branch refs/heads/"))?.slice(18),
      locked: fields.find((value) => value === "locked" || value.startsWith("locked ")),
      prunable: fields.find((value) => value === "prunable" || value.startsWith("prunable ")) };
  });
}
function checkout(selected: string, repositoryCwd?: string): string {
  if (!isAbsolute(selected)) throw new Error("Select an absolute registered checkout path");
  const physical = realpathSync(selected);
  const identity = pluginProjectIdentity(physical);
  if (!identity || (repositoryCwd && identity !== pluginProjectIdentity(repositoryCwd))
    || !worktrees(physical).some((entry) => samePath(entry.path, physical))) throw new Error("Selected checkout is not registered in the selected repository");
  if (!samePath(toNativePath(git(physical, ["rev-parse", "--show-toplevel"]).trim()), physical)) throw new Error("Select the checkout root");
  idle(physical);
  // Even git status can invoke clean filters. Refuse before any content-based
  // preflight so an Ask/decline never executes project filter commands.
  refuseFilters(physical, git(physical, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]));
  return physical;
}
function settings(cwd: string, session?: PluginSession, op?: GitOperation): GitSettings {
  const snapshot = readPluginSettings(gitWorkflowManifest, cwd, undefined, session);
  if (!snapshot.enabled) throw new Error("Git Workflow plugin is disabled");
  const policy = snapshot.effective as unknown as GitSettings;
  if (op?.action === "rebase" || op?.action === "merge" || op?.action === "cleanupFeature") {
    // An Ask answer is an invocation choice, never a settings write or permission override.
    if (op.targetBranch !== undefined) {
      if (policy.targetSelection !== "ask" && policy.targetBranch && op.targetBranch !== policy.targetBranch) throw new Error("Target differs from configured policy");
      policy.targetBranch = op.targetBranch;
    }
    if ("mergeMethod" in op && op.mergeMethod !== undefined) {
      if (op.action !== "merge" || !["ff-only", "non-ff"].includes(op.mergeMethod)) throw new Error("Invalid merge method");
      if (policy.methodSelection !== "ask" && op.mergeMethod !== policy.mergeMethod) throw new Error("Method differs from configured policy");
      policy.mergeMethod = op.mergeMethod;
    }
  }
  return policy;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function physicalPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  return join(physicalPath(dirname(path)), basename(path));
}
function fileSelection(cwd: string, files: string[] | undefined): string[] {
  if (!files?.length || files.length > 256 || new Set(files).size !== files.length) throw new Error("Select 1–256 distinct whole files");
  for (const file of files) {
    if (!file || file.includes("\0") || isAbsolute(file) || file.split(/[\\/]/).some((part) => part === ".." || part === ".git")
      || relative(cwd, resolve(cwd, file)).startsWith("..")) throw new Error("Invalid selected file path");
    if (existsSync(join(cwd, file)) && lstatSync(join(cwd, file)).isDirectory()) throw new Error("Select files, not directories");
    const parent = physicalPath(resolve(cwd, file, ".."));
    if (relative(cwd, parent).startsWith("..")) throw new Error("Selected file escapes checkout");
    // A tracked deletion is a valid whole-file selection. Refuse absent/untracked typo paths.
    if (!existsSync(join(cwd, file))) git(cwd, ["ls-files", "--error-unmatch", "--", file]);
  }
  refuseFilters(cwd, `${files.join("\0")}\0`);
  return files;
}
function refuseFilters(cwd: string, paths: string) {
  const attributes = git(cwd, ["check-attr", "-z", "--stdin", "filter"], undefined, paths).split("\0");
  for (let i = 2; i < attributes.length; i += 3) {
    if (attributes[i] !== "unspecified" && attributes[i] !== "unset") throw new Error("Git plugin preflight refuses clean/process filter attributes; use ordinary Git tools for this repository");
  }
}
function cleanupAccess(ui: Partial<PluginUiContext>): CleanupAccess {
  return { git, checkout, branchTip, worktrees, project: pluginProjectIdentity,
    inUse: (path) => { if (!ui.isDirectoryInUse) throw new Error("Cleanup requires live directory-use inspection"); return ui.isDirectoryInUse(path); } };
}
async function preview(callerCwd: string, op: GitOperation, policy: GitSettings, ui: Partial<PluginUiContext> = {}, budget?: CleanupBudget): Promise<Snapshot> {
  if (op.action === "cleanupFeature") {
    if (!op.removeWorktree && !op.deleteBranch && !op.artifactRoots.length) throw new Error("Choose at least one cleanup resource");
    const cleanup = await captureCleanup(callerCwd, op, policy, cleanupAccess(ui), budget);
    const fields = [{ label: "Repository checkout", value: cleanup.cwd, code: true },
      { label: "Integrated feature", value: `${op.featureBranch} at ${op.featureTip}`, code: true },
      { label: "Verified integration", value: `${op.integrationCommit} remains reachable from ${cleanup.target}`, code: true },
      { label: "Worktree", value: `${op.removeWorktree ? "Remove" : "Keep"}: ${cleanup.path ?? "none"}` },
      { label: "Local branch", value: op.deleteBranch ? "Delete exact integrated ref" : "Keep" }];
    return { fingerprint: digest([cleanup.fingerprint, relevantPolicy(policy, op.action)]), cleanup,
      cwd: cleanup.cwd, args: [], checks: [], card: { title: "Clean up integrated Git feature", subtitle: "Approval required", fields,
        sections: [{ title: "Explicitly permitted generated directories", fields: cleanup.artifacts.map((item) => ({ label: item.path,
          value: `${item.entries} entries · ${item.bytes} bytes · SHA256 ${item.digest}`, code: true })) },
        { title: "Boundaries", text: "Only listed resources. Content/identity rechecked before each effect. Unknown files, source changes, locked or active worktrees block cleanup. Target advancement is allowed only while integration remains reachable. External filesystem/Git writers are not locked out; partial effects are reported, never rolled back. Local branch config is retained; remote branches and backups are untouched.", notice: true }],
        scope: "Approves all listed cleanup resources together, not an arbitrary ignored-file deletion.",
        actions: [{ id: "reject", label: "Keep resources" }, { id: "approve", label: "Clean up listed resources", primary: true }] } };
  }
  const cwd = checkout(op.checkout);
  const current = head(cwd);
  const rows: string[] = [JSON.stringify(op, null, 2), `Checkout: ${cwd}`, `Branch: ${current.branch}`, `HEAD: ${current.tip}`,
    "Native Git operation is unsigned and hook-free. Stronger user/repository instructions still apply."];
  const fields: PluginCardField[] = [{ label: "Checkout", value: cwd, code: true }, { label: "Branch", value: current.branch, code: true }];
  const sections: PluginCardSection[] = [];
  const notices = ["Native Git operation is unsigned and hook-free. Stronger user/repository instructions still apply."];
  let args: string[] = [];
  let patch: string | undefined;
  let comparison: Snapshot["comparison"];
  let checks: RequiredCheck[] = [];
  const state: unknown[] = [cwd, pluginProjectIdentity(cwd), current, status(cwd), worktrees(cwd)];
  if (op.action === "commit") {
    if (!op.message.trim() || op.message.length > 65536 || op.message.includes("\0")) throw new Error("An exact nonempty commit message is required");
    checks = policy.commitChecks;
    fields.push({ label: "Selection", value: op.mode === "files" ? "Selected whole files, including unstaged content" : "Complete staged set" });
    sections.push({ title: "Commit message", text: op.message, code: true });
    const files = op.mode === "files" ? fileSelection(cwd, op.files) : undefined;
    if (op.mode !== "staged" && op.mode !== "files") throw new Error("Invalid commit mode");
    if (op.mode === "staged" && op.files !== undefined) throw new Error("Staged mode commits the complete staged set, not selected paths");
    const scratch = mkdtempSync(join(tmpdir(), "pi-web-git-preview-"));
    try {
      const index = join(scratch, "index");
      const original = toNativePath(git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).trim());
      state.push(existsSync(original) ? digest(readFileSync(original).toString("base64")) : null);
      if (files) {
        // --only builds from HEAD; unrelated staging is not part of this candidate.
        git(cwd, ["read-tree", current.tip], index);
        git(cwd, ["add", "-A", "--", ...files], index);
      } else if (existsSync(original)) copyFileSync(original, index);
      else git(cwd, ["read-tree", current.tip], index);
      const tree = git(cwd, ["write-tree"], index).trim();
      if (tree === git(cwd, ["rev-parse", `${current.tip}^{tree}`]).trim()) throw new Error("No selected changes to commit");
      comparison = { before: current.tip, after: tree };
      patch = git(cwd, ["diff", "--binary", "--no-color", "--no-ext-diff", "--no-textconv", current.tip, tree, "--"], index);
      state.push(tree);
      rows.push(`Candidate tree: ${tree}`, `Exact message:\n${op.message}`);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
    args = ["commit", "--no-gpg-sign", "--cleanup=verbatim", ...(files ? ["--only", "--", ...files] : [])];
  } else if (op.action === "rebase" || op.action === "merge") {
    if (!policy.targetBranch) throw new Error("Configure a target local branch first");
    if (op.featureBranch === policy.targetBranch) throw new Error("Feature and target must differ");
    const feature = branchTip(cwd, op.featureBranch);
    const target = branchTip(cwd, policy.targetBranch);
    if (status(cwd)) throw new Error("Selected checkout must be clean, including untracked files");
    if (current.branch !== (op.action === "rebase" ? op.featureBranch : policy.targetBranch)) throw new Error("Select the checkout of the operation's branch");
    const sourceCheckout = worktrees(cwd).find((entry) => entry.branch === (op.action === "merge" ? op.featureBranch : policy.targetBranch));
    if (sourceCheckout) {
      const source = checkout(sourceCheckout.path, cwd);
      if (status(source)) throw new Error("Other selected branch checkout must be clean");
      state.push(source, head(source));
    }
    state.push(feature, target);
    fields.push({ label: "Feature → target", value: `${op.featureBranch} → ${policy.targetBranch}`, code: true });
    notices.push("Diffs show feature changes since the merge base, not a predicted rebase/merge result.");
    rows.push(`Feature: ${op.featureBranch} ${feature}`, `Target: ${policy.targetBranch} ${target}`,
      "Patch shows feature changes since the merge base, not a predicted rebase/merge result.");
    const base = git(cwd, ["merge-base", target, feature]).trim();
    comparison = { before: base, after: feature };
    patch = git(cwd, ["diff", "--binary", "--no-color", "--no-ext-diff", "--no-textconv", base, feature, "--"]);
    if (op.action === "rebase") args = ["rebase", "--no-autostash", "--no-update-refs", "--no-rebase-merges", "--no-gpg-sign", target];
    else {
      checks = policy.mergeChecks;
      fields.push({ label: "Merge method", value: policy.mergeMethod === "ff-only" ? "Fast-forward only" : "Non-fast-forward merge" });
      rows.push(`Merge method: ${policy.mergeMethod}`, "Checks run in the selected feature checkout before merging; no automatic rebase.");
      if (checks.length && !sourceCheckout) throw new Error("Required merge checks need the feature's registered clean checkout");
      args = ["-c", `branch.${policy.targetBranch}.mergeOptions=`, "merge", policy.mergeMethod === "ff-only" ? "--ff-only" : "--no-ff", "--commit", "--no-edit", "--no-gpg-sign", feature];
    }
  } else if (op.action === "createWorktree" || op.action === "attachWorktree") {
    if (status(cwd)) throw new Error("Source checkout must be clean");
    if (!isAbsolute(op.path) || existsSync(op.path)) throw new Error("Choose a new absolute worktree destination");
    const parent = resolve(op.path, "..");
    const physicalParent = physicalPath(parent);
    const destination = resolve(physicalParent, basename(op.path));
    const common = pluginProjectIdentity(cwd)!;
    // Limit creation to the existing allowed repository-adjacent worktree container.
    const main = worktrees(cwd)[0].path;
    const container = `${main}-worktrees`;
    if (!samePath(resolve(destination, ".."), container) || relative(common, destination).startsWith("..") === false) throw new Error(`Destination must be directly inside ${container}`);
    git(cwd, ["check-ref-format", `refs/heads/${op.branch}`]);
    const base = branchTip(cwd, op.baseBranch);
    const baseCheckout = worktrees(cwd).find((entry) => entry.branch === op.baseBranch);
    if (baseCheckout && status(checkout(baseCheckout.path, cwd))) throw new Error("Base checkout must be clean");
    const exists = git(cwd, ["for-each-ref", "--format=%(refname)", `refs/heads/${op.branch}`]).split("\n").includes(`refs/heads/${op.branch}`);
    if (op.action === "createWorktree" && exists) throw new Error("Create requires a new branch");
    if (op.action === "attachWorktree" && (op.baseBranch !== op.branch || !exists)) throw new Error("Attach requires the explicitly selected existing branch as base");
    state.push(base, destination);
    fields.push({ label: "Base branch", value: op.baseBranch, code: true }, { label: "Worktree branch", value: op.branch, code: true },
      { label: "Destination", value: destination, code: true });
    rows.push(`Base: ${op.baseBranch} ${base}`, `Destination: ${destination}`);
    args = op.action === "createWorktree" ? ["worktree", "add", "-b", op.branch, destination, base] : ["worktree", "add", destination, op.branch];
  } else if (op.action === "removeWorktree") {
    const selected = worktrees(cwd).find((entry) => samePath(entry.path, op.path));
    // A session may live outside Git, or below a linked checkout's root.
    const callerRoot = pluginProjectIdentity(callerCwd) === pluginProjectIdentity(cwd)
      ? realpathSync(toNativePath(git(callerCwd, ["rev-parse", "--show-toplevel"]).trim())) : null;
    if (!selected || samePath(selected.path, worktrees(cwd)[0].path) || samePath(selected.path, cwd)
      || (callerRoot && samePath(selected.path, callerRoot))) throw new Error("Select another registered linked worktree; never the main or caller checkout");
    const physical = checkout(selected.path, cwd);
    if (status(physical) || git(physical, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"])) throw new Error("Removal requires a clean worktree with no ignored files; force removal is not provided");
    state.push(physical, head(physical));
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
  return { fingerprint: digest(state), cwd, args, checks, comparison,
    card: { title: { commit: "Git commit", rebase: "Git rebase", merge: "Git merge", createWorktree: "Create Git worktree", attachWorktree: "Attach Git worktree", removeWorktree: "Remove Git worktree" }[op.action],
      subtitle: "Approval required", fields, sections, patch,
      scope: `Approves the entire ${op.action === "commit" ? "commit candidate" : "selected operation"}${checks.length ? " and the listed checks" : ""}${patch ? ", not just an expanded file" : ""}.`,
      patchBefore: op.action === "commit" ? "HEAD" : "Merge base", patchAfter: op.action === "commit" ? "Candidate" : "Selected feature",
      actions: [{ id: "reject", label: "Reject" }, { id: "approve", primary: true,
        label: { commit: "Approve commit", rebase: "Approve rebase", merge: "Approve merge", createWorktree: "Create worktree", attachWorktree: "Attach worktree", removeWorktree: "Remove worktree" }[op.action] }] } };
}
function run(command: string, args: string[], cwd: string, shell = false, index?: string): Promise<string> {
  // No AbortSignal or output-buffer kill on native effects: settle actual Git writes.
  if (!shell) return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: env(index), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const append = (chunk: Buffer) => { if (output.length < MAX_OUTPUT) output += chunk.toString().slice(0, MAX_OUTPUT - output.length); };
    child.stdout.on("data", append); child.stderr.on("data", append);
    child.on("error", reject);
    child.on("close", (code, signal) => code === 0 ? resolve(output) : reject(new Error(`Git exited ${code ?? signal}\n${output}`)));
  });
  return new Promise((resolve, reject) => execFile(command, args, { cwd, env: env(), shell: true,
    maxBuffer: MAX_OUTPUT, timeout: 120_000 }, (error, stdout, stderr) => {
    if (error) reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
    else resolve(`${stdout}${stderr}`);
  }));
}
function relevantPolicy(policy: GitSettings, action: GitAction) {
  return [policy[action], action === "commit" ? policy.commitChecks : action === "merge" ? policy.mergeChecks : [],
    action === "merge" || action === "rebase" || action === "cleanupFeature" ? [policy.targetSelection, policy.targetBranch] : null,
    action === "merge" ? [policy.methodSelection, policy.mergeMethod] : null,
    action === "cleanupFeature" ? [policy.cleanupWorktree, policy.cleanupBranch, policy.cleanupArtifacts, policy.approvedArtifactRoots] : null];
}
export async function executeGitOperation(callerCwd: string, operation: GitOperation, ui: Partial<PluginUiContext>, signal?: AbortSignal, session?: PluginSession, toolCallId?: string) {
  const op = structuredClone(operation);
  let started = false;
  let checksStarted = false;
  let completed = false;
  let receipt: PluginOperationReceipt | undefined;
  const effects: string[] = [];
  const cleanupBudget = createCleanupBudget();
  let attemptedEffect: string | undefined;
  const record = (phase: PluginOperationReceipt["phase"], summary?: string) => {
    if (!receipt || !ui.operationReceipt) throw new Error("Git operations require durable Pi Web operation receipts");
    receipt = { ...receipt, phase, effectStarted: started, ...(summary ? { summary: summary.slice(0, 16000) } : {}) };
    ui.operationReceipt(gitWorkflowManifest.id, structuredClone(receipt));
  };
  try {
    // Foreign repositories never inherit caller/session overrides. Deny still
    // precedes preview and checks. Identity is supplied by the host, not the model.
    const policy = settings(op.checkout, session, op);
    if (policy[op.action] === "deny") throw new Error(`${op.action} is denied by current settings`);
    const snapshot = await preview(callerCwd, op, policy, ui, cleanupBudget);
    const origin = readPluginSettings(gitWorkflowManifest, op.checkout, undefined, session);
    if (origin.effective[op.action] !== policy[op.action]) throw new Error("Policy changed during preparation");
    const operationId = randomUUID();
    snapshot.card.operationId = operationId;
    if (policy[op.action] === "allow") snapshot.card.subtitle = "Policy-authorized operation";
    receipt = { version: 1, operationId, ...(toolCallId ? { toolCallId } : {}), card: snapshot.card, phase: "prepared", effectStarted: false,
      authorization: { mode: policy[op.action] as "ask" | "allow", source: origin.sources[op.action], revision: digest(origin),
        decision: policy[op.action] === "allow" ? "policy-authorized" : "pending" },
      checks: snapshot.checks.map((check) => ({ name: check.name, status: "pending" })) };
    record("prepared");
    if (signal?.aborted) throw new Error("Cancelled before execution");
    if (policy[op.action] === "ask") {
      if (!ui.pluginCard) throw new Error("Ask requires the live Pi Web browser UI");
      if (snapshot.comparison && snapshot.card.patch) {
        snapshot.card.patchContext = registerGitPatchContext(snapshot.cwd, snapshot.comparison.before, snapshot.comparison.after, snapshot.card.patch);
      }
      const cancellation = new AbortController();
      const unsubscribe = onPluginSettingsChange((id) => {
        if (id !== gitWorkflowManifest.id) return;
        try {
          const current = settings(op.checkout, session, op);
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
      const current = settings(op.checkout, session, op);
      if (current[op.action] === "deny" || (await preview(callerCwd, op, current, ui, cleanupBudget)).fingerprint !== snapshot.fingerprint
        || digest(relevantPolicy(settings(op.checkout, session, op), op.action)) !== digest(relevantPolicy(policy, op.action))) throw new Error("Stale operation: relevant settings or repository state changed; invoke again");
    };
    // Cleanup owns a single full revalidation per effect, under its directory
    // reservation. Do not rescan dependency trees at every generic checkpoint.
    if (op.action !== "cleanupFeature") await revalidate();
    const checkCwd = op.action === "merge" ? worktrees(snapshot.cwd).find((entry) => entry.branch === op.featureBranch)?.path : snapshot.cwd;
    for (const [index, check] of snapshot.checks.entries()) {
      await revalidate();
      receipt.checks[index].status = "running";
      record("checking");
      checksStarted = true;
      try { await run(check.command, [], checkCwd!, true); receipt.checks[index].status = "passed"; }
      catch (error) { receipt.checks[index].status = "failed"; throw error; }
      record("checking");
    }
    if (op.action !== "cleanupFeature") await revalidate();
    const scratch = mkdtempSync(join(tmpdir(), "pi-web-git-effect-"));
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
      }
      // A durable executing stage is required BEFORE the first native mutation.
      // If persistence fails, started stays false and no Git effect is dispatched.
      record("executing");
      if (op.action !== "cleanupFeature") { await revalidate(); started = true; }
      if (op.action === "createWorktree" || op.action === "attachWorktree") mkdirSync(resolve(op.path, ".."), { recursive: true });
      const commandArgs = ["-c", `core.hooksPath=${scratch}`, "-c", "core.fsmonitor=false", "-c", "commit.gpgSign=false", "-c", "rebase.autoStash=false", "-c", "merge.autoStash=false", "-C", snapshot.cwd, ...args];
      if (op.action === "cleanupFeature") {
        output = await performCleanup(callerCwd, op, policy, cleanupAccess(ui), snapshot.cleanup!, () => {
          if (signal?.aborted) throw new Error("Cancelled; remaining cleanup resources retained");
          const current = settings(op.checkout, session, op);
          if (digest(relevantPolicy(current, op.action)) !== digest(relevantPolicy(policy, op.action))) throw new Error("Cleanup policy changed; remaining resources retained");
        }, (args) => run("git", [...commandArgs, ...args], snapshot.cwd), effects,
          (description) => { started = true; attemptedEffect = description; }, cleanupBudget);
      } else if (op.action === "commit" && op.mode === "files") {
        // Own Git's native index.lock only during effects. The private index keeps
        // unrelated staged entries; commit --only reconciles selected entries.
        const original = toNativePath(git(snapshot.cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).trim());
        const lockPath = `${original}.lock`;
        const fd = openSync(lockPath, "wx", 0o600);
        const ownedLock = fstatSync(fd);
        let installed = false;
        const privateIndex = join(scratch, "index");
        try {
          await revalidate();
          if (existsSync(original)) copyFileSync(original, privateIndex);
          else git(snapshot.cwd, ["read-tree", "HEAD"], privateIndex);
          await run("git", ["-C", snapshot.cwd, "add", "-A", "--", ...op.files!], snapshot.cwd, false, privateIndex);
          const before = head(snapshot.cwd).tip;
          try { output = await run("git", commandArgs, snapshot.cwd, false, privateIndex); }
          finally {
            // Even an output/exit failure can follow a completed commit. Preserve
            // its reconciled index when HEAD actually advanced; never reset HEAD.
            if (head(snapshot.cwd).tip !== before) {
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
      } else output = await run("git", commandArgs, snapshot.cwd);
    } finally { releaseReservation?.(); rmSync(scratch, { recursive: true, force: true }); }
    completed = true;
    if (op.action === "merge" || op.action === "rebase") idle(snapshot.cwd);
    if (op.action === "createWorktree" || op.action === "attachWorktree") allowFileRoot(op.path);
    const result = `${op.action} completed.\n${output.slice(0, 12000)}\nObserved HEAD: ${JSON.stringify(head(snapshot.cwd))}`;
    record("succeeded", result);
    return { content: [{ type: "text" as const, text: result }], details: { action: op.action, completed: true, operationId, effects } };
  } catch (error) {
    let observed = "";
    if (started) {
      try { observed = `\nObserved HEAD: ${JSON.stringify(head(op.checkout))}\nStatus: ${status(op.checkout)}\nWorktrees: ${JSON.stringify(worktrees(op.checkout))}`; }
      catch { observed = "\nObserved state could not be read; inspect repository manually."; }
    }
    let text = `${error instanceof Error ? error.message : String(error)}${completed ? "\nNative effect completed, but post-effect reporting failed. Do not repeat the operation." : started ? "\nNative effect started; partial changes or conflict state may remain. No rollback or retry was performed." : checksStarted ? "\nRequired checks started and may have side effects; Git effect did not start." : "\nGit effect did not start."}${attemptedEffect ? `\nLast dispatched cleanup step: ${attemptedEffect}` : ""}${effects.length ? `\nCompleted cleanup steps:\n${effects.join("\n")}` : ""}${observed}`.slice(0, 15000);
    if (receipt) {
      try { record(completed ? "succeeded" : receipt.authorization.decision === "not-approved" || signal?.aborted && !started ? "cancelled" : "failed", text); }
      catch { text += "\nTerminal receipt could not be persisted; saved outcome remains unknown. Inspect the repository before any retry."; }
    }
    return { isError: true, content: [{ type: "text" as const, text }],
      details: { action: op.action, completed, effectStarted: started, checksStarted, operationId: receipt?.operationId, effects } };
  }
}
