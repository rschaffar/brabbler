import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import fs, { type BigIntStats } from "node:fs";
import { isAbsolute, resolve, win32 } from "node:path";
import { readGitAction } from "./git-action-journal";
import { GIT_ACTION_ANCHOR_TYPE, GIT_ACTION_ID_PATTERN, isGitActionAnchor,
  type GitActionCandidateSnapshot, type GitActionSource } from "./git-action-types";

export const GIT_AGENT_PATCH_CHUNK_BYTES = 24 * 1024;
/** Fail closed instead of partially scanning a large or structurally excessive history. */
export const GIT_AGENT_SESSION_HISTORY_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024, entryBytes: 1024 * 1024, entries: 50_000, depth: 64,
});

/** The ONLY caller-controlled input. Offsets and limits are UTF-8 bytes, not JS indices. */
export interface GitAgentActionArtifactRequest {
  actionId: string;
  offset: number;
  /** 4..24KiB; default 24KiB. Four bytes guarantees progress for any Unicode scalar. */
  limitBytes?: number;
}
export interface GitAgentActionArtifactBootstrap {
  sessionManager: Pick<SessionManager, "getHeader" | "getSessionId" | "getCwd" | "getSessionFile" | "isPersisted" | "getEntries" | "getLeafId">;
  /** Trusted dispatch identity, NEVER values taken from tool arguments. */
  sessionId: string;
  cwd: string;
  /** Authorize the referring session's saved cwd without requiring it to exist. */
  authorizeRoot: (cwd: string) => boolean | Promise<boolean>;
  /** Test-only storage injection at trusted bootstrap, never a request field. */
  agentDir?: string;
}
type CapturedCandidate = Omit<GitActionCandidateSnapshot, "diff" | "diffUnavailable" | "checks">;
export type GitAgentActionArtifactResult = {
  status: "ok";
  attribution: { actionId: string; sessionId: string; source: GitActionSource; createdAt: number };
  candidate: CapturedCandidate;
  patch: null | {
    text: string;
    fromTreeOid: string;
    toTreeOid: string;
    hasBinaryChanges: boolean;
    sha256: string;
    offset: number;
    returnedBytes: number;
    totalBytes: number;
    nextOffset: number | null;
    end: boolean;
    /** False for a prefix, suffix, or middle chunk; never describe a chunk as the whole patch. */
    completePatch: boolean;
  };
  unavailable?: string;
} | { status: "invalid-request" | "denied" | "unavailable"; error: string };

const invalid = (): GitAgentActionArtifactResult => ({ status: "invalid-request", error: "Invalid captured Git patch request." });
const denied = (): GitAgentActionArtifactResult => ({ status: "denied", error: "Captured Git action access denied." });
const unavailable = (): GitAgentActionArtifactResult => ({ status: "unavailable", error: "Captured Git artifact is unavailable." });

/** Plain own data properties only: no getters, inherited fields, symbols or hidden extras. */
function plain(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const props = Object.getOwnPropertyDescriptors(value);
  return required.every((key) => Object.hasOwn(props, key)) && Reflect.ownKeys(value).every((key) =>
    typeof key === "string" && (required.includes(key) || optional.includes(key))
    && props[key].enumerable && "value" in props[key]);
}
function anchor(entry: unknown): entry is { data: { version: 1; actionId: string } } {
  return plain(entry, ["type", "id", "parentId", "timestamp", "customType", "data"])
    && entry.type === "custom" && entry.customType === GIT_ACTION_ANCHOR_TYPE
    && typeof entry.id === "string" && entry.id.length > 0
    && (entry.parentId === null || typeof entry.parentId === "string")
    && typeof entry.timestamp === "string" && Number.isFinite(Date.parse(entry.timestamp))
    && plain(entry.data, ["version", "actionId"]) && isGitActionAnchor(entry.data);
}
function boundary(bytes: Buffer, offset: number): boolean {
  return offset === bytes.length || (bytes[offset] & 0xc0) !== 0x80;
}

const SESSION_HEADER_BYTES = 16 * 1024;
interface SessionFileProof { path: string; identity: string; parents: string[]; headerSha256: string }
interface ManagerHistory { sha256: string; leafId: string }
interface HeldSessionFile {
  fd: number; proof: SessionFileProof; fingerprint: string;
  historySha256?: string; managerHistory?: ManagerHistory;
}
interface RawNode { id: string; parentId: string | null; type: string; customType?: unknown; data?: unknown }
interface PersistedHistory { sha256: string; entriesSha256: string; nodes: Map<string, RawNode> }
function identity(stat: BigIntStats): string { return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`; }
function fingerprint(stat: BigIntStats): string { return `${identity(stat)}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`; }
function unsafeSession(): never { throw new Error("Session file proof unavailable"); }

/** Only the bounded first line is parsed; no transcript content is used or returned. */
function sessionHeader(fd: number, sessionId: string, cwd: string): string {
  const bytes = Buffer.alloc(SESSION_HEADER_BYTES + 1);
  let used = 0, newline = -1;
  while (used < bytes.length && newline === -1) {
    const count = fs.readSync(fd, bytes, used, bytes.length - used, used);
    if (!count) break;
    used += count;
    newline = bytes.subarray(0, used).indexOf(10);
  }
  if (newline < 0 || newline > SESSION_HEADER_BYTES) unsafeSession();
  const line = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, newline));
  const header: unknown = JSON.parse(line);
  if (!plain(header, ["type", "version", "id", "timestamp", "cwd"], ["parentSession"])
    || header.type !== "session" || ![1, 2, 3].includes(header.version as number)
    || header.id !== sessionId || header.cwd !== cwd
    || typeof header.timestamp !== "string" || !Number.isFinite(Date.parse(header.timestamp))
    || Object.hasOwn(header, "parentSession") && typeof header.parentSession !== "string"
    || JSON.stringify(header) !== line) unsafeSession();
  return createHash("sha256").update(line).digest("hex");
}

/** Stable full-FD read, never an unbounded readFile or a truncated history scan. */
function sessionBytes(held: HeldSessionFile): Buffer {
  const before = fs.fstatSync(held.fd, { bigint: true });
  if (before.size > BigInt(GIT_AGENT_SESSION_HISTORY_LIMITS.bytes) || fingerprint(before) !== held.fingerprint) unsafeSession();
  const bytes = Buffer.alloc(Number(before.size) + 1);
  let used = 0;
  while (used < bytes.length) {
    const count = fs.readSync(held.fd, bytes, used, bytes.length - used, used);
    if (!count) break;
    used += count;
  }
  if (used !== Number(before.size) || fingerprint(fs.fstatSync(held.fd, { bigint: true })) !== held.fingerprint) unsafeSession();
  return bytes.subarray(0, used);
}

/** JSON wire form of trusted cached state: omit undefined object fields as the SDK writer does. */
function entryWire(value: unknown): string {
  let remaining = GIT_AGENT_SESSION_HISTORY_LIMITS.entryBytes;
  const take = (text: string) => {
    remaining -= Buffer.byteLength(text);
    if (remaining < 0) unsafeSession();
    return text;
  };
  const encode = (value: unknown, depth: number): string => {
    if (depth > GIT_AGENT_SESSION_HISTORY_LIMITS.depth) unsafeSession();
    if (value === null || typeof value === "boolean") return take(JSON.stringify(value));
    if (typeof value === "number" && Number.isFinite(value)) return take(JSON.stringify(value));
    if (typeof value === "string") {
      if (value.length > remaining) unsafeSession();
      return take(JSON.stringify(value));
    }
    if (!value || typeof value !== "object") unsafeSession();
    const props = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      if (value.length > GIT_AGENT_SESSION_HISTORY_LIMITS.entryBytes || Reflect.ownKeys(value).length !== value.length + 1) unsafeSession();
      take("[]" + ",".repeat(Math.max(0, value.length - 1)));
      const items: string[] = [];
      for (let i = 0; i < value.length; i++) {
        const property = props[String(i)];
        if (!property?.enumerable || !("value" in property)) unsafeSession();
        items.push(encode(property.value === undefined ? null : property.value, depth + 1));
      }
      return `[${items.join(",")}]`;
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) unsafeSession();
    const parts: string[] = [];
    take("{}");
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !props[key].enumerable || !("value" in props[key])) unsafeSession();
      if (props[key].value === undefined) continue;
      if (parts.length) take(",");
      const name = encode(key, depth + 1); take(":");
      parts.push(`${name}:${encode(props[key].value, depth + 1)}`);
    }
    return `{${parts.join(",")}}`;
  };
  return encode(value, 0);
}

function cachedHistory(manager: GitAgentActionArtifactBootstrap["sessionManager"]): ManagerHistory {
  const leafId = manager.getLeafId(), entries: readonly unknown[] = manager.getEntries();
  if (typeof leafId !== "string" || !leafId || leafId.length > 128 || !Array.isArray(entries)
    || entries.length > GIT_AGENT_SESSION_HISTORY_LIMITS.entries) unsafeSession();
  const digest = createHash("sha256");
  let bytes = 0;
  for (const entry of entries) {
    const wire = entryWire(entry);
    bytes += Buffer.byteLength(wire) + 1;
    if (bytes > GIT_AGENT_SESSION_HISTORY_LIMITS.bytes) unsafeSession();
    digest.update(wire).update("\n");
  }
  if (manager.getLeafId() !== leafId) unsafeSession();
  return { leafId, sha256: digest.digest("hex") };
}

/** Strict raw JSONL/tree reconciliation, not keyword search or a projection/compaction view. */
function persistedHistory(held: HeldSessionFile): PersistedHistory {
  const bytes = sessionBytes(held), lines = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\n");
  if (lines.pop() !== "" || lines.length - 1 > GIT_AGENT_SESSION_HISTORY_LIMITS.entries
    || createHash("sha256").update(lines[0]).digest("hex") !== held.proof.headerSha256) unsafeSession();
  const nodes = new Map<string, RawNode>(), digest = createHash("sha256");
  const types = ["message", "model_change", "thinking_level_change", "compaction", "branch_summary", "custom", "custom_message", "label", "session_info", "context_edit", "usage"];
  for (const line of lines.slice(1)) {
    if (!line || Buffer.byteLength(line) > GIT_AGENT_SESSION_HISTORY_LIMITS.entryBytes) unsafeSession();
    const entry: unknown = JSON.parse(line);
    if (!entry || typeof entry !== "object" || !plain(entry, ["type", "id", "parentId", "timestamp"], Object.keys(entry))
      || typeof entry.id !== "string" || !entry.id || entry.id.length > 128 || nodes.has(entry.id)
      || typeof entry.type !== "string" || !types.includes(entry.type)
      || typeof entry.timestamp !== "string" || entry.timestamp.length > 128 || !Number.isFinite(Date.parse(entry.timestamp))
      || entry.parentId !== null && (typeof entry.parentId !== "string" || !nodes.has(entry.parentId))
      || entryWire(entry) !== line) unsafeSession();
    const id = entry.id;
    if (entry.customType === GIT_ACTION_ANCHOR_TYPE && !anchor(entry)) unsafeSession();
    nodes.set(id, entry as unknown as RawNode);
    digest.update(line).update("\n");
  }
  return { nodes, entriesSha256: digest.digest("hex"), sha256: createHash("sha256").update(bytes).digest("hex") };
}

function referencedOnBranch(history: PersistedHistory, state: ManagerHistory, actionId: string): boolean {
  if (history.entriesSha256 !== state.sha256 || !history.nodes.has(state.leafId)) return false;
  let current: string | null = state.leafId, referenced = false;
  const visited = new Set<string>();
  while (current !== null) {
    const node = history.nodes.get(current);
    if (!node || visited.has(current)) return false;
    visited.add(current);
    if (anchor(node) && node.data.actionId === actionId) referenced = true;
    current = node.parentId;
  }
  return referenced;
}

/**
 * Linux descriptor-relative traversal pins every physical parent, not just the
 * leaf. No realpath rediscovery or symlink following. Other platforms fail closed
 * until an equally strong descriptor-relative implementation is available.
 */
function holdSessionFile(file: string, sessionId: string, cwd: string): HeldSessionFile {
  if (process.platform !== "linux" || !isAbsolute(file) || resolve(file) !== file || !file.endsWith(".jsonl")) unsafeSession();
  const components = file.split("/").filter(Boolean), parents: string[] = [];
  let parent = fs.openSync("/", fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  let fd: number | undefined;
  try {
    parents.push(identity(fs.fstatSync(parent, { bigint: true })));
    for (const component of components.slice(0, -1)) {
      const next = fs.openSync(`/proc/self/fd/${parent}/${component}`, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      fs.closeSync(parent); parent = next;
      parents.push(identity(fs.fstatSync(parent, { bigint: true })));
    }
    fd = fs.openSync(`/proc/self/fd/${parent}/${components.at(-1)}`, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== BigInt(1) || before.size === BigInt(0)
      || before.size > BigInt(GIT_AGENT_SESSION_HISTORY_LIMITS.bytes)
      || typeof process.getuid === "function" && before.uid !== BigInt(process.getuid())) unsafeSession();
    const headerSha256 = sessionHeader(fd, sessionId, cwd), after = fs.fstatSync(fd, { bigint: true });
    if (fingerprint(before) !== fingerprint(after)) unsafeSession();
    return { fd, proof: { path: file, identity: identity(after), parents, headerSha256 }, fingerprint: fingerprint(after) };
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    throw error;
  } finally { fs.closeSync(parent); }
}
function sameProof(a: SessionFileProof, b: SessionFileProof): boolean {
  return a.path === b.path && a.identity === b.identity && a.headerSha256 === b.headerSha256
    && a.parents.length === b.parents.length && a.parents.every((parent, i) => parent === b.parents[i]);
}

/**
 * Internal, on-demand history read for future dispatch integration. Bootstrap must
 * come from the CURRENT persisted session, not a caller-selected session lookup.
 * Reconcile bounded actual JSONL against the manager's full raw history and
 * trusted leaf. Only persisted anchors on that leaf's ancestry authorize a read;
 * old/compacted and fork-copied anchors there remain read-only references.
 * Cached-only/off-branch entries and action IDs alone authorize nothing.
 * No wrappers, UI waits, Git/checkout discovery, receipts, grants or writes.
 * Journal schema/digest/private-storage validation remains the sole artifact reader.
 */
export function createGitAgentActionArtifactReader(bootstrap: GitAgentActionArtifactBootstrap) {
  // Capture bootstrap values; caller-controlled request data cannot replace dependencies.
  const { sessionManager: manager, sessionId, cwd, authorizeRoot, agentDir } = bootstrap;
  const sameManager = () => {
    const header = manager.getHeader();
    return !!header && manager.isPersisted()
      && typeof sessionId === "string" && !!sessionId && header.id === sessionId && manager.getSessionId() === sessionId
      && typeof cwd === "string" && !!cwd && !cwd.includes("\0") && (isAbsolute(cwd) || win32.isAbsolute(cwd))
      && header.cwd === cwd && manager.getCwd() === cwd;
  };
  // Bootstrap proof precedes ANY anchor read. Retain identity, not an unbounded
  // open descriptor; each invocation holds its own FD across authorization/I/O.
  let initial: SessionFileProof | undefined;
  try {
    const file = manager.getSessionFile();
    if (sameManager() && typeof file === "string") {
      const held = holdSessionFile(file, sessionId, cwd);
      try { initial = held.proof; } finally { fs.closeSync(held.fd); }
    }
  } catch { /* Allocated/unwritten, malformed or redirected files grant no read. */ }
  const sameSession = (held: HeldSessionFile) => {
    let current: HeldSessionFile | undefined;
    try {
      if (!initial || !sameManager() || manager.getSessionFile() !== initial.path
        || fingerprint(fs.fstatSync(held.fd, { bigint: true })) !== held.fingerprint) return false;
      current = holdSessionFile(initial.path, sessionId, cwd);
      if (!sameProof(initial, held.proof) || !sameProof(initial, current.proof)
        || current.fingerprint !== held.fingerprint) return false;
      if (held.historySha256 !== undefined
        && (createHash("sha256").update(sessionBytes(held)).digest("hex") !== held.historySha256
          || createHash("sha256").update(sessionBytes(current)).digest("hex") !== held.historySha256)) return false;
      if (held.managerHistory) {
        const state = cachedHistory(manager);
        if (state.leafId !== held.managerHistory.leafId || state.sha256 !== held.managerHistory.sha256) return false;
      }
      return true;
    } catch { return false; }
    finally { if (current) fs.closeSync(current.fd); }
  };
  return async (input: unknown): Promise<GitAgentActionArtifactResult> => {
    let actionId: string, offset: number, limit: number;
    try {
      if (!plain(input, ["actionId", "offset"], ["limitBytes"])
        || typeof input.actionId !== "string" || !GIT_ACTION_ID_PATTERN.test(input.actionId)
        || !Number.isSafeInteger(input.offset) || (input.offset as number) < 0
        || Object.hasOwn(input, "limitBytes") && (!Number.isSafeInteger(input.limitBytes)
          || (input.limitBytes as number) < 4 || (input.limitBytes as number) > GIT_AGENT_PATCH_CHUNK_BYTES)) return invalid();
      actionId = input.actionId;
      offset = input.offset as number;
      limit = (input.limitBytes as number | undefined) ?? GIT_AGENT_PATCH_CHUNK_BYTES;
    } catch { return invalid(); }
    let held: HeldSessionFile | undefined;
    let authorized = false;
    try {
      if (!initial || !sameManager() || manager.getSessionFile() !== initial.path) return denied();
      held = holdSessionFile(initial.path, sessionId, cwd);
      if (!sameSession(held) || typeof authorizeRoot !== "function" || await authorizeRoot(cwd) !== true) return denied();
      // The callback may await; reject file/path/header changes before anchors.
      if (!sameSession(held)) return denied();
      const persisted = persistedHistory(held), state = cachedHistory(manager);
      held.historySha256 = persisted.sha256;
      held.managerHistory = state;
      if (!referencedOnBranch(persisted, state, actionId) || !sameSession(held)) return denied();
      authorized = true;
      const history = await readGitAction(actionId, { includeArtifact: true }, agentDir);
      if (!sameSession(held)) return denied();
      if (!history.record || !history.candidate || history.unavailable) return unavailable();
      const diff = history.candidate.diff;
      const candidate = { ...history.candidate };
      delete candidate.diff;
      delete candidate.diffUnavailable;
      delete candidate.checks;
      const attribution = { actionId, sessionId: history.record.sessionId, source: history.record.source, createdAt: history.record.createdAt };
      if (!diff) {
        if (offset !== 0) return invalid();
        return { status: "ok", attribution, candidate, patch: null, unavailable: "No patch was captured for this Git action." };
      }
      const bytes = Buffer.from(diff.patch, "utf8");
      // The journal permits escaped lone surrogates. They cannot be paginated as exact UTF-8 text.
      if (bytes.toString("utf8") !== diff.patch) return unavailable();
      if (offset > bytes.length || !boundary(bytes, offset)) return invalid();
      let endOffset = Math.min(bytes.length, offset + limit);
      while (!boundary(bytes, endOffset)) endOffset--;
      const end = endOffset === bytes.length;
      return { status: "ok", attribution, candidate, patch: {
        text: bytes.subarray(offset, endOffset).toString("utf8"), fromTreeOid: diff.fromTreeOid, toTreeOid: diff.toTreeOid,
        hasBinaryChanges: diff.hasBinaryChanges, sha256: createHash("sha256").update(bytes).digest("hex"),
        offset, returnedBytes: endOffset - offset, totalBytes: bytes.length, nextOffset: end ? null : endOffset,
        end, completePatch: offset === 0 && end,
      } };
    } catch {
      if (held && !sameSession(held)) return denied();
      return authorized ? unavailable() : denied();
    } finally { if (held) fs.closeSync(held.fd); }
  };
}
