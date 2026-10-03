import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import { samePath } from "./paths";
import { validateGitCheckRecipe } from "./git-check-recipe";
import { validLocalBranchName } from "./git-workflow-policy";
import { GIT_ACTION_ID_PATTERN, isTerminalGitAction,
  type GitActionCandidateSnapshot, type GitActionHistoryResponse, type GitActionOutcome, type GitActionResourceAttribution,
  type GitActionRecord, type GitActionSource, type GitActionState, type GitActionUpdateEvent } from "./git-action-types";

/**
 * Server-owned evidence only. Checksums detect corruption, not a malicious
 * same-user writer able to replace both documents and their digests. CAS is
 * process-local: another process cannot adopt these actions from disk.
 * No retention deletion, Git reads, ref repair, or executable state lives here.
 */

/** Independent storage limits, not permission to truncate a reviewed candidate. */
export const GIT_ACTION_LIMITS = Object.freeze({
  recordBytes: 256 * 1024, artifactBytes: 2 * 1024 * 1024, patchBytes: 1024 * 1024,
  paths: 2000, pathBytes: 4096, messageBytes: 32 * 1024, reasonBytes: 4096,
  checks: 12, checkArgs: 33, commitOids: 1000, commitMapping: 200, ignoredEntries: 2000, logBytes: 8 * 1024 * 1024,
});
const KINDS = ["commit", "review", "checks", "integration", "workspace", "preparation", "checkout-verification", "cleanup"] as const;
const SOURCES = ["agent", "human", "legacy-agent"] as const;
const STATES = ["proposed", "awaiting-decision", "executing", "succeeded", "declined", "cancelled", "expired", "blocked", "failed", "recovery-required"] as const;
const DECISIONS = ["approved", "declined", "cancelled", "reviewed", "dismissed"] as const;
const NEXT: Partial<Record<GitActionState, readonly GitActionState[]>> = {
  proposed: ["awaiting-decision", "executing", "succeeded", "blocked", "failed", "cancelled", "expired"],
  "awaiting-decision": ["executing", "succeeded", "declined", "cancelled", "blocked", "failed", "expired"],
  executing: ["executing", "succeeded", "failed", "cancelled", "blocked", "recovery-required"],
};
type Transition = { state: GitActionState; decision?: GitActionRecord["decision"]; intended?: GitActionOutcome; outcome?: GitActionOutcome; reason?: string };
type Listener = (event: GitActionUpdateEvent) => void;
interface Runtime {
  processId: string;
  // Membership + the last durable digest are liveness/integrity evidence ONLY.
  // No tokens, approval callbacks, engine plans, receipts or executable jobs.
  active: Map<string, string>;
  locks: Map<string, Promise<void>>;
  listeners: Map<string, Set<Listener>>;
}
const runtimeKey = Symbol.for("pi-web:git-action-journal:v1");
function runtime(): Runtime {
  const shared = globalThis as unknown as Record<symbol, Runtime | undefined>;
  return (shared[runtimeKey] ??= { processId: randomUUID(), active: new Map(), locks: new Map(), listeners: new Map() });
}
function invalid(detail: string): never { throw new Error(`Invalid Git action ${detail}`); }
function hash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
/** Only validated, acyclic data. Legacy encoding is unchanged. Native v2 recipe
 * JSON (including literal env key order) is hashed, so retain it verbatim. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const v = value as Record<string, unknown>, snapshot = v.snapshot;
    const nativeRecipe = snapshot !== null && typeof snapshot === "object" && "version" in snapshot && snapshot.version === 2
      && Object.hasOwn(v, "checkIndex") && Object.hasOwn(v, "recipe");
    return `{${Object.keys(v).sort().map((key) => `${JSON.stringify(key)}:${nativeRecipe && key === "recipe" ? JSON.stringify(v[key]) : canonical(v[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid("object");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (required.some((key) => !Object.hasOwn(descriptors, key))
    || Reflect.ownKeys(value).some((key) => typeof key !== "string" || !required.includes(key) && !optional.includes(key)
      || !descriptors[key].enumerable || !("value" in descriptors[key]))) invalid("fields");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || !empty && value.length === 0
    || value.includes("\0") || value.length > max || Buffer.byteLength(value) > max) invalid("text or size");
  return value;
}
function integer(value: unknown, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) invalid("integer");
  return value as number;
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid("enum");
  return value as T;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !GIT_ACTION_ID_PATTERN.test(value)) invalid("ID");
  return value;
}
function oid(value: unknown): string {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) invalid("object ID");
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid("digest");
  return value;
}
function array<T>(value: unknown, max: number, item: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) invalid("array or size");
  const result: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const property = Object.getOwnPropertyDescriptor(value, String(i));
    if (!property || !("value" in property)) invalid("array item");
    result.push(item(property.value));
  }
  return result;
}
function sessionId(value: unknown): string { return text(value, 256); }
function directoryInstance(value: unknown): GitActionResourceAttribution["commonIdentity"] {
  const v = fields(value, ["device", "inode", "birthtime"]);
  const component = (part: unknown) => {
    if (typeof part !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(part)) invalid("directory instance");
    return part;
  };
  return { device: component(v.device), inode: component(v.inode), birthtime: component(v.birthtime) };
}
function physicalPath(value: unknown): string {
  const path = text(value, GIT_ACTION_LIMITS.pathBytes);
  if ((!isAbsolute(path) && !win32.isAbsolute(path)) || /[\x00-\x1f\x7f]/.test(path) || path !== path.trim()) invalid("checkout path");
  return path;
}
function canonicalPath(value: unknown): string {
  const path = physicalPath(value);
  if (path !== (isAbsolute(path) ? resolve(path) : win32.resolve(path))) invalid("noncanonical resource path");
  return path;
}
function localBranch(value: unknown): string {
  if (!validLocalBranchName(value)) invalid("local branch");
  return text(value, 255);
}
function workspace(input: unknown): NonNullable<GitActionCandidateSnapshot["workspace"]> {
  const v = fields(input, ["mode", "destinationPath", "baseBranch", "baseOid", "branch", "tipOid", "treeOid"], ["parentCreation"]);
  const result: NonNullable<GitActionCandidateSnapshot["workspace"]> = { mode: choice(v.mode, ["create", "attach"]), destinationPath: canonicalPath(v.destinationPath),
    baseBranch: localBranch(v.baseBranch), baseOid: oid(v.baseOid), branch: localBranch(v.branch), tipOid: oid(v.tipOid), treeOid: oid(v.treeOid) };
  if (result.mode === "create" && result.tipOid !== result.baseOid) invalid("workspace create tip");
  if (Object.hasOwn(v, "parentCreation")) {
    const p = fields(v.parentCreation, ["path", "expectedAbsent", "ancestorPath", "ancestorIdentity", "mode"]);
    if (p.expectedAbsent !== true || p.mode !== 0o700) invalid("parent creation plan");
    result.parentCreation = { path: canonicalPath(p.path), expectedAbsent: true, ancestorPath: canonicalPath(p.ancestorPath),
      ancestorIdentity: directoryInstance(p.ancestorIdentity), mode: 448 };
    if (!samePath(dirname(result.destinationPath), result.parentCreation.path)
      || !samePath(dirname(result.parentCreation.path), result.parentCreation.ancestorPath)) invalid("parent creation path");
  }
  return result;
}
function checkout(input: unknown): NonNullable<GitActionCandidateSnapshot["preparation"]>["source"] {
  const v = fields(input, ["gitDir", "checkoutIdentity", "gitIdentity", "markerIdentity"]);
  const marker = fields(v.markerIdentity, ["device", "inode", "birthtime"], ["changed", "size"]);
  if ((marker.changed === undefined) !== (marker.size === undefined)) invalid("marker identity");
  const markerIdentity = directoryInstance({ device: marker.device, inode: marker.inode, birthtime: marker.birthtime });
  // Reuse the same bounded decimal encoding for file change/size observations.
  const part = (value: unknown) => directoryInstance({ device: value, inode: "0", birthtime: "0" }).device;
  return { gitDir: canonicalPath(v.gitDir), checkoutIdentity: directoryInstance(v.checkoutIdentity),
    gitIdentity: directoryInstance(v.gitIdentity), markerIdentity: { ...markerIdentity,
      ...(marker.changed !== undefined ? { changed: part(marker.changed), size: part(marker.size) } : {}) } };
}
function insideCheckout(root: string, cwd: string): boolean {
  const rel = isAbsolute(root) ? relative(root, cwd) : win32.relative(root, cwd);
  return rel === "" || !isAbsolute(rel) && !win32.isAbsolute(rel) && rel !== ".." && !/^(?:\.\.\/|\.\.\\)/.test(rel);
}
function flags(v: Record<string, unknown>) {
  if (v.evidenceScope !== "working-workspace" || v.candidateTreeVerified !== false || v.repositoryChecksWaived !== false) invalid("working-workspace scope");
  return { evidenceScope: "working-workspace" as const, candidateTreeVerified: false as const, repositoryChecksWaived: false as const };
}
const FLAG_KEYS = ["evidenceScope", "candidateTreeVerified", "repositoryChecksWaived"];
const CHECK_BINDING_KEYS = [...FLAG_KEYS, "sourceOid", "sourceTreeOid", "snapshotDigest", "policyDigest", "policyRevision", "stage", "requiredSavedIndexes"];
function indexes(value: unknown): number[] {
  const result = array(value, GIT_ACTION_LIMITS.checks, (index) => integer(index));
  if (result.some((index) => index >= GIT_ACTION_LIMITS.checks) || new Set(result).size !== result.length) invalid("saved check indexes");
  return result;
}
function checkBinding(v: Record<string, unknown>): Omit<NonNullable<GitActionOutcome["checkoutVerification"]>, "runs"> {
  const stage = choice(v.stage, ["commit", "integration", "handoff", "none"] as const), requiredSavedIndexes = indexes(v.requiredSavedIndexes);
  if (stage === "none" && requiredSavedIndexes.length) invalid("manual-only stage prerequisites");
  if (v.candidateTreeVerified !== false || v.repositoryChecksWaived !== false) invalid("verification limitations");
  const evidenceScope = choice(v.evidenceScope, ["working-workspace", "clean-checkout"] as const);
  if ((evidenceScope === "working-workspace") !== (stage === "commit")) invalid("verification scope/stage mismatch");
  return { evidenceScope, candidateTreeVerified: false, repositoryChecksWaived: false,
    sourceOid: oid(v.sourceOid), sourceTreeOid: oid(v.sourceTreeOid), snapshotDigest: digest(v.snapshotDigest),
    policyDigest: digest(v.policyDigest), policyRevision: text(v.policyRevision, 512), stage, requiredSavedIndexes };
}
function execution(input: unknown): NonNullable<GitActionOutcome["checkoutVerification"]>["runs"][number] {
  const v = fields(input, ["actionId", "sessionId", "checkIndex", "stage", "recipeDigest", "policyDigest", "snapshotDigest", "environmentDigest", "executionCwd",
    "startedAt", "finishedAt", "unit", "exitStatus", "containmentComplete", "timedOut", "overflow", "logDigest", "logBytes"], ["cgroupIdentity", "invocation", "launcherIdentity", "payload", "receipt"]);
  const checkIndex = integer(v.checkIndex), startedAt = integer(v.startedAt), finishedAt = integer(v.finishedAt), logBytes = integer(v.logBytes);
  if (checkIndex >= GIT_ACTION_LIMITS.checks || finishedAt < startedAt || logBytes > GIT_ACTION_LIMITS.logBytes) invalid("check run bounds");
  for (const key of ["containmentComplete", "timedOut", "overflow"] as const) if (typeof v[key] !== "boolean") invalid("check execution flag");
  const exitStatus = v.exitStatus === null ? null : integer(v.exitStatus);
  if (exitStatus !== null && exitStatus > 255) invalid("exit status");
  const unit = text(v.unit, 256);
  if (!/^[A-Za-z0-9_.@-]+\.service$/.test(unit)) invalid("check unit");
  const result: NonNullable<GitActionOutcome["checkoutVerification"]>["runs"][number] = { actionId: uuid(v.actionId), sessionId: sessionId(v.sessionId), checkIndex,
    stage: choice(v.stage, ["commit", "integration", "handoff", "none"]), recipeDigest: digest(v.recipeDigest), policyDigest: digest(v.policyDigest),
    snapshotDigest: digest(v.snapshotDigest), environmentDigest: digest(v.environmentDigest), executionCwd: canonicalPath(v.executionCwd), startedAt, finishedAt,
    unit, exitStatus, containmentComplete: v.containmentComplete as boolean, timedOut: v.timedOut as boolean, overflow: v.overflow as boolean,
    logDigest: digest(v.logDigest), logBytes };
  if (Object.hasOwn(v, "cgroupIdentity")) {
    const id = text(v.cgroupIdentity, 4180);
    // Preserve old inert dev:ino history. New native measurements retain the
    // ORIGINAL invocation and manager ControlGroup path verbatim, not a label.
    if (!/^[0-9]{1,20}:[0-9]{1,20}$/.test(id)) {
      const parts = /^([0-9]{1,20}):([0-9]{1,20}):([a-fA-F0-9]{32}):(\/.*)$/.exec(id);
      if (!parts || /^0{32}$/.test(parts[3])) invalid("cgroup identity");
      const group = parts[4], segments = group.slice(1).split("/");
      if (Buffer.byteLength(group) > 4096 || segments.some((part) => !part || part === "." || part === ".." || Buffer.byteLength(part) > 255
        || !/^(?:[A-Za-z0-9_.@:-]|\\x[0-9a-fA-F]{2})+$/.test(part))) invalid("control group path");
      if (Object.hasOwn(v, "invocation") && v.invocation !== parts[3]) invalid("cgroup invocation mismatch");
    }
    result.cgroupIdentity = id;
  }
  if (Object.hasOwn(v, "invocation")) {
    const id = text(v.invocation, 64);
    if (!/^(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})$/.test(id)) invalid("invocation identity");
    result.invocation = id;
  }
  if (Object.hasOwn(v, "launcherIdentity")) {
    const id = text(v.launcherIdentity, 96);
    if (!/^[1-9][0-9]{0,9}:[0-9]{1,20}:[0-9]{1,20}:[0-9]{1,20}$/.test(id)) invalid("launcher process instance");
    result.launcherIdentity = id;
  }
  if (Object.hasOwn(v, "payload")) result.payload = choice(v.payload, ["release-attempted", "prevented-before-write"] as const);
  if (Object.hasOwn(v, "receipt")) {
    const r = fields(v.receipt, ["id", "sha256", "expiresAt"]), expiresAt = integer(r.expiresAt);
    if (expiresAt <= finishedAt || expiresAt - finishedAt > 15 * 60_000 || exitStatus !== 0 || !result.containmentComplete || result.timedOut || result.overflow
      || !result.cgroupIdentity || !result.invocation || result.payload === "prevented-before-write") invalid("receipt without passing actual run");
    result.receipt = { id: uuid(r.id), sha256: digest(r.sha256), expiresAt };
  }
  return result;
}
function executions(value: unknown) {
  const runs = array(value, GIT_ACTION_LIMITS.checks, execution);
  if (new Set(runs.map((run) => run.checkIndex)).size !== runs.length
    || new Set(runs.flatMap((run) => run.receipt ? [run.receipt.id] : [])).size !== runs.filter((run) => run.receipt).length) invalid("duplicate runs/receipts");
  return runs;
}
function workingEvidence(input: unknown): NonNullable<GitActionCandidateSnapshot["workingWorkspaceVerification"]> {
  const v = fields(input, [...FLAG_KEYS, "requiredSavedIndexes", "runs"]);
  const result = { ...flags(v), requiredSavedIndexes: indexes(v.requiredSavedIndexes), runs: executions(v.runs) };
  if (result.runs.some((run) => run.stage !== "commit")) invalid("non-commit run in working-workspace commit evidence");
  if (result.requiredSavedIndexes.some((index) => !result.runs.some((run) => run.checkIndex === index && run.stage === "commit" && run.receipt))) invalid("missing commit prerequisite evidence");
  return result;
}
const CLEAN_SNAPSHOT_KEYS = ["checkoutPath", "checkoutIdentity", "resourceIdentity", "branch", "head", "tree", "index", "status", "refs",
  "policyDigest", "policyRevision", "recipeDigest", "checkDigest", "cwdIdentity", "environmentDigest", "stageDigest"] as const;
function cleanCheckSnapshot(input: unknown): NonNullable<NonNullable<GitActionCandidateSnapshot["checkoutVerification"]>["checks"][number]["snapshot"]> {
  const v = fields(input, ["version", ...CLEAN_SNAPSHOT_KEYS]);
  if (v.version !== 2) invalid("clean checkout manifest version");
  // Native v2 field order is part of JSON digest identity. Never normalize,
  // invent defaults, relabel a paired manifest or upgrade historical data.
  return { version: 2, checkoutPath: digest(v.checkoutPath), checkoutIdentity: digest(v.checkoutIdentity), resourceIdentity: digest(v.resourceIdentity),
    branch: digest(v.branch), head: digest(v.head), tree: digest(v.tree), index: digest(v.index), status: digest(v.status), refs: digest(v.refs),
    policyDigest: digest(v.policyDigest), policyRevision: digest(v.policyRevision), recipeDigest: digest(v.recipeDigest), checkDigest: digest(v.checkDigest),
    cwdIdentity: digest(v.cwdIdentity), environmentDigest: digest(v.environmentDigest), stageDigest: digest(v.stageDigest) };
}
function checkoutVerification(input: unknown): NonNullable<GitActionCandidateSnapshot["checkoutVerification"]> {
  const v = fields(input, [...CHECK_BINDING_KEYS, "source", "checks"]), binding = checkBinding(v);
  const checks = array(v.checks, GIT_ACTION_LIMITS.checks, (input) => {
    const row = fields(input, ["checkIndex", "recipe", "recipeDigest", "environmentDigest", "executionCwd"], ["snapshot"]);
    const r = fields(row.recipe, ["label", "argv"], ["cwd", "env", "requiredStage"]);
    const argv = array(r.argv, GIT_ACTION_LIMITS.checkArgs, (arg) => text(arg, 512));
    if (r.env !== undefined) fields(r.env, [], Object.keys(r.env as object));
    const recipe = validateGitCheckRecipe({ ...r, argv });
    const checkIndex = integer(row.checkIndex);
    if (checkIndex >= GIT_ACTION_LIMITS.checks || (recipe.requiredStage ?? "integration") !== binding.stage) invalid("saved recipe stage/index");
    const recipeDigest = digest(row.recipeDigest), environmentDigest = digest(row.environmentDigest);
    if (binding.evidenceScope === "working-workspace") {
      if (Object.hasOwn(row, "snapshot")) invalid("v2 manifest on working-workspace check");
      return { checkIndex, recipe, recipeDigest, environmentDigest, executionCwd: canonicalPath(row.executionCwd) };
    }
    const snapshot = cleanCheckSnapshot(row.snapshot);
    if (recipeDigest !== hash(JSON.stringify(recipe)) || snapshot.recipeDigest !== recipeDigest
      || snapshot.checkDigest !== hash(JSON.stringify({ checkIndex, recipe })) || snapshot.policyDigest !== binding.policyDigest
      || snapshot.policyRevision !== hash(binding.policyRevision) || snapshot.stageDigest !== hash(binding.stage)
      || snapshot.environmentDigest !== environmentDigest) invalid("clean checkout recipe/policy binding mismatch");
    return { checkIndex, recipe, recipeDigest, environmentDigest, executionCwd: canonicalPath(row.executionCwd), snapshot };
  });
  if (!checks.length || new Set(checks.map((row) => row.checkIndex)).size !== checks.length
    || binding.requiredSavedIndexes.some((index) => !checks.some((row) => row.checkIndex === index))) invalid("verification recipe selection");
  if (binding.evidenceScope === "clean-checkout" && binding.snapshotDigest !== hash(JSON.stringify(checks[0].snapshot))) invalid("clean checkout snapshot digest mismatch");
  return { ...binding, source: checkout(v.source), checks };
}
const CLEANUP_BINDING_KEYS = ["featureOid", "targetOid", "mainOid", "sourcePath", "branchRef", "targetPath", "mainPath"];
function cleanupBinding(v: Record<string, unknown>): Pick<NonNullable<GitActionCandidateSnapshot["cleanup"]>, "featureOid" | "targetOid" | "mainOid" | "sourcePath" | "branchRef" | "targetPath" | "mainPath"> {
  const branchRef = text(v.branchRef, 1024);
  if (!branchRef.startsWith("refs/heads/")) invalid("cleanup local branch");
  localBranch(branchRef.slice("refs/heads/".length));
  const result = { featureOid: oid(v.featureOid), targetOid: oid(v.targetOid), mainOid: oid(v.mainOid), sourcePath: canonicalPath(v.sourcePath),
    branchRef, targetPath: canonicalPath(v.targetPath), mainPath: canonicalPath(v.mainPath) };
  if (samePath(result.sourcePath, result.targetPath) || samePath(result.sourcePath, result.mainPath)) invalid("cleanup surviving checkout");
  return result;
}
function decimal(value: unknown): string {
  return directoryInstance({ device: value, inode: "0", birthtime: "0" }).device;
}
function cleanupSnapshot(input: unknown, summary: boolean): NonNullable<GitActionCandidateSnapshot["cleanup"]> {
  const v = fields(input, [...CLEANUP_BINDING_KEYS, "source", "target", "main", "integration", "provenance", "ignoredCount", "ignoredDeletion", ...(summary ? [] : ["ignored"])]);
  const binding = cleanupBinding(v), i = fields(v.integration, ["completedAt", "delivery", "method", "actualFF", "featureOid", "previousTargetOid", "resultOid", "resultTree", "parents"]);
  if (typeof i.actualFF !== "boolean") invalid("cleanup integration method");
  const integration = { completedAt: integer(i.completedAt), delivery: choice(i.delivery, ["selected-local"] as const), method: choice(i.method, ["ff", "merge"] as const),
    actualFF: i.actualFF, featureOid: oid(i.featureOid), previousTargetOid: oid(i.previousTargetOid), resultOid: oid(i.resultOid), resultTree: oid(i.resultTree), parents: array(i.parents, 16, oid) };
  if (integration.featureOid !== binding.featureOid || integration.resultOid !== binding.targetOid
    || (integration.method === "ff") !== integration.actualFF || integration.method === "ff" && (integration.resultOid !== integration.featureOid || integration.previousTargetOid === integration.featureOid)
    || integration.method === "merge" && (canonical(integration.parents) !== canonical([integration.previousTargetOid, integration.featureOid])
      || integration.resultOid === integration.featureOid)) invalid("cleanup integration mismatch");
  const p = fields(v.provenance, ["mode", "originalSourcePath", "originalSource", "branchRef"]);
  const provenance = { mode: choice(p.mode, ["create"] as const), originalSourcePath: canonicalPath(p.originalSourcePath),
    originalSource: checkout(p.originalSource), branchRef: text(p.branchRef, 1024) };
  if (provenance.branchRef !== binding.branchRef || samePath(provenance.originalSourcePath, binding.sourcePath)) invalid("cleanup creation provenance");
  const ignoredCount = integer(v.ignoredCount), ignoredDeletion = choice(v.ignoredDeletion, ["none", "exact-approval-required"] as const);
  if (ignoredCount > GIT_ACTION_LIMITS.ignoredEntries || (ignoredCount === 0) !== (ignoredDeletion === "none")) invalid("ignored-data approval scope");
  const result: NonNullable<GitActionCandidateSnapshot["cleanup"]> = { ...binding, source: checkout(v.source), target: checkout(v.target), main: checkout(v.main), integration, provenance, ignoredCount, ignoredDeletion };
  if (!summary) {
    result.ignored = array(v.ignored, GIT_ACTION_LIMITS.ignoredEntries, (input) => {
      const row = fields(input, ["path", "kind", "device", "inode", "birthtime", "size", "mode", "changed", "modified"]), path = text(row.path, GIT_ACTION_LIMITS.pathBytes);
      if (/^[\\/]|[\x00-\x1f\x7f\\]/.test(path) || path.split("/").some((part) => !part || part === "." || part === ".." || part === ".git" || part === ".gitattributes") || win32.isAbsolute(path)) invalid("ignored path");
      return { path, kind: choice(row.kind, ["file", "directory"] as const), ...directoryInstance({ device: row.device, inode: row.inode, birthtime: row.birthtime }),
        size: decimal(row.size), mode: decimal(row.mode), changed: decimal(row.changed), modified: decimal(row.modified) };
    });
    if (result.ignored.length !== ignoredCount || new Set(result.ignored.map((row) => row.path)).size !== ignoredCount) invalid("complete ignored inventory");
  }
  return result;
}
function cleanupOutcome(input: unknown): NonNullable<GitActionOutcome["cleanup"]> {
  const v = fields(input, [...CLEANUP_BINDING_KEYS, "effects"], ["ignoredDataDeletionApproved", "observedFeatureOid", "nativeHeadReflogMayHaveChanged", "recovery"]);
  const result: NonNullable<GitActionOutcome["cleanup"]> = { ...cleanupBinding(v), effects: array(v.effects, 2, (input) => {
    const row = fields(input, ["kind"], ["sourcePath", "sourceIdentity", "adminPath", "featureOid", "exit", "sourceAbsent", "adminAbsent", "beforeInventoryDigest", "afterInventoryDigest",
      "branchRef", "deletedOid", "transactionExit", "finalInventoryDigest"]);
    if (row.kind === "worktree-removed") {
      fields(row, ["kind", "sourcePath", "sourceIdentity", "adminPath", "featureOid", "exit", "sourceAbsent", "adminAbsent", "beforeInventoryDigest", "afterInventoryDigest"]);
      if (row.exit !== 0 || row.sourceAbsent !== true || row.adminAbsent !== true) invalid("unmeasured cleanup removal");
      return { kind: "worktree-removed" as const, sourcePath: canonicalPath(row.sourcePath), sourceIdentity: directoryInstance(row.sourceIdentity),
        adminPath: canonicalPath(row.adminPath), featureOid: oid(row.featureOid), exit: 0 as const, sourceAbsent: true as const, adminAbsent: true as const,
        beforeInventoryDigest: digest(row.beforeInventoryDigest), afterInventoryDigest: digest(row.afterInventoryDigest) };
    }
    fields(row, ["kind", "branchRef", "deletedOid", "transactionExit", "finalInventoryDigest"]);
    if (row.kind !== "branch-deleted" || row.transactionExit !== 0) invalid("unmeasured branch deletion");
    return { kind: "branch-deleted" as const, branchRef: text(row.branchRef, 1024), deletedOid: oid(row.deletedOid), transactionExit: 0 as const, finalInventoryDigest: digest(row.finalInventoryDigest) };
  }) };
  if (result.effects.some((effect, index) => effect.kind !== (index === 0 ? "worktree-removed" : "branch-deleted"))) invalid("cleanup effect order");
  for (const key of ["ignoredDataDeletionApproved", "nativeHeadReflogMayHaveChanged"] as const) if (Object.hasOwn(v, key)) {
    if (v[key] !== true) invalid("cleanup measured flag");
    result[key] = true;
  }
  if (Object.hasOwn(v, "observedFeatureOid")) result.observedFeatureOid = v.observedFeatureOid === null ? null : oid(v.observedFeatureOid);
  if (Object.hasOwn(v, "recovery")) {
    const r = fields(v.recovery, ["phase", "removeAttempted", "branchDeleteAttempted", "childTerminationConfirmed", "sourceAbsent", "adminAbsent", "featureRefAbsent", "removeExit", "transactionExit"],
      ["usageRemovalAcknowledged", "completedRecorded", "leaseReleaseUncertain", "checkoutGateRetained"]);
    for (const key of ["removeAttempted", "branchDeleteAttempted", "childTerminationConfirmed", "usageRemovalAcknowledged", "completedRecorded", "leaseReleaseUncertain", "checkoutGateRetained"])
      if (Object.hasOwn(r, key) && typeof r[key] !== "boolean") invalid("cleanup recovery flag");
    for (const key of ["sourceAbsent", "adminAbsent", "featureRefAbsent"]) if (r[key] !== null && typeof r[key] !== "boolean") invalid("cleanup recovery observation");
    if (r.removeExit !== null && r.removeExit !== 0 || r.transactionExit !== null && r.transactionExit !== 0) invalid("cleanup recovery exit");
    result.recovery = { phase: choice(r.phase, ["capture", "preflight", "intent", "remove", "verify-removal", "record-removal", "usage-removal-transition", "before-delete", "delete-ref", "verify-delete", "completed-record"]),
      removeAttempted: r.removeAttempted as boolean, branchDeleteAttempted: r.branchDeleteAttempted as boolean, childTerminationConfirmed: r.childTerminationConfirmed as boolean,
      sourceAbsent: r.sourceAbsent as boolean | null, adminAbsent: r.adminAbsent as boolean | null, featureRefAbsent: r.featureRefAbsent as boolean | null,
      removeExit: r.removeExit as 0 | null, transactionExit: r.transactionExit as 0 | null };
    for (const key of ["usageRemovalAcknowledged", "completedRecorded", "leaseReleaseUncertain", "checkoutGateRetained"] as const)
      if (Object.hasOwn(r, key)) result.recovery[key] = r[key] as boolean;
  }
  return result;
}
function preparation(input: unknown, summary: boolean): NonNullable<GitActionCandidateSnapshot["preparation"]> {
  const v = fields(input, ["oldSourceOid", "newSourceOid", "targetMainOid", "resultTreeOid", "emptyRetention", "commitCount", "source", "target",
    ...(summary ? [] : ["commitMapping"])]);
  const count = integer(v.commitCount);
  if (count > GIT_ACTION_LIMITS.commitMapping) invalid("commit mapping size");
  const result: NonNullable<GitActionCandidateSnapshot["preparation"]> = {
    oldSourceOid: oid(v.oldSourceOid), newSourceOid: oid(v.newSourceOid), targetMainOid: oid(v.targetMainOid),
    resultTreeOid: oid(v.resultTreeOid), emptyRetention: choice(v.emptyRetention, ["keep"]), commitCount: count,
    source: checkout(v.source), target: checkout(v.target) };
  if (count === 0 && result.oldSourceOid !== result.newSourceOid
    || count > 0 && result.oldSourceOid === result.newSourceOid) invalid("preparation rewrite count");
  if (!summary) {
    result.commitMapping = array(v.commitMapping, GIT_ACTION_LIMITS.commitMapping, (input) => {
      const row = fields(input, ["oldOid", "newOid", "oldTreeOid", "newTreeOid", "emptyAfterReplay"]);
      if (typeof row.emptyAfterReplay !== "boolean") invalid("empty retention flag");
      return { oldOid: oid(row.oldOid), newOid: oid(row.newOid), oldTreeOid: oid(row.oldTreeOid),
        newTreeOid: oid(row.newTreeOid), emptyAfterReplay: row.emptyAfterReplay };
    });
    const rows = result.commitMapping;
    if (rows.length !== count || new Set(rows.map((row) => row.oldOid)).size !== count
      || new Set(rows.map((row) => row.newOid)).size !== count
      || (count === 0 ? result.oldSourceOid !== result.newSourceOid
        : rows.at(-1)!.oldOid !== result.oldSourceOid || rows.at(-1)!.newOid !== result.newSourceOid
          || rows.at(-1)!.newTreeOid !== result.resultTreeOid)) invalid("commit mapping mismatch");
  }
  return result;
}
function candidate(input: unknown, summary = false): GitActionCandidateSnapshot {
  const v = fields(input, ["kind", "repositoryRoot"], ["projectRoot", "sourceCheckoutRoot", "targetCheckoutRoot", "resourceAttribution", "featureBranch", "targetBranch", "message", "commitMode", "paths", "parentOid",
    "candidateTreeOid", "featureOid", "targetOid", "mergeOid", "integrationMethod", "checks", "selection", "workspace", "preparation", "checkoutVerification", "cleanup", "workingWorkspaceVerification", "diffUnavailable", ...(summary ? [] : ["diff"])]);
  const root = text(v.repositoryRoot, GIT_ACTION_LIMITS.pathBytes);
  if (!isAbsolute(root) && !win32.isAbsolute(root)) invalid("repository root");
  const result: GitActionCandidateSnapshot = { kind: choice(v.kind, KINDS), repositoryRoot: root };
  // Older v1 snapshots have no attribution. New ones must carry a complete
  // source pair, never a project-only guess or an unbound destination.
  if (v.projectRoot !== undefined || v.sourceCheckoutRoot !== undefined || v.targetCheckoutRoot !== undefined) {
    if (v.projectRoot === undefined || v.sourceCheckoutRoot === undefined) invalid("incomplete attribution");
    result.projectRoot = physicalPath(v.projectRoot);
    result.sourceCheckoutRoot = physicalPath(v.sourceCheckoutRoot);
    if (!samePath(root, result.sourceCheckoutRoot)) invalid("source checkout mismatch");
    if (v.targetCheckoutRoot !== undefined) {
      if (result.kind !== "integration" && result.kind !== "checks" && result.kind !== "review" && result.kind !== "preparation" && result.kind !== "cleanup") invalid("target checkout on commit");
      result.targetCheckoutRoot = physicalPath(v.targetCheckoutRoot);
    }
  }
  if (Object.hasOwn(v, "resourceAttribution")) {
    if (!result.projectRoot || !result.sourceCheckoutRoot) invalid("incomplete resource attribution");
    const a = fields(v.resourceAttribution, ["version", "commonDir", "commonIdentity", "projectIdentity"]);
    if (a.version !== 2) invalid("resource attribution version");
    const canonicalPath = (value: string) => {
      if (value !== (isAbsolute(value) ? resolve(value) : win32.resolve(value))) invalid("noncanonical resource path");
    };
    canonicalPath(root); canonicalPath(result.projectRoot); canonicalPath(result.sourceCheckoutRoot);
    if (result.targetCheckoutRoot) canonicalPath(result.targetCheckoutRoot);
    const commonDir = physicalPath(a.commonDir);
    canonicalPath(commonDir);
    result.resourceAttribution = { version: 2, commonDir,
      commonIdentity: directoryInstance(a.commonIdentity), projectIdentity: directoryInstance(a.projectIdentity) };
  }
  const nativeField = result.kind === "checkout-verification" ? "checkoutVerification" : result.kind;
  if (["workspace", "preparation", "checkout-verification", "cleanup"].includes(result.kind)) {
    fields(v, ["kind", "repositoryRoot", "projectRoot", "sourceCheckoutRoot", "resourceAttribution", nativeField],
      ["featureBranch", "targetBranch", "targetCheckoutRoot", "diffUnavailable", ...(summary ? [] : ["diff"])]);
    if (result.kind === "workspace") {
      if (Object.hasOwn(v, "targetBranch") || Object.hasOwn(v, "targetCheckoutRoot")) invalid("workspace target");
      result.workspace = workspace(v.workspace);
      if (samePath(result.workspace.destinationPath, root)) invalid("workspace destination");
      if (result.workspace.parentCreation && (!samePath(result.workspace.parentCreation.path, `${result.projectRoot}-worktrees`)
        || !samePath(result.workspace.parentCreation.ancestorPath, dirname(result.projectRoot!)))) invalid("nonconventional parent creation");
    } else if (result.kind === "preparation") {
      if (!result.targetCheckoutRoot || samePath(root, result.targetCheckoutRoot) || !v.featureBranch || !v.targetBranch) invalid("preparation checkouts");
      result.preparation = preparation(v.preparation, summary);
      if (v.featureBranch === v.targetBranch) invalid("preparation branch selection");
    } else if (result.kind === "checkout-verification") {
      if (Object.hasOwn(v, "targetBranch") || Object.hasOwn(v, "targetCheckoutRoot") || Object.hasOwn(v, "diff")) invalid("target-free verification");
      if (!v.featureBranch) invalid("verification source branch");
      result.checkoutVerification = checkoutVerification(v.checkoutVerification);
      for (const row of result.checkoutVerification.checks) {
        const cwd = isAbsolute(root) ? resolve(root, row.recipe.cwd ?? ".") : win32.resolve(root, row.recipe.cwd ?? ".");
        if (!samePath(cwd, row.executionCwd)) invalid("verification execution cwd mismatch");
        if (row.snapshot) {
          const s = row.snapshot, source = result.checkoutVerification.source, attribution = result.resourceAttribution!;
          const identities = { project: attribution.projectIdentity, checkout: source.checkoutIdentity,
            common: attribution.commonIdentity, git: source.gitIdentity, marker: source.markerIdentity };
          if (s.checkoutPath !== hash(root) || s.checkoutIdentity !== hash(JSON.stringify(identities))
            || s.resourceIdentity !== hash(attribution.commonDir + "\0" + JSON.stringify(attribution.commonIdentity))
            || s.branch !== hash(`refs/heads/${localBranch(v.featureBranch)}`) || s.head !== hash(result.checkoutVerification.sourceOid)
            || s.tree !== hash(result.checkoutVerification.sourceTreeOid)) invalid("clean checkout physical/source binding mismatch");
          if (samePath(cwd, root) && s.cwdIdentity !== hash(JSON.stringify({ cwd, ...source.checkoutIdentity }))) invalid("clean checkout cwd identity mismatch");
        }
      }
    } else {
      if (!result.targetCheckoutRoot || !v.featureBranch || !v.targetBranch || Object.hasOwn(v, "diff")) invalid("cleanup resources");
      result.cleanup = cleanupSnapshot(v.cleanup, summary);
      if (!samePath(result.cleanup.sourcePath, root) || !samePath(result.cleanup.targetPath, result.targetCheckoutRoot)
        || result.cleanup.branchRef !== `refs/heads/${v.featureBranch}` || v.featureBranch === v.targetBranch) invalid("cleanup resource mismatch");
    }
  } else if (["workspace", "preparation", "checkoutVerification", "cleanup"].some((key) => Object.hasOwn(v, key))) invalid("operation kind mismatch");
  if (Object.hasOwn(v, "workingWorkspaceVerification")) {
    if (result.kind !== "commit") invalid("working-workspace evidence on non-commit");
    result.workingWorkspaceVerification = workingEvidence(v.workingWorkspaceVerification);
  }
  for (const key of ["featureBranch", "targetBranch"] as const) if (v[key] !== undefined)
    result[key] = ["workspace", "preparation", "checkout-verification", "cleanup"].includes(result.kind) ? localBranch(v[key]) : text(v[key], 1024);
  if (v.message !== undefined) result.message = text(v.message, GIT_ACTION_LIMITS.messageBytes);
  if (v.commitMode !== undefined) {
    if (result.kind !== "commit") invalid("commit mode on non-commit action");
    result.commitMode = choice(v.commitMode, ["whole-file", "staged"]) as "whole-file" | "staged";
  }
  if (v.integrationMethod !== undefined) {
    if (result.kind !== "integration") invalid("integration method on non-integration action");
    result.integrationMethod = choice(v.integrationMethod, ["merge", "ff"]) as "merge" | "ff";
  }
  if (v.diffUnavailable !== undefined) result.diffUnavailable = text(v.diffUnavailable, GIT_ACTION_LIMITS.reasonBytes);
  if (v.paths !== undefined) result.paths = array(v.paths, GIT_ACTION_LIMITS.paths, (path) => text(path, GIT_ACTION_LIMITS.pathBytes));
  for (const key of ["parentOid", "candidateTreeOid", "featureOid", "targetOid", "mergeOid"] as const) if (v[key] !== undefined) result[key] = oid(v[key]);
  if (v.checks !== undefined) result.checks = array(v.checks, GIT_ACTION_LIMITS.checks, (check) => {
    const c = fields(check, ["label", "argv"]);
    const argv = array(c.argv, GIT_ACTION_LIMITS.checkArgs, (arg) => text(arg, 512));
    if (!argv.length || Buffer.byteLength(argv[0]) > 256) invalid("check executable");
    return { label: text(c.label, 80), argv };
  });
  if (v.selection !== undefined) {
    const s = fields(v.selection, ["kind"], ["commitOids"]);
    if (s.kind === "merge") {
      fields(s, ["kind"]);
      result.selection = { kind: "merge" };
    } else {
      choice(s.kind, ["commits"]);
      const commitOids = array(s.commitOids, GIT_ACTION_LIMITS.commitOids, oid);
      if (!commitOids.length) invalid("commit selection");
      result.selection = { kind: "commits", commitOids };
    }
  }
  if (v.diff !== undefined) {
    const d = fields(v.diff, ["fromTreeOid", "toTreeOid", "patch", "hasBinaryChanges"]);
    if (typeof d.hasBinaryChanges !== "boolean") invalid("binary flag");
    if (v.diffUnavailable !== undefined) invalid("ambiguous diff");
    result.diff = { fromTreeOid: oid(d.fromTreeOid), toTreeOid: oid(d.toTreeOid),
      patch: text(d.patch, GIT_ACTION_LIMITS.patchBytes, true), hasBinaryChanges: d.hasBinaryChanges };
    if (result.preparation && result.diff.toTreeOid !== result.preparation.resultTreeOid) invalid("preparation diff tree mismatch");
    if (result.workspace && result.diff.toTreeOid !== result.workspace.treeOid) invalid("workspace diff tree mismatch");
  }
  return result;
}
/** Pure bounded copy of server-captured display evidence; no storage, Git reads
 * or authority. Useful before projecting a live request without its patch. */
export function captureGitActionCandidateSnapshot(input: unknown): GitActionCandidateSnapshot {
  return candidate(input);
}
function summaryOf(value: GitActionCandidateSnapshot): GitActionRecord["summary"] {
  const summary = { ...value };
  delete summary.diff;
  if (summary.preparation) {
    summary.preparation = { ...summary.preparation };
    delete summary.preparation.commitMapping;
  }
  if (summary.cleanup) {
    summary.cleanup = { ...summary.cleanup };
    delete summary.cleanup.ignored;
  }
  return summary;
}
function outcome(input: unknown): GitActionOutcome {
  const v = fields(input, [], ["status", "commit", "tree", "parents", "authorEmail", "targetBranch", "featureOid", "targetOid", "mergeOid", "kind", "workspace", "preparation", "checkoutVerification", "cleanup", "workingWorkspaceVerification"]);
  const result: GitActionOutcome = {};
  if (Object.hasOwn(v, "kind")) {
    const kind = choice(v.kind, ["workspace", "preparation", "checkout-verification", "cleanup"] as const);
    result.kind = kind;
    const field = kind === "checkout-verification" ? "checkoutVerification" : kind;
    fields(v, ["kind", field], ["status"]);
    if (result.kind === "workspace") {
      const w = fields(v.workspace, ["mode", "destinationPath", "branch", "tipOid", "treeOid"], ["parentCreated", "knownParentCreation", "parentCreationAttempted", "phase", "addAttempted", "observedBranchOid", "destinationPresent"]);
      result.workspace = { mode: choice(w.mode, ["create", "attach"]), destinationPath: canonicalPath(w.destinationPath),
        branch: text(w.branch, 1024), tipOid: oid(w.tipOid), treeOid: oid(w.treeOid) };
      if (Object.hasOwn(w, "parentCreated")) {
        if (typeof w.parentCreated !== "boolean") invalid("parent-created flag");
        result.workspace.parentCreated = w.parentCreated;
      }
      if (Object.hasOwn(w, "parentCreationAttempted")) {
        if (typeof w.parentCreationAttempted !== "boolean") invalid("parent-creation attempt flag");
        result.workspace.parentCreationAttempted = w.parentCreationAttempted;
      }
      if (Object.hasOwn(w, "phase")) result.workspace.phase = choice(w.phase, ["intent", "before-add", "create-parent", "after-parent", "add", "verify", "completed-record"] as const);
      if (Object.hasOwn(w, "addAttempted")) {
        if (typeof w.addAttempted !== "boolean") invalid("workspace add attempt");
        result.workspace.addAttempted = w.addAttempted;
      }
      if (Object.hasOwn(w, "observedBranchOid")) result.workspace.observedBranchOid = w.observedBranchOid === null ? null : oid(w.observedBranchOid);
      if (Object.hasOwn(w, "destinationPresent")) {
        if (w.destinationPresent !== null && typeof w.destinationPresent !== "boolean") invalid("workspace destination observation");
        result.workspace.destinationPresent = w.destinationPresent as boolean | null;
      }
      if (Object.hasOwn(w, "knownParentCreation")) {
        const p = fields(w.knownParentCreation, ["path", "identity", "mode", "ownerUid", "ancestorPath", "ancestorIdentity"]);
        result.workspace.knownParentCreation = { path: canonicalPath(p.path), identity: directoryInstance(p.identity), mode: integer(p.mode),
          ownerUid: integer(p.ownerUid), ancestorPath: canonicalPath(p.ancestorPath), ancestorIdentity: directoryInstance(p.ancestorIdentity) };
      }
    } else if (kind === "preparation") {
      const p = fields(v.preparation, ["oldSourceOid", "newSourceOid", "targetMainOid", "resultTreeOid"]);
      result.preparation = { oldSourceOid: oid(p.oldSourceOid), newSourceOid: oid(p.newSourceOid),
        targetMainOid: oid(p.targetMainOid), resultTreeOid: oid(p.resultTreeOid) };
    } else if (kind === "checkout-verification") {
      const c = fields(v.checkoutVerification, [...CHECK_BINDING_KEYS, "runs"]);
      result.checkoutVerification = { ...checkBinding(c), runs: executions(c.runs) };
    } else result.cleanup = cleanupOutcome(v.cleanup);
  } else if (["workspace", "preparation", "checkoutVerification", "cleanup"].some((key) => Object.hasOwn(v, key))) invalid("result kind missing");
  if (Object.hasOwn(v, "workingWorkspaceVerification")) result.workingWorkspaceVerification = workingEvidence(v.workingWorkspaceVerification);
  for (const key of ["commit", "tree", "featureOid", "targetOid", "mergeOid"] as const) if (v[key] !== undefined) result[key] = oid(v[key]);
  if (v.parents !== undefined) result.parents = array(v.parents, 16, oid);
  for (const key of ["status", "authorEmail", "targetBranch"] as const) if (v[key] !== undefined) result[key] = text(v[key], 1024);
  return result;
}
/** Pure strict outcome copy. Never persist or expose native diagnostic objects
 * themselves, including when a later final-record write fails. */
export function captureGitActionOutcome(input: unknown): GitActionOutcome { return outcome(input); }
function transition(input: unknown): Transition {
  const v = fields(input, ["state"], ["decision", "intended", "outcome", "reason"]);
  return { state: choice(v.state, STATES),
    ...(v.decision !== undefined ? { decision: choice(v.decision, DECISIONS) } : {}),
    ...(v.intended !== undefined ? { intended: outcome(v.intended) } : {}),
    ...(v.outcome !== undefined ? { outcome: outcome(v.outcome) } : {}),
    ...(v.reason !== undefined ? { reason: text(v.reason, GIT_ACTION_LIMITS.reasonBytes) } : {}) };
}
function validateOperationRecord(value: GitActionRecord): void {
  const native = ["workspace", "preparation", "checkout-verification", "cleanup"].includes(value.kind);
  for (const evidence of [value.summary.workingWorkspaceVerification, value.intended?.workingWorkspaceVerification, value.outcome?.workingWorkspaceVerification]) {
    if (!evidence) continue;
    if (value.kind !== "commit" || evidence.runs.some((run) => run.sessionId !== value.sessionId || !insideCheckout(value.summary.repositoryRoot, run.executionCwd))) invalid("foreign commit working-workspace evidence");
    if (canonical(evidence) !== canonical(value.summary.workingWorkspaceVerification)) invalid("commit verification evidence mismatch");
  }
  if (!native) {
    if (value.intended?.kind || value.outcome?.kind) invalid("result kind mismatch");
    return;
  }
  if (value.decision === "reviewed" || value.decision === "dismissed") invalid("mutation review decision");
  const allowedOutcomeStates = value.kind === "checkout-verification" ? ["executing", "succeeded", "failed", "cancelled", "recovery-required"]
    : value.kind === "cleanup" ? ["executing", "succeeded", "recovery-required"] : ["succeeded", "recovery-required"];
  if (value.outcome && !allowedOutcomeStates.includes(value.state)) invalid("outcome before native completion");
  if ((value.kind === "checkout-verification" || value.kind === "cleanup") && value.outcome && !value.intended) invalid("captured intent must precede measured outcome");
  if (value.kind === "cleanup" && value.summary.cleanup!.ignoredCount > 0
    && ["executing", "succeeded", "recovery-required"].includes(value.state) && value.decision !== "approved") invalid("exact ignored-data deletion approval required");
  for (const [label, fact] of [["intended", value.intended], ["outcome", value.outcome]] as const) {
    if (!fact) continue;
    if (fact.kind !== value.kind) invalid("request/result kind mismatch");
    if (fact.status !== undefined) choice(fact.status, value.kind === "workspace" ? ["created", "attached", "partial-state"]
      : value.kind === "preparation" ? ["prepared", "already-prepared", "partial-state"]
        : value.kind === "checkout-verification" ? ["passed", "failed", "cancelled", "partial-state"] : ["worktree-removed", "cleaned-up", "partial-state"]);
    if (value.kind === "workspace") {
      const request = value.summary.workspace!, result = fact.workspace!;
      if (request.mode !== result.mode || request.destinationPath !== result.destinationPath
        || request.branch !== result.branch || request.tipOid !== result.tipOid || request.treeOid !== result.treeOid) invalid("workspace result mismatch");
      const plan = request.parentCreation, measured = result.knownParentCreation;
      if (!plan && (result.parentCreated !== undefined || result.parentCreationAttempted !== undefined || measured)
        || label === "intended" && (result.parentCreated !== undefined || result.parentCreationAttempted !== undefined || result.phase || measured)) invalid("unplanned/unmeasured parent creation");
      if (label === "intended" && (result.addAttempted !== undefined || result.observedBranchOid !== undefined || result.destinationPresent !== undefined)) invalid("workspace intent is not a measured effect");
      if (label === "outcome" && value.state === "succeeded" && (result.addAttempted === false || result.destinationPresent === false
        || Object.hasOwn(result, "observedBranchOid") && result.observedBranchOid !== request.tipOid)) invalid("workspace completion observation mismatch");
      if (measured && (!plan || result.parentCreated !== true || measured.path !== plan.path || measured.ancestorPath !== plan.ancestorPath
        || measured.mode !== plan.mode || canonical(measured.ancestorIdentity) !== canonical(plan.ancestorIdentity))) invalid("parent creation measurement mismatch");
      if (result.parentCreationAttempted === false && result.parentCreated === true) invalid("parent attempt/creation contradiction");
      if (result.parentCreated === true && !measured && (fact.status !== "partial-state" || result.parentCreationAttempted !== true)
        || label === "outcome" && value.state === "succeeded" && plan && (result.parentCreated !== true || !measured)) invalid("parent creation outcome missing");
    } else if (value.kind === "preparation") {
      const request = value.summary.preparation!, result = fact.preparation!;
      if (request.oldSourceOid !== result.oldSourceOid || request.targetMainOid !== result.targetMainOid
        || (label === "intended" || fact.status !== "partial-state")
          && (request.newSourceOid !== result.newSourceOid || request.resultTreeOid !== result.resultTreeOid)) invalid("preparation result mismatch");
    } else if (value.kind === "checkout-verification") {
      const request = value.summary.checkoutVerification!, result = fact.checkoutVerification!;
      for (const key of CHECK_BINDING_KEYS) if (canonical(request[key as keyof typeof request]) !== canonical(result[key as keyof typeof result])) invalid("verification binding mismatch");
      if (label === "intended" && result.runs.length) invalid("intended checks are not measured runs");
      for (const run of result.runs) {
        const recipe = request.checks.find((row) => row.checkIndex === run.checkIndex);
        if (!recipe || run.actionId !== value.id || run.sessionId !== value.sessionId || run.stage !== request.stage
          || run.policyDigest !== request.policyDigest || run.snapshotDigest !== (recipe.snapshot ? hash(JSON.stringify(recipe.snapshot)) : request.snapshotDigest) || run.recipeDigest !== recipe.recipeDigest
          || run.environmentDigest !== recipe.environmentDigest || run.executionCwd !== recipe.executionCwd) invalid("foreign/mismatched verification run");
      }
      if (label === "outcome" && fact.status === "passed" && ((!result.runs.length || value.state !== "executing" && result.runs.length !== request.checks.length)
        || result.runs.some((run) => !run.receipt))) invalid("incomplete passing verification evidence");
    } else {
      const request = value.summary.cleanup!, result = fact.cleanup!;
      for (const key of CLEANUP_BINDING_KEYS) if (request[key as keyof typeof request] !== result[key as keyof typeof result]) invalid("cleanup binding mismatch");
      if (label === "intended" && (result.effects.length || result.ignoredDataDeletionApproved || result.observedFeatureOid !== undefined
        || result.nativeHeadReflogMayHaveChanged || result.recovery)) invalid("intended cleanup is not a measured effect");
      if (result.recovery && fact.status !== "partial-state") invalid("cleanup recovery is not completed cleanup");
      for (const effect of result.effects) {
        if (effect.kind === "worktree-removed") {
          if (effect.sourcePath !== request.sourcePath || canonical(effect.sourceIdentity) !== canonical(request.source.checkoutIdentity)
            || effect.adminPath !== request.source.gitDir || effect.featureOid !== request.featureOid) invalid("cleanup removal mismatch");
        } else if (effect.branchRef !== request.branchRef || effect.deletedOid !== request.featureOid) invalid("cleanup branch deletion mismatch");
      }
      if (label === "outcome" && request.ignoredCount > 0 && result.effects.length && result.ignoredDataDeletionApproved !== true) invalid("ignored deletion approval evidence missing");
      if (fact.status === "worktree-removed" && (result.effects.length !== 1 || !["executing", "recovery-required"].includes(value.state))
        || fact.status === "cleaned-up" && (result.effects.length !== 2 || !result.nativeHeadReflogMayHaveChanged)) invalid("cleanup completion effect mismatch");
    }
  }
  if (value.outcome?.status === "partial-state" && value.state !== "recovery-required") invalid("partial outcome requires manual recovery");
  if (value.kind === "checkout-verification" && value.outcome && value.state !== "recovery-required") {
    const expected = value.state === "succeeded" ? "passed" : value.state;
    if (value.state === "executing") {
      // The native callback has measured terminal unit facts, but admission
      // settlement and receipt registration still follow this durable write.
      if (!["passed", "failed", "cancelled"].includes(value.outcome.status ?? "") || !value.outcome.checkoutVerification!.runs.length)
        invalid("executing verification requires actual measured progress");
    } else if (value.outcome.status !== expected) invalid("verification outcome state mismatch");
    if (value.outcome.checkoutVerification!.runs.some((run) => !run.containmentComplete)) invalid("uncontained verification requires recovery");
  }
  if (value.state === "succeeded") {
    const expected = value.kind === "workspace" ? value.summary.workspace!.mode === "create" ? "created" : "attached"
      : value.kind === "preparation" ? value.summary.preparation!.oldSourceOid === value.summary.preparation!.newSourceOid ? "already-prepared" : "prepared"
        : value.kind === "checkout-verification" ? "passed" : "cleaned-up";
    if (value.outcome?.status !== expected) invalid("verified native outcome required");
  }
}
function record(input: unknown, id: string): GitActionRecord {
  const v = fields(input, ["version", "id", "sessionId", "source", "kind", "state", "revision", "createdAt", "updatedAt", "processId", "summary", "artifact"],
    ["decision", "intended", "outcome", "reason"]);
  if (v.version !== 1 || uuid(v.id) !== id) invalid("record version or identity");
  const s = candidate(v.summary, true);
  const a = fields(v.artifact, ["sha256", "bytes"]);
  const bytes = integer(a.bytes, 1);
  if (bytes > GIT_ACTION_LIMITS.artifactBytes || s.kind !== v.kind) invalid("artifact size or kind");
  const createdAt = integer(v.createdAt), updatedAt = integer(v.updatedAt);
  if (updatedAt < createdAt) invalid("timestamps");
  const result: GitActionRecord = { version: 1, id, sessionId: sessionId(v.sessionId), source: choice(v.source, SOURCES), kind: s.kind,
    revision: integer(v.revision, 1), createdAt, updatedAt, processId: uuid(v.processId), summary: s,
    artifact: { sha256: digest(a.sha256), bytes }, ...transition({ state: v.state,
      ...(v.decision !== undefined ? { decision: v.decision } : {}), ...(v.outcome !== undefined ? { outcome: v.outcome } : {}),
      ...(v.intended !== undefined ? { intended: v.intended } : {}), ...(v.reason !== undefined ? { reason: v.reason } : {}) }) };
  validateOperationRecord(result);
  return result;
}
function bounded(value: unknown, max: number): string {
  const data = canonical(value);
  if (Buffer.byteLength(data) > max) invalid("document size");
  return data;
}
function recordDocument(value: GitActionRecord): { data: string; sha256: string } {
  const sha256 = hash(canonical(value));
  return { data: bounded({ version: 1, record: value, sha256 }, GIT_ACTION_LIMITS.recordBytes), sha256 };
}
function location(id: string, agentDir: string): { dir: string; folders: string[] } {
  uuid(id); // Validate before constructing any filesystem path.
  const agent = resolve(text(agentDir, 16 * 1024));
  const web = join(agent, "pi-web"), actions = join(web, "git-actions"), version = join(actions, "v1");
  return { dir: join(version, id), folders: [agent, web, actions, version, join(version, id)] };
}
function syncDirectory(dir: string): void {
  // Windows does not support opening/fsyncing directories this way.
  if (process.platform === "win32") return;
  const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function checkDirectory(dir: string, privateMode: boolean): void {
  const info = fs.lstatSync(dir);
  if (!info.isDirectory() || info.isSymbolicLink()
    || privateMode && process.platform !== "win32" && (info.mode & 0o077) !== 0) invalid("private directory");
}
function createDirectories(folders: string[]): void {
  const firstCreated = fs.mkdirSync(folders[0], { recursive: true, mode: 0o700 });
  checkDirectory(folders[0], false);
  if (firstCreated) {
    // Persist each newly created ancestor as well as the eventual file entries.
    for (let child = folders[0]; ; child = dirname(child)) {
      syncDirectory(dirname(child));
      if (child === firstCreated) break;
    }
  }
  for (let i = 1; i < folders.length; i++) {
    let created = false;
    try { fs.mkdirSync(folders[i], { mode: 0o700 }); created = true; }
    catch (error) {
      // Never reuse an action UUID, even an incomplete prior creation.
      if (i === folders.length - 1 || (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    checkDirectory(folders[i], false);
    if (process.platform !== "win32") fs.chmodSync(folders[i], 0o700);
    if (created) syncDirectory(dirname(folders[i]));
  }
}
function checkDirectories(folders: string[]): void { folders.forEach((dir, i) => checkDirectory(dir, i !== 0)); }
/** Bounded descriptor read: refuse symlinks, devices/FIFOs, hardlinks and public files. */
function readBytes(file: string, max: number): Buffer {
  const before = fs.lstatSync(file);
  const safe = (info: typeof before) => info.isFile() && info.nlink === 1 && info.size <= max
    && (process.platform === "win32" || (info.mode & 0o077) === 0);
  if (!safe(before)) invalid("private file or size");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const info = fs.fstatSync(fd);
    if (!safe(info) || info.dev !== before.dev || info.ino !== before.ino) invalid("changed file");
    const buffer = Buffer.alloc(info.size + 1);
    let used = 0;
    while (used < buffer.length) {
      const count = fs.readSync(fd, buffer, used, buffer.length - used, used);
      if (!count) break;
      used += count;
    }
    const after = fs.fstatSync(fd);
    if (used !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) invalid("changed file");
    return buffer.subarray(0, used);
  } finally { fs.closeSync(fd); }
}
function parse(data: Buffer): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); }
/** Same-directory publication; no rollback of a possibly installed record on failure. */
function writeAtomic(file: string, data: string, exclusive: boolean): void {
  const temp = join(dirname(file), `.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, data, { encoding: "utf8", flag: "wx", mode: 0o600, flush: true });
    if (exclusive) { fs.linkSync(temp, file); fs.unlinkSync(temp); }
    else fs.renameSync(temp, file);
    syncDirectory(dirname(file));
  } finally {
    // Only our staging name, never the record/artifact; cleanup cannot undo a commit.
    try { fs.unlinkSync(temp); } catch { /* A failed write stays failed; no replay or retention deletion. */ }
  }
}
function loadRecord(dir: string, id: string): { record: GitActionRecord; sha256: string } {
  const data = readBytes(join(dir, "record.json"), GIT_ACTION_LIMITS.recordBytes);
  const v = fields(parse(data), ["version", "record", "sha256"]);
  if (v.version !== 1) invalid("document version");
  const value = record(v.record, id), encoded = recordDocument(value);
  if (digest(v.sha256) !== encoded.sha256 || !data.equals(Buffer.from(encoded.data))) invalid("record digest");
  const liveDigest = runtime().active.get(dir);
  if (liveDigest !== undefined && liveDigest !== encoded.sha256) invalid("live record digest");
  return { record: value, sha256: encoded.sha256 };
}
function loadCandidate(dir: string, value: GitActionRecord): GitActionCandidateSnapshot {
  const data = readBytes(join(dir, "candidate.json"), Math.min(GIT_ACTION_LIMITS.artifactBytes, value.artifact.bytes));
  if (data.length !== value.artifact.bytes || hash(data) !== value.artifact.sha256) invalid("artifact digest or size");
  const v = fields(parse(data), ["version", "candidate"]);
  if (v.version !== 1) invalid("artifact version");
  const snapshot = candidate(v.candidate);
  if (!data.equals(Buffer.from(canonical({ version: 1, candidate: snapshot })))
    || canonical(summaryOf(snapshot)) !== canonical(value.summary)) invalid("artifact metadata");
  return snapshot;
}
function project(value: GitActionRecord, dir: string, artifactAvailable: boolean): GitActionRecord {
  if (!isTerminalGitAction(value.state)
    && (!artifactAvailable || value.processId !== runtime().processId || !runtime().active.has(dir))) {
    return { ...value, state: value.state === "executing" ? "recovery-required" : "expired",
      reason: value.state === "executing" ? "Execution was interrupted; inspect the actual Git state before any new action."
        : "This action is no longer live; request a new candidate to continue." };
  }
  return value;
}
async function withLock<T>(key: string, action: () => T): Promise<T> {
  const locks = runtime().locks, prior = locks.get(key) ?? Promise.resolve();
  let unlock!: () => void;
  const held = new Promise<void>((done) => { unlock = done; });
  const tail = prior.then(() => held);
  locks.set(key, tail);
  await prior;
  try { return action(); }
  finally { unlock(); if (locks.get(key) === tail) locks.delete(key); }
}
function publish(session: string, event: GitActionUpdateEvent): void {
  for (const listener of [...(runtime().listeners.get(session) ?? [])]) {
    try {
      // Also contain accidental async observers; their failures cannot turn a
      // durable mutation into a reported failure or an unhandled rejection.
      void Promise.resolve(listener(Object.freeze({ ...event }))).catch(() => {});
    } catch { /* Observers are not transaction participants. GET reconciles missed events. */ }
  }
}

type CreateGitActionInput = { sessionId: string; source: GitActionSource; candidate: GitActionCandidateSnapshot };
export async function createGitAction(input: CreateGitActionInput, agentDir = getAgentDir()): Promise<GitActionRecord> {
  return createAction(input, randomUUID(), agentDir);
}
/** INTERNAL trusted composition only: recordId is the cryptographic UUID from
 * one single-use native capture (or a fresh preparation journal identity), never
 * a tool/model/route parameter. UUID membership conveys no authority. Exclusive
 * directory creation refuses even incomplete existing IDs; no overwrite/upsert. */
export async function createGitActionWithId(recordId: string, input: CreateGitActionInput,
  agentDir = getAgentDir()): Promise<GitActionRecord> {
  uuid(recordId);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(recordId)) invalid("native UUID");
  return createAction(input, recordId, agentDir, true);
}
async function createAction(input: CreateGitActionInput, id: string, agentDir: string, nativeId = false): Promise<GitActionRecord> {
  const v = fields(input, ["sessionId", "source", "candidate"]);
  const session = sessionId(v.sessionId), source = choice(v.source, SOURCES), snapshot = candidate(v.candidate);
  if (nativeId && !["workspace", "preparation", "checkout-verification", "cleanup"].includes(snapshot.kind)) invalid("native ID action kind");
  const artifact = bounded({ version: 1, candidate: snapshot }, GIT_ACTION_LIMITS.artifactBytes);
  const now = Date.now(), { dir, folders } = location(id, agentDir);
  const value: GitActionRecord = { version: 1, id, sessionId: session, source, kind: snapshot.kind, state: "proposed", revision: 1,
    createdAt: now, updatedAt: now, processId: runtime().processId, summary: summaryOf(snapshot),
    artifact: { sha256: hash(artifact), bytes: Buffer.byteLength(artifact) } };
  validateOperationRecord(value);
  const document = recordDocument(value); // All input/serialized bounds precede storage writes.
  createDirectories(folders);
  writeAtomic(join(dir, "candidate.json"), artifact, true);
  writeAtomic(join(dir, "record.json"), document.data, true);
  runtime().active.set(dir, document.sha256); // Never recover membership from disk.
  publish(session, { type: "git_action_update", actionId: id, revision: 1 });
  return value;
}

export async function transitionGitAction(
  id: string, expectedRevision: number, patch: Transition, agentDir = getAgentDir(),
): Promise<GitActionRecord> {
  const { dir, folders } = location(id, agentDir);
  integer(expectedRevision, 1);
  const update = transition(patch); // Capture before waiting; no caller-owned references.
  return withLock(dir, () => {
    checkDirectories(folders);
    const current = loadRecord(dir, id).record;
    if (isTerminalGitAction(current.state)) throw new Error("Git action is terminal and read-only");
    if (current.processId !== runtime().processId || !runtime().active.has(dir)) throw new Error("Git action is no longer live; history is read-only");
    if (current.revision !== expectedRevision) throw new Error("Git action revision conflict");
    if (!NEXT[current.state]?.includes(update.state)
      || update.state === "succeeded" && current.state === "proposed"
        && (current.kind !== "review" || update.decision !== undefined || update.intended !== undefined || update.outcome !== undefined)
      || current.state === "awaiting-decision" && update.state === "succeeded" && current.kind !== "review") {
      throw new Error(`Illegal Git action transition: ${current.state} -> ${update.state}`);
    }
    const cleanupProgress = current.kind === "cleanup" && update.state === "executing" && update.outcome?.status === "worktree-removed"
      && update.intended === undefined && update.decision === undefined;
    const verificationProgress = current.kind === "checkout-verification" && current.state === "executing" && current.intended !== undefined
      && update.state === "executing" && update.outcome?.kind === "checkout-verification"
      && ["passed", "failed", "cancelled"].includes(update.outcome.status ?? "")
      && update.intended === undefined && update.decision === undefined && update.reason === undefined;
    if (current.kind === "checkout-verification" && update.state === "executing" && update.outcome !== undefined && !verificationProgress)
      invalid("verification measurements must follow recorded execution intent");
    if (current.state === "executing" && update.state === "executing" && !cleanupProgress && !verificationProgress
      && (update.intended === undefined || update.decision !== undefined || update.outcome !== undefined)) {
      throw new Error("Executing Git action updates may only journal pre-ref intent or bound native measurements");
    }
    if (current.decision !== undefined && update.decision !== undefined && current.decision !== update.decision) {
      throw new Error("Git action decision is immutable");
    }
    if (update.intended !== undefined && (update.state !== "executing"
      || current.intended !== undefined && canonical(current.intended) !== canonical(update.intended))) {
      throw new Error("Git action intended result is immutable and must precede completion");
    }
    const captured = loadCandidate(dir, current); // Verifies artifact/summary identity and OID syntax; never trust a caller-supplied patch.
    if (current.state === "proposed" && update.state === "succeeded" &&
      (!captured.diff || !captured.selection || !captured.featureBranch || !captured.targetBranch ||
        !captured.featureOid || !captured.targetOid)) {
      // Direct completion attests only that a bounded comparison was captured,
      // not that a human reviewed it. Older awaiting-decision reviews keep their
      // original edge and may lack these fields.
      throw new Error("Incomplete Git review comparison artifact");
    }
    const next: GitActionRecord = { ...current, ...update, revision: integer(current.revision + 1, 1),
      updatedAt: integer(Math.max(Date.now(), current.updatedAt + 1)) };
    validateOperationRecord(next);
    if (current.kind === "checkout-verification" && current.outcome?.checkoutVerification) {
      const before = current.outcome.checkoutVerification.runs, after = next.outcome?.checkoutVerification?.runs;
      if (!after || after.length < before.length || canonical(after.slice(0, before.length)) !== canonical(before)) invalid("measured check executions are immutable");
      if (verificationProgress && after.length <= before.length) invalid("verification progress must append actual measured executions");
    }
    if (current.kind === "cleanup" && current.outcome?.cleanup) {
      const before = current.outcome.cleanup.effects, after = next.outcome?.cleanup?.effects;
      if (!after || after.length < before.length || canonical(after.slice(0, before.length)) !== canonical(before)) invalid("measured cleanup effects are immutable");
    }
    const document = recordDocument(next);
    try { writeAtomic(join(dir, "record.json"), document.data, false); }
    catch (error) {
      // Publication/fsync may already have happened. Do not retry a mutation,
      // restore an old record, or pretend its engine capability is still live.
      runtime().active.delete(dir);
      throw error;
    }
    if (isTerminalGitAction(next.state)) runtime().active.delete(dir);
    else runtime().active.set(dir, document.sha256);
    publish(next.sessionId, { type: "git_action_update", actionId: id, revision: next.revision });
    return next;
  });
}

/** History only: no session lookup, Git/worktree reads, repairs or capability reconstruction. */
export async function readGitAction(
  id: string, options: { includeArtifact?: boolean } = {}, agentDir = getAgentDir(),
): Promise<GitActionHistoryResponse> {
  const { dir, folders } = location(id, agentDir);
  const v = fields(options, [], ["includeArtifact"]);
  if (v.includeArtifact !== undefined && typeof v.includeArtifact !== "boolean") invalid("read options");
  let value: GitActionRecord;
  try { checkDirectories(folders); value = loadRecord(dir, id).record; }
  catch (error) {
    return { record: null, unavailable: (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "Git action history is unavailable." : "Git action record is invalid, unsupported or unreadable." };
  }
  let snapshot: GitActionCandidateSnapshot;
  try { snapshot = loadCandidate(dir, value); }
  catch {
    return { record: project(value, dir, false), unavailable: "Captured Git candidate is missing, invalid or unreadable; current Git content is not a substitute." };
  }
  return { record: project(value, dir, true), ...(options.includeArtifact ? { candidate: snapshot } : {}) };
}

export function releaseGitAction(id: string, agentDir = getAgentDir()): void {
  runtime().active.delete(location(id, agentDir).dir);
}
export function subscribeGitActionUpdates(session: string, listener: Listener): () => void {
  sessionId(session);
  if (typeof listener !== "function") invalid("listener");
  const listeners = runtime().listeners;
  const group = listeners.get(session) ?? new Set<Listener>();
  group.add(listener);
  listeners.set(session, group);
  return () => { group.delete(listener); if (group.size === 0 && listeners.get(session) === group) listeners.delete(session); };
}
/** The controller appends the SDK anchor first; publishing it never creates liveness. */
export function emitGitActionAnchor(session: string, event: GitActionUpdateEvent): void {
  sessionId(session);
  const v = fields(event, ["type", "actionId", "revision"], ["entryId", "timestamp"]);
  if (v.type !== "git_action_update") invalid("event type");
  publish(session, { type: "git_action_update", actionId: uuid(v.actionId), revision: integer(v.revision, 1),
    ...(v.entryId !== undefined ? { entryId: text(v.entryId, 256) } : {}),
    ...(v.timestamp !== undefined ? { timestamp: integer(v.timestamp) } : {}) });
}
