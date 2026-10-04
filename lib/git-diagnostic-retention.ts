import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { performance } from "node:perf_hooks";

/** Diagnostics-only storage (the action controller uses the stable application namespace). Never import this into admission or
 * use these bytes/IDs as receipts. No legacy journal, Git, transport, source-path
 * reader, provider, executable capability, process authority or lock lives here.
 *
 * Linux only. /proc/self/fd keeps operations on the original directory inodes.
 * Targets are NOT quotas: other writers and refused deletions can overshoot.
 * A pass has bounded work, not a hard syscall deadline (a blocked FS can stall).
 * This is not a sandbox against a malicious same-uid process racing the final
 * validation/unlink syscall. Unexpected replacements observed after quarantine
 * are NEVER unlinked; quarantines/temps are never swept on a later pass.
 */
export const GIT_DIAGNOSTIC_LIMITS = Object.freeze({
  recordBytes: 256 * 1024, logBytes: 8 * 1024 * 1024,
  recordBudget: 16 * 1024 * 1024, logBudget: 100 * 1024 * 1024,
  artifactBytes: 2 * 1024 * 1024, artifactBudget: 64 * 1024 * 1024,
  // Inventory headroom above the 180MiB combined byte targets and the entry
  // target. Reservations include BOTH publications in a record/log append.
  entryBudget: 4096, entries: 8192, scanBytes: 256 * 1024 * 1024, passMs: 250, warnings: 16,
});
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const ID = new RegExp(`^${UUID}$`);
const ROOT = new RegExp(`^git-diagnostics-v2-(${UUID})$`);
const ITEM = new RegExp(`^(${UUID})\\.(record|log|action|artifact)$`);
const KINDS = ["commit", "checks", "integration", "workspace", "preparation", "cleanup", "review", "checkout-verification"] as const;
const OUTCOMES = ["succeeded", "rejected", "failed", "cancelled", "partial", "uncertain"] as const;
export type NativeDiagnosticOutcome = typeof OUTCOMES[number];
export type DiagnosticStatus = "stored" | "omitted" | "unavailable";
export type TerminalDiagnostic = Readonly<{
  kind: typeof KINDS[number]; nativeOutcome: NativeDiagnosticOutcome;
  completedAt: number; durationMs: number; exitCode: number | null;
}>;
export type DiagnosticWarning = "invalid-input" | "unsupported-platform" | "storage-unavailable" |
  "unsafe-item" | "unknown-name" | "scan-incomplete" | "budget-unavailable" | "changed-item";
type Warnings = DiagnosticWarning[];
type Category = "record" | "log" | "artifact";
const categoryOf = (suffix: string): Category => suffix === "action" ? "record" : suffix as Category;
const emptyTotals = () => ({ record: 0, log: 0, artifact: 0 });
const totalBytes = (totals: Record<Category, number>) => totals.record + totals.log + totals.artifact;
type Stat = fs.BigIntStats;
type Pin = { fd: number; stat: Stat; parent?: Pin; name?: string };
type Item = { name: string; category: Category; id: string; stat: Stat; bytes: number; time: number };
type ReadResult<T> = { status: "stored"; value: T; warnings: Warnings } |
  { status: "expired" | "unavailable"; warnings: Warnings };
export type DiagnosticBudgets = { recordBytes?: number; logBytes?: number; artifactBytes?: number };

function warn(w: Warnings, value: DiagnosticWarning) {
  if (w.length < GIT_DIAGNOSTIC_LIMITS.warnings && !w.includes(value)) w.push(value);
}
function fail(): never { throw new Error("diagnostic storage unavailable"); }
function same(a: Stat, b: Stat): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}
function unchanged(a: Stat, b: Stat): boolean {
  return same(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink && a.mode === b.mode;
}
function privateMode(s: Stat) { return s.uid === BigInt(process.getuid!()) && (s.mode & BigInt(0o077)) === BigInt(0); }
function regular(s: Stat, max: number) {
  return s.isFile() && s.nlink === BigInt(1) && privateMode(s) && s.size >= BigInt(0) && s.size <= BigInt(max);
}
function at(pin: Pin, name = "") { return `/proc/self/fd/${pin.fd}${name ? `/${name}` : ""}`; }
function close(pin: Pin) { try { fs.closeSync(pin.fd); } catch { /* best effort */ } }
function check(pin: Pin): void {
  if (!same(pin.stat, fs.fstatSync(pin.fd, { bigint: true }))) fail();
  if (pin.parent) {
    check(pin.parent);
    if (!same(pin.stat, fs.lstatSync(at(pin.parent, pin.name), { bigint: true }))) fail();
  }
}
function openDirectory(path: string, parent?: Pin, name?: string): Pin {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isDirectory()) fail();
    return { fd, stat, parent, name };
  } catch (e) { fs.closeSync(fd); throw e; }
}
function fields(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  const names = Reflect.ownKeys(input);
  if (names.length !== keys.length || names.some(k => typeof k !== "string" || !keys.includes(k))) fail();
  const result: Record<string, unknown> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(input, k);
    if (!d || !("value" in d) || !d.enumerable) fail();
    result[k] = d.value;
  }
  return result;
}
function integer(n: unknown, max = Number.MAX_SAFE_INTEGER): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= max;
}
function terminal(input: unknown): TerminalDiagnostic {
  const v = fields(input, ["kind", "nativeOutcome", "completedAt", "durationMs", "exitCode"]);
  if (!KINDS.includes(v.kind as never) || !OUTCOMES.includes(v.nativeOutcome as never) ||
    !integer(v.completedAt) || !integer(v.durationMs) || !(v.exitCode === null || integer(v.exitCode, 255))) fail();
  return v as TerminalDiagnostic;
}
function digest(data: Buffer) { return createHash("sha256").update(data).digest("hex"); }
const OVERHEAD = 1024;
function maxBytes(category: Category) { return category === "log" ? GIT_DIAGNOSTIC_LIMITS.logBytes + OVERHEAD
  : category === "artifact" ? GIT_DIAGNOSTIC_LIMITS.artifactBytes + OVERHEAD : GIT_DIAGNOSTIC_LIMITS.recordBytes; }
function parse(data: Buffer): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); }

/** No default private-state path. Opening never creates/reuses legacy storage.
 * IMPORTANT: persist/configure the returned root and REOPEN THAT SAME ROOT across
 * invocations and restarts. `create: true` is explicit ONE-TIME BOOTSTRAP ONLY;
 * never call it once per action/run. Targets apply to ONE configured namespace,
 * not all UUID roots under a parent. There is no cross-root accounting or sweep;
 * repeatedly bootstrapping roots bypasses the targets and can grow without bound.
 * Creation allocates a new UUID root beneath an existing private physical parent.
 * `application:true` instead uses ONE fixed child under the explicit agentDir;
 * `existingOnly:true` suppresses bootstrap for history reads (not a capability).
 * Reopen accepts only recognized roots. Parents are never chmodded.
 * Budget overrides can only REDUCE the targets (useful for small fixture stores).
 */
export function openGitDiagnosticStore(parentOrRoot: string, options: { create?: boolean; application?: boolean; existingOnly?: boolean; budgets?: DiagnosticBudgets } = {}):
  { status: "stored"; store: GitDiagnosticStore; root: string; warnings: Warnings } |
  { status: "unavailable"; warnings: Warnings } {
  const pins: Pin[] = [];
  try {
    if (process.platform !== "linux") return { status: "unavailable", warnings: ["unsupported-platform"] };
    if (typeof parentOrRoot !== "string" || parentOrRoot.length > 4096 || !isAbsolute(parentOrRoot) ||
      parentOrRoot.includes("\0") || parentOrRoot.split("/").slice(1).some(p => !p || p === "." || p === "..")) fail();
    const budgets = { record: options.budgets?.recordBytes ?? GIT_DIAGNOSTIC_LIMITS.recordBudget,
      log: options.budgets?.logBytes ?? GIT_DIAGNOSTIC_LIMITS.logBudget,
      artifact: options.budgets?.artifactBytes ?? GIT_DIAGNOSTIC_LIMITS.artifactBudget };
    if (!integer(budgets.record, GIT_DIAGNOSTIC_LIMITS.recordBudget) || !integer(budgets.log, GIT_DIAGNOSTIC_LIMITS.logBudget)
      || !integer(budgets.artifact, GIT_DIAGNOSTIC_LIMITS.artifactBudget)) fail();
    let pin = openDirectory("/"); pins.push(pin);
    for (const part of parentOrRoot.split("/").slice(1)) {
      pin = openDirectory(at(pin, part), pin, part); pins.push(pin);
    }
    if (!privateMode(pin.stat)) fail();
    let root = parentOrRoot;
    if (options.create && (options.application || options.existingOnly)) fail();
    if (options.application) {
      // One fixed namespace beneath the explicit agent directory, across runs and
      // restarts. Never bootstrap UUID roots per invocation or scan legacy data.
      const name = "git-diagnostics-v2";
      check(pin);
      if (!options.existingOnly) {
        try { fs.mkdirSync(at(pin, name), { mode: 0o700 }); fs.fsyncSync(pin.fd); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      }
      pin = openDirectory(at(pin, name), pin, name); pins.push(pin);
      root += `/${name}`;
    } else if (options.create) {
      const name = `git-diagnostics-v2-${randomUUID()}`;
      check(pin);
      fs.mkdirSync(at(pin, name), { mode: 0o700 });
      fs.fsyncSync(pin.fd);
      pin = openDirectory(at(pin, name), pin, name); pins.push(pin);
      root += `/${name}`;
    }
    const match = ROOT.exec(pin.name ?? "");
    if ((!match && !options.application) || !privateMode(pin.stat)) fail();
    check(pin);
    // Bind stable application envelopes to this physical root, not a loose path.
    const rootId = match?.[1] ?? createHash("sha256").update(`${pin.stat.dev}:${pin.stat.ino}:${pin.stat.birthtimeNs}`).digest("hex");
    return { status: "stored", root, warnings: [], store: makeStore(pin, pins, rootId, budgets) };
  } catch { pins.reverse().forEach(close); return { status: "unavailable", warnings: ["storage-unavailable"] }; }
}

export interface GitDiagnosticStore {
  /** Only terminal display facts; no free-form secrets/commands/paths or authority.
   * Optional output is a finalized in-memory copy, NOT a live spool/transport.
   * The envelope proves complete stored bytes, not containment or check success.
   * Diagnostics failures never rewrite nativeOutcome. No output redaction is
   * attempted: finalized logs may be sensitive and remain private, bounded data.
   */
  append(input: TerminalDiagnostic, completedOutput?: Buffer): {
    id?: string; nativeOutcome?: NativeDiagnosticOutcome; record: DiagnosticStatus; log: DiagnosticStatus; warnings: Warnings;
  };
  /** Immutable, already validated terminal action JSON. No active prompt/spool,
   * and never an execution proof. Shares the compact-record budget. ID is only
   * correlation; conflicting publications are refused, never overwritten. */
  appendCompletedRecord(id: string, completedRecord: Buffer): { record: DiagnosticStatus; warnings: Warnings };
  readCompletedRecord(id: string): ReadResult<Buffer>;
  /** Finalized captured bytes only, never a live candidate/path/spool. The journal
   * validates exact candidate binding. This envelope confers no native rights. */
  appendCompletedArtifact(id: string, completedArtifact: Buffer): { artifact: DiagnosticStatus; warnings: Warnings };
  readCompletedArtifact(id: string): ReadResult<Buffer>;
  readRecord(id: string): ReadResult<TerminalDiagnostic>;
  readCompletedLog(id: string): ReadResult<Buffer>;
  retain(): { removed: Record<Category, number>; observedBytes: Record<Category, number>; complete: boolean; warnings: Warnings };
  close(): void;
}

/** Checker handoff: only an already-finalized in-memory output copy. This owns
 * no transport/path/process and never removes active or uncertain spools. Uses
 * the SAME application namespace as terminal action records across restarts. */
export function appendFinalizedGitDiagnosticOutput(agentDir: string, input: TerminalDiagnostic, completedOutput: Buffer):
  ReturnType<GitDiagnosticStore["append"]> & { diagnosticsUnavailable?: true; diagnostics?: { status: "unavailable"; reason: "storage-unavailable" | "retention-limited" } } {
  let value: TerminalDiagnostic;
  try { value = terminal(input); }
  catch { return { record: "omitted", log: "omitted", warnings: ["invalid-input"], diagnosticsUnavailable: true,
    diagnostics: { status: "unavailable", reason: "retention-limited" } }; }
  if (!Buffer.isBuffer(completedOutput) || completedOutput.buffer instanceof SharedArrayBuffer
    || completedOutput.length > GIT_DIAGNOSTIC_LIMITS.logBytes) return { nativeOutcome: value.nativeOutcome,
      record: "omitted", log: "omitted", warnings: ["invalid-input"], diagnosticsUnavailable: true,
      diagnostics: { status: "unavailable", reason: "retention-limited" } };
  const opened = openGitDiagnosticStore(agentDir, { application: true });
  if (opened.status !== "stored") return { nativeOutcome: value.nativeOutcome, record: "unavailable", log: "unavailable", warnings: opened.warnings,
    diagnosticsUnavailable: true, diagnostics: { status: "unavailable", reason: "storage-unavailable" } };
  try {
    const result = opened.store.append(value, completedOutput);
    return result.record === "stored" && result.log === "stored" ? result : { ...result, diagnosticsUnavailable: true,
      diagnostics: { status: "unavailable", reason: result.record === "unavailable" || result.log === "unavailable" ? "storage-unavailable" : "retention-limited" } };
  } finally { opened.store.close(); }
}

function makeStore(root: Pin, pins: Pin[], rootId: string, budgets: Record<Category, number>): GitDiagnosticStore {
  let closed = false;
  const ready = () => { if (closed) fail(); check(root); if (!privateMode(fs.fstatSync(root.fd, { bigint: true }))) fail(); };
  function readItem(name: string, inventoried?: Stat): { item: Item; data: Buffer; value: TerminalDiagnostic | Buffer } {
    ready();
    const m = ITEM.exec(name); if (!m) fail();
    const category = categoryOf(m[2]), file = at(root, name);
    const before = fs.lstatSync(file, { bigint: true });
    if (!regular(before, maxBytes(category)) || (inventoried && !unchanged(inventoried, before))) fail();
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const stat = fs.fstatSync(fd, { bigint: true });
      if (!unchanged(before, stat) || !regular(stat, maxBytes(category))) fail();
      const data = Buffer.alloc(Number(stat.size) + 1);
      let used = 0;
      while (used < data.length) {
        const n = fs.readSync(fd, data, used, data.length - used, used);
        if (!n) break;
        used += n;
      }
      ready();
      if (used !== Number(stat.size) || !unchanged(stat, fs.fstatSync(fd, { bigint: true })) ||
        !unchanged(stat, fs.lstatSync(file, { bigint: true }))) fail();
      const bytes = data.subarray(0, used);
      let value: TerminalDiagnostic | Buffer, time = Number(stat.mtimeMs);
      if (m[2] === "record") {
        const v = fields(parse(bytes), ["version", "rootId", "id", "type", "terminal"]);
        if (v.version !== 2 || v.rootId !== rootId || v.id !== m[1] || v.type !== "terminal-record") fail();
        value = terminal(v.terminal); time = value.completedAt;
        if (!Buffer.from(JSON.stringify({ version: 2, rootId, id: m[1], type: "terminal-record", terminal: value })).equals(bytes)) fail();
      } else {
        const end = bytes.indexOf(10);
        if (end < 0 || end > OVERHEAD) fail();
        const v = fields(parse(bytes.subarray(0, end)), ["version", "rootId", "id", "type", "bytes", "sha256"]);
        value = bytes.subarray(end + 1);
        const type = category === "log" ? "completed-log" : category === "artifact" ? "completed-artifact" : "completed-action";
        if (v.version !== 2 || v.rootId !== rootId || v.id !== m[1] || v.type !== type ||
          value.length > (category === "artifact" ? GIT_DIAGNOSTIC_LIMITS.artifactBytes : category === "log" ? GIT_DIAGNOSTIC_LIMITS.logBytes : maxBytes(category))
          || v.bytes !== value.length || v.sha256 !== digest(value)) fail();
        if (!Buffer.from(JSON.stringify({ version: 2, rootId, id: m[1], type, bytes: value.length, sha256: v.sha256 }) + "\n").equals(bytes.subarray(0, end + 1))) fail();
      }
      return { item: { name, category, id: m[1], stat, bytes: used, time }, data: bytes, value };
    } finally { fs.closeSync(fd); }
  }
  function scan(w: Warnings, deadline: number, incomingName?: string) {
    ready();
    const items: Item[] = [], totals = emptyTotals();
    let count = 0, readBytes = 0, complete = true, capacityKnown = true, conflict = false;
    const dir = fs.opendirSync(at(root), { bufferSize: 32 });
    try {
      while (true) {
        if (count >= GIT_DIAGNOSTIC_LIMITS.entries || performance.now() >= deadline) { complete = false; break; }
        const entry = dir.readSync(); if (!entry) break;
        count++;
        if (entry.name === incomingName) conflict = true;
        if (!ITEM.test(entry.name)) { capacityKnown = false; warn(w, "unknown-name"); continue; }
        try {
          const stat = fs.lstatSync(at(root, entry.name), { bigint: true });
          if (!regular(stat, maxBytes(categoryOf(ITEM.exec(entry.name)![2])))) { capacityKnown = false; warn(w, "unsafe-item"); continue; }
          // Include the growth-detection byte in the strict read-work bound.
          readBytes += Number(stat.size) + 1;
          if (readBytes > GIT_DIAGNOSTIC_LIMITS.scanBytes) { complete = false; break; }
          const { item } = readItem(entry.name, stat);
          totals[item.category] += item.bytes; items.push(item);
        } catch { capacityKnown = false; warn(w, "unsafe-item"); }
      }
    } finally { dir.closeSync(); }
    if (!complete) warn(w, "scan-incomplete");
    return { items, totals, count, complete, capacityKnown, conflict };
  }
  function remove(item: Item, w: Warnings): boolean {
    // Rename first, then compare against the original observed inode. If a foreign
    // file won the rename race it is preserved under the quarantine name. Never
    // restore over a subsequent writer and never sweep these names on restart.
    const quarantine = `.retired-${randomUUID()}`;
    let fd: number | undefined;
    try {
      ready();
      const file = at(root, item.name);
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      if (!unchanged(item.stat, fs.fstatSync(fd, { bigint: true })) || !unchanged(item.stat, fs.lstatSync(file, { bigint: true }))) fail();
      ready();
      fs.renameSync(file, at(root, quarantine));
      const moved = fs.lstatSync(at(root, quarantine), { bigint: true });
      // Rename changes ctime, so compare the held descriptor's post-rename stat.
      const held = fs.fstatSync(fd, { bigint: true });
      if (!same(item.stat, moved) || !unchanged(moved, held) || !regular(moved, maxBytes(item.category)) ||
        moved.size !== item.stat.size || moved.mtimeNs !== item.stat.mtimeNs) fail();
      ready();
      if (!unchanged(moved, fs.lstatSync(at(root, quarantine), { bigint: true }))) fail();
      fs.unlinkSync(at(root, quarantine));
      return true;
    } catch { warn(w, "changed-item"); return false; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  function rotation(w: Warnings, reserve = emptyTotals(), entries = 0, protectedId?: string, incomingName?: string) {
    const deadline = performance.now() + GIT_DIAGNOSTIC_LIMITS.passMs;
    // Leave half the pass for validated retirement. A large concurrent overshoot
    // or a time-limited inventory must not leave a valid namespace permanently
    // unscannable: an incomplete pass can retire its validated prefix, but can
    // NEVER establish capacity or publish new data. No cursors/locks/retries.
    const s = scan(w, deadline - GIT_DIAGNOSTIC_LIMITS.passMs / 2, incomingName), removed = emptyTotals();
    if (incomingName && !s.conflict) {
      ready();
      try { fs.lstatSync(at(root, incomingName)); s.conflict = true; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    }
    if (s.conflict) { warn(w, "changed-item"); return { ...s, removed }; }
    if (s.capacityKnown) {
      s.items.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
      for (const item of s.items) {
        // Protect the whole correlation, including an already stored artifact
        // while appending its action (and vice versa). A racing incoming name
        // discovered by inventory must never be evicted just to reuse that ID.
        if (item.id === protectedId) continue;
        if (s.complete && s.totals[item.category] + reserve[item.category] <= budgets[item.category]
          && s.count + entries <= GIT_DIAGNOSTIC_LIMITS.entryBudget) continue;
        if (performance.now() >= deadline) { s.complete = false; warn(w, "scan-incomplete"); break; }
        if (remove(item, w)) { s.totals[item.category] -= item.bytes; s.count--; removed[item.category]++; }
      }
    }
    return { ...s, removed };
  }
  function capacity(s: ReturnType<typeof scan>, reserve: Record<Category, number>, entries: number) {
    // Even if a category's attempted retirement failed, another publication
    // cannot spend unreserved aggregate scan capacity or directory slots.
    return s.complete && s.capacityKnown && s.count + entries <= GIT_DIAGNOSTIC_LIMITS.entryBudget
      && totalBytes(s.totals) + totalBytes(reserve) <= totalBytes(budgets);
  }
  function publish(id: string, category: Category, data: Buffer, w: Warnings, suffix: string = category): DiagnosticStatus {
    if (data.length > budgets[category]) { warn(w, "budget-unavailable"); return "omitted"; }
    // No temp sweeper: failed writes may leave bounded orphan data. Subsequent
    // scans omit new data while any unknown/temp/quarantine entry remains, rather
    // than treating unaccounted bytes as free capacity. Concurrent writers can
    // therefore cause optional omissions as well as target overshoot. Do not
    // unlink a staging pathname that an external process might have replaced.
    let fd: number | undefined;
    try {
      ready();
      const name = `.${randomUUID()}.tmp`, final = `${id}.${suffix}`;
      fd = fs.openSync(at(root, name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      const original = fs.fstatSync(fd, { bigint: true });
      let offset = 0;
      while (offset < data.length) {
        const n = fs.writeSync(fd, data, offset, data.length - offset, offset);
        if (!n) fail(); offset += n;
      }
      fs.fsyncSync(fd);
      ready();
      const stat = fs.fstatSync(fd, { bigint: true });
      if (!same(original, stat) || !regular(stat, maxBytes(category)) || stat.size !== BigInt(data.length) ||
        !unchanged(stat, fs.lstatSync(at(root, name), { bigint: true }))) fail();
      try { fs.lstatSync(at(root, final)); fail(); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      if (suffix === "action" || suffix === "artifact") {
        // Caller-correlated IDs need atomic no-replace publication, including
        // two independent writers racing the same ID. Keep a partly published
        // final name on failure; never retry/overwrite it or unlink foreign data.
        fs.linkSync(at(root, name), at(root, final));
        if (!same(stat, fs.lstatSync(at(root, name), { bigint: true }))
          || !same(stat, fs.lstatSync(at(root, final), { bigint: true }))) fail();
        fs.unlinkSync(at(root, name));
      } else fs.renameSync(at(root, name), at(root, final));
      if (!same(stat, fs.lstatSync(at(root, final), { bigint: true }))) fail();
      fs.fsyncSync(root.fd);
      return "stored";
    } catch { warn(w, "storage-unavailable"); return "unavailable"; }
    finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* optional diagnostics */ } } }
  }
  function read<T>(id: string, category: Category | "action"): ReadResult<T> {
    try {
      if (typeof id !== "string" || id.length !== 36 || !ID.test(id)) return { status: "unavailable", warnings: ["invalid-input"] };
      // A missing/replaced root is unavailable, not an expired item.
      try { ready(); } catch { return { status: "unavailable", warnings: ["storage-unavailable"] }; }
      return { status: "stored", value: readItem(`${id}.${category}`).value as T, warnings: [] };
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "ENOENT" ? { status: "expired", warnings: [] } : { status: "unavailable", warnings: ["storage-unavailable"] };
    }
  }
  return {
    append(input, completedOutput) {
      const warnings: Warnings = [];
      let value: TerminalDiagnostic;
      try { value = terminal(input); } catch { return { record: "omitted", log: "omitted", warnings: ["invalid-input"] }; }
      const result: ReturnType<GitDiagnosticStore["append"]> = { nativeOutcome: value.nativeOutcome, record: "unavailable", log: "omitted", warnings };
      try {
        const id = randomUUID(); result.id = id;
        const record = Buffer.from(JSON.stringify({ version: 2, rootId, id, type: "terminal-record", terminal: value }));
        let log: Buffer | undefined;
        if (completedOutput !== undefined) {
          if (!Buffer.isBuffer(completedOutput) || completedOutput.length > GIT_DIAGNOSTIC_LIMITS.logBytes || completedOutput.buffer instanceof SharedArrayBuffer) warn(warnings, "invalid-input");
          else {
            const copy = Buffer.from(completedOutput);
            log = Buffer.concat([Buffer.from(JSON.stringify({ version: 2, rootId, id, type: "completed-log", bytes: copy.length, sha256: digest(copy) }) + "\n"), copy]);
            result.log = "unavailable";
          }
        }
        // Oversized optional items do not evict existing data for no benefit.
        const reserve = { record: record.length <= budgets.record ? record.length : 0, log: log && log.length <= budgets.log ? log.length : 0, artifact: 0 };
        const entries = Number(reserve.record > 0) + Number(reserve.log > 0);
        const s = rotation(warnings, reserve, entries, id);
        const fits = (category: Category, bytes: number) => capacity(s, reserve, entries) && s.totals[category] + bytes <= budgets[category];
        if (fits("record", record.length)) result.record = publish(id, "record", record, warnings);
        else { result.record = "omitted"; warn(warnings, "budget-unavailable"); }
        if (log) {
          if (fits("log", log.length)) result.log = publish(id, "log", log, warnings);
          else { result.log = "omitted"; warn(warnings, "budget-unavailable"); }
        }
      } catch { warn(warnings, "storage-unavailable"); }
      return result;
    },
    appendCompletedRecord(id, completedRecord) {
      const warnings: Warnings = [];
      if (!ID.test(id) || !Buffer.isBuffer(completedRecord) || completedRecord.buffer instanceof SharedArrayBuffer
        || completedRecord.length > GIT_DIAGNOSTIC_LIMITS.recordBytes - OVERHEAD) return { record: "omitted", warnings: ["invalid-input"] };
      const copy = Buffer.from(completedRecord);
      const data = Buffer.concat([Buffer.from(JSON.stringify({ version: 2, rootId, id, type: "completed-action", bytes: copy.length, sha256: digest(copy) }) + "\n"), copy]);
      try {
        // Fast-path conflict check; rotation also protects this ID and checks
        // inventory-discovered conflicts. This precheck alone is not atomic.
        ready();
        try { fs.lstatSync(at(root, `${id}.action`)); return { record: "unavailable", warnings: ["changed-item"] }; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
        if (data.length > budgets.record) return { record: "omitted", warnings: ["budget-unavailable"] };
        const reserve = { record: data.length, log: 0, artifact: 0 };
        const s = rotation(warnings, reserve, 1, id, `${id}.action`);
        if (s.conflict) return { record: "unavailable", warnings };
        if (!capacity(s, reserve, 1) || s.totals.record + data.length > budgets.record) {
          warn(warnings, "budget-unavailable"); return { record: "omitted", warnings };
        }
        return { record: publish(id, "record", data, warnings, "action"), warnings };
      } catch { warn(warnings, "storage-unavailable"); return { record: "unavailable", warnings }; }
    },
    appendCompletedArtifact(id, completedArtifact) {
      const warnings: Warnings = [];
      if (typeof id !== "string" || !ID.test(id) || !Buffer.isBuffer(completedArtifact)
        || completedArtifact.buffer instanceof SharedArrayBuffer || completedArtifact.length > GIT_DIAGNOSTIC_LIMITS.artifactBytes)
        return { artifact: "omitted", warnings: ["invalid-input"] };
      const copy = Buffer.from(completedArtifact);
      const data = Buffer.concat([Buffer.from(JSON.stringify({ version: 2, rootId, id, type: "completed-artifact", bytes: copy.length, sha256: digest(copy) }) + "\n"), copy]);
      try {
        ready();
        try { fs.lstatSync(at(root, `${id}.artifact`)); return { artifact: "unavailable", warnings: ["changed-item"] }; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
        if (data.length > budgets.artifact) return { artifact: "omitted", warnings: ["budget-unavailable"] };
        const reserve = { record: 0, log: 0, artifact: data.length };
        const s = rotation(warnings, reserve, 1, id, `${id}.artifact`);
        if (s.conflict) return { artifact: "unavailable", warnings };
        if (!capacity(s, reserve, 1) || s.totals.artifact + data.length > budgets.artifact) {
          warn(warnings, "budget-unavailable"); return { artifact: "omitted", warnings };
        }
        return { artifact: publish(id, "artifact", data, warnings), warnings };
      } catch { warn(warnings, "storage-unavailable"); return { artifact: "unavailable", warnings }; }
    },
    readCompletedArtifact: id => read<Buffer>(id, "artifact"),
    readCompletedRecord: id => read<Buffer>(id, "action"),
    readRecord: id => read<TerminalDiagnostic>(id, "record"),
    readCompletedLog: id => read<Buffer>(id, "log"),
    retain() {
      const warnings: Warnings = [];
      try {
        const s = rotation(warnings);
        return { removed: s.removed, observedBytes: s.totals, complete: s.complete && s.capacityKnown, warnings };
      } catch { warn(warnings, "storage-unavailable"); return { removed: emptyTotals(), observedBytes: emptyTotals(), complete: false, warnings }; }
    },
    close() { if (!closed) { closed = true; [...pins].reverse().forEach(close); } },
  };
}
