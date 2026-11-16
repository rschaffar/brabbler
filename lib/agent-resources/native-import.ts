import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, type BigIntStats } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { buildResourceCatalog, type CatalogInput, type CatalogResult, type CatalogRow } from "./catalog";
import type { ResourceContext } from "./context";
import { commitScopedImport, readScopedPreferences, type ImportDecision, type ImportReceipt, type PreferencePublicationGuard, type PreferenceSnapshot, type PreferenceTarget } from "./preferences";
import { selectionKey } from "./selection";

/** UNCONNECTED W06b library. W05b part 2 must supply real first-use admission;
 * W06c must unconditionally retire legacy native writers before live activation.
 * This neither restores native files on rollback nor suppresses native filters at
 * runtime (W07/W08/W10). Preserve the preference store across re-upgrade. */
export class NativeImportError extends Error {
  constructor(readonly code: "scope" | "read" | "generation" | "shape" | "provenance" | "existing", readonly reference: string, detail: string) {
    super(`Native import refused at ${reference}: ${detail}; repair the declaration/admission and prepare again`);
    this.name = "NativeImportError";
  }
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const digestBytes = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const MAX_BYTES = 1024 * 1024, MAX_PATHS = 1024, MAX_TOTAL = 16 * MAX_BYTES;
const plurals = ["extensions", "skills", "prompts", "themes"] as const;
type Scope = "global" | "project";
type Settings = CatalogInput["globalSettings"];
export interface NativeImportInput {
  readonly context: ResourceContext;
  readonly scope: Scope;
  readonly catalog: Pick<CatalogInput, "discoveryAdmitted" | "metadata" | "managedMetadataTrusted" | "eligibility">;
  /** Trusted source admission's finite read-set, BEFORE discovery. Include native
   * automatic/ancestor/.agents roots, package roots/manifests, observed members and
   * skill entry files. Missing observed paths refuse, not a second discovery scan.
   * No request paths, recursively copied SDK discovery or hidden writer. */
  readonly admittedEvidencePaths: readonly string[];
  /** Content/path admission, including intentional configured symlink targets. */
  readonly assertNativeReadAllowed: (path: string) => void;
  /** Required live source/trust/profile/catalog fence, composed with canonical
   * context admission internally. May be async; the actual store awaits it. */
  readonly assertPublicationCurrent: PreferencePublicationGuard;
}
export interface NativeImportCapture {
  readonly scope: Scope;
  readonly context: ResourceContext["selection"];
  readonly target: PreferenceTarget;
  readonly catalog: CatalogResult;
  readonly settings: Readonly<{ global: Settings; project: Settings }>;
  readonly evidenceDigest: string;
}
interface PrivateCapture { readonly recheck: () => void; readonly publish: PreferencePublicationGuard }
const captures = new WeakMap<NativeImportCapture, PrivateCapture>();
function fail(code: NativeImportError["code"], reference: string, message: string): never { throw new NativeImportError(code, reference, message); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function targetFor(context: ResourceContext, scope: Scope): PreferenceTarget {
  if (scope !== "global" && scope !== "project") fail("scope", String(scope), "only Global/Project import is supported (no historical Session)");
  if (scope === "project" && (!context.cwd || !context.selection.projectBinding)) fail("scope", scope, "an exact registered Project root is required");
  return scope === "global" ? { scope, binding: null } : { scope, binding: context.selection.projectBinding! };
}
const stamp = (s: BigIntStats, directoryIdentity = false) => [s.dev, s.ino, s.mode, s.uid, s.gid, s.birthtimeNs,
  ...(directoryIdentity ? [] : [s.nlink, s.size, s.mtimeNs, s.ctimeNs])].join(":");
function optional(path: string): BigIntStats | null {
  try { return lstatSync(path, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
/** Existing ancestor identity + every link generation + true absence. ENOTDIR,
 * dangling links and read errors are never treated as absent settings. */
function observation(path: string, structural: boolean) {
  const chain: unknown[] = [];
  const names: string[] = [];
  for (let p = path; ; p = dirname(p)) { names.unshift(p); if (dirname(p) === p) break; }
  for (const name of names) {
    const s = optional(name);
    if (s?.isSymbolicLink()) realpathSync(name); // reject dangling ancestors/leaves
    chain.push([name, s ? stamp(s, s.isDirectory() && (name !== path || structural)) : null]);
  }
  const leaf = optional(path);
  if (!leaf) return { token: hash(chain), physical: null, stat: null };
  const physical = realpathSync(path), stat = lstatSync(physical, { bigint: true });
  return { token: hash([chain, physical, stamp(stat, structural && stat.isDirectory())]), physical, stat };
}
function readObservation(path: string, allow: (path: string) => void, structural: boolean) {
  allow(path);
  const before = observation(path, structural);
  if (!before.stat) return { token: before.token, text: undefined, size: 0 };
  allow(before.physical!);
  if (before.stat.isDirectory()) return { token: before.token, text: undefined, size: 0 };
  if (!before.stat.isFile() || before.stat.size > BigInt(MAX_BYTES)) fail("read", path, "expected a bounded regular native file");
  const fd = openSync(before.physical!, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || stamp(opened) !== stamp(before.stat)) fail("generation", path, "native descriptor changed");
    const bytes = Buffer.alloc(Number(opened.size) + 1); let length = 0;
    while (length < bytes.length) { const n = readSync(fd, bytes, length, bytes.length - length, null); if (!n) break; length += n; }
    if (length !== Number(opened.size) || stamp(opened) !== stamp(fstatSync(fd, { bigint: true }))
      || observation(path, structural).token !== before.token) fail("generation", path, "native source changed during capture");
    // Only settings text is consumed. Other bounded bytes are retained as digests.
    return { token: hash([before.token, digestBytes(bytes.subarray(0, length))]), bytes: bytes.subarray(0, length), size: length };
  } finally { closeSync(fd); }
}
function settingsText(bytes: Uint8Array | undefined, reference: string): string | undefined {
  if (!bytes) return undefined;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return fail("shape", reference, "invalid UTF-8 settings"); }
  if (text === "") return text; // Native empty-file semantics, distinct evidence.
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail("shape", reference, "invalid native JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("shape", reference, "expected a native settings object");
  // Validate supported legacy skills before the PUBLIC SDK migrates it. Do not
  // silently turn malformed legacy directories into successful empty evidence.
  const skills = (value as Record<string, unknown>).skills;
  if (skills && typeof skills === "object" && !Array.isArray(skills)) {
    const legacy = skills as Record<string, unknown>;
    if (legacy.customDirectories !== undefined) strings(legacy.customDirectories, `${reference}.skills.customDirectories`);
    if (Object.keys(legacy).some(key => !["customDirectories", "enableSkillCommands"].includes(key))) fail("shape", `${reference}.skills`, "unsupported legacy skill selectors");
  }
  return text;
}
function strings(value: unknown, reference: string): void {
  if (!Array.isArray(value) || value.length > 128 || value.some(s => typeof s !== "string" || !s.length || s.length > 16_384 || !s.isWellFormed() || /[\x00-\x1f\x7f]/.test(s))) fail("shape", reference, "expected a bounded native string array");
}
function validate(settings: Settings, reference: string) {
  for (const kind of plurals) if (settings[kind] !== undefined) strings(settings[kind], `${reference}.${kind}`);
  if (settings.packages === undefined) return;
  if (!Array.isArray(settings.packages) || settings.packages.length > 128) fail("shape", `${reference}.packages`, "expected bounded packages");
  settings.packages.forEach((pkg, index) => {
    const ref = `${reference}.packages[${index}]`;
    if (typeof pkg === "string") { strings([pkg], ref); return; }
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) fail("shape", ref, "expected native package source/object");
    strings([pkg.source], `${ref}.source`);
    if (pkg.autoload !== undefined && typeof pkg.autoload !== "boolean") fail("shape", `${ref}.autoload`, "expected boolean autoload");
    if (Object.keys(pkg).some(key => !["source", "autoload", ...plurals].includes(key))) fail("shape", ref, "unsupported package filter field");
    for (const kind of plurals) if (pkg[kind] !== undefined) strings(pkg[kind], `${ref}.${kind}`);
  });
}

/** Bounded before/after source observation, NOT cross-file atomicity, exhaustive
 * subtree change detection, ABA resistance or a producer transaction. Admission
 * supplies exact known paths; unseen subtrees are explicitly outside this fence. */
export async function captureNativeImportSources(input: NativeImportInput): Promise<NativeImportCapture> {
  const { context, scope, assertNativeReadAllowed: allow, assertPublicationCurrent: publication } = input;
  const target = targetFor(context, scope);
  if (typeof allow !== "function" || typeof publication !== "function" || !input.catalog.discoveryAdmitted) fail("provenance", scope, "trusted native read/discovery/publication admission required");
  const catalogInput = { ...input.catalog };
  const admittedPaths = [...input.admittedEvidencePaths];
  // Detach caller metadata before callbacks/awaits; no mutable callback result can
  // replace the captured authority or native settings mid-preparation.
  catalogInput.metadata = structuredClone(catalogInput.metadata);
  const publish = async () => { context.assertAdmissionCurrent(); await publication(); context.assertAdmissionCurrent(); };
  await publish();
  const globalPath = join(context.selection.agentDir, "settings.json");
  const projectPath = scope === "project" ? join(context.cwd!, ".pi/settings.json") : null;
  const paths = new Set([globalPath, ...(projectPath ? [projectPath] : []), ...admittedPaths]);
  if (paths.size > MAX_PATHS) fail("read", scope, "native evidence path budget exceeded");
  const tokens = new Map<string, string>(); let total = 0;
  const capturePath = (path: string) => {
    if (!isAbsolute(path) || normalize(path) !== path || path.includes("\0")) fail("read", path, "expected an admitted absolute normalized path");
    const structural = path === context.selection.agentDir || path === context.cwd;
    const result = readObservation(path, allow, structural); total += result.size;
    if (total > MAX_TOTAL) fail("read", scope, "native evidence byte budget exceeded");
    tokens.set(path, result.token); return result;
  };
  const text: Record<string, string | undefined> = {};
  try {
    for (const path of paths) {
      const result = capturePath(path);
      if (path === globalPath || path === projectPath) {
        if (observation(path, false).stat?.isDirectory()) fail("read", path, "settings must be regular files or truly absent");
        text[path] = settingsText(result.bytes, path);
      }
    }
  } catch (error) { if (error instanceof NativeImportError) throw error; return fail("read", scope, "native source is unreadable, special, dangling or changed"); }
  const manager = SettingsManager.fromStorage({ withLock(which, fn) {
    if (fn(text[which === "global" ? globalPath : projectPath ?? ""]) !== undefined) fail("read", which, "native capture storage is read-only");
  } }, { projectTrusted: scope === "project" });
  if (manager.drainErrors().length) fail("shape", scope, "public SDK rejected captured native settings");
  const settings = { global: manager.getGlobalSettings(), project: scope === "project" ? manager.getProjectSettings() : {} };
  validate(settings.global, globalPath); validate(settings.project, projectPath ?? "project");
  const recheck = () => {
    context.assertAdmissionCurrent(); let bytes = 0;
    for (const [path, token] of tokens) {
      const fresh = readObservation(path, allow, path === context.selection.agentDir || path === context.cwd); bytes += fresh.size;
      if (bytes > MAX_TOTAL || fresh.token !== token) fail("generation", path, "native evidence changed since preparation");
    }
    context.assertAdmissionCurrent();
  };
  // Global MUST NOT depend on whichever project is first visited. The public SDK
  // global-only view uses agentDir as cwd and projectTrusted:false, never a live
  // SettingsManager.create or a copied native resolver.
  const cwd = scope === "global" ? context.selection.agentDir : context.cwd!;
  const nativeContext = { ...context.selection, ...(scope === "global" ? { projectBinding: null, sessionBinding: null } : {}) };
  const requirePath = (path: string) => { if (!tokens.has(path)) fail("provenance", path, "observed source lacks BEFORE evidence in admittedEvidencePaths"); };
  const catalog = await buildResourceCatalog({ ...catalogInput, context: nativeContext, cwd,
    globalSettings: settings.global, projectSettings: settings.project, projectTrusted: scope === "project",
    eligibility(resource) { requirePath(resource.path); allow(resource.path); return catalogInput.eligibility(resource); } });
  for (const pkg of catalog.configuredPackages) if (pkg.installedPath) {
    requirePath(pkg.installedPath); requirePath(join(pkg.installedPath, "package.json"));
    for (const kind of plurals) requirePath(join(pkg.installedPath, kind));
  }
  for (const row of catalog.rows) if (row.kind !== "group") {
    if (isAbsolute(row.path)) requirePath(row.path);
    for (const path of row.observedPaths) requirePath(path);
  }
  if (catalogInput.metadata.status === "loaded") requirePath(catalogInput.metadata.generation.path);
  recheck(); await publish(); recheck();
  const evidenceDigest = hash([context.selection, target, [...tokens], settings, catalog]);
  const capture = freeze({ scope, context: { ...context.selection }, target, settings, catalog, evidenceDigest });
  captures.set(capture, { recheck, publish }); return capture;
}

/** Pure finite mapping. Native observations, never desired selection.enabled or
 * authored disable-model-invocation. No patterns, descendant Off, future aliases,
 * prompt/theme preferences, registry, source rewrites or SDK-private filters. */
export function deriveNativeImport(capture: NativeImportCapture): ImportReceipt {
  if (!captures.has(capture)) fail("provenance", "capture", "use a checked native capture");
  const { catalog, scope } = capture, nativeScope = scope === "global" ? "user" : "project";
  if (!catalog.ok) {
    const diagnostic = catalog.diagnostics.find(d => d.severity === "error")!;
    fail("provenance", `${scope}:${diagnostic.path}`, `${diagnostic.code}: ${diagnostic.message}`);
  }
  const fragments: ImportReceipt["fragments"][number][] = [{ reference: `${scope}:snapshot`, digest: capture.evidenceDigest, provenance: "explicit-resolution" }];
  const decisions = new Map<string, ImportDecision>();
  const fragment = (reference: string, value: unknown) => {
    fragments.push({ reference, digest: hash(value), provenance: "native-filter" }); return reference;
  };
  const add = (row: CatalogRow, enabled: boolean, rule: ImportDecision["rule"], reference: string) => {
    if (row.membership !== "confirmed" || !row.identity || row.scope !== nativeScope || row.identity.origin.scope !== scope) fail("provenance", reference, "exact confirmed same-scope identity required");
    const key = selectionKey(row.identity);
    if (decisions.has(key)) fail("provenance", reference, "overlapping choice attribution");
    decisions.set(key, { identity: row.identity, value: enabled ? "enabled" : "disabled", rule, evidence: [reference] });
  };
  const direct = (row: CatalogRow, reference: string, source?: string, root?: string) => {
    const plural = row.kind === "skill" ? "skills" : "extensions";
    const observations = catalog.native[plural].filter(resource => row.observedPaths.includes(resource.path));
    if (row.nativeEnabled === null || observations.length !== 1 || row.observedPaths.length !== 1) fail("provenance", reference, "one unchanged native winner required");
    const observed = observations[0];
    const lexical = observed.path === row.path || (row.kind === "skill" && join(observed.path, "SKILL.md") === row.path);
    if (!lexical || observed.metadata.scope !== nativeScope || (source !== undefined
      ? observed.metadata.origin !== "package" || observed.metadata.source !== source || observed.metadata.packageRoot !== root
      : observed.metadata.origin === "package" || row.parent?.kind === "package")) fail("provenance", reference, "alias/shadow hides exact selector provenance; remove duplicate aliases or use an exact native declaration");
    return observed.enabled;
  };
  const settings = capture.settings[scope];
  for (const [index, pkg] of (settings.packages ?? []).entries()) {
    if (typeof pkg === "string") continue; // registration != choice history
    const reference = `${scope}:packages[${index}]`;
    if (pkg.autoload === false) fail("provenance", reference, "autoload:false delta attribution is unsupported (empty arrays are no-ops, not Off)");
    const owners = catalog.rows.filter(row => row.kind === "package" && row.scope === nativeScope && row.source === pkg.source);
    const configured = catalog.configuredPackages.filter(row => row.scope === nativeScope && row.source === pkg.source);
    if (owners.length !== 1 || configured.length !== 1 || !configured[0].installedPath || owners[0].path !== configured[0].installedPath) fail("provenance", reference, "one configured installed owner required");
    const owner = owners[0];
    const ref = fragment(reference, pkg);
    if (plurals.every(kind => Array.isArray(pkg[kind]) && pkg[kind]!.length === 0)) {
      // A top-level alias may win native deduplication over the disabled package
      // observation. Child On cannot preserve that winner beneath an Off gate.
      const enabledWinner = catalog.rows.find(row => (row.kind === "skill" || row.kind === "extension") && row.membership === "confirmed"
        && row.nativeEnabled === true && row.parent && owner.identity && selectionKey(row.parent) === selectionKey(owner.identity));
      if (enabledWinner) fail("provenance", `${reference}:${enabledWinner.path}`, "whole-package Off would disable an enabled native winner; remove duplicate aliases or use an exact native declaration before importing");
      add(owner, false, "whole-package-off", ref); continue;
    }
    for (const [plural, kind] of [["extensions", "extension"], ["skills", "skill"]] as const) {
      if (pkg[plural] === undefined) continue;
      for (const row of catalog.rows.filter(row => row.kind === kind && row.parent && owner.identity && selectionKey(row.parent) === selectionKey(owner.identity))) {
        add(row, direct(row, ref, pkg.source, owner.path), "individual", ref);
      }
    }
  }
  for (const [plural, kind] of [["extensions", "extension"], ["skills", "skill"]] as const) {
    const selectors = settings[plural];
    if (!selectors?.some(s => /^[!+\-]|[*?\[\]{}]/.test(s))) continue;
    const ref = fragment(`${scope}:${plural}`, selectors);
    const scopedRows = catalog.rows.filter(row => row.kind === kind && row.scope === nativeScope);
    // Logical package association does not turn a top-level native winner into
    // package-filter evidence. Refuse before excluding it from selector mapping.
    const associatedWinner = scopedRows.find(row => row.parent?.kind === "package" && catalog.native[plural].some(resource =>
      row.observedPaths.includes(resource.path) && resource.metadata.scope === nativeScope && resource.metadata.origin !== "package"));
    if (associatedWinner) fail("provenance", `${ref}:${associatedWinner.path}`, "top-level selector attribution for a package-associated native winner is unsupported; remove duplicate aliases or use an exact native declaration before importing");
    const rows = scopedRows.filter(row => row.parent?.kind !== "package");
    if (!rows.length) fail("provenance", ref, "selector has no concrete top-level attributed winner");
    for (const row of rows) add(row, direct(row, ref), "individual", ref);
  }
  if (fragments.length > 256) fail("shape", scope, "receipt fragment budget exceeded");
  return freeze({ ruleVersion: 1, evidenceDigest: capture.evidenceDigest, fragments, decisions: [...decisions.values()] });
}

/** Automatic one-time initializer, not wired to production. Receipt check comes
 * BEFORE native capture/admission availability work. Errors get exactly one safe
 * receipt reread (lost acknowledgement), never a second capture/commit/replay. */
export async function ensureScopedNativeImport(input: NativeImportInput): Promise<PreferenceSnapshot> {
  const context = input.context, target = targetFor(context, input.scope);
  context.assertAdmissionCurrent();
  const before = readScopedPreferences(context.selection, target);
  context.assertAdmissionCurrent();
  if (before.importReceipt) return before;
  if (before.choices.length) fail("existing", input.scope, "unexplained preferences exist without a completion receipt; do not overwrite");
  const captured = await captureNativeImportSources(input), receipt = deriveNativeImport(captured), privateCapture = captures.get(captured)!;
  try {
    const result = await commitScopedImport(captured.context, target, before.revision, receipt,
      () => { privateCapture.recheck(); return receipt.evidenceDigest; }, privateCapture.publish);
    context.assertAdmissionCurrent(); return result;
  } catch (error) {
    // Authority is checked on both sides of the single recovery read. Never let
    // an unrelated recovery failure conceal the original publication failure.
    try {
      context.assertAdmissionCurrent();
      const current = readScopedPreferences(captured.context, target);
      context.assertAdmissionCurrent();
      if (current.importReceipt) return current;
    } catch { /* retain original error */ }
    throw error;
  }
}
