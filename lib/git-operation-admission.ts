import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { selectGitProjectResources, revalidateGitProjectResources, type GitProjectResources } from "./git-project-resources";
import { readGitAction } from "./git-action-journal";
import { GIT_ACTION_ID_PATTERN, type GitActionKind } from "./git-action-types";

/**
 * Server-only conservative admission ledger for supervised commits. A reservation
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
const KINDS: readonly GitActionKind[] = ["commit", "review", "checks", "integration"];
type Phase = "intent" | "resolved";
/** Digests keep arbitrary repo paths, branch names and ref output out of bounded ledger files. */
export type GitCheckSnapshot = { version: 1; featurePath: string; targetPath: string;
  featureIdentity: string; targetIdentity: string; resourceIdentity: string;
  featureBranch: string; targetBranch: string; featureOid: string; targetOid: string;
  reviewDigest: string; policyDigest: string; checkDigest: string;
  featureIndex: string; targetIndex: string; featureStatus: string; targetStatus: string; refs: string };
export type GitCheckCleanupProof = { unit: string; cgroupIdentity: string; invocation: string; empty: true;
  emptyEvidence: "pinned-populated-zero" | "verified-removed"; terminal: true;
  payload: "release-attempted" | "prevented-before-write" };
export type GitCheckOutcome = { status: number | null; timedOut: boolean; overflow: boolean;
  containmentComplete: boolean; logDigest: string; finishedAt: number };
type CheckPre = { version: 1; id: string; actionId: string; resource: string; unit: string; snapshot: GitCheckSnapshot };
type CheckPost = { version: 1; id: string; actionId: string; resource: string; unit: string;
  preSha256: string; snapshot: GitCheckSnapshot; cleanupProof: GitCheckCleanupProof; outcome: GitCheckOutcome;
  source: "linux-systemd" | "node-test-simulated" };
type Evidence = { version: 1; id: string; actionId: string; kind: GitActionKind; resource: string;
  phase: Phase; createdAt: number; resolvedAt?: number; checkUnit?: string; disposition?: "recovered" };
/** Construct only on the server after an explicit human review of this exact check.
 * This is an assertion by the caller, not a substitute for repository/process revalidation. */
export type GitCheckHumanReviewReceipt = Readonly<{ kind: "human-reviewed-git-check-recovery";
  id: string; actionId: string; resource: string; unit: string; proofIdentifier: string }>;
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
   * Do not call on a rejected/aborted check or an uncertain Git update. */
  resolve(): void;
  /** Recheck durable reservation and intent inside the final native apply gate. */
  assertOwned(): void;
  /** Immutable recovery artifacts only; neither method releases quarantine. */
  recordCheckBefore(snapshot: GitCheckSnapshot): void;
  recordCheckAfter(snapshot: GitCheckSnapshot, proof: GitCheckCleanupProof, outcome: GitCheckOutcome,
    source: "linux-systemd" | "node-test-simulated"): void;
}
function deny(): never { throw new Error("Git operation admission unavailable; inspect the resource ledger manually"); }
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const CHECK_UNIT = /^pi-web-git-check-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.service$/;
const HASH = /^[a-f0-9]{64}$/;
const INVOCATION = /^[a-fA-F0-9]{32}$/;
const SNAPSHOT_KEYS = ["version", "featurePath", "targetPath", "featureIdentity", "targetIdentity", "resourceIdentity",
  "featureBranch", "targetBranch", "featureOid", "targetOid", "reviewDigest", "policyDigest", "checkDigest",
  "featureIndex", "targetIndex", "featureStatus", "targetStatus", "refs"];
function validSnapshot(value: unknown): value is GitCheckSnapshot {
  return keys(value, SNAPSHOT_KEYS) && value.version === 1 &&
    SNAPSHOT_KEYS.slice(1).every((key) => HASH.test(value[key] as string));
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
function readFile(file: string): Buffer {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_DOCUMENT
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
    ...(Object.hasOwn(value as object, "disposition") ? ["disposition"] : [])]) ||
    value.version !== 1 || value.id !== id || !uuid(value.actionId) || !KINDS.includes(value.kind as GitActionKind) ||
    value.resource !== resource || !["intent", "resolved"].includes(value.phase as string) ||
    (value.kind === "checks" ? !CHECK_UNIT.test(value.checkUnit as string) : Object.hasOwn(value, "checkUnit")) ||
    !Number.isSafeInteger(value.createdAt) || (value.createdAt as number) < 0 ||
    (value.phase === "intent" && Object.hasOwn(value, "resolvedAt")) ||
    (value.phase === "resolved" && (!Number.isSafeInteger(value.resolvedAt) || (value.resolvedAt as number) < (value.createdAt as number))) ||
    (Object.hasOwn(value, "disposition") && (value.disposition !== "recovered" || value.phase !== "resolved" || value.kind !== "checks")) ||
    outer.sha256 !== sha(JSON.stringify(value)) || !bytes.equals(Buffer.from(encode(value as Evidence)))) deny();
  return value as unknown as Evidence;
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
  if (entries.length > entryLimit() * 3 + 1) deny();
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
    const match = /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(json|pre|post)$/.exec(name);
    if (!match) deny();
    if (match[2] !== "json") { artifacts.add(name); continue; }
    const value = load(path.join(dir, name), commonDir, match[1]);
    records.set(match[1], value);
    if (value.phase === "intent") actions.push(value.actionId);
  }
  if (records.size > entryLimit()) deny();
  for (const record of records.values()) {
    if (record.disposition === "recovered" &&
      (!artifacts.has(`${record.id}.pre`) || !artifacts.has(`${record.id}.post`))) deny();
  }
  for (const artifact of artifacts) {
    const id = artifact.slice(0, artifact.endsWith(".post") ? -5 : -4);
    const intent = records.get(id);
    if (!intent || intent.kind !== "checks") deny();
    const pre = loadCheck(path.join(dir, `${id}.pre`), intent, "pre");
    if (artifact.endsWith(".post")) {
      const post = loadCheck(path.join(dir, artifact), intent, "post") as CheckPost;
      if (post.preSha256 !== sha(encodeCheck(pre)) ||
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
  if (post && post.preSha256 !== sha(encodeCheck(pre))) deny();
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
  freshSnapshot: GitCheckSnapshot, proofIdentifier: string, receipt: GitCheckHumanReviewReceipt): void {
  if (!uuid(id) || !uuid(actionId) || !validSnapshot(freshSnapshot) || !INVOCATION.test(proofIdentifier)) deny();
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
    JSON.stringify(freshSnapshot) !== JSON.stringify(post.snapshot) ||
    post.cleanupProof.invocation !== proofIdentifier ||
    !keys(receipt, ["kind", "id", "actionId", "resource", "unit", "proofIdentifier"]) ||
    receipt.kind !== "human-reviewed-git-check-recovery" || receipt.id !== id || receipt.actionId !== actionId ||
    receipt.resource !== commonDir || receipt.unit !== intent.checkUnit || receipt.proofIdentifier !== proofIdentifier) deny();
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
export function beginGitOperationIntent(agentDir: string, commonDir: string, actionId: string, kind: GitActionKind,
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
  const assertOwned = () => {
    if (finished) deny();
    directory(gate);
    if (fs.readdirSync(gate).length !== 1 || !readFile(path.join(gate, "owner")).equals(Buffer.from(owner))
      || load(file, commonDir, id).phase !== "intent") deny();
  };
  return { actionId, id, assertOwned,
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
      writeCheck(path.join(dir, `${id}.post`), { version: 1, id, actionId, resource: commonDir, unit: checkUnit!,
        preSha256: sha(encodeCheck(pre)), snapshot, cleanupProof: proof, outcome, source });
    },
    resolve() {
    assertOwned();
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
    write(file, { ...record, phase: "resolved", resolvedAt: Math.max(Date.now(), record.createdAt) }, false);
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
async function assertNoHistoricalRecovery(agentDir: string, commonDir: string, ownId: string): Promise<void> {
  const base = path.join(agentDir, "pi-web", "git-actions", "v1");
  if (!fs.existsSync(base)) return;
  // The journal owns the directory layout; never follow links during an admission scan.
  for (const dir of [agentDir, path.join(agentDir, "pi-web"), path.join(agentDir, "pi-web", "git-actions"), base]) physicalDirectory(dir);
  // Walk one entry at a time. A global count cap would quarantine an unrelated
  // repository after enough settled cards elsewhere; the durable operation
  // ledger itself remains bounded per Git resource. Every historical action
  // is still inspected, including old uncertainty with no classifiable root.
  const history = fs.opendirSync(base);
  try { for (let entry; (entry = history.readSync()) !== null;) {
    const id = entry.name;
    if (!entry.isDirectory() || !uuid(id)) throw new GitOperationRecoveryError();
    const item = await readGitAction(id, { includeArtifact: true }, agentDir);
    if (!item.record) throw new GitOperationRecoveryError(id);
    // The action being confirmed must still have its captured candidate;
    // process-local previews do not replace missing durable review evidence.
    if (id === ownId) {
      if (item.unavailable || !item.candidate) throw new GitOperationRecoveryError(id);
      continue;
    }
    // A decision never approved for execution is safe to ignore even when its
    // captured artifact has since disappeared. Other missing artifacts remain
    // blockers for their resource; an old blocked or succeeded action without
    // evidence must not be silently treated as an unrelated declined preview.
    if (["declined", "expired", "cancelled"].includes(item.record.state)) continue;
    if (item.unavailable || !item.candidate) {
      if (item.record.summary.repositoryRoot === commonDir || item.record.state === "executing"
        || item.record.state === "recovery-required") throw new GitOperationRecoveryError(id);
      // The missing artifact might belong to another checkout of this repo;
      // resolve the canonical resource below before deciding it is unrelated.
    } else if (item.record.state !== "executing" && item.record.state !== "recovery-required") continue;
    // If the old checkout was removed or cannot be inspected, it cannot be
    // proven unrelated. No global migration/clear based on session liveness.
    let old: GitProjectResources;
    try { old = await selectGitProjectResources(item.record.summary.repositoryRoot); }
    catch { throw new GitOperationRecoveryError(id); }
    if (old.commonDir === commonDir) throw new GitOperationRecoveryError(id);
  } } finally { history.closeSync(); }
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
    await assertNoHistoricalRecovery(agentDir, selection.commonDir, ownActionId);
  } catch { throw new GitOperationRecoveryError(); }
  await revalidateGitProjectResources(selection);
}

/** Reserve the physical Git common directory before launching checks or applying
 * a ref/checkout mutation. A positive local result is not recovery evidence:
 * only the caller can resolve after recording the exact outcome and positively
 * proving any spawned check children have stopped. */
export async function beginSupervisedGitOperationIntent(selection: GitProjectResources, actionId: string,
  kind: "commit" | "checks" | "integration", agentDir = getAgentDir(), checkUnit?: string): Promise<GitOperationReservation> {
  await revalidateGitProjectResources(selection);
  // Reject known legacy quarantine before publishing our own intent. Otherwise
  // an unrelated old blocker strands a second, avoidable orphan on this checkout.
  try { await assertNoHistoricalRecovery(agentDir, selection.commonDir, actionId); }
  catch { throw new GitOperationRecoveryError(actionId); }
  let operation: GitOperationReservation;
  try { operation = beginGitOperationIntent(agentDir, selection.commonDir, actionId, kind, checkUnit); }
  catch { throw new GitOperationRecoveryError(actionId); }
  try { await assertNoHistoricalRecovery(agentDir, selection.commonDir, actionId); }
  catch { // Do not release a reservation if history changed during admission.
    throw new GitOperationRecoveryError(actionId);
  }
  return operation;
}
export function beginSupervisedGitCommitIntent(selection: GitProjectResources, actionId: string): Promise<GitOperationReservation> {
  return beginSupervisedGitOperationIntent(selection, actionId, "commit");
}
export async function revalidateGitCommitAdmission(selection: GitProjectResources): Promise<void> {
  await revalidateGitProjectResources(selection);
}
