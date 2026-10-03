import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gitExecEnv } from "./git-exec";
import { readGitWorkspaceNativeProof, type GitWorkspaceEvidence, type GitWorkspaceCompletedProof } from "./git-workspace-operation";
import type { GitCleanupEvidence, GitCleanupRemovalProof, GitCleanupCompletedProof } from "./git-cleanup-operation";
import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { selectGitProjectResources, revalidateGitProjectResources, registeredGitProjectCheckoutPaths,
  registeredGitProjectCheckoutPathsSync, parseBoundedGitWorktreePaths, type GitProjectResources } from "./git-project-resources";
import { readGitAction } from "./git-action-journal";
import { GIT_ACTION_ID_PATTERN, type GitActionKind, type GitActionResourceAttribution } from "./git-action-types";
import { samePath } from "./paths";
import { validLocalBranchName } from "./git-workflow-policy";

/**
 * Server-only conservative admission ledger for supervised Git operations. A reservation
 * is short-lived (never held through approval) but its intent survives crashes.
 * A chat/session is not a resource; a successful process exit is not proof of
 * child containment.
 *
 * The on-disk exclusive reservation survives a process crash. No PID/timeout
 * reaper, automatic reconciliation, manual-clear API, or executable replay.
 * A corrupt/unknown entry, unfinished intent, or orphan reservation denies
 * admission for THAT resource. Checksums guard corruption, not hostile same-user
 * writers; physical path selection/authorization belongs to the caller.
 * A relocated/replaced Git common dir can acquire another path key: callers
 * must revalidate pinned repository identity. Existing journal-only actions
 * are scanned separately before admitting a supervised operation.
 */
const MAX_ENTRIES = 1024;
const entryLimit = () => process.env.NODE_TEST_CONTEXT && process.env.PI_WEB_GIT_ADMISSION_TEST_LIMIT === "32" ? 32 : MAX_ENTRIES;
const MAX_DOCUMENT = 4096;
type GitOperationIntentKind = GitActionKind | "prepare" | "workspace" | "cleanup";
const KINDS: readonly GitOperationIntentKind[] = ["commit", "review", "checks", "integration", "prepare", "workspace", "cleanup"];
export type GitNativeEvidenceStage = "binding" | "removal" | "completed" | "failure";
/** Trusted native verifier's identity reader, never reconstructed from a payload. */
export type GitNativeProofReader = (handle: unknown) => unknown;
/** Process-only, identity-issued seal. Serialized copies never resolve an intent. */
export type GitNativeEvidenceSeal = Readonly<{ id: string; actionId: string; stage: GitNativeEvidenceStage; sha256: string }>;
type NativeArtifact = { version: 1; id: string; actionId: string; kind: "workspace" | "cleanup"; resource: string;
  stage: GitNativeEvidenceStage; bindingSha256: string | null; removalSha256: string | null; payload: unknown };
const MAX_NATIVE_DOCUMENT = 2 * 1024 * 1024;
// A low-level path-only reservation may quarantine, but cannot settle native
// mutations without the supervised physical inventory verifier's private seal.
const verifiedNativeInventorySeals = new WeakSet<object>();
type Phase = "intent" | "resolved";
/** Caller attests to a completed native preparation AND a verified final repository
 * state (including no operation markers). A preflight snapshot, planned OID,
 * exit code alone, failure or uncertain partial result is not this proof. The
 * ledger validates and preserves the assertion; it does not execute or verify Git. */
export type GitPrepareOutcomeProof = Readonly<{ version: 1; outcome: "completed";
  beforeOid: string; afterOid: string; resultTreeOid: string }>;
/** Digests keep arbitrary repo paths, branch names and ref output out of bounded ledger files. */
export type GitPairedCheckSnapshot = { version: 1; featurePath: string; targetPath: string;
  featureIdentity: string; targetIdentity: string; resourceIdentity: string;
  featureBranch: string; targetBranch: string; featureOid: string; targetOid: string;
  reviewDigest: string; policyDigest: string; checkDigest: string;
  featureIndex: string; targetIndex: string; featureStatus: string; targetStatus: string; refs: string };
// A later checkout capture has no merge review: it must never be mistaken for
// the original check snapshot or a verification receipt.
export type GitCheckRecoveryCurrentState = Omit<GitPairedCheckSnapshot, "reviewDigest">;
/** Independent verification: exactly one real selected checkout, never a fabricated pair.
 * Every field except the discriminator is a SHA-256 digest; recipe/environment values
 * and arbitrary repository data must not enter this durable bounded document. */
export type GitSelectedCheckSnapshot = { version: 2; checkoutPath: string; checkoutIdentity: string;
  resourceIdentity: string; branch: string; head: string; tree: string; index: string; status: string; refs: string;
  policyDigest: string; policyRevision: string; recipeDigest: string; checkDigest: string;
  cwdIdentity: string; environmentDigest: string; stageDigest: string };
/** Strict new working-workspace evidence. Never relabel v1/v2 or claim the
 * eventual candidate tree was tested. Digests bind actual content AND index. */
export type GitWorkingWorkspaceCheckSnapshot = Omit<GitSelectedCheckSnapshot, "version"> & {
  version: 3; evidenceScope: "working-workspace"; candidateTreeVerified: false; repositoryChecksWaived: false;
  workspaceManifestVersion: 2; workspaceContentDigest: string; workspaceIndexDigest: string;
  workspaceCoverage: "tracked-index-head-union-and-nonignored-physical-workspace";
  ignoredCachesCovered: false; externalInputsCovered: false;
  workspaceSummary: Readonly<{ paths: number; tracked: number; untracked: number; regularFiles: number; symlinks: number;
    absent: number; directories: number; totalBytes: number; indexBytes: number }>;
};
export type GitCheckSnapshot = GitPairedCheckSnapshot | GitSelectedCheckSnapshot | GitWorkingWorkspaceCheckSnapshot;
export type GitCheckCleanupProof = { unit: string; cgroupIdentity: string; invocation: string; empty: true;
  emptyEvidence: "pinned-populated-zero" | "verified-removed"; terminal: true;
  payload: "release-attempted" | "prevented-before-write" };
export type GitCheckOutcome = { status: number | null; timedOut: boolean; overflow: boolean;
  containmentComplete: boolean; logDigest: string; finishedAt: number };
type CheckPre = { version: 1; id: string; actionId: string; resource: string; unit: string; snapshot: GitCheckSnapshot };
type CheckPost = { version: 1; id: string; actionId: string; resource: string; unit: string;
  preSha256: string; snapshot: GitCheckSnapshot; cleanupProof: GitCheckCleanupProof; outcome: GitCheckOutcome;
  source: "linux-systemd" | "node-test-simulated" };
type Evidence = { version: 1; id: string; actionId: string; kind: GitOperationIntentKind; resource: string;
  phase: Phase; createdAt: number; resolvedAt?: number; checkUnit?: string; disposition?: "recovered";
  prepareOutcome?: GitPrepareOutcomeProof; nativeOutcomeSha256?: string };
/** Construct only on the server after an explicit human review of this exact check.
 * This is an assertion by the caller, not a substitute for repository/process revalidation. */
type CheckReviewIdentity = Readonly<{ id: string; actionId: string; resource: string; unit: string; proofIdentifier: string }>;
export type GitCheckHumanReviewReceipt =
  | (CheckReviewIdentity & Readonly<{ kind: "human-reviewed-git-check-recovery" }>)
  | (CheckReviewIdentity & Readonly<{ kind: "human-reviewed-git-check-recovery-moved";
      currentStateDigest: string; reviewedMovement: true }>);
export type GitOperationAdmission = { admitted: boolean; reason: "clear" | "unresolved" | "unavailable";
  /** Only validated action IDs, never executable authority. */ actionIds: readonly string[] };
export class GitOperationRecoveryError extends Error {
  readonly recoveryRequired = true;
  constructor(readonly actionId?: string) {
    super(`Git operation admission requires manual recovery${actionId ? ` (action ${actionId})` : ""}; inspect the checkout and durable action history. Do not retry.`);
  }
}
export interface GitOperationReservation {
  readonly actionId: string;
  readonly id: string;
  /** Call only after independent evidence proves the effect AND any child processes are finished.
   * Do not call on a rejected/aborted check or an uncertain Git update.
   * Preparation requires the caller's positively verified actual outcome; read-only
   * preflight and an uncertain/partial operation must remain quarantined. */
  resolve(proof?: GitPrepareOutcomeProof): void;
  /** Recheck durable reservation and intent inside the final native apply gate. */
  assertOwned(): void;
  /** Immutable recovery artifacts only; neither method releases quarantine. */
  /** Trusted native callback only. Publication is immutable and does NOT release.
   * Workspace completion authenticates the leaf's private proof identity. */
  recordNativeEvidence(stage: GitNativeEvidenceStage, payload: unknown, nativeReader?: GitNativeProofReader): GitNativeEvidenceSeal;
  /** Only THIS live reservation's identity-issued completed seal can settle it. */
  resolveNativeOutcome(seal: GitNativeEvidenceSeal): void;
  recordCheckBefore(snapshot: GitCheckSnapshot): void;
  recordCheckAfter(snapshot: GitCheckSnapshot, proof: GitCheckCleanupProof, outcome: GitCheckOutcome,
    source: "linux-systemd" | "node-test-simulated"): void;
}
export type GitOperationReservationOwner = Readonly<{ id: string; actionId: string; kind: GitOperationIntentKind; agentDir: string;
  selection: Readonly<GitProjectResources> }>;
const reservationOwners = new WeakMap<object, { owner: GitOperationReservationOwner; assertOwned: () => void; agentDir: string }>();
function freezeOwner<T>(value: T): T {
  if (value && typeof value === "object") { for (const item of Object.values(value)) freezeOwner(item); Object.freeze(value); }
  return value;
}
function issueReservationOwner(op: GitOperationReservation, selection: GitProjectResources, kind: GitOperationIntentKind, agentDir: string) {
  reservationOwners.set(op, { owner: freezeOwner({ id: op.id, actionId: op.actionId, kind, agentDir, selection: structuredClone(selection) }),
    assertOwned: op.assertOwned, agentDir });
  return op;
}
/** Narrow identity reader for the native protected commit boundary. No grant,
 * action-ID lookup or structural assertOwned interface. Keep the SAME held owner.
 * Directory/marker replacement, another intent, corruption and resolution deny. */
export function readGitOperationReservationOwner(handle: unknown): GitOperationReservationOwner | undefined {
  if (!handle || typeof handle !== "object") return undefined;
  const saved = reservationOwners.get(handle); if (!saved) return undefined;
  try {
    saved.assertOwned();
    const r = saved.owner.selection;
    for (const [dir, expected] of [[r.projectRoot, r.identities.project], [r.cwd, r.identities.checkout],
      [r.commonDir, r.identities.common], [r.gitDir, r.identities.git]] as const) {
      const s = fs.lstatSync(dir, { bigint: true });
      if (!s.isDirectory() || s.isSymbolicLink() || fs.realpathSync(dir) !== dir ||
        JSON.stringify({ device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) }) !== JSON.stringify(expected)) return undefined;
    }
    const marker = fs.lstatSync(path.join(r.cwd, ".git"), { bigint: true });
    if (marker.isSymbolicLink() || (!marker.isDirectory() && !marker.isFile()) ||
      JSON.stringify({ device: String(marker.dev), inode: String(marker.ino), birthtime: String(marker.birthtimeNs),
        ...(marker.isFile() ? { changed: String(marker.ctimeNs), size: String(marker.size) } : {}) }) !== JSON.stringify(r.identities.marker)) return undefined;
    const status = inspectGitOperationAdmission(saved.agentDir, r.commonDir);
    if (status.reason !== "unresolved" || status.actionIds.length !== 1 || status.actionIds[0] !== saved.owner.actionId) return undefined;
    return saved.owner;
  } catch { return undefined; }
}
function deny(): never { throw new Error("Git operation admission unavailable; inspect the resource ledger manually"); }
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const CHECK_UNIT = /^pi-web-git-check-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.service$/;
const HASH = /^[a-f0-9]{64}$/;
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function validPrepareOutcome(value: unknown): value is GitPrepareOutcomeProof {
  return keys(value, ["version", "outcome", "beforeOid", "afterOid", "resultTreeOid"]) &&
    value.version === 1 && value.outcome === "completed" && OID.test(value.beforeOid as string) &&
    OID.test(value.afterOid as string) && OID.test(value.resultTreeOid as string) &&
    (value.beforeOid as string).length === (value.afterOid as string).length &&
    (value.afterOid as string).length === (value.resultTreeOid as string).length;
}
const INVOCATION = /^[a-fA-F0-9]{32}$/;
const SNAPSHOT_KEYS = ["version", "featurePath", "targetPath", "featureIdentity", "targetIdentity", "resourceIdentity",
  "featureBranch", "targetBranch", "featureOid", "targetOid", "reviewDigest", "policyDigest", "checkDigest",
  "featureIndex", "targetIndex", "featureStatus", "targetStatus", "refs"];
const CURRENT_STATE_KEYS = SNAPSHOT_KEYS.filter((key) => key !== "reviewDigest");
const SELECTED_SNAPSHOT_KEYS = ["version", "checkoutPath", "checkoutIdentity", "resourceIdentity",
  "branch", "head", "tree", "index", "status", "refs", "policyDigest", "policyRevision", "recipeDigest",
  "checkDigest", "cwdIdentity", "environmentDigest", "stageDigest"];
const WORKING_SNAPSHOT_KEYS = [...SELECTED_SNAPSHOT_KEYS, "evidenceScope", "candidateTreeVerified", "repositoryChecksWaived",
  "workspaceManifestVersion", "workspaceContentDigest", "workspaceIndexDigest", "workspaceCoverage", "ignoredCachesCovered", "externalInputsCovered", "workspaceSummary"];
const WORKING_SUMMARY_KEYS = ["paths", "tracked", "untracked", "regularFiles", "symlinks", "absent", "directories", "totalBytes", "indexBytes"];
function validWorkingSummary(value: unknown): boolean {
  if (!keys(value, WORKING_SUMMARY_KEYS) || !Object.values(value).every((v) => Number.isSafeInteger(v) && (v as number) >= 0)) return false;
  const s = value as GitWorkingWorkspaceCheckSnapshot["workspaceSummary"];
  return s.paths <= 20000 && s.directories <= 1024 && s.totalBytes <= 128 * 1024 * 1024 && s.indexBytes <= 16 * 1024 * 1024 &&
    s.tracked + s.untracked === s.paths && s.regularFiles + s.symlinks + s.absent + s.directories === s.paths;
}
function validSnapshot(value: unknown): value is GitCheckSnapshot {
  // Keep v1 validation and serialization unchanged. Strict alternatives refuse
  // mixed snapshots, unknown fields and version relabelling, even with valid hashes.
  return keys(value, SNAPSHOT_KEYS) && value.version === 1 &&
    SNAPSHOT_KEYS.slice(1).every((key) => HASH.test(value[key] as string)) ||
    keys(value, SELECTED_SNAPSHOT_KEYS) && value.version === 2 &&
    SELECTED_SNAPSHOT_KEYS.slice(1).every((key) => HASH.test(value[key] as string)) ||
    keys(value, WORKING_SNAPSHOT_KEYS) && value.version === 3 &&
    SELECTED_SNAPSHOT_KEYS.slice(1).every((key) => HASH.test(value[key] as string)) && value.stageDigest === sha("commit") &&
    value.evidenceScope === "working-workspace" && value.candidateTreeVerified === false && value.repositoryChecksWaived === false &&
    value.workspaceManifestVersion === 2 && HASH.test(value.workspaceContentDigest as string) && HASH.test(value.workspaceIndexDigest as string) &&
    value.workspaceCoverage === "tracked-index-head-union-and-nonignored-physical-workspace" && value.ignoredCachesCovered === false &&
    value.externalInputsCovered === false && validWorkingSummary(value.workspaceSummary);
}
function validCurrentState(value: unknown): value is GitCheckRecoveryCurrentState {
  return keys(value, CURRENT_STATE_KEYS) && value.version === 1 &&
    CURRENT_STATE_KEYS.slice(1).every((key) => HASH.test(value[key] as string));
}
function validProof(value: unknown, unit: string): value is GitCheckCleanupProof {
  return keys(value, ["unit", "cgroupIdentity", "invocation", "empty", "emptyEvidence", "terminal", "payload"]) &&
    value.unit === unit && INVOCATION.test(value.invocation as string) && value.empty === true && value.terminal === true &&
    ["pinned-populated-zero", "verified-removed"].includes(value.emptyEvidence as string) &&
    ["release-attempted", "prevented-before-write"].includes(value.payload as string) &&
    typeof value.cgroupIdentity === "string" && value.cgroupIdentity.length <= 2048 &&
    /^(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*):[a-fA-F0-9]{32}:\/(?:[^/\x00-\x1f]+\/)*[^/\x00-\x1f]+$/.test(value.cgroupIdentity) &&
    value.cgroupIdentity.split(":")[2] === value.invocation;
}
function validOutcome(value: unknown): value is GitCheckOutcome {
  return keys(value, ["status", "timedOut", "overflow", "containmentComplete", "logDigest", "finishedAt"]) &&
    (value.status === null || Number.isSafeInteger(value.status) && (value.status as number) >= 0 && (value.status as number) <= 255) &&
    typeof value.timedOut === "boolean" && typeof value.overflow === "boolean" &&
    typeof value.containmentComplete === "boolean" && HASH.test(value.logDigest as string) &&
    Number.isSafeInteger(value.finishedAt) && (value.finishedAt as number) >= 0;
}
function keys(value: unknown, names: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === names.length && names.every((key) => Object.hasOwn(value, key));
}
function uuid(value: unknown): value is string { return typeof value === "string" && GIT_ACTION_ID_PATTERN.test(value); }
function physicalDirectory(dir: string): fs.Stats {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) deny();
  return stat;
}
function directory(dir: string): void {
  const stat = physicalDirectory(dir);
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) deny();
}
function syncDir(dir: string): void {
  if (process.platform === "win32") return;
  const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function resourceKey(commonDir: string): string {
  if (typeof commonDir !== "string" || !path.isAbsolute(commonDir) || commonDir.length > 4096 || commonDir.includes("\0")
    || path.resolve(commonDir) !== commonDir || fs.realpathSync(commonDir) !== commonDir) deny();
  // Git common dirs are often 0755; only the private ledger must be 0700.
  physicalDirectory(commonDir);
  return sha(commonDir);
}
function locations(agentDir: string, commonDir: string) {
  if (typeof agentDir !== "string" || !path.isAbsolute(agentDir) || agentDir.length > 4096 || agentDir.includes("\0")
    || path.resolve(agentDir) !== agentDir) deny();
  if (fs.realpathSync(agentDir) !== agentDir) deny();
  const key = resourceKey(commonDir);
  const folders = [agentDir, path.join(agentDir, "pi-web"), path.join(agentDir, "pi-web", "git-operation-admission"),
    path.join(agentDir, "pi-web", "git-operation-admission", "v1")];
  const dir = path.join(folders[3], key);
  return { folders, dir, gate: path.join(dir, "reservation") };
}
function present(dir: string): boolean {
  try { directory(dir); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
function makeDir(dir: string): void {
  try { fs.mkdirSync(dir, { mode: 0o700 }); syncDir(path.dirname(dir)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  directory(dir);
}
function readFile(file: string, limit = MAX_DOCUMENT): Buffer {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > limit
    || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) deny();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const current = fs.fstatSync(fd);
    if (current.ino !== stat.ino || current.dev !== stat.dev || current.size !== stat.size) deny();
    const data = Buffer.alloc(stat.size + 1);
    let count = 0;
    while (count < data.length) { const n = fs.readSync(fd, data, count, data.length - count, count); if (!n) break; count += n; }
    const after = fs.fstatSync(fd);
    if (count !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) deny();
    return data.subarray(0, count);
  } finally { fs.closeSync(fd); }
}
function encode(record: Evidence): string {
  const body = JSON.stringify(record);
  const data = JSON.stringify({ version: 1, record, sha256: sha(body) });
  if (Buffer.byteLength(data) > MAX_DOCUMENT) deny();
  return data;
}
function load(file: string, resource: string, id: string): Evidence {
  const bytes = readFile(file);
  const outer: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!keys(outer, ["version", "record", "sha256"]) || outer.version !== 1 || typeof outer.sha256 !== "string") deny();
  const value = outer.record;
  if (!keys(value, ["version", "id", "actionId", "kind", "resource", "phase", "createdAt",
    ...(typeof (value as Record<string, unknown>)?.resolvedAt === "number" ? ["resolvedAt"] : []),
    ...(typeof (value as Record<string, unknown>)?.checkUnit === "string" ? ["checkUnit"] : []),
    ...(Object.hasOwn(value as object, "disposition") ? ["disposition"] : []),
    ...(Object.hasOwn(value as object, "prepareOutcome") ? ["prepareOutcome"] : []),
    ...(Object.hasOwn(value as object, "nativeOutcomeSha256") ? ["nativeOutcomeSha256"] : [])]) ||
    value.version !== 1 || value.id !== id || !uuid(value.actionId) || !KINDS.includes(value.kind as GitOperationIntentKind) ||
    value.resource !== resource || !["intent", "resolved"].includes(value.phase as string) ||
    (value.kind === "checks" ? !CHECK_UNIT.test(value.checkUnit as string) : Object.hasOwn(value, "checkUnit")) ||
    !Number.isSafeInteger(value.createdAt) || (value.createdAt as number) < 0 ||
    (value.phase === "intent" && Object.hasOwn(value, "resolvedAt")) ||
    (value.phase === "resolved" && (!Number.isSafeInteger(value.resolvedAt) || (value.resolvedAt as number) < (value.createdAt as number))) ||
    (Object.hasOwn(value, "disposition") && (value.disposition !== "recovered" || value.phase !== "resolved" || value.kind !== "checks")) ||
    (value.kind === "prepare" && value.phase === "resolved" ? !validPrepareOutcome(value.prepareOutcome) :
      Object.hasOwn(value, "prepareOutcome")) ||
    (["workspace", "cleanup"].includes(value.kind as string) && value.phase === "resolved" ? !HASH.test(value.nativeOutcomeSha256 as string) :
      Object.hasOwn(value, "nativeOutcomeSha256")) ||
    outer.sha256 !== sha(JSON.stringify(value)) || !bytes.equals(Buffer.from(encode(value as Evidence)))) deny();
  return value as unknown as Evidence;
}
function nativeKind(record: Evidence): record is Evidence & { kind: "workspace" | "cleanup" } {
  return record.kind === "workspace" || record.kind === "cleanup";
}
function nativeObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
function validIdentity(value: unknown): boolean {
  return keys(value, ["device", "inode", "birthtime"]) && Object.values(value).every((v) => typeof v === "string" && /^[0-9]{1,30}$/.test(v));
}
function validResource(value: unknown, common: string): value is GitProjectResources {
  if (!keys(value, ["projectRoot", "cwd", "branch", "commonDir", "gitDir", "identities"]) || value.commonDir !== common ||
    ![value.projectRoot, value.cwd, value.commonDir, value.gitDir].every((v) => typeof v === "string" && path.isAbsolute(v) &&
      path.resolve(v) === v && v.length <= 4096 && !/[\x00-\x1f\x7f]/.test(v)) ||
    !validLocalBranchName(value.branch) ||
    !keys(value.identities, ["project", "checkout", "common", "git", "marker"])) return false;
  const ids = value.identities;
  return [ids.project, ids.checkout, ids.common, ids.git].every(validIdentity) && nativeObject(ids.marker) &&
    keys(ids.marker, ["device", "inode", "birthtime", ...(Object.hasOwn(ids.marker, "changed") ? ["changed", "size"] : [])]) &&
    Object.values(ids.marker).every((v) => typeof v === "string" && /^[0-9]{1,30}$/.test(v));
}
function validNativeInventory(value: unknown, cleanup: boolean): boolean {
  if (!keys(value, cleanup ? ["refs", "registrations", "admins", "checkouts"] : ["refs", "registrations", "checkouts"]) ||
    typeof value.refs !== "string" || Buffer.byteLength(value.refs) > 512 * 1024 || value.refs.split("\n").length > 2001 ||
    typeof value.registrations !== "string" || !nativeObject(value.checkouts)) return false;
  const refRows = value.refs.split("\n");
  if (refRows.pop() !== "" || refRows.some((row) => !/^refs\/[^\x00-\x20\x7f]+\0(?:[a-f0-9]{40}|[a-f0-9]{64})\0(?:refs\/[^\x00-\x20\x7f]+)?$/.test(row)) ||
    new Set(refRows.map((row) => row.split("\0")[0])).size !== refRows.length) return false;
  const paths = parseBoundedGitWorktreePaths(Buffer.from(value.registrations));
  if (JSON.stringify(Object.keys(value.checkouts)) !== JSON.stringify(paths) || !Object.values(value.checkouts).every(validIdentity)) return false;
  return !cleanup || nativeObject(value.admins) && Object.keys(value.admins).length <= 256 &&
    Object.entries(value.admins).every(([key, digest]) => key.length <= 4096 && !/[\/\x00-\x1f\x7f]/.test(key) && HASH.test(digest as string));
}
function validWorkspaceSnapshot(value: unknown, r: GitProjectResources): boolean {
  return keys(value, ["ref", "oid", "indexDigest", "headDigest", "indexIdentity", "headIdentity", "trackedFilesDigest", "configDigest"]) &&
    value.ref === `refs/heads/${r.branch}` && OID.test(value.oid as string) &&
    [value.indexDigest, value.headDigest, value.trackedFilesDigest, value.configDigest].every((v) => HASH.test(v as string)) &&
    validIdentity(value.indexIdentity) && validIdentity(value.headIdentity);
}
function validWorkspaceRequest(e: GitWorkspaceEvidence): boolean {
  const r = e.request;
  return keys(r, ["repositoryPath", "sourceCheckoutPath", "destinationPath", "branch", "baseBranch", "expectedBaseOid", "mode",
    ...(r?.mode === "attach" ? ["expectedTipOid"] : [])]) && ["create", "attach"].includes(r.mode) &&
    r.repositoryPath === e.source.projectRoot && r.sourceCheckoutPath === e.source.cwd &&
    typeof r.destinationPath === "string" && path.isAbsolute(r.destinationPath) && path.resolve(r.destinationPath) === r.destinationPath &&
    r.destinationPath.length <= 4096 && !/[\x00-\x1f\x7f]/.test(r.destinationPath) && validLocalBranchName(r.branch) && validLocalBranchName(r.baseBranch) &&
    OID.test(r.expectedBaseOid) && e.resultOid === (r.mode === "create" ? r.expectedBaseOid : r.expectedTipOid) &&
    (r.mode !== "attach" || OID.test(r.expectedTipOid)) && validWorkspaceSnapshot(e.sourceSnapshot, e.source) &&
    (!e.baseCheckout || validWorkspaceSnapshot(e.baseSnapshot, e.baseCheckout)) &&
    (e.parentIdentity ? validIdentity(e.parentIdentity) : !!e.parentCreation &&
      keys(e.parentCreation, ["path", "expectedAbsent", "ancestorPath", "ancestorIdentity", "mode"]) &&
      e.parentCreation.path === path.dirname(r.destinationPath) && e.parentCreation.path === `${e.source.projectRoot}-worktrees` &&
      e.parentCreation.expectedAbsent === true && e.parentCreation.mode === 0o700 &&
      e.parentCreation.ancestorPath === path.dirname(e.source.projectRoot) && validIdentity(e.parentCreation.ancestorIdentity));
}
function workspaceBinding(payload: unknown): { evidence: GitWorkspaceEvidence; checkouts: Record<string, GitProjectResources["identities"]["checkout"]> } {
  if (!keys(payload, ["evidence", "checkouts"]) || !nativeObject(payload.evidence)) deny();
  return payload as unknown as ReturnType<typeof workspaceBinding>;
}
function encodeNative(record: NativeArtifact): string {
  const data = JSON.stringify({ version: 1, record, sha256: sha(JSON.stringify(record)) });
  if (Buffer.byteLength(data) > MAX_NATIVE_DOCUMENT) deny();
  return data;
}
function publishNative(file: string, data: string): void {
  const temp = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, data, { flag: "wx", mode: 0o600, flush: true }); fs.linkSync(temp, file);
    fs.unlinkSync(temp); syncDir(path.dirname(file));
  } finally { try { fs.unlinkSync(temp); } catch { /* published immutable evidence remains */ } }
}
function loadNative(file: string, intent: Evidence, stage: GitNativeEvidenceStage): NativeArtifact {
  const bytes = readFile(file, MAX_NATIVE_DOCUMENT), outer: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!keys(outer, ["version", "record", "sha256"]) || outer.version !== 1 ||
    !keys(outer.record, ["version", "id", "actionId", "kind", "resource", "stage", "bindingSha256", "removalSha256", "payload"])) deny();
  const r = outer.record;
  if (!nativeKind(intent) || r.version !== 1 || r.id !== intent.id || r.actionId !== intent.actionId || r.kind !== intent.kind ||
    r.resource !== intent.resource || r.stage !== stage || !["binding", "removal", "completed", "failure"].includes(stage) ||
    outer.sha256 !== sha(JSON.stringify(r)) || !bytes.equals(Buffer.from(encodeNative(r as NativeArtifact)))) deny();
  return r as NativeArtifact;
}
function validateNativeLinks(dir: string, intent: Evidence, record: NativeArtifact): void {
  if (!nativeKind(intent) || record.kind !== intent.kind || !nativeObject(record.payload)) deny();
  const p = record.payload;
  if (record.stage === "binding") {
    if (record.bindingSha256 !== null || record.removalSha256 !== null) deny();
    if (intent.kind === "workspace") {
      const { evidence: e, checkouts } = workspaceBinding(p);
      if (!keys(e, ["version", "actionId", "request", "source", "sourceSnapshot", "refs", "registrations", "resultOid", "treeOid",
        ...(e.baseCheckout ? ["baseCheckout", "baseSnapshot"] : []), ...(e.parentIdentity ? ["parentIdentity"] : []),
        ...(e.parentCreation ? ["parentCreation"] : [])]) || e.version !== 1 || e.actionId !== intent.actionId ||
        !validResource(e.source, intent.resource) || e.baseCheckout && !validResource(e.baseCheckout, intent.resource) ||
        (!!e.parentIdentity === !!e.parentCreation) || !OID.test(e.resultOid) || !OID.test(e.treeOid) || !validWorkspaceRequest(e) ||
        !validNativeInventory({ refs: e.refs, registrations: e.registrations, checkouts }, false)) deny();
    } else {
      const e = p as unknown as GitCleanupEvidence;
      if (!keys(e, ["version", "actionId", "integration", "creator", "main", "source", "target", "mainSnapshot", "inventory", "sharedStorageDigest"]) ||
        e.version !== 1 || e.actionId !== intent.actionId || !e.integration || !e.creator ||
        !validResource(e.integration.feature, intent.resource) || !validResource(e.integration.target, intent.resource) ||
        !validResource(e.main, intent.resource) || !validNativeInventory(e.inventory, true) || !HASH.test(e.sharedStorageDigest)) deny();
    }
    return;
  }
  const bindingBytes = readFile(path.join(dir, `${intent.id}.binding`), MAX_NATIVE_DOCUMENT);
  if (record.bindingSha256 !== sha(bindingBytes)) deny();
  const binding = loadNative(path.join(dir, `${intent.id}.binding`), intent, "binding"); validateNativeLinks(dir, intent, binding);
  if (record.stage === "failure") {
    if (p.version !== 1 || p.actionId !== intent.actionId || p.recoveryRequired !== true || record.removalSha256 !== null) deny();
    return;
  }
  if (intent.kind === "workspace") {
    const { evidence: e } = workspaceBinding(binding.payload), proof = p as unknown as GitWorkspaceCompletedProof;
    if (record.stage !== "completed" || record.removalSha256 !== null ||
      !keys(p, ["version", "outcome", "actionId", "mode", "destination", "sourceOid", "baseOid", "branchRef", "resultOid", "treeOid",
        "sourceIndexDigest", "destinationIndexDigest", "sourceTrackedFilesDigest", "destinationTrackedFilesDigest", "configDigest", "refsDigest",
        "registrationsDigest", "backlinkDigest", "status", ...(proof.knownParentCreation ? ["knownParentCreation"] : [])]) ||
      proof.version !== 1 || proof.actionId !== intent.actionId || proof.outcome !== "completed" || proof.status !== "clean" ||
      proof.mode !== e.request.mode || proof.sourceOid !== e.sourceSnapshot.oid || proof.baseOid !== e.request.expectedBaseOid ||
      proof.resultOid !== e.resultOid || proof.treeOid !== e.treeOid || proof.branchRef !== `refs/heads/${e.request.branch}` ||
      !validResource(proof.destination, intent.resource) || proof.destination.cwd !== e.request.destinationPath ||
      proof.destination.branch !== e.request.branch || proof.sourceIndexDigest !== e.sourceSnapshot.indexDigest ||
      proof.sourceTrackedFilesDigest !== e.sourceSnapshot.trackedFilesDigest || proof.configDigest !== e.sourceSnapshot.configDigest ||
      [proof.destinationIndexDigest, proof.destinationTrackedFilesDigest, proof.refsDigest, proof.registrationsDigest, proof.backlinkDigest].some((v) => !HASH.test(v)) ||
      (!!e.parentCreation !== !!proof.knownParentCreation)) deny();
    if (e.parentCreation) {
      const known = proof.knownParentCreation!, plan = e.parentCreation;
      if (!keys(known, ["path", "identity", "mode", "ownerUid", "ancestorPath", "ancestorIdentity"]) || known.path !== plan.path ||
        !validIdentity(known.identity) || known.mode !== plan.mode || !Number.isSafeInteger(known.ownerUid) || known.ownerUid < 0 ||
        known.ancestorPath !== plan.ancestorPath || JSON.stringify(known.ancestorIdentity) !== JSON.stringify(plan.ancestorIdentity)) deny();
    }
    return;
  }
  const e = binding.payload as GitCleanupEvidence, source = e.integration.feature;
  const removed = nativeRemovedInventory(e);
  const removal = (record.stage === "removal" ? p : loadNative(path.join(dir, `${intent.id}.removal`), intent, "removal").payload) as GitCleanupRemovalProof;
  if (!keys(removal, ["version", "actionId", "kind", "sourcePath", "sourceIdentity", "adminPath", "featureOid", "exit", "sourceAbsent", "adminAbsent", "before", "after"]) ||
    removal.version !== 1 || removal.actionId !== intent.actionId || removal.kind !== "removed" || removal.sourcePath !== source.cwd ||
    JSON.stringify(removal.sourceIdentity) !== JSON.stringify(source.identities.checkout) || removal.adminPath !== source.gitDir ||
    removal.featureOid !== e.integration.featureOid || removal.exit !== 0 || removal.sourceAbsent !== true || removal.adminAbsent !== true ||
    JSON.stringify(removal.before) !== JSON.stringify(e.inventory) || JSON.stringify(removal.after) !== JSON.stringify(removed)) deny();
  if (record.stage === "removal") { if (record.removalSha256 !== null) deny(); return; }
  const completed = p as unknown as GitCleanupCompletedProof;
  const removalBytes = readFile(path.join(dir, `${intent.id}.removal`), MAX_NATIVE_DOCUMENT);
  if (record.stage !== "completed" || record.removalSha256 !== sha(removalBytes) ||
    !keys(p, ["version", "actionId", "kind", "removal", "deletedRef", "deletedOid", "transactionExit", "finalInventory", "nativeHeadReflogMayHaveChanged"]) ||
    completed.version !== 1 || completed.actionId !== intent.actionId || completed.kind !== "completed" ||
    JSON.stringify(completed.removal) !== JSON.stringify(removal) || completed.deletedRef !== `refs/heads/${source.branch}` ||
    completed.deletedOid !== e.integration.featureOid || completed.transactionExit !== 0 || completed.nativeHeadReflogMayHaveChanged !== true ||
    JSON.stringify(completed.finalInventory) !== JSON.stringify(nativeCompletedInventory(e))) deny();
}
function nativeRemovedInventory(e: GitCleanupEvidence) {
  const s = e.integration.feature, rows = e.inventory.registrations.slice(0, -2).split("\0\0"), own = `worktree ${s.cwd}\0HEAD ${e.integration.featureOid}\0branch refs/heads/${s.branch}`;
  if (rows.filter((row) => row === own).length !== 1 || rows.some((row) => row !== own && row.split("\0").includes(`branch refs/heads/${s.branch}`)) ||
    path.dirname(s.gitDir) !== path.join(s.commonDir, "worktrees") || s.cwd === s.projectRoot) deny();
  const admins = { ...e.inventory.admins }, checkouts = { ...e.inventory.checkouts };
  if (!Object.hasOwn(admins, path.basename(s.gitDir)) || JSON.stringify(checkouts[s.cwd]) !== JSON.stringify(s.identities.checkout)) deny();
  delete admins[path.basename(s.gitDir)]; delete checkouts[s.cwd];
  return { refs: e.inventory.refs, registrations: rows.filter((row) => row !== own).join("\0\0") + "\0\0", admins, checkouts };
}
function nativeCompletedInventory(e: GitCleanupEvidence) {
  const result = nativeRemovedInventory(e);
  result.refs = result.refs.split("\n").filter((row) => !row.startsWith(`refs/heads/${e.integration.feature.branch}\0`)).join("\n");
  return result;
}
function nativeInventory(selection: GitProjectResources) {
  const paths = registeredGitProjectCheckoutPathsSync(selection);
  const git = (...args: string[]) => execFileSync("git", ["--no-optional-locks", "-C", selection.cwd,
    `--git-dir=${selection.gitDir}`, `--work-tree=${selection.cwd}`, ...args], {
    encoding: "utf8", env: { ...gitExecEnv(), GIT_COMMON_DIR: selection.commonDir }, timeout: 15000, maxBuffer: 512 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  const refs = git("for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)", "refs"), registrations = git("worktree", "list", "--porcelain", "-z");
  if (JSON.stringify(parseBoundedGitWorktreePaths(Buffer.from(registrations))) !== JSON.stringify(paths)) deny();
  const checkouts = Object.fromEntries(paths.map((cwd) => {
    const s = fs.lstatSync(cwd, { bigint: true });
    return [cwd, { device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) }];
  }));
  const result = { refs, registrations, checkouts }; if (!validNativeInventory(result, false)) deny(); return result;
}
/** No inventory waiver. ONLY durable, linked, measured native transition can
 * replace the exact original inventory. Cleanup remains pinned to surviving target. */
function nativeInventoryReservation(selection: GitProjectResources, op: GitOperationReservation): GitOperationReservation {
  let expected = nativeInventory(selection), binding: unknown, removalRecorded = false;
  const assertOwned = () => { op.assertOwned(); if (JSON.stringify(nativeInventory(selection)) !== JSON.stringify(expected)) deny(); };
  return { ...op, assertOwned,
    resolve() { assertOwned(); deny(); },
    recordNativeEvidence(stage, payload, nativeReader) {
      if (stage === "failure") return op.recordNativeEvidence(stage, payload);
      op.assertOwned();
      const current = nativeInventory(selection);
      if (stage === "binding") {
        assertOwned();
        const e = (nativeObject(payload) && Object.hasOwn(payload, "evidence") ? workspaceBinding(payload).evidence : payload) as GitWorkspaceEvidence | GitCleanupEvidence;
        const r = "integration" in e ? e.integration.target : e.source;
        const inventory = "integration" in e ? e.inventory : { refs: e.refs, registrations: e.registrations, checkouts: workspaceBinding(payload).checkouts };
        if (JSON.stringify(r) !== JSON.stringify(selection) || JSON.stringify({ refs: inventory.refs, registrations: inventory.registrations, checkouts: inventory.checkouts }) !== JSON.stringify(expected)) deny();
      } else {
        if (!binding) deny();
        if (nativeObject(binding) && Object.hasOwn(binding, "evidence")) {
          const { evidence: e } = workspaceBinding(binding), p = payload as GitWorkspaceCompletedProof;
          if (stage !== "completed" || !readGitWorkspaceNativeProof(p)) deny();
          const rows = expected.registrations.slice(0, -2).split("\0\0");
          const added = `worktree ${e.request.destinationPath}\0HEAD ${e.resultOid}\0branch refs/heads/${e.request.branch}`;
          const refs = e.refs.trimEnd().split("\n").filter(Boolean);
          if (e.request.mode === "create") refs.push(`refs/heads/${e.request.branch}\0${e.resultOid}\0`);
          const oldCheckouts = { ...current.checkouts }; delete oldCheckouts[e.request.destinationPath];
          if (JSON.stringify(oldCheckouts) !== JSON.stringify(expected.checkouts) ||
            JSON.stringify(current.registrations.slice(0, -2).split("\0\0").sort()) !== JSON.stringify([...rows, added].sort()) ||
            JSON.stringify(current.refs.trimEnd().split("\n").filter(Boolean).sort()) !== JSON.stringify(refs.sort()) ||
            p.refsDigest !== sha(current.refs) || p.registrationsDigest !== sha(current.registrations) ||
            JSON.stringify(current.checkouts[e.request.destinationPath]) !== JSON.stringify(p.destination.identities.checkout)) deny();
        } else {
          const e = binding as GitCleanupEvidence, wanted = stage === "removal" && !removalRecorded ? nativeRemovedInventory(e) :
            stage === "completed" && removalRecorded ? nativeCompletedInventory(e) : undefined;
          if (!wanted || JSON.stringify(current) !== JSON.stringify({ refs: wanted.refs, registrations: wanted.registrations, checkouts: wanted.checkouts })) deny();
        }
      }
      const seal = op.recordNativeEvidence(stage, payload, nativeReader);
      // Original inventory remains mandatory until immutable publication+fsync succeeds.
      if (stage === "binding") binding = structuredClone(payload);
      else { expected = current; if (stage === "removal") removalRecorded = true; }
      if (stage === "completed") verifiedNativeInventorySeals.add(seal);
      return seal;
    },
    resolveNativeOutcome(seal) { assertOwned(); op.resolveNativeOutcome(seal); },
  };
}
function encodeCheck(record: CheckPre | CheckPost): string {
  const body = JSON.stringify(record);
  const data = JSON.stringify({ version: 1, record, sha256: sha(body) });
  if (Buffer.byteLength(data) > MAX_DOCUMENT) deny();
  return data;
}
/** Preflight the exact on-disk envelope size before reserving the checkout. */
export function assertGitCheckRecoverySnapshotCapacity(resource: string, actionId: string, unit: string,
  snapshot: GitCheckSnapshot): void {
  if (!path.isAbsolute(resource) || resource.length > 4096 || !uuid(actionId) || !CHECK_UNIT.test(unit) ||
    !validSnapshot(snapshot)) deny();
  encodeCheck({ version: 1, id: "00000000-0000-0000-0000-000000000000", actionId, resource, unit, snapshot });
}
function loadCheck(file: string, intent: Evidence, stage: "pre" | "post"): CheckPre | CheckPost {
  const bytes = readFile(file);
  const outer: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!keys(outer, ["version", "record", "sha256"]) || outer.version !== 1 || typeof outer.sha256 !== "string") deny();
  const value = outer.record;
  const common = ["version", "id", "actionId", "resource", "unit", "snapshot"];
  if (!keys(value, stage === "pre" ? common : [...common, "preSha256", "cleanupProof", "outcome", "source"]) ||
    value.version !== 1 || value.id !== intent.id || value.actionId !== intent.actionId ||
    value.resource !== intent.resource || value.unit !== intent.checkUnit || !validSnapshot(value.snapshot) ||
    (stage === "post" && (!HASH.test(value.preSha256 as string) || !validProof(value.cleanupProof, intent.checkUnit!) ||
      !validOutcome(value.outcome) || !["linux-systemd", "node-test-simulated"].includes(value.source as string))) || outer.sha256 !== sha(JSON.stringify(value)) ||
    !bytes.equals(Buffer.from(encodeCheck(value as CheckPre)))) deny();
  return value as CheckPre | CheckPost;
}
function recoverablePost(post: CheckPost, before: GitCheckSnapshot): boolean {
  return (post.source === "linux-systemd" || post.source === "node-test-simulated" && !!process.env.NODE_TEST_CONTEXT) &&
    // Aborted/timed-out checks can have a positively proven empty, terminal
    // original pinned unit while the execution outcome remains incomplete.
    (post.outcome.status !== 0 || post.outcome.timedOut || post.outcome.overflow) &&
    JSON.stringify(before) === JSON.stringify(post.snapshot);
}
function writeCheck(file: string, record: CheckPre | CheckPost): void {
  const temp = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, encodeCheck(record), { flag: "wx", mode: 0o600, flush: true });
    fs.linkSync(temp, file); // immutable publication; never replace an existing proof
    fs.unlinkSync(temp);
    syncDir(path.dirname(file));
  } finally { try { fs.unlinkSync(temp); } catch { /* published evidence remains */ } }
}
function write(file: string, record: Evidence, exclusive: boolean): void {
  const temp = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, encode(record), { flag: "wx", mode: 0o600, flush: true });
    if (exclusive) { fs.linkSync(temp, file); fs.unlinkSync(temp); }
    else fs.renameSync(temp, file);
    syncDir(path.dirname(file));
  } finally { try { fs.unlinkSync(temp); } catch { /* never roll back the published intent */ } }
}
function scan(commonDir: string, dir: string, gate: string): GitOperationAdmission {
  if (!present(dir)) return { admitted: true, reason: "clear", actionIds: [] };
  const entries = fs.readdirSync(dir);
  if (entries.length > entryLimit() * 5 + 1) deny();
  const actions: string[] = [];
  let reserved = false;
  const records = new Map<string, Evidence>();
  const artifacts = new Set<string>();
  for (const name of entries) {
    if (name === "reservation") {
      directory(gate);
      const contents = fs.readdirSync(gate);
      // An incomplete reservation is still a block, not a lease to reclaim.
      if (contents.length && (contents.length !== 1 || contents[0] !== "owner" || readFile(path.join(gate, "owner")).length > 256)) deny();
      reserved = true; continue;
    }
    const match = /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(json|pre|post|binding|removal|completed|failure)$/.exec(name);
    if (!match) deny();
    if (match[2] !== "json") { artifacts.add(name); continue; }
    const value = load(path.join(dir, name), commonDir, match[1]);
    records.set(match[1], value);
    if (value.phase === "intent") actions.push(value.actionId);
  }
  if (records.size > entryLimit()) deny();
  for (const record of records.values()) {
    if (["workspace", "cleanup"].includes(record.kind) && record.phase === "resolved" &&
      (!artifacts.has(`${record.id}.binding`) || !artifacts.has(`${record.id}.completed`) ||
        sha(readFile(path.join(dir, `${record.id}.completed`), MAX_NATIVE_DOCUMENT)) !== record.nativeOutcomeSha256)) deny();
    if (record.disposition === "recovered" &&
      (!artifacts.has(`${record.id}.pre`) || !artifacts.has(`${record.id}.post`))) deny();
  }
  for (const artifact of artifacts) {
    const id = artifact.slice(0, 36);
    const intent = records.get(id);
    if (!intent) deny();
    if (["workspace", "cleanup"].includes(intent.kind)) {
      const stage = artifact.slice(id.length + 1) as GitNativeEvidenceStage;
      const native = loadNative(path.join(dir, artifact), intent, stage);
      validateNativeLinks(dir, intent, native);
      if (stage === "failure" && !actions.includes(intent.actionId)) actions.push(intent.actionId);
      continue;
    }
    if (intent.kind !== "checks" || !artifact.endsWith(".pre") && !artifact.endsWith(".post")) deny();
    const pre = loadCheck(path.join(dir, `${id}.pre`), intent, "pre");
    if (artifact.endsWith(".post")) {
      const post = loadCheck(path.join(dir, artifact), intent, "post") as CheckPost;
      if (post.snapshot.version !== pre.snapshot.version || post.preSha256 !== sha(encodeCheck(pre)) ||
        intent.disposition === "recovered" && !recoverablePost(post, pre.snapshot)) deny();
    }
  }
  return { admitted: !reserved && actions.length === 0, reason: reserved || actions.length ? "unresolved" : "clear", actionIds: actions };
}
/** Read-only inspection. Any unavailable or unrecognized evidence denies; no filesystem repairs. */
export function inspectGitOperationAdmission(agentDir: string, commonDir: string): GitOperationAdmission {
  try {
    const { folders, dir, gate } = locations(agentDir, commonDir);
    for (const folder of folders) if (!present(folder)) return { admitted: false, reason: "unavailable", actionIds: [] };
    return scan(commonDir, dir, gate);
  } catch { return { admitted: false, reason: "unavailable", actionIds: [] }; }
}
/** Recipe-specific execution bindings stay on each exact receipt. The common
 * source/policy/stage snapshot identifies successful sibling-check cohorts. */
export function gitCheckSnapshotCohortDigest(snapshot: GitCheckSnapshot): string {
  if (!validSnapshot(snapshot)) deny();
  const perRecipe = snapshot.version === 1 ? ["checkDigest"] :
    ["checkDigest", "recipeDigest", "cwdIdentity", "environmentDigest"];
  return sha(JSON.stringify(Object.fromEntries(Object.entries(snapshot).filter(([key]) => !perRecipe.includes(key)))));
}
export type GitCheckAttemptState = Readonly<{ epoch: string; attempts: readonly Readonly<{
  id: string; digest: string; successful: boolean; pending: boolean; cohortDigest?: string }> [] }>;
/** Durable attempt state for process-only receipts in BOTH engines. Only the
 * live successful owner can advance a cohort over positively completed sibling
 * checks. Failure/uncertainty/recovered dispositions never qualify as success.
 * Reads do not create attempts. No new ledger schema/file or weaker v1 proof. */
export function readGitCheckAttemptState(agentDir: string, commonDir: string): GitCheckAttemptState {
  const { folders, dir, gate } = locations(agentDir, commonDir);
  for (const folder of folders) directory(folder);
  const status = scan(commonDir, dir, gate);
  if (!status.admitted && !status.actionIds.length) deny(); // incomplete/orphan reservation
  // A positively identified non-check owned mutation does not itself change
  // the verification epoch. Consumers still require admission/their own valid
  // reservation; otherwise checking a receipt inside an integration intent
  // would invalidate that intent's already-approved evidence.
  const checks: Evidence[] = [];
  const attempts: { id: string; digest: string; successful: boolean; pending: boolean; cohortDigest?: string }[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const record = load(path.join(dir, name), commonDir, name.slice(0, -5));
    if (record.kind !== "checks") continue;
    checks.push(record);
    let successful = false;
    let cohortDigest: string | undefined;
    if (record.phase === "resolved" && record.disposition !== "recovered") {
      const pre = loadCheck(path.join(dir, `${record.id}.pre`), record, "pre");
      let post: CheckPost | undefined;
      try { post = loadCheck(path.join(dir, `${record.id}.post`), record, "post") as CheckPost; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      successful = post ? post.preSha256 === sha(encodeCheck(pre)) &&
        (post.source === "linux-systemd" || post.source === "node-test-simulated" && !!process.env.NODE_TEST_CONTEXT) &&
        JSON.stringify(pre.snapshot) === JSON.stringify(post.snapshot) && post.outcome.status === 0 &&
        !post.outcome.timedOut && !post.outcome.overflow && post.outcome.containmentComplete &&
        post.cleanupProof.payload === "release-attempted" : !!process.env.NODE_TEST_CONTEXT;
      // The no-post exemption is exactly the existing node:test owner-settlement
      // seam, never production process/cleanup evidence.
      if (!successful) deny();
      cohortDigest = gitCheckSnapshotCohortDigest(pre.snapshot);
    }
    attempts.push({ id: record.id, digest: sha(encode(record)), successful, pending: record.phase === "intent",
      ...(cohortDigest ? { cohortDigest } : {}) });
  }
  const resource = fs.lstatSync(commonDir, { bigint: true });
  return Object.freeze({ epoch: sha(JSON.stringify({ commonDir, device: String(resource.dev), inode: String(resource.ino),
    birthtime: String(resource.birthtimeNs), checks })), attempts: Object.freeze(attempts.map((item) => Object.freeze(item))) });
}
export function gitCheckAttemptEpoch(agentDir: string, commonDir: string): string {
  return readGitCheckAttemptState(agentDir, commonDir).epoch;
}

/** Read-only, immutable recovery evidence. Never authorizes clearing the ledger.
 * A missing or invalid artifact fails closed; simulated proof is explicitly
 * labeled and must never be mistaken for OS containment.
 */
export function readGitCheckRecoveryEvidence(agentDir: string, commonDir: string, id: string):
  Readonly<{ before: Readonly<GitCheckSnapshot>; after?: Readonly<GitCheckSnapshot>;
    cleanupProof?: Readonly<GitCheckCleanupProof>; outcome?: Readonly<GitCheckOutcome>;
    source?: "linux-systemd" | "node-test-simulated" }> {
  if (!uuid(id)) deny();
  const { folders, dir } = locations(agentDir, commonDir);
  for (const folder of folders) directory(folder);
  const intent = load(path.join(dir, `${id}.json`), commonDir, id);
  if (intent.kind !== "checks" || intent.phase !== "intent") deny();
  const pre = loadCheck(path.join(dir, `${id}.pre`), intent, "pre");
  const postFile = path.join(dir, `${id}.post`);
  let post: CheckPost | undefined;
  try { post = loadCheck(postFile, intent, "post") as CheckPost; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (post && (post.snapshot.version !== pre.snapshot.version || post.preSha256 !== sha(encodeCheck(pre)))) deny();
  return Object.freeze({ before: Object.freeze(pre.snapshot),
    ...(post ? { after: Object.freeze(post.snapshot), cleanupProof: Object.freeze(post.cleanupProof),
      outcome: Object.freeze(post.outcome), source: post.source } : {}) });
}

/** Discover exactly one unresolved check without guessing a ledger UUID from an
 * action card. An orphan, incomplete snapshot or unknown entry denies. This is
 * inspection only; it provides no ownership or release authority.
 */
export function readUnresolvedGitCheckRecovery(agentDir: string, commonDir: string): Readonly<{
  id: string; actionId: string; unit: string; before: Readonly<GitCheckSnapshot>;
  after?: Readonly<GitCheckSnapshot>; cleanupProof?: Readonly<GitCheckCleanupProof>;
  outcome?: Readonly<GitCheckOutcome>; source?: "linux-systemd" | "node-test-simulated" }> {
  const { folders, dir, gate } = locations(agentDir, commonDir);
  for (const folder of folders) directory(folder);
  const inspected = scan(commonDir, dir, gate);
  if (inspected.reason !== "unresolved" || inspected.actionIds.length !== 1) deny();
  const matches: Evidence[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const record = load(path.join(dir, name), commonDir, name.slice(0, -5));
    if (record.phase === "intent") matches.push(record);
  }
  if (matches.length !== 1 || matches[0].kind !== "checks" || matches[0].actionId !== inspected.actionIds[0]) deny();
  const { id, actionId, checkUnit } = matches[0];
  const evidence = readGitCheckRecoveryEvidence(agentDir, commonDir, id);
  return Object.freeze({ id, actionId, unit: checkUnit!, ...evidence });
}

/** Settle ONLY a failed/cancelled check after the caller has obtained a fresh
 * snapshot, independently verified the original unit and reviewed it with a
 * human under the checkout gate. No live Git/process inspection happens here.
 * Crashes after publication strand a resolved record behind the reservation;
 * this function never reaps or retries such partial releases. */
export function resolveHumanReviewedGitCheck(agentDir: string, commonDir: string, id: string, actionId: string,
  freshSnapshot: GitCheckSnapshot | GitCheckRecoveryCurrentState, proofIdentifier: string, receipt: GitCheckHumanReviewReceipt): void {
  const moved = receipt?.kind === "human-reviewed-git-check-recovery-moved";
  if (!uuid(id) || !uuid(actionId) || !(moved ? validCurrentState(freshSnapshot) : validSnapshot(freshSnapshot)) ||
    !INVOCATION.test(proofIdentifier)) deny();
  const { folders, dir, gate } = locations(agentDir, commonDir);
  for (const folder of folders) directory(folder);
  const status = scan(commonDir, dir, gate);
  if (status.reason !== "unresolved" || status.actionIds.length !== 1 || status.actionIds[0] !== actionId) deny();
  const file = path.join(dir, `${id}.json`);
  const intent = load(file, commonDir, id);
  if (intent.phase !== "intent" || intent.kind !== "checks" || intent.actionId !== actionId) deny();
  // The reservation is not a lease: an absent/empty/malformed or mismatched
  // owner cannot be adopted just because the check has complete artifacts.
  directory(gate);
  if (fs.readdirSync(gate).length !== 1) deny();
  const owner = readFile(path.join(gate, "owner"));
  const ownerText = owner.toString("utf8");
  if (!owner.equals(Buffer.from(ownerText)) ||
    !new RegExp(`^${id}:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`).test(ownerText)) deny();
  const pre = loadCheck(path.join(dir, `${id}.pre`), intent, "pre");
  const post = loadCheck(path.join(dir, `${id}.post`), intent, "post") as CheckPost;
  if (post.preSha256 !== sha(encodeCheck(pre)) || !recoverablePost(post, pre.snapshot) ||
    post.cleanupProof.invocation !== proofIdentifier ||
    !keys(receipt, ["kind", "id", "actionId", "resource", "unit", "proofIdentifier",
      ...(moved ? ["currentStateDigest", "reviewedMovement"] : [])]) ||
    receipt.id !== id || receipt.actionId !== actionId || receipt.resource !== commonDir ||
    receipt.unit !== intent.checkUnit || receipt.proofIdentifier !== proofIdentifier) deny();
  if (moved) {
    if (post.snapshot.version !== 1 || !validCurrentState(freshSnapshot) || receipt.kind !== "human-reviewed-git-check-recovery-moved" ||
      receipt.reviewedMovement !== true || receipt.currentStateDigest !== sha(JSON.stringify(freshSnapshot))) deny();
    // Branch movement is not authority to change the selected physical worktrees,
    // repository instance, saved check, or policy. Only later Git state may drift.
    const stable: (keyof GitCheckRecoveryCurrentState)[] = ["featurePath", "targetPath", "featureIdentity",
      "targetIdentity", "resourceIdentity", "featureBranch", "targetBranch", "policyDigest", "checkDigest"];
    if (stable.some((key) => freshSnapshot[key] !== post.snapshot[key]) ||
      ["featureOid", "targetOid", "featureIndex", "targetIndex", "featureStatus", "targetStatus", "refs"]
        .every((key) => freshSnapshot[key as keyof GitCheckRecoveryCurrentState] === post.snapshot[key as keyof GitCheckRecoveryCurrentState])) deny();
  } else if (!validSnapshot(freshSnapshot) || receipt.kind !== "human-reviewed-git-check-recovery" ||
    JSON.stringify(freshSnapshot) !== JSON.stringify(post.snapshot)) deny();
  // One last scan before publication: extra files or another unresolved record
  // cannot be ignored. The exclusive reservation is the checkout protocol.
  const again = scan(commonDir, dir, gate);
  if (again.reason !== "unresolved" || again.actionIds.length !== 1 || again.actionIds[0] !== actionId ||
    !readFile(path.join(gate, "owner")).equals(owner) || load(file, commonDir, id).phase !== "intent") deny();
  write(file, { ...intent, phase: "resolved", disposition: "recovered",
    resolvedAt: Math.max(Date.now(), intent.createdAt) }, false);
  // write() fsyncs the resolved record and directory before releasing the gate.
  if (!readFile(path.join(gate, "owner")).equals(owner)) deny();
  fs.unlinkSync(path.join(gate, "owner"));
  syncDir(gate);
  fs.rmdirSync(gate);
  syncDir(dir);
}

/** Begin only after physical resource selection and authorization. A reservation is durable BEFORE any caller side effect. */
export function beginGitOperationIntent(agentDir: string, commonDir: string, actionId: string, kind: GitOperationIntentKind,
  checkUnit?: string): GitOperationReservation {
  if (!uuid(actionId) || !KINDS.includes(kind) || kind === "checks" && !CHECK_UNIT.test(checkUnit ?? "") ||
    kind !== "checks" && checkUnit !== undefined) deny();
  const { folders, dir, gate } = locations(agentDir, commonDir);
  // The agent root is caller-managed. Never follow an existing symlink in the ledger path.
  directory(folders[0]);
  for (const folder of folders.slice(1)) makeDir(folder);
  makeDir(dir);
  // Capacity is deterministic under the exclusive gate protocol. Refuse a
  // full history BEFORE publishing a reservation: no process or ref action has
  // started yet, so exhausting the bounded ledger must not orphan a checkout.
  const preflight = scan(commonDir, dir, gate);
  if (!preflight.admitted || fs.readdirSync(dir).filter((name) => name.endsWith(".json")).length >= entryLimit() - 1) deny();
  // Cross-process O_EXCL reservation, never stolen on PID death. If an error
  // occurs after mkdir, leave it in place for manual investigation.
  fs.mkdirSync(gate, { mode: 0o700 });
  syncDir(dir);
  const gateStat = fs.lstatSync(gate, { bigint: true });
  const gateIdentity = `${gateStat.dev}:${gateStat.ino}:${gateStat.birthtimeNs}`;
  const id = randomUUID(), owner = `${id}:${randomUUID()}`;
  fs.writeFileSync(path.join(gate, "owner"), owner, { flag: "wx", mode: 0o600, flush: true });
  syncDir(gate);
  const status = scan(commonDir, dir, gate);
  if (status.actionIds.length) deny();
  if (fs.readdirSync(dir).filter((name) => name.endsWith(".json")).length >= entryLimit()) deny();
  const file = path.join(dir, `${id}.json`);
  const record: Evidence = { version: 1, id, actionId, kind, resource: commonDir, phase: "intent", createdAt: Date.now(),
    ...(checkUnit ? { checkUnit } : {}) };
  write(file, record, true);
  let finished = false;
  const nativeSeals = new WeakMap<object, string>();
  const assertOwned = () => {
    if (finished) deny();
    directory(gate);
    const currentGate = fs.lstatSync(gate, { bigint: true });
    if (`${currentGate.dev}:${currentGate.ino}:${currentGate.birthtimeNs}` !== gateIdentity) deny();
    if (fs.readdirSync(gate).length !== 1 || !readFile(path.join(gate, "owner")).equals(Buffer.from(owner))
      || JSON.stringify(load(file, commonDir, id)) !== JSON.stringify(record)) deny();
    if (kind === "workspace" || kind === "cleanup") {
      const status = scan(commonDir, dir, gate);
      if (status.reason !== "unresolved" || status.actionIds.length !== 1 || status.actionIds[0] !== actionId) deny();
    }
  };
  return { actionId, id, assertOwned,
    recordNativeEvidence(stage, payload, nativeReader) {
      if (!["workspace", "cleanup"].includes(kind) || !["binding", "removal", "completed", "failure"].includes(stage)) deny();
      // Known post-completion failures remain durable blockers, including failed
      // usage-lease release. They never resurrect a live reservation.
      if (!finished) assertOwned();
      else if (stage !== "failure" || load(file, commonDir, id).nativeOutcomeSha256 === undefined) deny();
      const bindingFile = path.join(dir, `${id}.binding`), removalFile = path.join(dir, `${id}.removal`);
      const artifact: NativeArtifact = { version: 1, id, actionId, kind: kind as "workspace" | "cleanup", resource: commonDir, stage,
        bindingSha256: stage === "binding" ? null : sha(readFile(bindingFile, MAX_NATIVE_DOCUMENT)),
        removalSha256: stage === "completed" && kind === "cleanup" ? sha(readFile(removalFile, MAX_NATIVE_DOCUMENT)) : null, payload };
      if (stage === "completed" && kind === "workspace" && !readGitWorkspaceNativeProof(payload)) deny();
      if (kind === "cleanup" && (stage === "removal" || stage === "completed")) {
        const native = nativeReader?.(payload);
        if (!nativeObject(native) || JSON.stringify(native) !== JSON.stringify(payload)) deny();
      }
      validateNativeLinks(dir, record, artifact);
      const data = encodeNative(artifact), artifactFile = path.join(dir, `${id}.${stage}`);
      publishNative(artifactFile, data);
      const seal = Object.freeze({ id, actionId, stage, sha256: sha(data) }); nativeSeals.set(seal, data);
      return seal;
    },
    resolveNativeOutcome(seal) {
      assertOwned();
      if (!["workspace", "cleanup"].includes(kind) || !seal || seal.stage !== "completed" ||
        seal.id !== id || seal.actionId !== actionId || !nativeSeals.has(seal) || !verifiedNativeInventorySeals.has(seal)) deny();
      const status = scan(commonDir, dir, gate);
      if (status.reason !== "unresolved" || status.actionIds.length !== 1 || status.actionIds[0] !== actionId ||
        fs.existsSync(path.join(dir, `${id}.failure`))) deny();
      const data = readFile(path.join(dir, `${id}.completed`), MAX_NATIVE_DOCUMENT);
      if (data.toString() !== nativeSeals.get(seal) || sha(data) !== seal.sha256) deny();
      write(file, { ...record, phase: "resolved", resolvedAt: Math.max(Date.now(), record.createdAt), nativeOutcomeSha256: seal.sha256 }, false);
      if (!readFile(path.join(gate, "owner")).equals(Buffer.from(owner))) deny();
      fs.unlinkSync(path.join(gate, "owner")); syncDir(gate); fs.rmdirSync(gate); syncDir(dir); finished = true;
    },
    recordCheckBefore(snapshot) {
      assertOwned();
      if (kind !== "checks" || !validSnapshot(snapshot)) deny();
      writeCheck(path.join(dir, `${id}.pre`), { version: 1, id, actionId, resource: commonDir, unit: checkUnit!, snapshot });
    },
    recordCheckAfter(snapshot, proof, outcome, source) {
      assertOwned();
      if (kind !== "checks" || !validSnapshot(snapshot) || !validProof(proof, checkUnit!) || !validOutcome(outcome) ||
        !["linux-systemd", "node-test-simulated"].includes(source) ||
        source === "node-test-simulated" && !process.env.NODE_TEST_CONTEXT) deny();
      const pre = loadCheck(path.join(dir, `${id}.pre`), record, "pre");
      if (snapshot.version !== pre.snapshot.version) deny();
      writeCheck(path.join(dir, `${id}.post`), { version: 1, id, actionId, resource: commonDir, unit: checkUnit!,
        preSha256: sha(encodeCheck(pre)), snapshot, cleanupProof: proof, outcome, source });
    },
    resolve(proof) {
    assertOwned();
    if (kind === "workspace" || kind === "cleanup") deny();
    if (kind === "prepare") {
      if (!validPrepareOutcome(proof)) deny();
      // Never clear an unknown/corrupt/orphan or a second unresolved intent.
      const status = scan(commonDir, dir, gate);
      if (status.reason !== "unresolved" || status.actionIds.length !== 1 || status.actionIds[0] !== actionId) deny();
    } else if (proof !== undefined) deny();
    if (kind === "checks") {
      const pre = loadCheck(path.join(dir, `${id}.pre`), record, "pre");
      let post: CheckPost | undefined;
      try { post = loadCheck(path.join(dir, `${id}.post`), record, "post") as CheckPost; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      // Only the owner of a successful live execution may settle a check.
      // A simulated backend may omit proof only inside direct node:test; never
      // mistake that fixture exemption for production cleanup evidence.
      if (!post && !process.env.NODE_TEST_CONTEXT || post &&
        (post.preSha256 !== sha(encodeCheck(pre)) ||
         post.source !== "linux-systemd" && (!process.env.NODE_TEST_CONTEXT || post.source !== "node-test-simulated") ||
         JSON.stringify(pre.snapshot) !== JSON.stringify(post.snapshot) ||
         post.outcome.status !== 0 || post.outcome.timedOut || post.outcome.overflow || !post.outcome.containmentComplete ||
         post.cleanupProof.payload !== "release-attempted")) deny();
    }
    write(file, { ...record, phase: "resolved", resolvedAt: Math.max(Date.now(), record.createdAt),
      ...(kind === "prepare" ? { prepareOutcome: proof } : {}) }, false);
    // A replaced reservation cannot be released by a stale handle. An error
    // between unlink and rmdir strands a conservative orphan, never clears it.
    if (!readFile(path.join(gate, "owner")).equals(Buffer.from(owner))) deny();
    fs.unlinkSync(path.join(gate, "owner"));
    syncDir(gate);
    fs.rmdirSync(gate);
    syncDir(dir);
    finished = true;
  } };
}

/** A journal without a ledger intent is never evidence of a clean old execution.
 * Scan a bounded index of action IDs; refuse corrupt/unreadable history rather than
 * treating missing records or artifacts as absence. Unrelated repos remain usable.
 */
function sameInstance(a: GitActionResourceAttribution["commonIdentity"], b: GitProjectResources["identities"]["common"]): boolean {
  return a.device === b.device && a.inode === b.inode && a.birthtime === b.birthtime;
}
/** A complete captured v2 record can be classified even if its source checkout no longer exists.
 * Admission requires positive distinct evidence for BOTH canonical directories and every captured checkout path. */
function distinctCapturedResource(selection: GitProjectResources, checkouts: readonly string[],
  summary: NonNullable<Awaited<ReturnType<typeof readGitAction>>["record"]>["summary"]): boolean {
  const captured = summary.resourceAttribution!;
  return !samePath(captured.commonDir, selection.commonDir)
    && !sameInstance(captured.commonIdentity, selection.identities.common)
    && !samePath(summary.projectRoot!, selection.projectRoot)
    && !sameInstance(captured.projectIdentity, selection.identities.project)
    && checkouts.every((cwd) => !samePath(summary.sourceCheckoutRoot!, cwd)
      && (summary.targetCheckoutRoot === undefined || !samePath(summary.targetCheckoutRoot, cwd)));
}
async function assertNoHistoricalRecovery(agentDir: string, selection: GitProjectResources, ownId: string): Promise<readonly string[] | undefined> {
  const base = path.join(agentDir, "pi-web", "git-actions", "v1");
  // Only a genuinely absent child of a validated existing directory means no
  // history. existsSync also returns false for dangling links and EACCES.
  const folders = [agentDir, path.join(agentDir, "pi-web"), path.join(agentDir, "pi-web", "git-actions"), base];
  for (let i = 0; i < folders.length; i++) {
    try { physicalDirectory(folders[i]); }
    catch (error) {
      if (i > 0 && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
  // Walk one entry at a time. A global count cap would quarantine an unrelated
  // repository after enough settled cards elsewhere; the durable operation
  // ledger itself remains bounded per Git resource. Every historical action
  // is still inspected, including old uncertainty with no classifiable root.
  const history = fs.opendirSync(base);
  let currentCheckouts: readonly string[] | undefined;
  try { for (let entry; (entry = history.readSync()) !== null;) {
    const id = entry.name;
    if (!entry.isDirectory() || !uuid(id)) throw new GitOperationRecoveryError();
    const item = await readGitAction(id, { includeArtifact: true }, agentDir);
    if (!item.record) throw new GitOperationRecoveryError(id);
    // The action being confirmed must still have its captured candidate;
    // process-local previews do not replace missing durable review evidence.
    if (id === ownId) {
      if (item.unavailable || !item.candidate ||
        !item.record.summary.resourceAttribution &&
          (item.record.state === "executing" || item.record.state === "recovery-required"))
        throw new GitOperationRecoveryError(id);
      // An unresolved path-only action is not exempt merely because its ID
      // was supplied as the current candidate. It has no instance proof.
      continue;
    }
    // A decision never approved for execution is safe to ignore even when its
    // captured artifact has since disappeared. Other missing artifacts remain
    // blockers for their resource; an old blocked or succeeded action without
    // evidence must not be silently treated as an unrelated declined preview.
    if (["declined", "expired", "cancelled"].includes(item.record.state)) continue;
    if (item.record.summary.resourceAttribution) {
      // Both the summary and immutable artifact must validate. Missing or
      // mismatched evidence cannot establish an unrelated repository.
      if (item.unavailable || !item.candidate) throw new GitOperationRecoveryError(id);
      if (item.record.state === "executing" || item.record.state === "recovery-required") {
        currentCheckouts ??= await registeredGitProjectCheckoutPaths(selection);
        if (!distinctCapturedResource(selection, currentCheckouts, item.record.summary)) throw new GitOperationRecoveryError(id);
      }
      continue;
    }
    if (item.unavailable || !item.candidate) throw new GitOperationRecoveryError(id);
    // Neither v1's optional project/checkout paths nor a currently resolvable
    // source proves the *original* repository's directory instance. Moving A,
    // then recreating both captured paths with a replacement, makes a path-only
    // negative comparison falsely admit A. Quarantine ALL unresolved v1
    // globally until explicit human recovery; do not infer identity from paths.
    if (item.record.state === "executing" || item.record.state === "recovery-required")
      throw new GitOperationRecoveryError(id);
  }
  if (currentCheckouts && JSON.stringify(currentCheckouts) !== JSON.stringify(await registeredGitProjectCheckoutPaths(selection)))
    throw new GitOperationRecoveryError();
  return currentCheckouts;
  } finally { history.closeSync(); }
}

/** Capture BEFORE a human decision; revalidate it after acquiring the checkout gate.
 * The caller must also revalidate immediately before the ref CAS callback.
 */
export async function selectGitCommitAdmission(cwd: string): Promise<GitProjectResources> {
  const selection = await selectGitProjectResources(cwd);
  await assertGitOperationAdmission(selection);
  return selection;
}
export async function assertGitOperationAdmission(selection: GitProjectResources, agentDir = getAgentDir(),
  ownActionId = ""): Promise<void> {
  await revalidateGitProjectResources(selection);
  try {
    const { folders, dir, gate } = locations(agentDir, selection.commonDir);
    directory(folders[0]);
    // No ledger yet is clear only if every already-existing parent is private;
    // symlinks, corruption and an existing unresolved entry never mean clear.
    for (const folder of folders.slice(1)) if (!present(folder)) break;
    if (present(dir) && !scan(selection.commonDir, dir, gate).admitted) throw new GitOperationRecoveryError();
    await assertNoHistoricalRecovery(agentDir, selection, ownActionId);
  } catch { throw new GitOperationRecoveryError(); }
  await revalidateGitProjectResources(selection);
}

/** Reserve the physical Git common directory before launching checks or applying
 * a ref/checkout mutation. A positive local result is not recovery evidence:
 * only the caller can resolve after recording the exact outcome and positively
 * proving any spawned check children have stopped. */
export async function beginSupervisedGitOperationIntent(selection: GitProjectResources, actionId: string,
  kind: "commit" | "checks" | "integration" | "prepare" | "workspace" | "cleanup", agentDir = getAgentDir(), checkUnit?: string): Promise<GitOperationReservation> {
  await revalidateGitProjectResources(selection);
  // Reject known legacy quarantine before publishing our own intent. Otherwise
  // an unrelated old blocker strands a second, avoidable orphan on this checkout.
  let before: readonly string[] | undefined;
  try { before = await assertNoHistoricalRecovery(agentDir, selection, actionId); }
  catch { throw new GitOperationRecoveryError(actionId); }
  let operation: GitOperationReservation;
  try { operation = beginGitOperationIntent(agentDir, selection.commonDir, actionId, kind, checkUnit); }
  catch { throw new GitOperationRecoveryError(actionId); }
  let after: readonly string[] | undefined;
  try { after = await assertNoHistoricalRecovery(agentDir, selection, actionId); }
  catch { // Do not release a reservation if history changed during admission.
    throw new GitOperationRecoveryError(actionId);
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new GitOperationRecoveryError(actionId);
  if (kind === "workspace" || kind === "cleanup") return issueReservationOwner(nativeInventoryReservation(selection, operation), selection, kind, agentDir);
  if (!after) return issueReservationOwner(operation, selection, kind, agentDir);
  // Retain the positively classified inventory in this process-only owner.
  // Recheck synchronously at each native callback, not just before publication
  // of the intent. This narrows, but cannot eliminate, external Git races.
  const assertOwned = () => {
    operation.assertOwned();
    try {
      if (JSON.stringify(registeredGitProjectCheckoutPathsSync(selection)) !== JSON.stringify(after))
        throw new GitOperationRecoveryError(actionId);
    } catch { throw new GitOperationRecoveryError(actionId); }
  };
  return issueReservationOwner({ actionId: operation.actionId, id: operation.id, assertOwned,
    recordNativeEvidence() { deny(); }, resolveNativeOutcome() { deny(); },
    recordCheckBefore(snapshot) { assertOwned(); operation.recordCheckBefore(snapshot); },
    recordCheckAfter(snapshot, proof, outcome, source) { assertOwned(); operation.recordCheckAfter(snapshot, proof, outcome, source); },
    resolve(proof) { assertOwned(); operation.resolve(proof); } }, selection, kind, agentDir);
}
export function beginSupervisedGitCommitIntent(selection: GitProjectResources, actionId: string): Promise<GitOperationReservation> {
  return beginSupervisedGitOperationIntent(selection, actionId, "commit");
}
export async function revalidateGitCommitAdmission(selection: GitProjectResources): Promise<void> {
  await revalidateGitProjectResources(selection);
}
