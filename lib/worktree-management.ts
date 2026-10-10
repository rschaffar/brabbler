import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
// @ts-expect-error Native Node tests require .ts extensions.
import { gitExecEnv } from "./git-exec.ts";
// @ts-expect-error Native Node tests require .ts extensions.
import { samePath, toNativePath } from "./paths.ts";
import type { ManagedWorktree, MergeDate, WorktreeManagementDetails, WorktreeManagementInventory, WorktreeManagementRow, WorktreeManagementStatus } from "./worktree-management-types";
const exec = promisify(execFile);
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const LIMIT = 8 * 1024 * 1024;
const HISTORY = 10_000;
export class WorktreeManagementError extends Error {
  readonly code: "INVALID" | "STALE" | "UNAVAILABLE";
  constructor(code: WorktreeManagementError["code"], message: string) { super(message); this.code = code; }
}
/** Local-only, no optional writes or project fsmonitor commands. Status additionally preflights attributes. */
export async function managementGit(cwd: string, args: string[], signal?: AbortSignal, input?: string): Promise<string> {
  const child = exec("git", ["--no-pager", "--no-optional-locks", "-c", "core.fsmonitor=false", "-C", cwd, ...args], {
    env: { ...gitExecEnv(), GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "", GIT_LITERAL_PATHSPECS: "1" },
    timeout: 15_000, maxBuffer: LIMIT, encoding: "utf8", signal,
  });
  if (input !== undefined) { child.child.stdin?.end(input); child.child.stdin?.on("error", () => {}); }
  return (await child).stdout;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const native = (value: string) => toNativePath(value);
async function graphSupported(cwd: string, signal?: AbortSignal) {
  const graft = native((await managementGit(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "info/grafts"], signal)).trim());
  if (existsSync(graft) && statSync(graft).size) throw new Error("Legacy grafts are unsupported");
}
export async function managementRegistrations(cwd: string, signal?: AbortSignal): Promise<ManagedWorktree[]> {
  const text = await managementGit(cwd, ["worktree", "list", "--porcelain", "-z"], signal);
  return text.split("\0\0").filter(Boolean).map((record, index) => {
    const fields = record.split("\0"), path = fields.find((v) => v.startsWith("worktree "))?.slice(9);
    if (!path) throw new Error("Invalid worktree registration");
    const find = (name: string) => fields.find((v) => v === name || v.startsWith(`${name} `));
    const head = find("HEAD")?.slice(5) ?? null;
    return { path: native(path), head: head && OID.test(head) ? head : null,
      branch: fields.find((v) => v.startsWith("branch refs/heads/"))?.slice(18) ?? null,
      main: index === 0, selected: samePath(native(path), cwd), detached: fields.includes("detached"),
      locked: find("locked")?.slice(6).trim() ?? null, prunable: find("prunable")?.slice(8).trim() ?? null,
      missing: !existsSync(native(path)) };
  });
}
export async function managementCheckout(cwd: string, signal?: AbortSignal) {
  if (!isAbsolute(cwd) || !samePath(cwd, realpathSync(cwd))) throw new WorktreeManagementError("INVALID", "Select a physical absolute checkout root, without symlink aliases");
  let root: string;
  try { root = native((await managementGit(cwd, ["rev-parse", "--show-toplevel"], signal)).trim()); }
  catch { signal?.throwIfAborted(); throw new WorktreeManagementError("INVALID", "Select a non-bare registered checkout root"); }
  if (!samePath(root, cwd)) throw new WorktreeManagementError("INVALID", "Select the registered checkout root");
  const project = realpathSync(native((await managementGit(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal)).trim()));
  const registrations = await managementRegistrations(cwd, signal);
  if (!registrations.some((w) => samePath(w.path, cwd))) throw new WorktreeManagementError("INVALID", "Checkout is not registered");
  const identity = [cwd, project].map((path) => { const s = lstatSync(path); return [path, s.dev, s.ino]; });
  return { project, registrations, identity };
}
async function refs(cwd: string, signal?: AbortSignal) {
  let raw: string;
  try { raw = await managementGit(cwd, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)%00%(committerdate:iso-strict)%00%(authordate:iso-strict)%00%(subject)%00", "refs/heads"], signal); }
  catch {
    signal?.throwIfAborted();
    // Preserve branch names/tips when metadata objects cannot be read locally.
    raw = await managementGit(cwd, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)%00%00%00%00", "refs/heads"], signal);
  }
  return { raw, values: raw.split("\0\n").filter(Boolean).map((line) => {
    const [ref, tip, symbolic, tipDate, authorDate, subject] = line.split("\0");
    if (!ref.startsWith("refs/heads/") || !OID.test(tip)) throw new Error("Invalid local ref inventory");
    return { branch: ref.slice(11), tip, symbolic: Boolean(symbolic), tipDate: tipDate || null, authorDate: authorDate || null, subject: subject || null };
  }) };
}
function relatedIdentity(path: string): string | null {
  try {
    return hash([path, join(path, ".git")].map((item) => {
      const s = lstatSync(item, { bigint: true });
      if (s.isSymbolicLink()) throw new Error("Symlink checkout metadata");
      return [String(s.dev), String(s.ino), String(s.mode), ...(s.isFile() ? [String(s.size), String(s.mtimeNs), String(s.ctimeNs)] : [])];
    }));
  } catch { return null; }
}
interface Capture { inventory: WorktreeManagementInventory; related: Map<string, string | null>; identity: unknown; refs: string; registrations: string; expires: number; history?: Promise<Array<{ oid: string; parents: string[]; date: string }>>; dates?: Map<string, Promise<MergeDate>> }
const captures = new Map<string, Capture>();
/** Successful graph paths prove containment even with shallow history; negatives do not. */
export async function managementContains(cwd: string, feature: string, target: string, signal?: AbortSignal): Promise<"yes" | "no" | "unknown"> {
  if (!OID.test(feature) || !OID.test(target)) throw new WorktreeManagementError("INVALID", "Full captured object IDs required");
  try {
    await graphSupported(cwd, signal);
    await managementGit(cwd, ["merge-base", "--is-ancestor", feature, target], signal);
    return "yes";
  } catch (error) {
    signal?.throwIfAborted();
    if ((error as { code?: unknown }).code === 1) {
      try { if ((await managementGit(cwd, ["rev-parse", "--is-shallow-repository"], signal)).trim() === "false") return "no"; } catch { signal?.throwIfAborted(); }
    }
    return "unknown";
  }
}
export async function captureWorktreeManagement(cwd: string, options: { target?: string; configuredTarget?: string | null; targetSource?: "builtin" | "global" | "project"; signal?: AbortSignal } = {}): Promise<WorktreeManagementInventory> {
  const { signal } = options;
  const checkout = await managementCheckout(cwd, signal), branches = await refs(cwd, signal);
  const configured = options.configuredTarget ?? null;
  const chosen = options.target ?? (branches.values.some((r) => r.branch === configured) ? configured : null);
  const target = branches.values.find((r) => r.branch === chosen);
  if (options.target !== undefined && !target) throw new WorktreeManagementError("INVALID", "Choose a literal existing local branch");
  let merged = new Set<string>(), graphFailure = false, shallow = true;
  if (target) try {
    await graphSupported(cwd, signal);
    shallow = (await managementGit(cwd, ["rev-parse", "--is-shallow-repository"], signal)).trim() !== "false";
    merged = new Set((await managementGit(cwd, ["for-each-ref", `--merged=${target.tip}`, "--format=%(refname)", "refs/heads"], signal)).split("\n"));
  } catch { signal?.throwIfAborted(); graphFailure = true; }
  const rows: WorktreeManagementRow[] = branches.values.map((r) => {
    const worktrees = checkout.registrations.filter((w) => w.branch === r.branch);
    const integration = r.branch === target?.branch ? "target" : !target || graphFailure ? "unknown"
      : merged.has(`refs/heads/${r.branch}`) ? "integrated" : shallow || !r.tipDate ? "unknown" : "not-integrated";
    return { id: `branch:${r.branch}`, kind: "branch", ...r, worktrees, integration,
      ...(integration === "unknown" ? { integrationReason: !target ? "target-needed" : graphFailure || !r.tipDate ? "graph-unavailable" : "incomplete-history" } : {}),
      mergeDate: { state: integration === "integrated" ? "not-loaded" : "not-applicable" },
      // Containment is evidence, not removal authority. Protect both targets independently.
      // Checkout-specific blockers are evaluated against the selected removal path in the view.
      blockers: [...(r.symbolic ? ["symbolic-ref"] : []),
        ...(r.branch === configured ? ["configured-target"] : []), ...(r.branch === target?.branch ? ["comparison-target"] : [])] };
  });
  for (const w of checkout.registrations) {
    if (!w.branch || !branches.values.some((r) => r.branch === w.branch)) rows.push({ id: `registration:${hash(w.path)}`, kind: "diagnostic", branch: w.branch, tip: w.head, symbolic: false,
      tipDate: null, authorDate: null, subject: null, worktrees: [w], integration: "unknown", integrationReason: "diagnostic-registration", mergeDate: { state: "not-applicable" }, blockers: ["diagnostic-registration"] });
  }
  let diagnostic = 0;
  const diagnostics = rows.filter((r) => r.id.startsWith("registration:") && r.tip);
  await Promise.all(Array.from({ length: Math.min(3, diagnostics.length) }, async () => {
    while (diagnostic < diagnostics.length) {
      const row = diagnostics[diagnostic++];
      try {
        const [date, authorDate, subject] = (await managementGit(cwd, ["show", "-s", "--no-show-signature", "--format=%cI%x00%aI%x00%s", `${row.tip!}^{commit}`], signal)).trimEnd().split("\0");
        row.tipDate = date || null; row.authorDate = authorDate || null; row.subject = subject || null;
        const w = row.worktrees[0];
        if (!w.branch && w.detached && date && authorDate && !w.missing && w.locked === null && w.prunable === null) {
          row.kind = "detached"; row.integrationReason = "detached-head";
          row.blockers = [];
        }
      } catch { signal?.throwIfAborted(); }
    }
  }));
  rows.sort((a, b) => (a.integration === "integrated" ? 0 : 1) - (b.integration === "integrated" ? 0 : 1)
    || (a.tipDate ? Date.parse(a.tipDate) : Infinity) - (b.tipDate ? Date.parse(b.tipDate) : Infinity) || (a.branch ?? a.id).localeCompare(b.branch ?? b.id));
  const inventory: WorktreeManagementInventory = { captureId: randomUUID(), capturedAt: new Date().toISOString(), project: checkout.project,
    mainCheckout: checkout.registrations[0].path, checkout: cwd,
    target: { branch: target?.branch ?? null, tip: target?.tip ?? null, configured, source: options.targetSource ?? "builtin", temporary: Boolean(target && target.branch !== configured), missingConfigured: Boolean(configured && !branches.values.some((r) => r.branch === configured)) },
    targets: branches.values.map(({ branch, tip }) => ({ branch, tip })), rows, complete: true,
    counts: { branches: branches.values.length, worktrees: checkout.registrations.length,
      diagnostics: checkout.registrations.filter((w) => w.detached || w.locked !== null || w.prunable !== null || w.missing || w.branch && !branches.values.some((r) => r.branch === w.branch)).length,
      integrated: rows.filter((r) => r.integration === "integrated").length, notIntegrated: rows.filter((r) => r.integration === "not-integrated").length,
      unknown: rows.filter((r) => r.integration === "unknown").length, target: target ? 1 : 0 } };
  const capture: Capture = { inventory, related: new Map(checkout.registrations.map((w) => [w.path, relatedIdentity(w.path)])), identity: checkout.identity, refs: branches.raw, registrations: hash(checkout.registrations), expires: Date.now() + 15 * 60_000 };
  await revalidate(capture, signal);
  for (const [key, value] of captures) if (value.expires < Date.now()) captures.delete(key);
  while (captures.size >= 64) captures.delete(captures.keys().next().value!);
  captures.set(inventory.captureId, capture);
  return structuredClone(inventory);
}
async function revalidate(capture: Capture, signal?: AbortSignal) {
  const current = await managementCheckout(capture.inventory.checkout, signal);
  if (hash(current.identity) !== hash(capture.identity) || hash(current.registrations) !== capture.registrations || (await refs(capture.inventory.checkout, signal)).raw !== capture.refs)
    throw new WorktreeManagementError("STALE", "Repository refs or registration changed; refresh inventory");
}
async function firstParents(cwd: string, target: string, signal?: AbortSignal) {
  await graphSupported(cwd, signal);
  const raw = await managementGit(cwd, ["log", "--first-parent", "--no-show-signature", `--max-count=${HISTORY + 1}`, "--format=%H%x00%P%x00%cI", target], signal);
  return raw.trimEnd().split("\n").filter(Boolean).map((line) => { const [oid, parents, date] = line.split("\0"); return { oid, parents: parents ? parents.split(" ") : [], date }; });
}
export async function managementMergeDate(cwd: string, feature: string, target: string, signal?: AbortSignal, history?: Awaited<ReturnType<typeof firstParents>>): Promise<MergeDate> {
  if (await managementContains(cwd, feature, target, signal) !== "yes") return { state: "unavailable", reason: "containment-unavailable" };
  try {
    const chain = history ?? await firstParents(cwd, target, signal);
    let low = 0, high = chain.length - 1;
    if (high < 0) throw new Error("missing-history");
    // Containment is monotonic along first-parent order, regardless of timestamps.
    while (low < high) {
      const mid = Math.ceil((low + high) / 2), contains = await managementContains(cwd, feature, chain[mid].oid, signal);
      if (contains === "unknown") return { state: "unavailable", reason: "incomplete-history" };
      if (contains === "yes") low = mid; else high = mid - 1;
    }
    const entry = chain[low];
    if (low === chain.length - 1 && (await managementGit(cwd, ["rev-parse", "--is-shallow-repository"], signal)).trim() === "true") return { state: "unavailable", reason: "incomplete-history" };
    if (low === chain.length - 1 && entry.parents.length) return { state: "unavailable", reason: chain.length > HISTORY ? "history-budget" : "incomplete-history" };
    if (entry.parents[0] && await managementContains(cwd, feature, entry.parents[0], signal) !== "no") return { state: "unavailable", reason: "incomplete-history" };
    return entry.parents.length > 1 ? { state: "available", date: entry.date, commit: entry.oid, source: "first-parent-graph" }
      : { state: "unavailable", reason: "ordinary-or-root-introduction" };
  } catch { signal?.throwIfAborted(); return { state: "unavailable", reason: "history-unavailable-or-budget" }; }
}
export async function managementStatus(path: string, signal?: AbortSignal, expected?: { project: string; identity: string | null; isAllowed: (path: string) => boolean }): Promise<WorktreeManagementStatus> {
  const base = { path, trackedDirty: false, untracked: [] as string[], ignored: [] as string[], submodules: "ignored" as const };
  try {
    const assertRelated = () => {
      if (expected && (!expected.isAllowed(path) || !expected.identity || relatedIdentity(path) !== expected.identity)) throw new Error("Captured checkout access or physical identity changed");
    };
    assertRelated();
    const checkout = await managementCheckout(path, signal);
    if (expected && !samePath(checkout.project, expected.project)) throw new Error("Captured checkout belongs to another project");
    assertRelated();
    const files = await managementGit(path, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], signal);
    const attributes = await managementGit(path, ["check-attr", "-z", "--stdin", "filter"], signal, files);
    const parts = attributes.split("\0");
    for (let i = 2; i < parts.length; i += 3) if (!["unspecified", "unset"].includes(parts[i])) throw new Error("clean/process filter attributes unsupported");
    const raw = await managementGit(path, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all"], signal);
    // Collapse ignored directories instead of enumerating every dependency file.
    base.ignored = (await managementGit(path, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"], signal)).split("\0").filter(Boolean);
    const records = raw.split("\0").filter(Boolean);
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (record.startsWith("?? ")) base.untracked.push(record.slice(3));
      else if (record.startsWith("!! ")) base.ignored.push(record.slice(3));
      else { base.trackedDirty = true; if (record.slice(0, 2).includes("R") || record.slice(0, 2).includes("C")) i++; }
    }
    assertRelated();
    if (expected && !samePath((await managementCheckout(path, signal)).project, expected.project)) throw new Error("Captured checkout project changed during status read");
    return { ...base, state: base.trackedDirty || base.untracked.length ? "dirty" : "clean" };
  } catch (error) { signal?.throwIfAborted(); return { ...base, trackedDirty: false, untracked: [], ignored: [], state: "unavailable", reason: error instanceof Error ? error.message.split("\n")[0] : "status-unavailable" }; }
}
export async function worktreeManagementDetails(cwd: string, captureId: string, ids: string[], signal?: AbortSignal, datesOnly = false, isAllowed: (path: string) => boolean = () => false): Promise<WorktreeManagementDetails> {
  const capture = captures.get(captureId);
  if (!capture || capture.expires < Date.now() || !samePath(cwd, capture.inventory.checkout)) throw new WorktreeManagementError("STALE", "Capture expired; refresh inventory");
  if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length) throw new WorktreeManagementError("INVALID", "Select one to fifty distinct row IDs");
  const selected = ids.map((id) => { const row = capture.inventory.rows.find((r) => r.id === id); if (!row) throw new WorktreeManagementError("INVALID", "Unknown captured row"); return row; });
  await revalidate(capture, signal);
  const target = capture.inventory.target.tip;
  if (target && selected.some((r) => r.integration === "integrated")) {
    // Cache only immutable graph data; failed/cancelled reads do not poison later requests.
    capture.history ??= firstParents(cwd, target, signal).catch((error) => { capture.history = undefined; throw error; });
  }
  let history: Awaited<ReturnType<typeof firstParents>> | undefined;
  try { history = await capture.history; } catch { signal?.throwIfAborted(); }
  const rows: WorktreeManagementDetails["rows"] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, async () => {
    while (next < selected.length) {
      const row = selected[next++];
      let mergeDate = row.mergeDate;
      if (row.integration === "integrated" && row.tip && target) {
        const dates = capture.dates ??= new Map();
        if (!dates.has(row.tip)) dates.set(row.tip, managementMergeDate(cwd, row.tip, target, signal, history).catch((error) => { dates.delete(row.tip!); throw error; }));
        mergeDate = await dates.get(row.tip)!;
      }
      const statuses: WorktreeManagementStatus[] = [];
      if (!datesOnly) for (const w of row.worktrees) statuses.push(await managementStatus(w.path, signal, { project: capture.inventory.project, identity: capture.related.get(w.path) ?? null, isAllowed }));
      rows.push({ id: row.id, mergeDate, statuses });
    }
  }));
  await revalidate(capture, signal);
  return { captureId, rows };
}
