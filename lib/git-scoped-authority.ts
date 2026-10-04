// Trusted server storage, not diagnostics and never an operation grant.
import { createHash, randomUUID } from "node:crypto";
import fs, { closeSync, fsyncSync, linkSync, openSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { bindingFields, readBindingFile } from "./git-workflow-binding-io";
import { gitWorkflowPrivateParent, readGitWorkflowWriteEpoch, syncGitWorkflowDirectory } from "./git-workflow-write-epoch";

export type GitAuthorityDomain = "settings" | "grants" | "trust";
export type GitAuthorityScope = { kind: "global" } | { kind: "project"; projectRoot: string } |
  { kind: "session"; sessionId: string } | { kind: "chat-project"; sessionId: string; projectRoot: string } |
  { kind: "trust-path"; path: string };
export interface GitAuthoritySelection {
  projectRoots?: readonly string[];
  sessionId?: string;
  trustPaths?: readonly string[];
  domains?: readonly GitAuthorityDomain[];
  /** Conservative compatibility for bootstraps not yet supplying canonical scopes. */
  allScopes?: boolean;
}
type FileState = { fingerprint: string; digest: string } | "absent";
type Publication = { before: FileState; after: FileState; changes: Record<string, string> };
type Ledger = { version: 1; instance: string; serial: string; legacyEpoch: string; generations: Record<string, string>; files: Record<string, Publication> };
const MAX = 4 * 1024 * 1024;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const decimal = /^(0|[1-9][0-9]{0,39})$/;
const domains: GitAuthorityDomain[] = ["settings", "grants", "trust"];
function fail(): never { throw new Error("Scoped Git authority unavailable or unaccounted authority rewrite"); }
function pathKey(path: string): string {
  if (!isAbsolute(path) || resolve(path) !== path || path.includes("\0")) return fail();
  return path;
}
function key(domain: GitAuthorityDomain, scope: GitAuthorityScope): string {
  if (!domains.includes(domain)) return fail();
  switch (scope.kind) {
    case "global": return JSON.stringify([domain, "global"]);
    case "project": return JSON.stringify([domain, "project", pathKey(scope.projectRoot)]);
    case "session": return JSON.stringify([domain, "session", sessionKey(scope.sessionId)]);
    case "chat-project": return JSON.stringify([domain, "chat-project", sessionKey(scope.sessionId), pathKey(scope.projectRoot)]);
    case "trust-path": return JSON.stringify([domain, "trust-path", pathKey(scope.path)]);
    default: return fail();
  }
}
function sessionKey(id: string): string { if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return fail(); return id; }
function files(agentDir: string): string[] {
  return ["pi-web/git-workflow-settings.json", "pi-web/git-workflow-defaults.json", "pi-web/git-project-authorizations.json", "trust.json", "pi-web/git-workflow-write-epoch.json"].map((p) => join(agentDir, p));
}
function snapshot(path: string): FileState {
  try {
    if (realpathSync(path) !== path) fail();
    const file = readBindingFile(path, MAX);
    return { fingerprint: file.fingerprint, digest: hash(file.bytes.toString("base64")) };
  } catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return "absent"; throw cause; }
}
function validateState(value: unknown): FileState {
  if (value === "absent") return value;
  const row = bindingFields(value, ["fingerprint", "digest"]);
  if (typeof row.fingerprint !== "string" || !/^\d+:\d+:\d+:\d+:\d+:\d+$/.test(row.fingerprint) ||
    typeof row.digest !== "string" || !/^[a-f0-9]{64}$/.test(row.digest)) return fail();
  return row as FileState;
}
const ledgerHistoryKey = Symbol.for("pi-web:scoped-authority-ledger-history:v1");
function ledgerHistory(): Map<string, { current: Ledger; fingerprint: string; retired: Set<string> }> {
  const g = globalThis as unknown as Record<symbol, Map<string, { current: Ledger; fingerprint: string; retired: Set<string> }>>;
  return g[ledgerHistoryKey] ??= new Map();
}
function observeLedger(path: string, ledger: Ledger, fingerprint: string): void {
  const previous = ledgerHistory().get(path), retired = previous?.retired ?? new Set<string>();
  if (retired.has(ledger.instance)) fail();
  if (previous?.current.instance === ledger.instance) {
    if (ledger.legacyEpoch !== previous.current.legacyEpoch) fail();
    if (BigInt(ledger.serial) < BigInt(previous.current.serial) ||
      ledger.serial === previous.current.serial && fingerprint !== previous.fingerprint) fail();
    for (const [scope, value] of Object.entries(previous.current.generations)) {
      const next = ledger.generations[scope];
      if (!next || BigInt(next.split(":")[0]) < BigInt(value.split(":")[0]) ||
        next !== value && next.split(":")[0] === value.split(":")[0] && !value.endsWith(":event")) fail();
    }
  } else if (previous) retired.add(previous.current.instance);
  // Capture readers resolve publication phases on their private copy below.
  ledgerHistory().set(path, { current: structuredClone(ledger), fingerprint, retired });
}
function readLedger(path: string): Ledger {
  const file = readBindingFile(path, MAX, true);
  const row = bindingFields(JSON.parse(file.bytes.toString("utf8")), ["version", "instance", "serial", "legacyEpoch", "generations", "files"]);
  if (row.version !== 1 || typeof row.instance !== "string" || !uuid.test(row.instance) || typeof row.serial !== "string" || !decimal.test(row.serial)) return fail();
  if (typeof row.legacyEpoch !== "string" || row.legacyEpoch !== "none" && !uuid.test(row.legacyEpoch)) fail();
  for (const field of [row.generations, row.files]) if (!field || typeof field !== "object" || Array.isArray(field)) return fail();
  const generations: Record<string, string> = Object.create(null), publications: Record<string, Publication> = Object.create(null);
  for (const [k, v] of Object.entries(row.generations!)) {
    if (k.length > 16384 || typeof v !== "string" || !/^[0-9]+:(event|before|after)$/.test(v) ||
      !decimal.test(v.split(":")[0]) || BigInt(v.split(":")[0]) > BigInt(row.serial)) return fail();
    const parts: unknown = JSON.parse(k);
    if (!Array.isArray(parts) || !domains.includes(parts[0])) fail();
    const [domain, kind, first, second] = parts;
    const scope: GitAuthorityScope = kind === "global" ? { kind } : kind === "project" ? { kind, projectRoot: first }
      : kind === "session" ? { kind, sessionId: first } : kind === "chat-project" ? { kind, sessionId: first, projectRoot: second }
      : kind === "trust-path" ? { kind, path: first } : fail();
    if (key(domain, scope) !== k) fail();
    generations[k] = v;
  }
  for (const [k, v] of Object.entries(row.files!)) {
    pathKey(k);
    const p = bindingFields(v, ["before", "after", "changes"]);
    if (!p.changes || typeof p.changes !== "object" || Array.isArray(p.changes)) fail();
    const changes: Record<string, string> = Object.create(null);
    for (const [scope, generation] of Object.entries(p.changes)) {
      if (!Object.hasOwn(generations, scope) || typeof generation !== "string" || !decimal.test(generation) || BigInt(generation) > BigInt(row.serial)) fail();
      changes[scope] = generation;
    }
    publications[k] = { before: validateState(p.before), after: validateState(p.after), changes };
  }
  const ledger: Ledger = { version: 1, instance: row.instance, serial: row.serial, legacyEpoch: row.legacyEpoch, generations, files: publications };
  observeLedger(path, ledger, file.fingerprint);
  return ledger;
}
function prepare(path: string, bytes: string): string {
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); }
  catch (cause) { try { unlinkSync(temp); } catch {} throw cause; }
  finally { closeSync(fd); }
  return temp;
}
function remove(temp: string): void { try { unlinkSync(temp); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; } }
function ledgerPath(agentDir: string): string {
  return join(gitWorkflowPrivateParent(agentDir, true)!, "git-scoped-authority-v1.json");
}
function load(agentDir: string): { path: string; ledger: Ledger } {
  const path = ledgerPath(agentDir);
  try { return { path, ledger: readLedger(path) }; }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
  // First observation publishes a genuine random incarnation, never a static
  // missing-state revision. Exclusive link publication does not lock readers.
  const ledger: Ledger = { version: 1, instance: randomUUID(), serial: "0", legacyEpoch: readGitWorkflowWriteEpoch(agentDir), generations: Object.create(null), files: Object.create(null) };
  for (const file of files(agentDir)) { const state = snapshot(file); ledger.files[file] = { before: state, after: state, changes: Object.create(null) }; }
  const temp = prepare(path, JSON.stringify(ledger));
  try {
    try { linkSync(temp, path); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause; }
  } finally { remove(temp); }
  syncGitWorkflowDirectory(dirname(path));
  return { path, ledger: readLedger(path) };
}
function equal(a: FileState, b: FileState): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function accounted(current: FileState, p: Publication): boolean {
  if (equal(current, p.before) || equal(current, p.after)) return true;
  if (!Object.keys(p.changes).length) return false;
  // Rename changes ctime, but not the prepared inode, birthtime, size, mtime or
  // exact bytes. Only the prepared AFTER inode gets this rename allowance.
  return current !== "absent" && p.after !== "absent" && current.digest === p.after.digest &&
    current.fingerprint.split(":").slice(0, -1).join(":") === p.after.fingerprint.split(":").slice(0, -1).join(":");
}
const observationsKey = Symbol.for("pi-web:scoped-authority-publications:v1");
function observations(): Map<string, { relation: string; state: FileState; after: boolean }> {
  const g = globalThis as unknown as Record<symbol, Map<string, { relation: string; state: FileState; after: boolean }>>;
  return g[observationsKey] ??= new Map();
}
const unexplainedKey = Symbol.for("pi-web:scoped-authority-unexplained:v1");
function unexplained(): Set<string> {
  const g = globalThis as unknown as Record<symbol, Set<string>>;
  return g[unexplainedKey] ??= new Set();
}
function validatePublications(ledger: Ledger, agentDir: string, sticky = true): Map<string, FileState> {
  // Only an ACTUAL unexplained authority rewrite is sticky, never a historical
  // pending/failed accounted publication. A later byte restore cannot reopen it.
  const unknown = `${agentDir}:${ledger.instance}`;
  if (unexplained().has(unknown)) fail();
  const reject = (): never => { if (sticky) unexplained().add(unknown); return fail(); };
  if (JSON.stringify(Object.keys(ledger.files).sort()) !== JSON.stringify(files(agentDir).sort())) fail();
  const next = new Map<string, { relation: string; state: FileState; after: boolean }>();
  for (const [file, publication] of Object.entries(ledger.files)) {
    const current = snapshot(file), relation = hash([ledger.instance, publication]);
    if (!accounted(current, publication)) reject();
    const previous = observations().get(file);
    // Once this process has seen the published inode, pin its full ctime too.
    // A later external equal-byte/metadata rewrite cannot reuse rename allowance.
    if (previous?.relation === relation && !equal(current, previous.state) &&
      (previous.after || !equal(previous.state, publication.before))) reject();
    next.set(file, { relation, state: current, after: !equal(current, publication.before) });
  }
  for (const [file, value] of next) observations().set(file, value);
  return new Map([...next].map(([file, value]) => [file, value.state]));
}
function resolvePublication(ledger: Ledger, publication: Publication, current: FileState): void {
  // Bind affected readers to the observed side of a publication. Other scopes
  // never depend on this phase. When a later writer replaces the relation, it
  // preserves these exact resolved values; it cannot revoke unrelated scopes.
  for (const [scope, serial] of Object.entries(publication.changes)) {
    if (ledger.generations[scope] === `${serial}:event`) ledger.generations[scope] = `${serial}:${equal(current, publication.before) ? "before" : "after"}`;
  }
}
const attemptsKey = Symbol.for("pi-web:scoped-authority-attempts:v1");
function attempts(): Map<string, Map<string, string>> {
  const g = globalThis as unknown as Record<symbol, Map<string, Map<string, string>>>;
  return g[attemptsKey] ??= new Map();
}
function noteAttempt(agentDir: string, domain: GitAuthorityDomain, scopes: readonly GitAuthorityScope[]): void {
  let current = attempts().get(agentDir);
  if (!current) attempts().set(agentDir, current = new Map());
  for (const scope of scopes.length ? scopes : [{ kind: "global" } as const]) current.set(key(domain, scope), randomUUID());
}
function clearAttempt(agentDir: string, domain: GitAuthorityDomain, scopes: readonly GitAuthorityScope[]): void {
  for (const scope of scopes.length ? scopes : [{ kind: "global" } as const]) attempts().get(agentDir)?.delete(key(domain, scope));
}
function advance(ledger: Ledger, domain: GitAuthorityDomain, scopes: readonly GitAuthorityScope[]): void {
  ledger.serial = String(BigInt(ledger.serial) + BigInt(1));
  if (!decimal.test(ledger.serial)) fail();
  for (const scope of scopes.length ? scopes : [{ kind: "global" } as const]) ledger.generations[key(domain, scope)] = `${ledger.serial}:event`;
}
function save(path: string, ledger: Ledger): void {
  // Every ledger publication, including preparation, gets a fresh sequence.
  // Restoring old sidecar bytes must never reopen a live original baseline.
  ledger.serial = String(BigInt(ledger.serial) + BigInt(1));
  if (!decimal.test(ledger.serial)) fail();
  const bytes = JSON.stringify(ledger);
  if (Buffer.byteLength(bytes) > MAX) fail();
  writePrivateFileAtomicSync(path, bytes);
  syncGitWorkflowDirectory(dirname(path));
  readLedger(path);
}
/** Storage writer lock only; never held across an await, native Git, checks or
 * approval. Readers do not take it. A crashed writer has no reader quarantine. */
function writing<T>(agentDir: string, action: (path: string, ledger: Ledger, validated: ReadonlyMap<string, FileState>) => T): T {
  const initial = load(agentDir);
  const release = lockfile.lockSync(initial.path, { realpath: false, stale: 30_000 });
  try {
    const ledger = readLedger(initial.path), validated = validatePublications(ledger, agentDir);
    return action(initial.path, ledger, validated);
  } finally { release(); }
}
/** Advance BEFORE an in-memory/session writer (including failure/equal value).
 * Session files are separately pinned by the invocation-owned owner reader. */
export function advanceGitScopedAuthority(agentDir: string, domain: GitAuthorityDomain, scopes: readonly GitAuthorityScope[] = [{ kind: "global" }]): void {
  noteAttempt(agentDir, domain, scopes);
  writing(agentDir, (path, ledger) => { advance(ledger, domain, scopes); save(path, ledger); clearAttempt(agentDir, domain, scopes); });
}
/** Account an atomic authority-file replacement BEFORE publishing it. Both the
 * unchanged before file and exact prepared after file are both acceptable;
 * failure/crash needs no settlement marker and cannot quarantine other scopes.
 * Unknown external/legacy rewrites are refused before they can be laundered.
 * The caller's ordinary document lock must encompass its read/modify/write. */
export function writeGitScopedAuthorityFile(agentDir: string, file: string, bytes: string, domain: GitAuthorityDomain,
  scopes: readonly GitAuthorityScope[] = [{ kind: "global" }], assertTargetUnchanged?: () => void): void {
  pathKey(file);
  noteAttempt(agentDir, domain, scopes);
  const assertTarget = () => {
    const result: unknown = assertTargetUnchanged?.();
    if (result !== undefined) {
      if (result && typeof (result as Promise<unknown>).then === "function") void Promise.resolve(result).catch(() => {});
      throw new Error("Synchronous authority target guard required");
    }
  };
  writing(agentDir, (path, ledger, validated) => {
    const before = validated.get(file);
    if (before === undefined) fail();
    // Carry the ACTUAL validated fingerprint across all publication/staging IO.
    // Recapturing a new before here would launder an external rewrite under the
    // next unrelated writer's scopes, even if its eventual rename fails.
    const assertBefore = () => {
      try { if (!equal(before, snapshot(file))) fail(); }
      catch (cause) { unexplained().add(`${agentDir}:${ledger.instance}`); throw cause; }
    };
    let temp: string | undefined, renameAttempted = false;
    try {
      // Publish attempted mutations even when staging fails. The trusted target
      // callback is server-only and cannot replace the captured file baseline.
      advance(ledger, domain, scopes); save(path, ledger); clearAttempt(agentDir, domain, scopes);
      assertTarget(); assertBefore();
      if (Buffer.byteLength(bytes) > MAX) fail();
      temp = prepare(file, bytes);
      const after = snapshot(temp);
      assertTarget(); assertBefore();
      resolvePublication(ledger, ledger.files[file], before);
      const changes = Object.fromEntries((scopes.length ? scopes : [{ kind: "global" } as const]).map((scope) => [key(domain, scope), ledger.generations[key(domain, scope)].split(":")[0]]));
      ledger.files[file] = { before, after, changes };
      save(path, ledger);
      assertTarget(); assertBefore();
      renameAttempted = true;
      fs.renameSync(temp, file);
      validatePublications(ledger, agentDir);
      syncGitWorkflowDirectory(dirname(file));
    } catch (cause) {
      // A failed known rename may leave either accounted state; neither is an
      // orphan-write veto. An unexplained native change must not be overlooked
      // merely because a staging/publication callback also threw.
      if (renameAttempted) validatePublications(ledger, agentDir);
      else assertBefore();
      throw cause;
    } finally { if (temp) remove(temp); }
  });
}
export function captureGitScopedAuthorityRevision(agentDir: string): (selection?: GitAuthoritySelection) => string {
  // A different process can publish between our ledger and authority-file reads.
  // Retry only a changed ledger, never excuse an unexplained native rewrite.
  for (let retry = 0; retry < 4; retry++) {
    const { path, ledger } = load(agentDir);
    const originalAttempts = new Map(attempts().get(agentDir));
    let error: unknown, states: Map<string, FileState> | undefined;
    try { states = validatePublications(ledger, agentDir, false); } catch (cause) { error = cause; }
    if (hash(readLedger(path)) !== hash(ledger)) continue;
    if (error) { unexplained().add(`${agentDir}:${ledger.instance}`); throw error; }
    for (const [file, state] of states!) resolvePublication(ledger, ledger.files[file], state);
    return (selection = {}) => revision(ledger, selection, originalAttempts);
  }
  return fail();
}
export function readGitScopedAuthorityRevision(agentDir: string, selection: GitAuthoritySelection = {}): string {
  return captureGitScopedAuthorityRevision(agentDir)(selection);
}
function selectedKeys(selection: GitAuthoritySelection): string[] {
  const selected: string[] = [];
  for (const domain of selection.domains ?? domains) {
    selected.push(key(domain, { kind: "global" }));
    if (selection.sessionId) selected.push(key(domain, { kind: "session", sessionId: selection.sessionId }));
    for (const projectRoot of selection.projectRoots ?? []) {
      selected.push(key(domain, { kind: "project", projectRoot }));
      if (selection.sessionId) selected.push(key(domain, { kind: "chat-project", sessionId: selection.sessionId, projectRoot }));
    }
    if (domain === "trust") for (const path of selection.trustPaths ?? []) {
      let parent = pathKey(path);
      for (;;) { selected.push(key(domain, { kind: "trust-path", path: parent })); if (dirname(parent) === parent) break; parent = dirname(parent); }
    }
  }
  return [...new Set(selected)].sort();
}
function revision(ledger: Ledger, selection: GitAuthoritySelection, attempted: Map<string, string>): string {
  if (selection.allScopes) return hash([ledger.instance, ledger.serial, Object.entries(ledger.generations).sort(), [...attempted].sort()]);
  return hash([ledger.instance, selectedKeys(selection).map((k) => [k, ledger.generations[k] ?? "0", attempted.get(k)])]);
}
/** One-way legacy saved-grant migration. The ORIGINAL scalar is pinned when
 * the namespace is created, not today's aggregate epoch. Any relevant scoped
 * settings attempt permanently disables this compatibility path. It supplies
 * no invocation revision and cannot resurrect a changed-and-restored grant. */
export function legacyGitWorkflowEpochIfUnchanged(agentDir: string, selection: GitAuthoritySelection): string | undefined {
  const { ledger } = load(agentDir);
  validatePublications(ledger, agentDir);
  if (selection.allScopes || selectedKeys({ ...selection, domains: ["settings"] }).some((k) =>
    Object.hasOwn(ledger.generations, k) || attempts().get(agentDir)?.has(k))) return undefined;
  return ledger.legacyEpoch;
}
// Response revisions are editor CAS. Operation revisions are trusted provenance
// attached to the actual load result, never a field accepted from public JSON.
const revisionsKey = Symbol.for("pi-web:git-scoped-policy-revisions:v1");
function policyRevisions(): WeakMap<object, string> {
  const g = globalThis as unknown as Record<symbol, WeakMap<object, string>>;
  return g[revisionsKey] ??= new WeakMap();
}
export function bindGitWorkflowPolicyRevision<T extends object>(state: T, revision: string): T { policyRevisions().set(state, revision); return state; }
export function gitWorkflowPolicyRevision(state: object): string { return policyRevisions().get(state) ?? fail(); }
