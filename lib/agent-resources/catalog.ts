import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { posix } from "node:path";
import { DefaultPackageManager, SettingsManager, loadSkills, type ResolvedPaths, type ResolvedResource, type Skill } from "@earendil-works/pi-coding-agent";
import { readCatalogMetadata, type CatalogMetadataKind, type CatalogMetadataReadResult } from "./catalog-metadata";
import { createSelectionIdentity, resolveSelection, selectionKey, type ResolvedSelection, type ScopedChoices, type SelectionContext, type SelectionEligibility, type SelectionIdentity, type SelectionObject } from "./selection";

const kinds = { extensions: "extension", skills: "skill", prompts: "prompt", themes: "theme" } as const;
type NativeScope = "user" | "project";
/** Public scoped getter contract; the SDK does not export Settings at its root. */
type Settings = ReturnType<SettingsManager["getGlobalSettings"]>;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export interface CatalogAdmission {
  readonly kind: CatalogMetadataKind | "package";
  readonly path: string;
  readonly scope: NativeScope;
  readonly source: string;
}
export interface CatalogInput {
  readonly cwd: string;
  readonly context: SelectionContext;
  /** Captured, independently admitted native settings, NOT live disk settings.
   * Caller also admits native default discovery roots (including ~/.agents).
   * This is not content-read authorization. No applyOverrides/writer is used. */
  readonly discoveryAdmitted: boolean;
  readonly globalSettings: Settings;
  readonly projectSettings: Settings;
  readonly projectTrusted: boolean;
  readonly metadata: CatalogMetadataReadResult;
  /** Producer/source authority, separate from project trust and availability. */
  readonly managedMetadataTrusted: boolean;
  readonly eligibility: (resource: CatalogAdmission) => SelectionEligibility;
  readonly choices?: (identity: SelectionIdentity) => ScopedChoices;
}
export interface CatalogDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly path: string;
  readonly message: string;
}
export interface CatalogRow {
  readonly kind: CatalogMetadataKind | "package" | "group";
  readonly path: string;
  readonly scope: NativeScope;
  readonly source: string;
  readonly membership: "confirmed" | "unresolved" | "unsupported";
  /** Observation, not desired selection. null means no attributed native winner. */
  readonly nativeEnabled: boolean | null;
  readonly observedPaths: readonly string[];
  readonly managedBy: "nix" | null;
  readonly ownership: "readonly" | "native" | "unresolved";
  readonly identity?: SelectionIdentity;
  readonly parent?: SelectionIdentity;
  readonly selection?: ResolvedSelection;
  readonly skill?: Skill;
}
export interface CatalogResult {
  readonly coverage: "native winners plus confirmed local members; not a complete declaration inventory";
  readonly ok: boolean;
  readonly rows: readonly CatalogRow[];
  readonly native: ResolvedPaths;
  readonly raw: Readonly<{ global: Settings; project: Settings }>;
  readonly configuredPackages: ReturnType<DefaultPackageManager["listConfiguredPackages"]>;
  readonly metadataGeneration: string | null;
  readonly diagnostics: readonly CatalogDiagnostic[];
}
type Row = Mutable<Omit<CatalogRow, "observedPaths">> & { observedPaths: string[]; ceiling: Mutable<SelectionEligibility> };
const denied: SelectionEligibility = { source: false, trust: false, profile: false };
function physical(path: string): string | undefined {
  try { return realpathSync(path); } catch { return undefined; }
}
function readable(path: string, directory = false): boolean {
  try {
    const stat = statSync(path);
    accessSync(path, constants.R_OK);
    return directory ? stat.isDirectory() : stat.isFile() || stat.isDirectory();
  } catch { return false; }
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Inert public SDK composition. No loader, extension import, factory, session,
 * temporary resolution or install/update operation. Native location probes MAY
 * execute the configured package-manager command; this is not a subprocess sandbox.
 * Caller must revalidate again at use: this is a bounded observation, not an atomic
 * native filesystem snapshot or runtime/filter/migration/content authority. */
export async function buildResourceCatalog(input: CatalogInput): Promise<CatalogResult> {
  if (!input.discoveryAdmitted) throw new Error("Native discovery roots/settings require independent admission");
  if (!posix.isAbsolute(input.cwd) || !posix.isAbsolute(input.context.agentDir)) throw new Error("Absolute cwd/agentDir required");
  const diagnostics: CatalogDiagnostic[] = [], rows: Row[] = [];
  const issue = (code: string, path: string, message: string, severity: "error" | "warning" = "error") => {
    diagnostics.push({ code, path, message, severity });
  };
  // JSON defensive snapshot also prevents a caller mutating scoped filters mid-resolve.
  const raw = JSON.parse(JSON.stringify({ global: input.globalSettings, project: input.projectSettings })) as { global: Settings; project: Settings };
  const settings = SettingsManager.fromStorage({ withLock(scope, fn) {
    const current = JSON.stringify(raw[scope]);
    if (fn(current) !== undefined) throw new Error("Catalog settings storage is read-only");
  } }, { projectTrusted: input.projectTrusted });
  const settingsErrors = settings.drainErrors();
  if (settingsErrors.length) throw new Error("Invalid captured native settings");
  const manager = new DefaultPackageManager({ cwd: input.cwd, agentDir: input.context.agentDir, settingsManager: settings });
  manager.setProgressCallback(event => { throw new Error(`Unexpected inventory mutation: ${event.action}`); });
  const skipped = new Set<string>();
  const native = await manager.resolve(async source => {
    skipped.add(source);
    issue("missing-source", source, "Configured source needs installation/version reconciliation; inventory skipped it without installing");
    return "skip";
  });
  const configuredPackages = manager.listConfiguredPackages();
  const identity = (kind: "package" | "group" | "skill" | "extension", path: string, scope: NativeScope): SelectionIdentity => {
    if (scope === "project" && !input.context.projectBinding) throw new Error("Project resource requires an admitted project binding");
    return createSelectionIdentity({ agentDir: input.context.agentDir,
      origin: scope === "user" ? { scope: "global" } : { scope: "project", binding: input.context.projectBinding! },
      ...(kind === "group" ? { kind, groupKey: path } : { kind, path }) });
  };
  const ceiling = (kind: CatalogAdmission["kind"], path: string, scope: NativeScope, source: string) => {
    const value = input.eligibility({ kind, path, scope, source });
    if (![value.source, value.trust, value.profile].every(flag => typeof flag === "boolean")) throw new Error("Explicit source/trust/profile ceilings required");
    return { ...value, trust: value.trust && (scope !== "project" || input.projectTrusted) };
  };
  // Small per-observation fences, not a transactional filesystem inventory.
  const sourceGenerations = new Map<string, string>();
  const generation = (path: string) => {
    try { const stat = statSync(path, { bigint: true });
      return [physical(path), stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
    } catch { return "missing"; }
  };
  const remember = (path: string) => { if (!sourceGenerations.has(path)) sourceGenerations.set(path, generation(path)); };
  const metadata = input.metadata;
  const revalidate = () => {
    if (metadata.status !== "loaded") return;
    if (posix.normalize(metadata.generation.agentDir) !== posix.normalize(input.context.agentDir)) throw new Error("Catalog metadata agentDir mismatch");
    const fresh = readCatalogMetadata({ status: "configured", path: metadata.generation.path, context: input.context });
    if (fresh.status !== "loaded" || fresh.generation.token !== metadata.generation.token) throw new Error("Catalog metadata generation changed; refresh inventory");
  };
  revalidate();
  if (metadata.status === "loaded" && !input.managedMetadataTrusted) issue("metadata-trust", metadata.generation.path, "Managed producer authority was not admitted; metadata cannot claim ownership");
  const managed = metadata.status === "loaded" && input.managedMetadataTrusted ? metadata.catalog : undefined;
  const groups = new Map<string, SelectionIdentity>();
  for (const group of managed?.groups ?? []) {
    const id = identity("group", group.key, "user"); groups.set(group.key, id);
    rows.push({ kind: "group", path: group.key, source: "metadata", scope: "user", membership: "confirmed", nativeEnabled: null,
      observedPaths: [], managedBy: "nix", ownership: "readonly", identity: id, ceiling: { source: true, trust: true, profile: true } });
  }
  const packages = new Map<string, Row>();
  const scopedKey = (scope: string, source: string) => JSON.stringify([scope, source]);
  const supplemental: { kind: CatalogMetadataKind; resource: ResolvedResource; owner: Row }[] = [];
  const objectConventions: { kind: CatalogMetadataKind; path: string; owner: Row }[] = [];
  for (const pkg of configuredPackages) {
    const rawPackage = (pkg.scope === "user" ? raw.global : raw.project).packages?.find(value => (typeof value === "string" ? value : value.source) === pkg.source);
    const path = pkg.installedPath ? posix.normalize(pkg.installedPath) : pkg.source;
    const eligible = pkg.installedPath ? ceiling("package", path, pkg.scope, pkg.source) : denied;
    const known = managed?.packages.find(value => pkg.scope === "user" && value.source === path);
    const row: Row = { kind: "package", path, source: pkg.source, scope: pkg.scope, membership: pkg.installedPath ? "confirmed" : "unresolved",
      nativeEnabled: null, observedPaths: [], managedBy: known ? "nix" : null, ownership: known ? "readonly" : "native", ceiling: eligible,
      ...(pkg.installedPath ? { identity: identity("package", path, pkg.scope) } : {}), ...(known?.group ? { parent: groups.get(known.group)! } : {}) };
    const key = scopedKey(pkg.scope, pkg.source);
    if (packages.has(key) || rows.some(other => other.kind === "package" && other.scope === row.scope && other.path === path)) {
      issue("package-collision", path, "Duplicate configured package identity; remove contradictory declarations");
      const previous = packages.get(key) ?? rows.find(other => other.kind === "package" && other.scope === row.scope && other.path === path)!;
      previous.ceiling = { ...previous.ceiling, source: false };
      continue;
    }
    packages.set(key, row); rows.push(row);
    if (!pkg.installedPath || !readable(path)) {
      row.membership = "unresolved"; row.ceiling = { ...eligible, source: false };
      issue("broken-package", path, "Still-declared package is missing, broken or unreadable; repair its native declaration/source"); continue;
    }
    if (!eligible.source || !eligible.trust || !eligible.profile) {
      issue("source-refused", path, "Package membership probing refused by independent source/trust/profile admission"); continue;
    }
    // Only absolute LOCAL configured roots, never remote installed roots. A remote
    // skipped version must not be laundered through its existing install directory.
    if (!posix.isAbsolute(pkg.source) || !readable(path, true) || skipped.has(pkg.source)) continue;
    const uncertain = typeof rawPackage === "object" && rawPackage.autoload === false;
    if (uncertain) issue("unsupported-delta", path, "autoload:false provenance is unsupported; absent members cannot be attributed from a bare-root scan");
    remember(path); remember(posix.join(path, "package.json"));
    const found = await manager.resolveExtensionSources([path], { temporary: false, local: pkg.scope === "project" });
    for (const [plural, kind] of Object.entries(kinds) as [keyof typeof kinds, CatalogMetadataKind][]) {
      for (const resource of found[plural]) supplemental.push({ kind, resource, owner: row });
      // Objects can discover conventional members omitted by a partial manifest;
      // the public bare-source supplement does not have those semantics. Record
      // only a refusal boundary, not a second discovery implementation or parent.
      if (typeof rawPackage === "object") {
        const convention = posix.join(path, plural), target = physical(convention);
        if (target && readable(convention, true)) {
          remember(convention); objectConventions.push({ kind, path: target, owner: row });
        }
      }
    }
  }
  // Start with the SDK's ordered physical-deduplicated winners; do not manufacture
  // losing declarations or infer ownership from path prefixes/display names.
  for (const [plural, kind] of Object.entries(kinds) as [keyof typeof kinds, CatalogMetadataKind][]) {
    for (const resource of native[plural]) {
      if (!posix.isAbsolute(resource.path)) { issue("unsupported-native", resource.path, "Non-local native resource has no catalog availability identity"); continue; }
      const scope = resource.metadata.scope;
      if (scope !== "user" && scope !== "project") { issue("unsupported-origin", resource.path, "Temporary native origin is not supported"); continue; }
      const owner = resource.metadata.origin === "package" ? packages.get(scopedKey(scope, resource.metadata.source)) : undefined;
      const row: Row = { kind, path: posix.normalize(resource.path), scope, source: resource.metadata.source, membership: "confirmed",
        nativeEnabled: resource.enabled, observedPaths: [resource.path], managedBy: null,
        ownership: owner?.managedBy === "nix" ? "readonly" : "native", ceiling: ceiling(kind, resource.path, scope, resource.metadata.source),
        ...((kind === "skill" || kind === "extension") ? { identity: identity(kind, resource.path, scope) } : {}),
        ...(owner?.identity ? { parent: owner.identity } : {}) };
      if (resource.metadata.origin === "package" && (!owner || !resource.metadata.packageRoot || owner.path !== posix.normalize(resource.metadata.packageRoot))) {
        row.membership = "unsupported"; row.ceiling.source = false;
        issue("unsupported-owner", row.path, "Native package source/root does not establish one configured owner");
      }
      if (owner) row.ceiling = { source: row.ceiling.source && owner.ceiling.source,
        trust: row.ceiling.trust && owner.ceiling.trust, profile: row.ceiling.profile && owner.ceiling.profile };
      if (!row.ceiling.source || !row.ceiling.trust || !row.ceiling.profile) issue("resource-refused", row.path,
        "Native resource is unavailable under independent source/trust/profile admission");
      if (row.ceiling.source && row.ceiling.trust && row.ceiling.profile) remember(row.path);
      rows.push(row);
    }
  }
  for (const item of supplemental) {
    const { kind, resource, owner } = item;
    const target = physical(resource.path);
    const matches = rows.filter(row => row.kind === kind && target !== undefined && physical(row.path) === target);
    const otherOwners = supplemental.filter(other => target !== undefined && other.kind === kind && physical(other.resource.path) === target && other.owner !== owner);
    if (otherOwners.length || matches.length > 1 || matches.some(row => row.parent && selectionKey(row.parent) !== selectionKey(owner.identity!))) {
      issue("ambiguous-owner", resource.path, "Physical aliases have multiple package/origin owners; no logical winner is inferred");
      owner.ceiling.source = false;
      for (const row of matches) { row.membership = "unsupported"; row.ceiling.source = false; }
      continue;
    }
    const matched = matches[0];
    if (matched) {
      // Exact observed alias association for this generation, not persisted continuity.
      if (matched.scope !== owner.scope) {
        issue("unsupported-alias", resource.path, "Physical alias crosses admitted origins; repair duplicate declarations");
        matched.membership = "unsupported"; matched.ceiling.source = false; continue;
      }
      const canonicalCeiling = ceiling(kind, resource.path, owner.scope, owner.source);
      matched.ceiling = { source: matched.ceiling.source && canonicalCeiling.source,
        trust: matched.ceiling.trust && canonicalCeiling.trust, profile: matched.ceiling.profile && canonicalCeiling.profile };
      matched.path = resource.path; matched.parent = owner.identity; matched.source = owner.source;
      if (owner.managedBy === "nix") matched.ownership = "readonly";
      if (kind === "skill" || kind === "extension") matched.identity = identity(kind, resource.path, owner.scope);
      continue;
    }
    // Membership is confirmed by public native discovery, but original eligibility
    // is not reconstructed for object omissions, replacement/delta or alias losers.
    rows.push({ kind, path: resource.path, scope: owner.scope, source: owner.source, membership: "unsupported", nativeEnabled: null,
      observedPaths: [], managedBy: null, ownership: owner.managedBy === "nix" ? "readonly" : "native", parent: owner.identity,
      ...((kind === "skill" || kind === "extension") ? { identity: identity(kind, resource.path, owner.scope) } : {}),
      ceiling: { ...ceiling(kind, resource.path, owner.scope, owner.source), source: false } });
    issue("unresolved-native-eligibility", resource.path, "Local membership discovered, but original native filter/replacement eligibility has no attributed winner");
  }
  // Support limit: an observed automatic/top-level alias beneath an object
  // package's conventional directory must have positive supplementary membership.
  // Otherwise refuse it visibly; physical containment alone never confirms a
  // controlling parent. Strings and positively discovered object members retain
  // their normal behavior. This is practical suppression, not anti-circumvention.
  for (const row of rows.filter(row => row.observedPaths.length && !row.parent)) {
    const target = physical(row.path);
    for (const boundary of objectConventions) {
      if (row.kind !== boundary.kind || !target || !target.startsWith(`${boundary.path}/`)) continue;
      const confirmed = supplemental.some(item => item.owner === boundary.owner && item.kind === row.kind && physical(item.resource.path) === target);
      if (confirmed) continue;
      row.membership = "unsupported"; row.ceiling.source = false;
      issue("unsupported-object-membership", row.path,
        `Native alias lies beneath object package ${boundary.owner.path}, but bare-source discovery does not confirm membership; declare this kind's members explicitly in the native manifest or remove the duplicate alias. No package parent is inferred`);
    }
  }
  for (const owner of packages.values()) {
    if (!owner.identity || owner.membership === "unresolved") continue;
    const observedMember = rows.some(row => row.parent && row.observedPaths.length > 0
      && selectionKey(row.parent) === selectionKey(owner.identity!));
    if (!observedMember) {
      owner.membership = "unsupported"; owner.ceiling = { ...owner.ceiling, source: false };
      issue("unresolved-package-eligibility", owner.path,
        "Configured installed source has no attributed native winner (empty/skipped/replaced); eligibility is not inferred from its directory");
    }
  }
  // Retain exact positive settings declarations even when native discovery omitted
  // them. Patterns/modifiers aren't registrations and are not interpreted here.
  for (const scope of ["user", "project"] as const) {
    const captured = scope === "user" ? raw.global : raw.project;
    if (scope === "project" && !input.projectTrusted) {
      if (Object.keys(captured).length) issue("project-trust", input.cwd, "Project settings retained as evidence only; project trust refused");
      continue;
    }
    for (const [plural, kind] of Object.entries(kinds) as [keyof typeof kinds, CatalogMetadataKind][]) {
      for (const declaration of captured[plural] ?? []) {
        if (/^[!+\-]|[*?\[\]{}]/.test(declaration)) {
          issue("unresolved-modifier", declaration, "Native pattern/modifier retained in raw settings; no standalone ownership inferred", "warning"); continue;
        }
        const path = manager.getInstalledPath(declaration, scope);
        const observed = path && rows.some(row => row.kind === kind && row.scope === scope
          && (row.path === path || row.observedPaths.includes(path)));
        if (observed) continue;
        const exists = path && readable(path);
        rows.push({ kind, path: path ?? declaration, source: declaration, scope, membership: "unresolved", nativeEnabled: null,
          observedPaths: [], managedBy: null, ownership: "unresolved", ceiling: { ...denied } });
        issue(exists ? "unresolved-declaration" : "broken-declaration", declaration,
          exists ? "Exact declaration has no attributed native winner; aliases/directory expansion are not reconstructed"
            : "Exact native declaration is missing, broken or unreadable");
      }
    }
  }
  const bindManaged = (kind: CatalogMetadataKind, path: string, parent?: SelectionIdentity) => {
    const matches = rows.filter(row => row.kind === kind && row.path === path && row.scope === "user"
      && (parent ? row.parent && selectionKey(row.parent) === selectionKey(parent) : !row.parent));
    if (matches.length === 1 && matches[0].membership !== "unresolved") {
      matches[0].managedBy = "nix"; matches[0].ownership = "readonly";
      return matches[0];
    }
    issue("metadata-native-mismatch", path, "Exact managed reference is not bound to one admitted native declaration/member; repair metadata or native registration");
    const row: Row = { kind, path, scope: "user", source: "metadata", membership: "unresolved", nativeEnabled: null,
      observedPaths: [], managedBy: null, ownership: "unresolved", ceiling: { ...denied } };
    rows.push(row); return row;
  };
  for (const pkg of managed?.packages ?? []) {
    const owner = rows.find(row => row.kind === "package" && row.path === pkg.source && row.scope === "user");
    if (!owner?.identity) {
      issue("metadata-package-mismatch", pkg.source, "Managed package is not an admitted configured installed source");
      for (const member of pkg.members) {
        const path = posix.join(pkg.source, member.path);
        issue("metadata-native-mismatch", path, "Managed member has no confirmed native package owner");
        rows.push({ kind: member.kind, path, source: "metadata", scope: "user", membership: "unresolved", nativeEnabled: null,
          observedPaths: [], managedBy: null, ownership: "unresolved", ceiling: { ...denied } });
      }
      continue;
    }
    for (const member of pkg.members) bindManaged(member.kind, posix.join(pkg.source, member.path), owner.identity);
  }
  for (const member of managed?.standalone ?? []) {
    const row = bindManaged(member.kind, member.path);
    if (member.group && row.membership === "confirmed") row.parent = groups.get(member.group);
  }
  // Validate only independently admitted native skill paths, using public SDK
  // validation and collision handling, including native-disabled known skills.
  const skillRows = rows.filter(row => row.kind === "skill" && row.membership === "confirmed"
    && row.ceiling.source && row.ceiling.trust && row.ceiling.profile);
  const validated = loadSkills({ cwd: input.cwd, agentDir: input.context.agentDir, includeDefaults: false, skillPaths: skillRows.map(row => row.path) });
  for (const diagnostic of validated.diagnostics) {
    issue(`native-skill-${diagnostic.type}`, diagnostic.path ?? "", diagnostic.message,
      diagnostic.type === "warning" ? "warning" : "error");
    if (diagnostic.collision) {
      for (const row of skillRows) if ([diagnostic.collision.winnerPath, diagnostic.collision.loserPath].includes(row.path)) row.ceiling.source = false;
    }
  }
  for (const row of skillRows) {
    const own = loadSkills({ cwd: input.cwd, agentDir: input.context.agentDir, includeDefaults: false, skillPaths: [row.path] });
    if (own.skills.length !== 1) {
      issue("unsupported-skill-entry", row.path, "Expected one validated skill entry; directory bundles/invalid entries require explicit native entries");
      row.ceiling.source = false; continue;
    }
    const skill = own.skills[0]; row.skill = skill;
    row.path = skill.filePath; row.identity = identity("skill", skill.filePath, row.scope);
    if (!validated.skills.some(value => value.filePath === skill.filePath)) row.ceiling.source = false;
    // Returned lexical entry identity, not a physical-target preference key.
    const admittedEntry = ceiling("skill", skill.filePath, row.scope, row.source);
    row.ceiling = { source: row.ceiling.source && admittedEntry.source, trust: row.ceiling.trust && admittedEntry.trust,
      profile: row.ceiling.profile && admittedEntry.profile };
  }
  for (const row of rows) {
    if ((row.kind === "skill" || row.kind === "extension") && row.membership === "confirmed" && !readable(row.path)) {
      issue("broken-member", row.path, "Still-declared native member is missing, broken or unreadable"); row.ceiling.source = false;
    }
  }
  for (const [path, before] of sourceGenerations) if (generation(path) !== before) {
    issue("source-generation", path, "Observed native source changed during listing; refresh before using this catalog");
    // A mixed generation cannot be used as a selection snapshot.
    for (const row of rows) row.ceiling = { ...row.ceiling, source: false };
  }
  const objects: SelectionObject[] = rows.filter(row => row.identity).map(row => ({ identity: row.identity!, parent: row.parent,
    choices: input.choices?.(row.identity!) ?? {}, eligibility: row.ceiling }));
  // Duplicate logical identities must diagnose, not crash into an arbitrary winner.
  const duplicates = new Set<string>(), seen = new Set<string>();
  for (const object of objects) { const key = selectionKey(object.identity); if (seen.has(key)) duplicates.add(key); seen.add(key); }
  for (const key of duplicates) issue("identity-collision", key, "Multiple catalog rows claim this lexical identity; repair conflicting declarations");
  const selection = duplicates.size ? [] : resolveSelection(objects, input.context);
  for (const row of rows) if (row.identity) row.selection = selection.find(value => value.key === selectionKey(row.identity!));
  revalidate();
  return freeze({ coverage: "native winners plus confirmed local members; not a complete declaration inventory", ok: !diagnostics.some(value => value.severity === "error"),
    rows: rows.map(row => { const { ceiling, ...publicRow } = row; void ceiling; return publicRow; }), native, raw, configuredPackages,
    metadataGeneration: metadata.status === "loaded" ? metadata.generation.token : null, diagnostics });
}
