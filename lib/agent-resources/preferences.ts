import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, rmdirSync, writeFileSync, type BigIntStats } from "node:fs";
import { join, posix } from "node:path";
import { performance } from "node:perf_hooks";
import { createSelectionIdentity, selectionKey, type SelectionChoice, type SelectionContext, type SelectionIdentity } from "./selection";

/** Isolated W05a/W06a store. No live imports/callers; activation remains gated.
 * Contexts are ALREADY ADMITTED by the caller. These opaque comparisons do NOT
 * prove canonical Git checkout membership, session ownership or HTTP authority
 * (W05b). No cwd/sessionId lookup, trust marker, native settings or content access.
 * The directory containing agentDir is caller-owned; hostile same-user ancestor
 * substitution is not made atomic by portable path-based Node operations. */
export const PREFERENCES_MAX_BYTES = 4 * 1024 * 1024;
export const PREFERENCES_MAX_TARGETS = 1000;
export const PREFERENCES_MAX_CHOICES = 10_000;
export type PreferenceTarget = Readonly<{ scope: "global"; binding: null } | { scope: "project" | "session"; binding: string }>;
export interface PreferenceChoice { readonly identity: SelectionIdentity; readonly value: "enabled" | "disabled" }
export interface PreferenceSnapshot {
  readonly target: PreferenceTarget;
  /** Desired OWN choices only, never effective, eligible, applied or authorized. */
  readonly choices: readonly PreferenceChoice[];
  readonly revision: string;
  readonly importReceipt: ImportReceipt | null;
}
/** Already admitted same-path/scope evidence, NOT native capture/derivation or
 * authorization. References are bounded provenance labels, never settings backups.
 * The target enclosing the receipt and the agentDir namespace bind its context. */
export interface ImportDecision extends PreferenceChoice {
  readonly rule: "whole-package-off" | "individual";
  readonly evidence: readonly string[];
}
export interface ImportReceipt {
  readonly ruleVersion: 1;
  readonly evidenceDigest: string;
  readonly fragments: readonly Readonly<{ reference: string; digest: string; provenance: "native-filter" | "explicit-resolution" }>[];
  readonly decisions: readonly ImportDecision[];
}
export class PreferencesError extends Error {
  constructor(readonly code: "schema" | "limit" | "json" | "read" | "private" | "generation" | "conflict" | "locked" | "scope") {
    super(`Resource preferences refused: ${code}`); this.name = "PreferencesError";
  }
}
function need(condition: unknown, code: PreferencesError["code"]): asserts condition {
  if (!condition) throw new PreferencesError(code);
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  need(value !== null && typeof value === "object" && !Array.isArray(value), "schema");
  const item = value as Record<string, unknown>;
  need(Object.keys(item).length === keys.length && keys.every(key => Object.hasOwn(item, key)), "schema");
  return item;
}
function text(value: unknown): string {
  need(typeof value === "string" && value.length > 0 && value.length <= 16_384 && value.isWellFormed()
    && !/[\x00-\x1f\x7f]/.test(value), "schema");
  return value;
}
function path(value: unknown): string {
  const name = text(value);
  need(name.startsWith("/") && !name.startsWith("//") && !name.split("/").includes(".."), "schema");
  const normalized = posix.normalize(name).replace(/\/$/, "");
  need(normalized.length > 0, "schema"); return normalized;
}
function contextCopy(input: SelectionContext): SelectionContext {
  const value = record(input, ["agentDir", "projectBinding", "sessionBinding"]);
  return Object.freeze({ agentDir: path(value.agentDir), projectBinding: value.projectBinding === null ? null : text(value.projectBinding),
    sessionBinding: value.sessionBinding === null ? null : text(value.sessionBinding) });
}
function targetCopy(input: unknown): PreferenceTarget {
  const value = record(input, ["scope", "binding"]);
  if (value.scope === "global") { need(value.binding === null, "schema"); return Object.freeze({ scope: "global", binding: null }); }
  need(value.scope === "project" || value.scope === "session", "schema");
  return Object.freeze({ scope: value.scope, binding: text(value.binding) });
}
function admitTarget(context: SelectionContext, input: PreferenceTarget): PreferenceTarget {
  const target = targetCopy(input);
  if (target.scope !== "global") need(context[target.scope === "project" ? "projectBinding" : "sessionBinding"] === target.binding, "scope");
  return target;
}
function identityCopy(input: unknown, agentDir: string): SelectionIdentity {
  need(input !== null && typeof input === "object", "schema");
  const kind = (input as { kind?: unknown }).kind;
  const value = record(input, ["agentDir", "origin", "kind", kind === "group" ? "groupKey" : "path"]);
  const originInput = value.origin as { scope?: unknown } | null;
  const origin = record(originInput, originInput?.scope === "global" ? ["scope"] : ["scope", "binding"]);
  need(origin.scope === "global" || origin.scope === "project", "schema");
  need(path(value.agentDir) === agentDir, "scope");
  const normalized = { agentDir, origin: origin.scope === "global" ? { scope: "global" as const }
    : { scope: "project" as const, binding: text(origin.binding) }, kind,
  ...(kind === "group" ? { groupKey: text(value.groupKey) } : { path: path(value.path) }) };
  need(kind === "group" || kind === "package" || kind === "skill" || kind === "extension", "schema");
  return createSelectionIdentity(normalized as SelectionIdentity);
}
function choicesCopy(input: unknown, agentDir: string, target: PreferenceTarget): readonly PreferenceChoice[] {
  need(Array.isArray(input) && input.length <= PREFERENCES_MAX_CHOICES, "limit");
  const keys = new Set<string>();
  return Object.freeze(input.map(item => {
    const value = record(item, ["identity", "value"]), identity = identityCopy(value.identity, agentDir), key = selectionKey(identity);
    need(!keys.has(key), "schema"); keys.add(key);
    need(value.value === "enabled" || value.value === "disabled", "schema");
    need(!(target.scope === "global" && identity.origin.scope === "project"), "scope");
    if (target.scope === "project" && identity.origin.scope === "project") need(identity.origin.binding === target.binding, "scope");
    return Object.freeze({ identity, value: value.value });
  }).sort((a, b) => selectionKey(a.identity).localeCompare(selectionKey(b.identity))));
}
const digestCopy = (value: unknown): string => {
  need(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), "schema"); return value;
};
function receiptCopy(input: unknown, agentDir: string, target: PreferenceTarget): ImportReceipt {
  need(target.scope !== "session", "scope");
  const value = record(input, ["ruleVersion", "evidenceDigest", "fragments", "decisions"]);
  need(value.ruleVersion === 1, "schema");
  need(Array.isArray(value.fragments) && value.fragments.length > 0 && value.fragments.length <= 256, "limit");
  const references = new Set<string>();
  const label = (input: unknown) => { const result = text(input); need(result.length <= 256, "limit"); return result; };
  const fragments = Object.freeze(value.fragments.map(input => {
    const fragment = record(input, ["reference", "digest", "provenance"]), reference = label(fragment.reference);
    need(!references.has(reference), "schema"); references.add(reference);
    need(fragment.provenance === "native-filter" || fragment.provenance === "explicit-resolution", "schema");
    return Object.freeze({ reference, digest: digestCopy(fragment.digest), provenance: fragment.provenance });
  }));
  need(Array.isArray(value.decisions) && value.decisions.length <= PREFERENCES_MAX_CHOICES, "limit");
  const keys = new Set<string>();
  const decisions = Object.freeze(value.decisions.map(input => {
    const decision = record(input, ["identity", "value", "rule", "evidence"]);
    const choice = choicesCopy([{ identity: decision.identity, value: decision.value }], agentDir, target)[0];
    const key = selectionKey(choice.identity); need(!keys.has(key), "schema"); keys.add(key);
    // No historical Session import, group inference or cross-scope overrides.
    need(choice.identity.origin.scope === target.scope, "scope");
    need((decision.rule === "whole-package-off" && choice.identity.kind === "package" && choice.value === "disabled")
      || (decision.rule === "individual" && (choice.identity.kind === "skill" || choice.identity.kind === "extension")), "schema");
    need(Array.isArray(decision.evidence) && decision.evidence.length > 0 && decision.evidence.length <= 256, "limit");
    const evidence = decision.evidence.map(label);
    need(new Set(evidence).size === evidence.length && evidence.every(ref => references.has(ref)), "schema");
    return Object.freeze({ ...choice, rule: decision.rule, evidence: Object.freeze(evidence) });
  }));
  return Object.freeze({ ruleVersion: 1, evidenceDigest: digestCopy(value.evidenceDigest), fragments, decisions });
}
interface TargetState { target: PreferenceTarget; generation: string; choices: readonly PreferenceChoice[]; importReceipt: ImportReceipt | null }
interface Store { version: 1; id: string; targets: readonly TargetState[] }
const uuid = (value: unknown): string => { need(typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value), "schema"); return value; };

/** Strict duplicate-aware JSON, bounded before allocating a whole object graph.
 * Local parser avoids coupling persistence to catalog metadata/discovery. */
function decode(input: string): unknown {
  let i = 0, nodes = 0;
  const space = () => { while (/[ \t\r\n]/.test(input[i] ?? "!")) i++; };
  const string = (): string => {
    const start = i++;
    while (i < input.length) {
      const char = input[i++];
      if (char === "\\") { i++; continue; }
      if (char === '"') { try { return JSON.parse(input.slice(start, i)); } catch { throw new PreferencesError("json"); } }
    }
    throw new PreferencesError("json");
  };
  const value = (depth: number): unknown => {
    need(depth <= 16 && ++nodes <= 150_000, "limit"); space();
    const char = input[i];
    if (char === '"') return string();
    if (char === "{" || char === "[") {
      const object = char === "{", end = object ? "}" : "]";
      const result: Record<string, unknown> = Object.create(null), array: unknown[] = [], keys = new Set<string>();
      i++; space(); if (input[i] === end) { i++; return object ? result : array; }
      while (i < input.length) {
        if (object) {
          need(input[i] === '"', "json"); const key = string(); need(!keys.has(key), "json"); keys.add(key);
          space(); need(input[i++] === ":", "json"); result[key] = value(depth + 1);
        } else array.push(value(depth + 1));
        space(); if (input[i] === end) { i++; return object ? result : array; }
        need(input[i++] === ",", "json"); space();
      }
      throw new PreferencesError("json");
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(input.slice(i));
    need(token, "json"); i += token[0].length;
    const parsed: unknown = JSON.parse(token[0]); need(typeof parsed !== "number" || Number.isFinite(parsed), "json"); return parsed;
  };
  const result = value(0); space(); need(i === input.length, "json"); return result;
}
export function parsePreferences(input: string | Uint8Array, admittedAgentDir: string): Readonly<Store> {
  const agentDir = path(admittedAgentDir);
  need((typeof input === "string" || input instanceof Uint8Array)
    && (typeof input === "string" ? Buffer.byteLength(input) : input.byteLength) <= PREFERENCES_MAX_BYTES, "limit");
  let json: string;
  try { json = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input); }
  catch { throw new PreferencesError("json"); }
  const root = record(decode(json), ["version", "id", "targets"]);
  need(root.version === 1, "schema"); const id = uuid(root.id);
  need(Array.isArray(root.targets) && root.targets.length <= PREFERENCES_MAX_TARGETS, "limit");
  const keys = new Set<string>(); let total = 0;
  const targets = root.targets.map(item => {
    const entry = record(item, ["target", "generation", "choices", "importReceipt"]), target = targetCopy(entry.target), key = JSON.stringify(target);
    need(!keys.has(key), "schema"); keys.add(key);
    const choices = choicesCopy(entry.choices, agentDir, target); total += choices.length; need(total <= PREFERENCES_MAX_CHOICES, "limit");
    const importReceipt = entry.importReceipt === null ? null : receiptCopy(entry.importReceipt, agentDir, target);
    return Object.freeze({ target, generation: uuid(entry.generation), choices, importReceipt });
  });
  return Object.freeze({ version: 1, id, targets: Object.freeze(targets) });
}
function stamp(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].join(":");
}
function privateStat(stat: BigIntStats, directory: boolean): void {
  need(directory ? stat.isDirectory() : stat.isFile() && stat.nlink === BigInt(1), "private");
  need(stat.uid === BigInt(process.getuid!()) && (stat.mode & (directory ? BigInt(0o077) : BigInt(0o177))) === BigInt(0), "private");
}
function optionalStat(file: string): BigIntStats | null {
  try { return lstatSync(file, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new PreferencesError("read"); }
}
interface Layout { agentDir: string; dir: string; file: string; check: () => void }
function layout(agentDir: string, create: boolean): Layout {
  need(typeof process.getuid === "function" && constants.O_NOFOLLOW && constants.O_NONBLOCK, "private");
  const dir = join(agentDir, "brabbler"), file = join(dir, "resource-preferences.json");
  const agent = optionalStat(agentDir);
  need(agent?.isDirectory() && agent.uid === BigInt(process.getuid()) && (agent.mode & BigInt(0o022)) === BigInt(0), "private");
  if (create && !optionalStat(dir)) mkdirSync(dir, { mode: 0o700 });
  const privateDir = optionalStat(dir);
  if (privateDir) privateStat(privateDir, true);
  // Directory size/timestamps change during our own temp/lock creation; pin identity
  // and permissions, not incidental contents. No chmod/repair of existing paths.
  const directoryId = (stat: BigIntStats | null) => stat && [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid, stat.birthtimeNs].join(":");
  const before = [directoryId(agent), directoryId(privateDir)];
  return { agentDir, dir, file, check() {
    need(JSON.stringify(before) === JSON.stringify([directoryId(optionalStat(agentDir)), directoryId(optionalStat(dir))]), "generation");
  } };
}
interface ReadState { store: Readonly<Store> | null; generation: string | null }
function readStore(paths: Layout): ReadState {
  paths.check(); const before = optionalStat(paths.file);
  if (!before) { paths.check(); need(optionalStat(paths.file) === null, "generation"); return { store: null, generation: null }; }
  privateStat(before, false); need(before.size <= BigInt(PREFERENCES_MAX_BYTES), "limit");
  let fd: number;
  try { fd = openSync(paths.file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW); }
  catch { throw new PreferencesError("read"); }
  try {
    const opened = fstatSync(fd, { bigint: true }); privateStat(opened, false);
    need(stamp(before) === stamp(opened), "generation");
    const bytes = Buffer.alloc(Number(opened.size) + 1); let length = 0;
    while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    need(length === Number(opened.size) && stamp(opened) === stamp(fstatSync(fd, { bigint: true })), "generation");
    paths.check(); need(stamp(opened) === (optionalStat(paths.file) && stamp(lstatSync(paths.file, { bigint: true }))), "generation");
    return { store: parsePreferences(bytes.subarray(0, length), paths.agentDir), generation: stamp(opened) };
  } finally { closeSync(fd); }
}
const targetKey = (target: PreferenceTarget) => JSON.stringify(target);
function snapshot(state: ReadState, agentDir: string, target: PreferenceTarget): PreferenceSnapshot {
  const entry = state.store?.targets.find(item => targetKey(item.target) === targetKey(target));
  return Object.freeze({ target, choices: entry?.choices ?? Object.freeze([]), importReceipt: entry?.importReceipt ?? null,
    revision: hash([agentDir, target, state.store?.id ?? null, entry?.generation ?? null, entry?.choices ?? [], entry?.importReceipt ?? null]) });
}
export function readScopedPreferences(admittedContext: SelectionContext, requestedTarget: PreferenceTarget): PreferenceSnapshot {
  const context = contextCopy(admittedContext), target = admitTarget(context, requestedTarget);
  return snapshot(readStore(layout(context.agentDir, false)), context.agentDir, target);
}

/** Optional trusted context/catalog/membership fence, NOT store authorization.
 * Throws/rejects to refuse publication. Both calls settle under the same lock;
 * the caller must bound its work. The five-second publication budget is checked
 * after settlement, never a timeout that releases ownership of a pending guard.
 * The caller must compose fresh authority; opaque store bindings alone grant none. */
export type PreferencePublicationGuard = () => void | Promise<void>;

/** Exclusive mkdir lock: contention/abandoned locks REFUSE, never stale-reclaim.
 * No heartbeat/timer or implicit retry. Crash recovery/removal needs an explicit
 * future recovery owner, not a guessed lease takeover. Cooperating writers use
 * one lock for the WHOLE store, with scope-local desired revisions. */
export async function saveScopedPreference(admittedContext: SelectionContext, requestedTarget: PreferenceTarget,
  desiredRevision: string, requestedIdentity: SelectionIdentity, choice: SelectionChoice,
  assertAdmissionCurrent?: PreferencePublicationGuard): Promise<PreferenceSnapshot> {
  const context = contextCopy(admittedContext), target = admitTarget(context, requestedTarget);
  const identity = identityCopy(requestedIdentity, context.agentDir);
  need(choice === "inherit" || choice === "enabled" || choice === "disabled", "schema");
  need(/^[a-f0-9]{64}$/.test(desiredRevision), "conflict");
  if (identity.origin.scope === "project") {
    need(identity.origin.binding === context.projectBinding && target.scope !== "global", "scope");
  }
  return writeTarget(context, target, desiredRevision, { identity, choice }, assertAdmissionCurrent);
}

/** Commit point is one rename, not acknowledgement. File bytes are flushed, but
 * the parent directory is NOT fsynced: process interruption is atomic; power-loss
 * persistence is not promised. Preserve this store across rollback/re-upgrade;
 * concurrent old binaries/native availability writers are not fenced here.
 * Recheck is synchronous bounded conflict detection, NOT canonical authorization,
 * SDK semantics, cross-file atomicity, ABA detection or an external-writer lock.
 * Completed targets return before CAS/input/recheck, never reimporting Pi edits. */
export async function commitScopedImport(admittedContext: SelectionContext, requestedTarget: PreferenceTarget,
  desiredRevision: string, admittedImport: ImportReceipt, recheckEvidence: () => string,
  assertAdmissionCurrent?: PreferencePublicationGuard): Promise<PreferenceSnapshot> {
  const context = contextCopy(admittedContext), target = admitTarget(context, requestedTarget);
  need(target.scope !== "session", "scope");
  return writeTarget(context, target, desiredRevision, { admittedImport, recheckEvidence }, assertAdmissionCurrent);
}

type TargetWrite = { identity: SelectionIdentity; choice: SelectionChoice }
  | { admittedImport: ImportReceipt; recheckEvidence: () => string };
async function writeTarget(context: SelectionContext, target: PreferenceTarget, desiredRevision: string, operation: TargetWrite,
  assertAdmissionCurrent?: PreferencePublicationGuard): Promise<PreferenceSnapshot> {
  const paths = layout(context.agentDir, true), lock = `${paths.file}.lock`;
  const started = performance.now(), wall = Date.now();
  paths.check();
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new PreferencesError("locked"); throw error; }
  const lockStat = lstatSync(lock, { bigint: true });
  const checkLock = () => {
    paths.check(); need(stamp(lockStat) === (optionalStat(lock) && stamp(lstatSync(lock, { bigint: true }))), "generation");
    need(Math.max(performance.now() - started, Date.now() - wall) < 5000, "generation");
  };
  try {
    checkLock(); const state = readStore(paths);
    const currentSnapshot = snapshot(state, context.agentDir, target);
    if ("admittedImport" in operation && currentSnapshot.importReceipt) return currentSnapshot;
    need(typeof desiredRevision === "string" && /^[a-f0-9]{64}$/.test(desiredRevision)
      && currentSnapshot.revision === desiredRevision, "conflict");
    const receipt = "admittedImport" in operation ? receiptCopy(operation.admittedImport, context.agentDir, target) : currentSnapshot.importReceipt;
    const checkEvidence = () => {
      if ("admittedImport" in operation) {
        need(typeof operation.recheckEvidence === "function", "schema");
        need(operation.recheckEvidence() === receipt!.evidenceDigest, "generation");
      }
    };
    await assertAdmissionCurrent?.(); checkLock();
    checkEvidence();
    const store = { version: 1 as const, id: state.store?.id ?? randomUUID(), targets: [...(state.store?.targets ?? [])] };
    const previous = store.targets.findIndex(item => targetKey(item.target) === targetKey(target));
    let choices = [...currentSnapshot.choices];
    if ("identity" in operation) {
      choices = choices.filter(item => selectionKey(item.identity) !== selectionKey(operation.identity));
      if (operation.choice !== "inherit") choices.push({ identity: operation.identity, value: operation.choice });
    } else {
      const existingChoices = new Map(choices.map(item => [selectionKey(item.identity), item]));
      for (const decision of receipt!.decisions) {
        const existing = existingChoices.get(selectionKey(decision.identity));
        need(!existing || existing.value === decision.value, "conflict");
        if (!existing) choices.push({ identity: decision.identity, value: decision.value });
      }
    }
    const next: TargetState = { target, generation: randomUUID(), choices: choicesCopy(choices, context.agentDir, target), importReceipt: receipt };
    // Retain even empty target generations to fence stale reset/ABA submissions.
    if (previous < 0) store.targets.push(next); else store.targets[previous] = next;
    store.targets.sort((a, b) => targetKey(a.target).localeCompare(targetKey(b.target)));
    const contents = `${JSON.stringify(store)}\n`;
    parsePreferences(contents, context.agentDir); // same strict total bounds as reads
    const temp = join(paths.dir, `.resource-preferences-${randomUUID()}.tmp`);
    checkLock(); const fd = openSync(temp, "wx", 0o600);
    try { writeFileSync(fd, contents, { encoding: "utf8", flush: true }); }
    finally { closeSync(fd); }
    // Recheck AFTER staging: external replacements/content edits must not be lost.
    checkEvidence();
    const current = readStore(paths);
    need(current.generation === state.generation, "generation");
    checkLock();
    if (assertAdmissionCurrent) {
      // Keep the existing lock until ACTUAL settlement, even past the budget.
      // Callback effects can invalidate the observations above: fence them again
      // before the one choices+receipt rename. This is bounded detection, not an
      // atomic snapshot/lock across noncooperating external files.
      await assertAdmissionCurrent(); checkLock();
      checkEvidence();
      need(readStore(paths).generation === state.generation, "generation");
    }
    checkLock(); renameSync(temp, paths.file);
    return snapshot({ store, generation: null }, context.agentDir, target);
  } finally {
    // Failure may leave a private stage artifact. Never unlink its pathname:
    // exclusive creation may have failed, or that path/directory may be replaced.
    // Never remove a substituted lock owned by someone else.
    if (optionalStat(lock) && stamp(lstatSync(lock, { bigint: true })) === stamp(lockStat)) rmdirSync(lock);
  }
}

/** Pure creation-time COPY INPUT, not session creation/reopen behavior. The caller
 * supplies a current own-session snapshot and a separately admitted NEW binding.
 * Never accepts effective values/parents/permissions. Persisting once vs reopening
 * the same ID is the future lifecycle owner's responsibility. */
export function copyOwnSessionChoices(input: Readonly<{ target: PreferenceTarget; choices: readonly PreferenceChoice[] }>,
  admittedAgentDir: string, admittedNewBinding: string): Readonly<{ target: PreferenceTarget; choices: readonly PreferenceChoice[] }> {
  const value = record(input, ["target", "choices"]), source = targetCopy(value.target);
  const target = targetCopy({ scope: "session", binding: admittedNewBinding });
  need(source.scope === "session" && source.binding !== target.binding, "scope");
  return Object.freeze({ target, choices: choicesCopy(value.choices, path(admittedAgentDir), target) });
}
