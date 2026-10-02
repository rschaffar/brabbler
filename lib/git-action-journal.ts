import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { dirname, isAbsolute, join, resolve, win32 } from "node:path";
import { samePath } from "./paths";
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
  checks: 12, checkArgs: 33, commitOids: 1000,
});
const KINDS = ["commit", "review", "checks", "integration"] as const;
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
/** Only called on validated, acyclic data; object insertion order is not identity. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
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
function candidate(input: unknown, summary = false): GitActionCandidateSnapshot {
  const v = fields(input, ["kind", "repositoryRoot"], ["projectRoot", "sourceCheckoutRoot", "targetCheckoutRoot", "resourceAttribution", "featureBranch", "targetBranch", "message", "commitMode", "paths", "parentOid",
    "candidateTreeOid", "featureOid", "targetOid", "mergeOid", "integrationMethod", "checks", "selection", "diffUnavailable", ...(summary ? [] : ["diff"])]);
  const physicalPath = (value: unknown): string => {
    const path = text(value, GIT_ACTION_LIMITS.pathBytes);
    if (!isAbsolute(path) && !win32.isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path) || path !== path.trim()) invalid("checkout path");
    return path;
  };
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
      if (result.kind !== "integration" && result.kind !== "checks" && result.kind !== "review") invalid("target checkout on commit");
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
  for (const key of ["featureBranch", "targetBranch"] as const) if (v[key] !== undefined) result[key] = text(v[key], 1024);
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
  }
  return result;
}
function summaryOf(value: GitActionCandidateSnapshot): GitActionRecord["summary"] {
  const summary = { ...value };
  delete summary.diff;
  return summary;
}
function outcome(input: unknown): GitActionOutcome {
  const v = fields(input, [], ["status", "commit", "tree", "parents", "authorEmail", "targetBranch", "featureOid", "targetOid", "mergeOid"]);
  const result: GitActionOutcome = {};
  for (const key of ["commit", "tree", "featureOid", "targetOid", "mergeOid"] as const) if (v[key] !== undefined) result[key] = oid(v[key]);
  if (v.parents !== undefined) result.parents = array(v.parents, 16, oid);
  for (const key of ["status", "authorEmail", "targetBranch"] as const) if (v[key] !== undefined) result[key] = text(v[key], 1024);
  return result;
}
function transition(input: unknown): Transition {
  const v = fields(input, ["state"], ["decision", "intended", "outcome", "reason"]);
  return { state: choice(v.state, STATES),
    ...(v.decision !== undefined ? { decision: choice(v.decision, DECISIONS) } : {}),
    ...(v.intended !== undefined ? { intended: outcome(v.intended) } : {}),
    ...(v.outcome !== undefined ? { outcome: outcome(v.outcome) } : {}),
    ...(v.reason !== undefined ? { reason: text(v.reason, GIT_ACTION_LIMITS.reasonBytes) } : {}) };
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
  return { version: 1, id, sessionId: sessionId(v.sessionId), source: choice(v.source, SOURCES), kind: s.kind,
    revision: integer(v.revision, 1), createdAt, updatedAt, processId: uuid(v.processId), summary: s,
    artifact: { sha256: digest(a.sha256), bytes }, ...transition({ state: v.state,
      ...(v.decision !== undefined ? { decision: v.decision } : {}), ...(v.outcome !== undefined ? { outcome: v.outcome } : {}),
      ...(v.intended !== undefined ? { intended: v.intended } : {}), ...(v.reason !== undefined ? { reason: v.reason } : {}) }) };
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

export async function createGitAction(
  input: { sessionId: string; source: GitActionSource; candidate: GitActionCandidateSnapshot }, agentDir = getAgentDir(),
): Promise<GitActionRecord> {
  const v = fields(input, ["sessionId", "source", "candidate"]);
  const session = sessionId(v.sessionId), source = choice(v.source, SOURCES), snapshot = candidate(v.candidate);
  const artifact = bounded({ version: 1, candidate: snapshot }, GIT_ACTION_LIMITS.artifactBytes);
  const id = randomUUID(), now = Date.now(), { dir, folders } = location(id, agentDir);
  const value: GitActionRecord = { version: 1, id, sessionId: session, source, kind: snapshot.kind, state: "proposed", revision: 1,
    createdAt: now, updatedAt: now, processId: runtime().processId, summary: summaryOf(snapshot),
    artifact: { sha256: hash(artifact), bytes: Buffer.byteLength(artifact) } };
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
    if (current.state === "executing" && update.state === "executing"
      && (update.intended === undefined || update.decision !== undefined || update.outcome !== undefined)) {
      throw new Error("Executing Git action updates may only journal pre-ref intent");
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
