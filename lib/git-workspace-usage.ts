// Cleanup-only coordination, not authorization, a sandbox, or a deletion API.
// Covers supported host placements. Arbitrary external writers require the
// cleanup engine's independent native identity/admission checks.
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync, type BigIntStats, type Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export class GitWorkspaceUsageError extends Error {
  constructor(readonly code: "leased" | "inflight" | "unknown" | "used" | "stale") {
    super(`Workspace cleanup usage refused: ${code}`);
  }
}
function refuse(code: GitWorkspaceUsageError["code"]): never { throw new GitWorkspaceUsageError(code); }
export interface WorkspaceIdentity { device: string; inode: string; birthtime: string }
interface Location { named: string; physical: string }
interface Root extends Location { identity: WorkspaceIdentity }
interface State { placements: Map<object, Location>; leases: Map<object, Root> }
const KEY = Symbol.for("pi-web.git-workspace-usage.v1");
function state(): State {
  const host = globalThis as typeof globalThis & { [KEY]?: State };
  return host[KEY] ??= { placements: new Map(), leases: new Map() };
}
function path(value: string): string {
  if (typeof value !== "string" || !value || !isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)) refuse("unknown");
  return resolve(value);
}
function location(cwd: string): Location {
  const named = path(cwd);
  try { return { named, physical: realpathSync(named) }; } catch { return refuse("unknown"); }
}
// Persisted metadata may refer to a directory already removed elsewhere. Resolve
// its nearest existing ancestor, retaining the missing suffix: it still has a
// known location, and aliases to descendants must not turn into false negatives.
function inventoryLocation(cwd: string): Location {
  const named = path(cwd);
  let ancestor = named;
  for (let depth = 0; depth < 256; depth++) {
    try { return { named, physical: resolve(realpathSync(ancestor), relative(ancestor, named)) }; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(ancestor) === ancestor) refuse("unknown");
      // A dangling symlink is not a known missing suffix. Never guess its target.
      try { lstatSync(ancestor); refuse("unknown"); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") refuse("unknown"); }
      ancestor = dirname(ancestor);
    }
  }
  return refuse("unknown");
}
function beneath(root: string, child: string): boolean {
  const suffix = relative(root, child);
  return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`));
}
function intersects(a: Location, b: Location): boolean {
  return beneath(a.named, b.named) || beneath(a.physical, b.physical);
}
function statIdentity(s: { dev: bigint; ino: bigint; birthtimeNs: bigint }): WorkspaceIdentity {
  return { device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) };
}
function sameIdentity(actual: WorkspaceIdentity, expected?: WorkspaceIdentity): boolean {
  return !!expected && actual.device === expected.device && actual.inode === expected.inode && actual.birthtime === expected.birthtime;
}
function identity(cwd: string): WorkspaceIdentity {
  const s = lstatSync(cwd, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink()) refuse("stale");
  return statIdentity(s);
}
function pin(cwd: string, expected?: WorkspaceIdentity): Root {
  try {
    const loc = location(cwd);
    // No retargeting through aliases/convenience paths for a destructive lease.
    if (loc.named !== cwd || loc.physical !== cwd) refuse("stale");
    const id = identity(cwd);
    if (expected && !sameIdentity(id, expected)) refuse("stale");
    return { ...loc, identity: id };
  } catch { return refuse("stale"); }
}

/** Call BEFORE any SDK/native start or first await, hold through registration or failure.
 * Not a checkout-operation/busy-chat gate: ordinary Git operations do not use it. */
export function beginGitWorkspacePlacement(cwd: string): () => void {
  // A future cwd may not exist yet (e.g. supported isolated subagent setup).
  // This only marks its placement; it never grants permission to create it.
  const loc = inventoryLocation(cwd), shared = state();
  for (const root of shared.leases.values()) if (intersects(root, loc)) refuse("leased");
  const token = {};
  shared.placements.set(token, loc);
  return () => { shared.placements.delete(token); };
}

export interface KnownInventory<T> { known: boolean; entries: readonly T[] }
export interface SessionUsage { id: string; cwd: string }
/** A complete externally trusted containment/process-accounting result. Launch
 * cwd alone is never proof. Even exited shells require surviving-child accounting.
 * `containedCwds` describes ALL current shell/descendant cwd locations. */
export interface TerminalUsage {
  id: string;
  known: boolean;
  exited: boolean;
  survivingChildren: number;
  containedCwds: readonly string[];
}
export interface CheckUsage { id: string; cwd: string; stopped: boolean }
export interface WorkspaceUsageSnapshot {
  sessions: KnownInventory<SessionUsage>;
  terminals: KnownInventory<TerminalUsage>;
  checks: KnownInventory<CheckUsage>;
  // Host markers are checked separately; include other supported producers here.
  inflight: KnownInventory<{ cwd: string }>;
}
export interface WorkspaceRemovalSelection {
  actionId: string;
  featureOid: string;
  adminPath: string;
  adminIdentity: WorkspaceIdentity;
  markerIdentity: WorkspaceIdentity & { changed: string; size: string };
  adminInventoryHash: string;
}
/** Structural subset of GitCleanupRemovalProof; no native-module import/cycle.
 * The trusted reader must resolve ONLY an identity-sealed durable acknowledgement
 * issued after successful native removal, independent verification and admission.
 * A parsed proof or { durable: true, proof } lookalike is never an issuer. */
export interface WorkspaceRemovalProof {
  version: 1; actionId: string; kind: "removed"; sourcePath: string; adminPath: string; featureOid: string;
  exit: 0; sourceAbsent: true; adminAbsent: true;
  before: { checkouts: Record<string, WorkspaceIdentity>; admins: Record<string, string> };
  after: { checkouts: Record<string, WorkspaceIdentity>; admins: Record<string, string> };
}
export type ReadIssuedWorkspaceRemoval = (issuedAck: object) => WorkspaceRemovalProof | undefined;
export interface GitWorkspaceDeletionLease {
  /** Re-read all trusted inventory at every destructive boundary while held. */
  assertUnused(): { sessions: "known-idle"; terminals: "known-idle"; checks: "known-stopped" };
  /** Mandatory after durable recordRemoval and before post-removal assertUnused.
   * Never releases/reacquires the fence or grants policy/ref-deletion authority. */
  acknowledgeRemoval(issuedAck: object): void;
  release(): void;
}
export interface TrustedWorkspaceUsage {
  acquireLease(cwd: string, expected?: WorkspaceIdentity, removal?: WorkspaceRemovalSelection): GitWorkspaceDeletionLease;
}
const MAX_INVENTORY = 10_000;
function inventory<T>(value: KnownInventory<T>): readonly T[] {
  if (!value || value.known !== true || !Array.isArray(value.entries) || value.entries.length > MAX_INVENTORY) refuse("unknown");
  return value.entries;
}
/** Internal callers supply authoritative fresh SDK/session metadata and positive
 * terminal/check inventories, never browser cache or caller-supplied policy.
 * Can adapt to the cleanup engine's acquireUsageLease/assertIdle/release interface.
 * Hold through native cleanup AND positive process settlement; no expiry/reset. */
export function createTrustedWorkspaceUsage(read: () => WorkspaceUsageSnapshot, readIssuedRemoval?: ReadIssuedWorkspaceRemoval): TrustedWorkspaceUsage {
  return {
    acquireLease(cwd, expected, removal) {
      const root = pin(cwd, expected), shared = state();
      for (const held of shared.leases.values()) if (intersects(root, held) || intersects(held, root)) refuse("leased");
      for (const pending of shared.placements.values()) if (intersects(root, pending)) refuse("inflight");
      const token = {};
      // Descriptor pins identify the ORIGINAL root/admin/.git instances, not
      // just absent names. Absence additionally needs an issued durable proof.
      const parent = pin(dirname(root.named));
      const fds: number[] = [];
      const openPin = (name: string, directory: boolean) => {
        const fd = openSync(name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (directory ? constants.O_DIRECTORY : 0));
        fds.push(fd); return fd;
      };
      let fd: number;
      let selected: WorkspaceRemovalSelection | undefined;
      let admin: Root | undefined, adminParent: Root | undefined, common: Root | undefined;
      let adminFd: number | undefined, markerFd: number | undefined, adminParentFd: number | undefined, commonFd: number | undefined;
      let initialAdmins: Record<string, WorkspaceIdentity> | undefined;
      // Bounded reads through our OWN known directory descriptor, never proc
      // process discovery/cmdline/environment. Retired directories must be empty.
      const adminEntries = (opened: number): Record<string, WorkspaceIdentity> => {
        if (process.platform !== "linux") refuse("unknown");
        const base = `/proc/self/fd/${opened}`, entries: Record<string, WorkspaceIdentity> = Object.create(null);
        const directory = opendirSync(base);
        try {
          let entry, count = 0;
          while ((entry = directory.readSync())) {
            if (++count > MAX_INVENTORY) refuse("unknown");
            const s = lstatSync(join(base, entry.name), { bigint: true });
            if (!s.isDirectory() || s.isSymbolicLink()) refuse("unknown");
            entries[entry.name] = statIdentity(s);
          }
        } finally { directory.closeSync(); }
        return entries;
      };
      const record = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value);
      const sameNames = (a: object, b: object) => JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort());
      const markerPath = join(root.named, ".git");
      const markerIdentity = (s: BigIntStats) =>
        ({ ...statIdentity(s), changed: String(s.ctimeNs), size: String(s.size) });
      try {
        fd = openPin(root.named, true);
        if (removal) {
          selected = { ...removal, adminIdentity: { ...removal.adminIdentity }, markerIdentity: { ...removal.markerIdentity } };
          if (!readIssuedRemoval || !selected.actionId || selected.actionId.length > 128
            || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(selected.featureOid) || !/^[a-f0-9]{64}$/.test(selected.adminInventoryHash)) refuse("stale");
          admin = pin(selected.adminPath, selected.adminIdentity);
          if (beneath(root.named, admin.named)) refuse("stale");
          adminParent = pin(dirname(admin.named));
          common = pin(dirname(adminParent.named));
          adminParentFd = openPin(adminParent.named, true);
          commonFd = openPin(common.named, true);
          if (!sameIdentity(statIdentity(fstatSync(adminParentFd, { bigint: true })), adminParent.identity)
            || !sameIdentity(statIdentity(fstatSync(commonFd, { bigint: true })), common.identity)) refuse("stale");
          initialAdmins = adminEntries(adminParentFd);
          if (!sameIdentity(admin.identity, initialAdmins[basename(admin.named)])) refuse("stale");
          adminFd = openPin(admin.named, true);
          const marker = lstatSync(markerPath, { bigint: true });
          if (!marker.isFile() || marker.isSymbolicLink() || marker.nlink !== BigInt(1)) refuse("stale");
          const actual = markerIdentity(marker);
          if (!sameIdentity(actual, selected.markerIdentity) || actual.changed !== selected.markerIdentity.changed || actual.size !== selected.markerIdentity.size) refuse("stale");
          markerFd = openPin(markerPath, false);
          const opened = markerIdentity(fstatSync(markerFd, { bigint: true }));
          if (JSON.stringify(opened) !== JSON.stringify(actual) || !sameIdentity(statIdentity(fstatSync(adminFd, { bigint: true })), admin.identity)) refuse("stale");
        }
      } catch { for (const opened of fds) closeSync(opened); return refuse("stale"); }
      let removed = false, removedAdminParent = false;
      let survivingAdmins: Record<string, WorkspaceIdentity> | undefined;
      const attemptedRemovalAcks = new WeakSet<object>();
      shared.leases.set(token, root); // Fence first, then inventory. Reentrant starts are denied.
      const absent = (name: string) => {
        try { lstatSync(name); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; }
        refuse("stale");
      };
      const assertRemovedInstances = (parentRemoved: boolean, expectedAdmins: Record<string, WorkspaceIdentity> | undefined) => {
        if (process.platform !== "linux" || !selected || !admin || !adminParent || !common || !expectedAdmins
          || adminFd === undefined || markerFd === undefined || adminParentFd === undefined || commonFd === undefined) refuse("stale");
        pin(parent.named, parent.identity); pin(common.named, common.identity);
        const commonStat = fstatSync(commonFd, { bigint: true }), parentStat = fstatSync(adminParentFd, { bigint: true });
        if (!commonStat.isDirectory() || commonStat.nlink === BigInt(0) || !sameIdentity(statIdentity(commonStat), common.identity)
          || !sameIdentity(statIdentity(parentStat), adminParent.identity)) refuse("stale");
        if (parentRemoved) {
          // ONLY the sealed own-removal delta can authorize retirement of the
          // original NOWEMPTY worktrees parent; not ENOENT or an empty replacement.
          if (Object.keys(expectedAdmins).length || parentStat.nlink !== BigInt(0)) refuse("stale");
          absent(adminParent.named);
        } else {
          pin(adminParent.named, adminParent.identity);
          if (parentStat.nlink === BigInt(0)) refuse("stale");
        }
        const currentAdmins = adminEntries(adminParentFd);
        if (!sameNames(currentAdmins, expectedAdmins)
          || Object.entries(expectedAdmins).some(([name, id]) => !sameIdentity(id, currentAdmins[name]))) refuse("stale");
        for (const [opened, expectedId] of [[fd, root.identity], [adminFd, admin.identity], [markerFd, selected.markerIdentity]] as const) {
          const s = fstatSync(opened, { bigint: true });
          if (!sameIdentity(statIdentity(s), expectedId) || s.nlink !== BigInt(0)) refuse("stale");
        }
        absent(root.named); absent(admin.named); absent(markerPath);
      };
      const assertRoot = () => {
        try {
          if (removed) { assertRemovedInstances(removedAdminParent, survivingAdmins); return; }
          const s = fstatSync(fd, { bigint: true });
          if (!s.isDirectory() || !sameIdentity(statIdentity(s), root.identity)) refuse("stale");
          pin(root.named, root.identity);
          if (admin && selected && adminFd !== undefined && markerFd !== undefined && adminParent && common && commonFd !== undefined) {
            pin(common.named, common.identity); pin(adminParent.named, adminParent.identity);
            const commonStat = fstatSync(commonFd, { bigint: true });
            if (commonStat.nlink === BigInt(0) || !sameIdentity(statIdentity(commonStat), common.identity)) refuse("stale");
            pin(admin.named, admin.identity);
            const marker = markerIdentity(lstatSync(markerPath, { bigint: true }));
            if (!sameIdentity(marker, selected.markerIdentity) || marker.changed !== selected.markerIdentity.changed || marker.size !== selected.markerIdentity.size) refuse("stale");
          }
        } catch { return refuse("stale"); }
      };
      const lease: GitWorkspaceDeletionLease = {
        assertUnused() {
          if (shared.leases.get(token) !== root) refuse("stale");
          assertRoot(); // Same-path replacement never inherits a lease.
          for (const pending of shared.placements.values()) if (intersects(root, pending)) refuse("inflight");
          let snapshot: WorkspaceUsageSnapshot;
          try { snapshot = read(); } catch { return refuse("unknown"); }
          if (!snapshot || typeof snapshot !== "object") refuse("unknown");
          const matches = (cwd: string) => intersects(root, inventoryLocation(cwd));
          for (const session of inventory(snapshot.sessions)) {
            if (!session || typeof session.id !== "string" || !session.id) refuse("unknown");
            // Idle persisted chats need an explicit, separate relocation too.
            if (matches(session.cwd)) refuse("used");
          }
          for (const terminal of inventory(snapshot.terminals)) {
            if (!terminal || terminal.known !== true || !terminal.id || typeof terminal.exited !== "boolean"
              || !Number.isSafeInteger(terminal.survivingChildren) || terminal.survivingChildren < 0
              || !Array.isArray(terminal.containedCwds) || terminal.containedCwds.length > MAX_INVENTORY) refuse("unknown");
            // No current cwd proof for a live shell is unknown, not inactive.
            if ((!terminal.exited || terminal.survivingChildren > 0) && !terminal.containedCwds.length) refuse("unknown");
            const contained = terminal.containedCwds.map(matches).some(Boolean);
            if (contained && (!terminal.exited || terminal.survivingChildren > 0)) refuse("used");
          }
          for (const check of inventory(snapshot.checks)) {
            if (!check || !check.id || typeof check.stopped !== "boolean") refuse("unknown");
            if (matches(check.cwd) && !check.stopped) refuse("used");
          }
          for (const pending of inventory(snapshot.inflight)) {
            if (!pending) refuse("unknown");
            if (matches(pending.cwd)) refuse("inflight");
          }
          // Inventory callbacks cannot release or retarget the selected root either.
          if (shared.leases.get(token) !== root) refuse("stale");
          assertRoot();
          return { sessions: "known-idle", terminals: "known-idle", checks: "known-stopped" };
        },
        acknowledgeRemoval(issuedAck) {
          if (shared.leases.get(token) !== root || removed || !selected || !readIssuedRemoval || !issuedAck || typeof issuedAck !== "object"
            || attemptedRemovalAcks.has(issuedAck)) refuse("stale");
          // A premature/unissued acknowledgement never becomes a retry handle.
          attemptedRemovalAcks.add(issuedAck);
          let proof: WorkspaceRemovalProof | undefined;
          try { proof = readIssuedRemoval(issuedAck); } catch { return refuse("unknown"); }
          const ownAdmin = basename(selected.adminPath);
          if (!proof || proof.version !== 1 || proof.kind !== "removed" || proof.actionId !== selected.actionId
            || proof.featureOid !== selected.featureOid || proof.sourcePath !== root.named || proof.adminPath !== selected.adminPath
            || proof.exit !== 0 || proof.sourceAbsent !== true || proof.adminAbsent !== true
            || !sameIdentity(root.identity, proof.before?.checkouts?.[root.named])
            || proof.before?.admins?.[ownAdmin] !== selected.adminInventoryHash
            || !record(proof.before?.checkouts) || !record(proof.before?.admins) || !record(proof.after?.checkouts) || !record(proof.after?.admins)
            || Object.hasOwn(proof.after.checkouts, root.named) || Object.hasOwn(proof.after.admins, ownAdmin)) refuse("stale");
          if (!initialAdmins || adminParentFd === undefined || !adminParent || !sameNames(proof.before.admins, initialAdmins)) refuse("stale");
          const expectedAdmins = { ...initialAdmins }; delete expectedAdmins[ownAdmin];
          const expectedHashes = { ...proof.before.admins }; delete expectedHashes[ownAdmin];
          const expectedCheckouts = { ...proof.before.checkouts }; delete expectedCheckouts[root.named];
          if (!sameNames(proof.after.admins, expectedHashes) || !sameNames(proof.after.checkouts, expectedCheckouts)
            || Object.entries(expectedHashes).some(([name, hash]) => proof.after.admins[name] !== hash)
            || Object.entries(expectedCheckouts).some(([name, id]) => !sameIdentity(id, proof.after.checkouts[name]))) refuse("stale");
          const parentWasRemoved = fstatSync(adminParentFd, { bigint: true }).nlink === BigInt(0);
          if (parentWasRemoved && (basename(adminParent.named) !== "worktrees" || Object.keys(initialAdmins).length !== 1
            || Object.keys(expectedAdmins).length !== 0)) refuse("stale");
          assertRemovedInstances(parentWasRemoved, expectedAdmins);
          survivingAdmins = expectedAdmins;
          removedAdminParent = parentWasRemoved;
          removed = true;
          lease.assertUnused(); // Absence does not weaken any known-use inventory.
        },
        release() {
          if (!shared.leases.delete(token)) return;
          for (const opened of fds) closeSync(opened);
        },
      };
      try { lease.assertUnused(); return lease; } catch (error) { lease.release(); throw error; }
    },
  };
}

/** Header-only scan of the SDK-owned sessions tree. No incremental/UI cache,
 * no transcript parsing or credential-file reads. Missing, unreadable, symlinked, changed or
 * over-budget inventory is unknown. Optional limits only tighten the budget. */
export function readPersistedWorkspaceSessions(sessionsDir: string, limits: { entries?: number; headerBytes?: number } = {}): KnownInventory<SessionUsage> {
  const entries: SessionUsage[] = [];
  const maxEntries = Math.min(MAX_INVENTORY, limits.entries ?? MAX_INVENTORY);
  const maxHeader = Math.min(64 * 1024, limits.headerBytes ?? 64 * 1024);
  let visited = 0;
  const ids = new Set<string>();
  const fingerprint = (s: Stats) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
  try {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxHeader) || maxHeader < 1) refuse("unknown");
    const scan = (dir: string, depth: number) => {
      const before = lstatSync(dir);
      if (!before.isDirectory() || before.isSymbolicLink()) refuse("unknown");
      // Bounded directory enumeration, including files not considered sessions.
      const fd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try {
        const names: string[] = [];
        const directory = opendirSync(dir);
        try {
          let entry;
          while ((entry = directory.readSync())) {
            if (++visited > maxEntries) refuse("unknown");
            names.push(entry.name);
          }
        } finally { directory.closeSync(); }
        for (const name of names) {
          const file = join(dir, name), s = lstatSync(file);
          if (s.isSymbolicLink()) refuse("unknown");
          if (s.isDirectory()) {
            if (depth >= 2) refuse("unknown");
            scan(file, depth + 1);
          } else if (name.endsWith(".jsonl")) {
            if (!s.isFile()) refuse("unknown");
            const headerFd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            try {
              if (fingerprint(fstatSync(headerFd)) !== fingerprint(s)) refuse("unknown");
              const data = Buffer.alloc(maxHeader + 1);
              const length = readSync(headerFd, data, 0, data.length, 0);
              const newline = data.subarray(0, length).indexOf(10);
              if (newline < 0 && length > maxHeader) refuse("unknown");
              const text = new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(0, newline < 0 ? length : newline));
              const h = JSON.parse(text) as { type?: unknown; id?: unknown; cwd?: unknown };
              if (h.type !== "session" || typeof h.id !== "string" || !h.id || typeof h.cwd !== "string" || ids.has(h.id)) refuse("unknown");
              path(h.cwd);
              if (fingerprint(fstatSync(headerFd)) !== fingerprint(s) || fingerprint(lstatSync(file)) !== fingerprint(s)) refuse("unknown");
              ids.add(h.id); entries.push({ id: h.id, cwd: h.cwd });
            } finally { closeSync(headerFd); }
          } else if (!s.isFile()) refuse("unknown");
        }
        if (fingerprint(fstatSync(fd)) !== fingerprint(before) || fingerprint(lstatSync(dir)) !== fingerprint(before)) refuse("unknown");
      } finally { closeSync(fd); }
    };
    scan(path(sessionsDir), 0);
    return { known: true, entries };
  } catch { return { known: false, entries: [] }; }
}
