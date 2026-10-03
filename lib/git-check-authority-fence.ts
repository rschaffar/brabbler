// Server bootstrap adapter. A revision fence is NOT a grant or cached approval.
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { readBindingFile } from "./git-workflow-binding-io";
import { readGitWorkflowWriteEpoch } from "./git-workflow-write-epoch";
import { getAllowedFileRoots, getKnownAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "./file-access";
import { getProjectTrustStatus } from "./project-trust";
import { readHumanGitSessionManager, type HumanGitScope } from "./git-action-human";
import { getRpcSession } from "./rpc-manager";
import { samePath } from "./paths";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { assertManagedGitAction, assertManagedGitProjectDenial, assertManagedGitWorkspace } from "./git-workflow-access";
import { revalidateGitProjectResources, type GitProjectResources } from "./git-project-resources";
import { loadGitProjectSettings } from "./git-project-settings";
import { selectGitCheckRecipesForStage, validateGitCheckRecipes } from "./git-check-recipe";
import type { SessionEntry } from "./types";
import { GitCommitVerificationError, type GitCommitVerificationContext } from "./git-commit-verification";
import type { GitWorkflowSettingsResponse } from "./git-workflow-settings";
import { lookupGitCheckoutVerificationReceipt, type GitWorkingWorkspaceVerificationReceipt } from "./git-checkout-verification";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function savedFile(file: string) {
  try {
    const named = lstatSync(file);
    if (!named.isFile() || named.isSymbolicLink()) throw new Error("ordinary authority file required");
    if (!samePath(realpathSync(file), file)) throw new Error("physical authority file required");
    const value = readBindingFile(file, 4 * 1024 * 1024);
    // Include metadata: even an equal-value rewrite or change-and-restore fences a run.
    return { fingerprint: value.fingerprint, digest: hash(value.bytes.toString("base64")) };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw cause;
  }
}
type LiveAuthorityReader = () => string;
interface LiveRegistration { read: LiveAuthorityReader; instance: string }
const liveReaderKey = Symbol.for("pi-web:git-check-authority:live-readers");
function liveReaders(): WeakMap<object, LiveRegistration> {
  const g = globalThis as unknown as Record<symbol, WeakMap<object, LiveRegistration>>;
  return g[liveReaderKey] ??= new WeakMap();
}
/** Trusted RPC bootstrap ONLY. Bind the actual current wrapper instance. The
 * writer must advance this monotonic revision BEFORE every tools/pause/off/leaf
 * mutation, including a failed mutation and change-and-restore. Never install a
 * getter that merely hashes final values. Missing adapters fail closed for live
 * wrappers; registration does not confer a human role or any authorization. */
export function registerGitCheckLiveAuthorityReader(wrapper: object, readRevisionSync: LiveAuthorityReader): () => void {
  const registration = { read: readRevisionSync, instance: randomUUID() };
  liveReaders().set(wrapper, registration);
  return () => { if (liveReaders().get(wrapper) === registration) liveReaders().delete(wrapper); };
}
const mutationKey = Symbol.for("pi-web:git-check-authority:process-mutations");
function mutations(): Map<string, string> {
  const g = globalThis as unknown as Record<symbol, Map<string, string>>;
  return g[mutationKey] ??= new Map();
}
/** Trusted selection/trust/config writers call BEFORE effect, even equal-value
 * writes. Complements persisted workflow write epochs and bounded external stat
 * fingerprints; cannot be invoked by HTTP/model payload fields. */
export function advanceGitCheckProcessAuthorityRevision(domain: "selection" | "trust" | "configuration" | "caller"): void {
  mutations().set(domain, randomUUID());
}
function syncRevision(read: LiveAuthorityReader): string {
  const revision: unknown = read();
  if (revision && typeof (revision as Promise<unknown>).then === "function") void Promise.resolve(revision).catch(() => {});
  if (typeof revision !== "string" || !revision || revision.length > 512 || /[\x00-\x1f\x7f]/.test(revision)) throw new Error("known monotonic process revision required");
  return revision;
}
// Ordinary transcript progress is not a Git grant, nor a policy mutation.
// Navigation uses the genuine SDK writer revision, not the advancing message leaf.
function neutralOwnerAppend(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as { type?: string; customType?: string };
  return row.type === "custom" ? row.customType === "pi-web:git-action" :
    ["message", "usage", "context_edit", "compaction", "model_change", "thinking_level_change", "session_info", "label"].includes(row.type ?? "");
}
interface OwnerObservation { fingerprint: string; contentDigest: string; size: number; revision: string }
const ownerKey = Symbol.for("pi-web:git-check-authority:owners");
function ownerObservations(): Map<string, OwnerObservation> {
  const g = globalThis as unknown as Record<symbol, Map<string, OwnerObservation>>;
  return g[ownerKey] ??= new Map();
}
function ownerRevision(scope: HumanGitScope): string {
  const current = readBindingFile(scope.sessionFile, 16 * 1024 * 1024);
  const observations = ownerObservations(), previous = observations.get(scope.sessionFile);
  let revision = previous?.revision ?? randomUUID();
  if (previous && previous.fingerprint !== current.fingerprint) {
    // Only verified exact appends of ordinary history are neutral. Rewrites,
    // restored bytes and authority-bearing custom entries always fence.
    const suffix = current.bytes.subarray(previous.size);
    const ordinaryAppend = current.bytes.length > previous.size && hash(current.bytes.subarray(0, previous.size).toString("base64")) === previous.contentDigest &&
      suffix.toString("utf8").trim().split("\n").every((line) => {
        try { return neutralOwnerAppend(JSON.parse(line)); } catch { return false; }
      });
    if (!ordinaryAppend) revision = randomUUID();
  }
  if (!previous && observations.size >= 128) observations.delete(observations.keys().next().value!);
  observations.delete(scope.sessionFile); // bounded LRU; eviction invalidates, never reopens, an old fence
  observations.set(scope.sessionFile, { fingerprint: current.fingerprint, contentDigest: hash(current.bytes.toString("base64")), size: current.bytes.length, revision });
  return revision;
}
export interface GitCheckAuthorityFenceOptions {
  scope: HumanGitScope;
  agentDir: string;
  /** Trusted bootstrap's exact physical source/target paths, never request cwd. */
  checkouts: readonly string[];
  /** Optional live server selection state, NOT a captured/static approval. */
  readSelectionStateSync?: () => unknown;
  /** Mandatory alongside selection state. Must advance at actual writers,
   * including a change-and-restore in the final awaited authorization call. */
  readSelectionRevisionSync?: () => string;
}
/** Covers saved settings/write epoch, grants, trust, own workflow/tool/opt-out
 * metadata and live allowed selection. No async callback is used as a final
 * fence. Exact ordinary history/anchor appends are neutral; navigation uses
 * instrumented writer revisions. Equal-byte owner rewrites still fence. Native engines independently fence source bytes,
 * directory identities, refs/index/config and sanitized process environment.
 * Bounded/unreadable/unknown state throws; callers must fail closed. */
export function createGitCheckAuthorityFence(options: GitCheckAuthorityFenceOptions): () => string {
  const scope = { ...options.scope }, checkouts = [...options.checkouts], agentDir = options.agentDir;
  return () => {
    const file = lstatSync(scope.sessionFile, { bigint: true });
    if (file.size > BigInt(16 * 1024 * 1024)) throw new Error("bounded saved owner required");
    const manager = readHumanGitSessionManager(scope);
    if (!samePath(realpathSync(scope.sessionFile), scope.sessionFile)) throw new Error("physical saved owner required");
    const live = getRpcSession(scope.sessionId);
    const active = live?.isAlive() ? live : undefined;
    const registration = active ? liveReaders().get(active) : undefined;
    if (active && !registration) throw new Error("live RPC monotonic authority adapter required");
    const liveRevision = registration ? syncRevision(registration.read) : undefined;
    const tools = active ? active.inner.getActiveToolNames() : undefined;
    const entries = manager.getEntries().filter((entry) => entry.type === "custom" && entry.customType !== "pi-web:git-action");
    if (entries.length > 4096 || Buffer.byteLength(JSON.stringify(entries)) > 4 * 1024 * 1024) throw new Error("bounded authority state required");
    const roots = getKnownAllowedFileRoots();
    if (options.readSelectionStateSync && !options.readSelectionRevisionSync) throw new Error("monotonic selection adapter required");
    const selectionRevision = options.readSelectionRevisionSync ? syncRevision(options.readSelectionRevisionSync) : undefined;
    const selectionState = options.readSelectionStateSync?.();
    if (selectionState && typeof (selectionState as Promise<unknown>).then === "function") {
      void Promise.resolve(selectionState).catch(() => {}); throw new Error("synchronous selection state required");
    }
    if (Buffer.byteLength(JSON.stringify(selectionState ?? null)) > 4 * 1024 * 1024) throw new Error("bounded selection state required");
    const stamp = hash({ scope, owner: { dev: String(file.dev), ino: String(file.ino), birthtime: String(file.birthtimeNs) },
      header: manager.getHeader(), entries, tools,
      liveRevision, liveInstance: registration?.instance, ownerRevision: ownerRevision(scope),
      processRevisions: [...mutations()].sort(([a], [b]) => a.localeCompare(b)), epoch: readGitWorkflowWriteEpoch(agentDir),
      files: ["pi-web/git-workflow-settings.json", "pi-web/git-workflow-defaults.json", "pi-web/git-project-authorizations.json", "trust.json"]
        .map((name) => savedFile(join(agentDir, name))),
      roots: [...roots].filter((root) => checkouts.some((cwd) => isFilePathAllowed(cwd, new Set([root])))).sort(), checkouts: checkouts.map((cwd) => ({ cwd,
        allowed: isFilePathAllowed(cwd, roots) && isExistingFilePathAllowed(cwd, roots), trust: getProjectTrustStatus(cwd, agentDir) })), selectionState, selectionRevision });
    // A trusted getter/serialization may itself cross an instrumented writer.
    // Never return the pre-read revision after a change-and-restore inside this
    // final synchronous observation, or after current wrapper replacement.
    const current = getRpcSession(scope.sessionId);
    if ((current?.isAlive() ? current : undefined) !== active ||
      registration && syncRevision(registration.read) !== liveRevision ||
      options.readSelectionRevisionSync && syncRevision(options.readSelectionRevisionSync) !== selectionRevision) throw new Error("authority changed during synchronous observation");
    return stamp;
  };
}

const receiptBindingKey = Symbol.for("pi-web:human-check-receipt-authority:v1");
function receiptBindings(): WeakMap<object, { scope: HumanGitScope; revision: string }> {
  const g = globalThis as unknown as Record<symbol, WeakMap<object, { scope: HumanGitScope; revision: string }>>;
  return g[receiptBindingKey] ??= new WeakMap();
}
/** Call ONLY after actual native success, positive admission settlement and
 * durable typed human outcome recording. IDs/receipt-shaped objects from JSON
 * cannot register: require the live engine's exact opaque receipt object. */
export function bindHumanGitCheckReceiptAuthority(scope: HumanGitScope, receipt: GitWorkingWorkspaceVerificationReceipt, revision: string): void {
  readHumanGitSessionManager(scope);
  if (lookupGitCheckoutVerificationReceipt(receipt.id) !== receipt || receipt.version !== 3 || receipt.stage !== "commit" ||
    receipt.sessionId !== scope.sessionId || !samePath(receipt.selection.cwd, scope.cwd)) throw new Error("actual native human receipt required");
  receiptBindings().set(receipt, { scope: { ...scope }, revision });
}

function sourceRecipes(state: GitWorkflowSettingsResponse) {
  const saved = validateGitCheckRecipes(state.project.checks ?? []);
  const inherited = Object.hasOwn(state.project, "checks") ? [] : validateGitCheckRecipes(state.global.checks ?? []);
  const chat = validateGitCheckRecipes(state.session?.checks ?? []);
  // The native contract supports saved canonical Project recipes only. Do not
  // turn historical inherited prerequisites into an empty/no-defined waiver.
  if (selectGitCheckRecipesForStage(inherited, "commit").length ||
    selectGitCheckRecipesForStage(chat, "commit").length && hash(chat) !== hash(saved)) throw new GitCommitVerificationError("unsupported-inheritance");
  return Object.hasOwn(state.project, "checks") ? saved : inherited;
}

/** Real human bootstrap for this saved chat's manual commit scope. Never send a
 * human role through the selected AGENT coding-capability gate. The source's
 * saved Project recipes are authoritative; task/global/chat recipe lists cannot
 * replace or waive them. Check consent remains separate from commit consent. */
export function createHumanGitCommitVerificationContext(scope: HumanGitScope, receiptIds: readonly string[],
  source: Readonly<GitProjectResources>, agentDir = getAgentDir()): GitCommitVerificationContext & {
    isCheckExecutionAuthorized: (source: Readonly<GitProjectResources>) => Promise<boolean>;
  } {
  const bound = { ...scope }, bootstrap = structuredClone(source);
  if (!samePath(bootstrap.cwd, bound.cwd)) throw new Error("saved physical source required");
  const readAuthorityRevisionSync = createGitCheckAuthorityFence({ scope: bound, agentDir, checkouts: [...new Set([bound.cwd, bootstrap.projectRoot])] });
  const discover = async (source: Readonly<GitProjectResources>) => {
    if (!samePath(source.cwd, bound.cwd) || JSON.stringify(source) !== JSON.stringify(bootstrap)) throw new Error("saved native source required");
    const entries = readHumanGitSessionManager(bound).getEntries() as SessionEntry[];
    // Reuse the general persisted-human Off/Pause/subagent/task restrictions,
    // NOT commit permission or the old paired checks/target prerequisite. The
    // discovery must not demand check consent. The independent execution and
    // receipt-consumption gate below enforces checks Deny/disabled separately.
    const state = await assertManagedGitAction(bound.cwd, entries, "settings", "human", agentDir);
    await assertManagedGitWorkspace(state, bound.cwd);
    const roots = await getAllowedFileRoots();
    if (!isFilePathAllowed(bound.cwd, roots) || !isExistingFilePathAllowed(bound.cwd, roots)) throw new Error("source no longer allowed");
    await revalidateGitProjectResources(source as GitProjectResources);
    const saved = await loadGitProjectSettings(source as GitProjectResources, entries, agentDir, bound.sessionId);
    if (saved.paused || saved.optedOut || !saved.resolved.session.values.enabled) throw new Error("source disabled");
    return saved;
  };
  const authorizeChecks = async (source: Readonly<GitProjectResources>) => {
    const saved = await discover(source);
    const entries = readHumanGitSessionManager(bound).getEntries() as SessionEntry[];
    const caller = await assertManagedGitAction(bound.cwd, entries, "settings", "human", agentDir);
    if (caller.resolved.session.values.checkConfirmation === "disabled" ||
      caller.task.kind === "managed" && caller.task.settings.checkConfirmation === "disabled" ||
      saved.resolved.session.values.checkConfirmation === "disabled") throw new Error("checks disabled");
    await assertManagedGitProjectDenial(bound.cwd, { sessionId: bound.sessionId, sessionFile: bound.sessionFile, sessionCwd: bound.cwd }, "checks", agentDir);
    return saved;
  };
  return { sessionId: bound.sessionId, agentDir, receiptIds: [...receiptIds],
    isCheckExecutionAuthorized: async (source) => { await authorizeChecks(source); return true; },
    sourceGetPolicy: async (source) => {
      const state = await discover(source);
      return { policyRevision: state.revision, settings: { ...state.resolved.session.values,
        checks: sourceRecipes(state) }, savedProjectSettings: state.project };
    },
    isSelectionAuthorized: async (source) => { await discover(source); return true; },
    isTrusted: (root) => samePath(root, bootstrap.projectRoot) && getProjectTrustStatus(root, agentDir).trusted && getProjectTrustStatus(bound.cwd, agentDir).trusted,
    isCheckAuthorized: async (receipt) => {
      const state = await authorizeChecks(receipt.selection);
      const original = receiptBindings().get(receipt);
      return !!original && original.scope.sessionId === bound.sessionId && samePath(original.scope.sessionFile, bound.sessionFile) &&
        samePath(original.scope.cwd, bound.cwd) && readAuthorityRevisionSync() === original.revision &&
        sourceRecipes(state)[receipt.checkIndex]?.requiredStage === "commit";
    },
    readAuthorityRevisionSync,
  };
}
