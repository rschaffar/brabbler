import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync, type BigIntStats } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { SettingsManager, parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath } from "../session-reader";
import { readRegularFileText } from "../regular-file";
import { readSubagentSessionResources, SUBAGENT_META_TYPE } from "../subagents";
import { readSessionToolSelection } from "../session-tool-selection";
import { PRESET_DEFAULT } from "../tool-presets";
import type { SessionEntry } from "../types";
import { getKnownAllowedFileRoots } from "../file-access";
import { physicalDirectoryPath, isImmutableNixStorePath, isPathWithinRoots } from "../path-security";
import { getProjectTrustStatus } from "../project-trust";
import { buildResourceCatalog, withResourceChoices, type CatalogInput, type CatalogResult } from "./catalog";
import { readCatalogMetadata, CatalogMetadataError } from "./catalog-metadata";
import { resolveResourceContext, ResourceContextError } from "./context";
import { ensureScopedNativeImport, NativeImportError } from "./native-import";
import { readScopedPreferences, saveScopedPreference, PreferencesError, type PreferenceSnapshot, type PreferenceTarget } from "./preferences";
import { selectionKey, type SelectionScope, type ScopedChoices, type SelectionIdentity } from "./selection";
import { resourceApplication, resourceStatus, ResourceApplyError } from "./live";

/** Desired-state facade and trusted internal selection snapshot. No session/loader or instruction-read authority.
 * Pilot: POSIX, installed local sources, global producer v1, canonical Project roots.
 * External physical sources must already pass the shared file-access boundary,
 * except immutable Nix store targets reached through an admitted alias;
 * neither native declarations nor metadata register arbitrary browsing roots. */
export class ResourceApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "ResourceApiError"; }
}
function refuse(status: number, code: string, message: string): never { throw new ResourceApiError(status, code, message); }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const plurals = ["extensions", "skills", "prompts", "themes"] as const;
const MAX_PATHS = 1024, MAX_NATIVE_BYTES = 1024 * 1024;
export const RESOURCE_REQUEST_MAX_BYTES = 64 * 1024;
type ContextInput = { cwd?: unknown; sessionId?: unknown };
function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    refuse(400, "request", "Unknown fields or invalid resource request; use cwd/sessionId and one scoped choice only");
  }
  return value as Record<string, unknown>;
}
export function resourceQuery(request: Request): ContextInput {
  if (Buffer.byteLength(request.url) > RESOURCE_REQUEST_MAX_BYTES) refuse(413, "limit", "Resource query is too large");
  const params = new URL(request.url).searchParams, result: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!["cwd", "sessionId"].includes(key) || Object.hasOwn(result, key)) refuse(400, "request", "Use only one cwd and optional own sessionId");
    result[key] = value;
  }
  return result;
}
export async function resourceBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) refuse(400, "request", "A JSON resource choice is required");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > RESOURCE_REQUEST_MAX_BYTES) { await reader.cancel(); refuse(413, "limit", "Resource request exceeds 64 KiB"); }
      chunks.push(value);
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { return refuse(400, "request", "Expected valid UTF-8 JSON for one scoped resource choice"); }
  } finally { reader.releaseLock(); }
}
function target(context: Awaited<ReturnType<typeof resolveResourceContext>>, scope: SelectionScope): PreferenceTarget | null {
  if (scope === "global") return { scope, binding: null };
  const binding = context.selection[scope === "project" ? "projectBinding" : "sessionBinding"];
  return binding ? { scope, binding } : null;
}
/** Bounded read-only native storage. Never SettingsManager.create/migrate/flush. */
function nativeSettings(path: string, allow: (path: string) => void): string | undefined {
  allow(path);
  let before;
  try { before = statSync(path, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  if (!before.isFile() || before.size > BigInt(MAX_NATIVE_BYTES)) refuse(422, "native-source", "Native settings must be regular files no larger than 1 MiB");
  const fd = openSync(realpathSync(path), constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.size !== before.size || opened.ino !== before.ino || opened.dev !== before.dev) refuse(409, "generation", "Native settings changed; refresh inventory");
    const bytes = Buffer.alloc(Number(opened.size) + 1); let size = 0;
    while (size < bytes.length) { const n = readSync(fd, bytes, size, bytes.length - size, null); if (!n) break; size += n; }
    if (size !== Number(opened.size) || stamp(opened) !== stamp(fstatSync(fd, { bigint: true })) || stamp(opened) !== stamp(statSync(path, { bigint: true }))) {
      refuse(409, "generation", "Native settings changed; refresh inventory");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
  } finally { closeSync(fd); }
}
function stamp(s: BigIntStats, structural = false): string {
  return [s.dev, s.ino, s.mode, s.uid, s.gid, s.birthtimeNs, ...(structural ? [] : [s.nlink, s.size, s.mtimeNs, s.ctimeNs])].join(":");
}
function observation(path: string, structural: boolean): unknown {
  try { const link = lstatSync(path, { bigint: true }); return [path, stamp(link, structural), realpathSync(path), stamp(statSync(path, { bigint: true }), structural)]; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    // A dangling source is not absence. Resolve the closest existing parent too.
    try { lstatSync(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return [path, null, physicalDirectoryPath(dirname(path))]; throw e; }
  } throw error; }
}
function localSettings(text: { global: string | undefined; project: string | undefined }, projectTrusted: boolean) {
  // Refuse transports BEFORE public discovery (which may otherwise probe npm).
  for (const raw of Object.values(text)) {
    if (raw === undefined || raw === "") continue;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { refuse(422, "native-settings", "Repair malformed native settings JSON before using resource choices"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) refuse(422, "native-settings", "Native settings must be objects");
    const packages = parsed.packages;
    if (packages !== undefined && (!Array.isArray(packages) || packages.length > 128 || packages.some((pkg: unknown) => {
      const source = typeof pkg === "string" ? pkg : (pkg as { source?: unknown } | null)?.source;
      return typeof source !== "string" || !isAbsolute(source) || normalize(source) !== source;
    }))) refuse(422, "unsupported-source", "This resource pilot supports absolute installed local package sources only; reconcile npm/git/relative sources separately");
  }
  const manager = SettingsManager.fromStorage({ withLock(scope, fn) {
    if (fn(text[scope]) !== undefined) refuse(503, "native-write", "Native resource storage is read-only");
  } }, { projectTrusted });
  if (manager.drainErrors().length) refuse(422, "native-settings", "Public SDK rejected native settings; repair them before retrying");
  const result = { global: manager.getGlobalSettings(), project: projectTrusted ? manager.getProjectSettings() : {} };
  for (const settings of Object.values(result)) for (const plural of plurals) {
    const entries = settings[plural];
    if (entries !== undefined && (!Array.isArray(entries) || entries.length > 128 || entries.some(entry => typeof entry !== "string" || entry.length > 16_384))) {
      refuse(422, "native-settings", "Repair unsupported native resource selectors before retrying");
    }
  }
  return result;
}
// The catalog contains desired resolutions; fence native membership, not choices.
const membership = (catalog: CatalogResult) => hash([catalog.ok, catalog.rows.map(({ selection: _selection, ...row }) => { void _selection; return row; }), catalog.native, catalog.diagnostics]);

async function prepare(input: ContextInput, importNative = true) {
  if (process.platform === "win32") refuse(422, "platform", "The managed-local resource pilot requires POSIX installed paths");
  const context = await resolveResourceContext(input), agentDir = context.selection.agentDir;
  // Canonical trust reads use the approved SDK read-lock metadata only; they
  // never grant trust or rewrite native decisions/settings/resource contents.
  const projectAdmitted = () => Boolean(context.selection.projectBinding && context.cwd && getProjectTrustStatus(context.cwd, agentDir).trusted);
  const projectTrusted = projectAdmitted();
  if (context.selection.projectBinding && !projectTrusted) refuse(403, "project-trust", "Project resources are not trusted; review the existing Project trust controls before importing or saving resource choices");
  const roots = () => new Set([agentDir, join(homedir(), ".agents"), ...getKnownAllowedFileRoots()]);
  const allow = (path: string) => {
    const admitted = roots();
    // Existing physical authority, or contained true absence; never add roots.
    // An admitted alias may also resolve into an immutable Nix store object
    // (Home Manager links); a lexical /nix/store path is still refused.
    if (isPathWithinRoots(path, admitted)) {
      const physical = physicalDirectoryPath(path);
      if (isImmutableNixStorePath(physical)) return;
      // Resolve fresh roots only until containment is proved. No authorization
      // survives this call: a later guard sees retargeted aliases/current roots.
      for (const root of admitted) {
        if (isPathWithinRoots(physical, new Set([physicalDirectoryPath(root)]))) return;
      }
    }
    refuse(403, "source-access", `Native source is outside admitted file roots: ${path}. Admit its physical installed location through the existing file-access workflow, or remove the unsupported declaration/alias`);
  };
  const metadataPath = join(agentDir, "resource-catalog.json"); allow(metadataPath);
  const metadata = readCatalogMetadata({ status: "configured", path: metadataPath, context: context.selection });
  const readSettings = () => ({ global: nativeSettings(join(agentDir, "settings.json"), allow),
    project: projectTrusted ? nativeSettings(join(context.cwd!, ".pi/settings.json"), allow) : undefined });
  const text = readSettings(), settings = localSettings(text, projectTrusted);
  for (const scoped of Object.values(settings)) {
    for (const pkg of scoped.packages ?? []) allow(typeof pkg === "string" ? pkg : pkg.source);
    // Native selector interpretation belongs solely to the public SDK. Explicit
    // paths are pre-admitted; observed pattern/default members are checked below.
    for (const plural of plurals) for (const path of scoped[plural] ?? []) {
      if (!/^[!+\-]|[*?\[\]{}]/.test(path)) {
        if (!isAbsolute(path)) refuse(422, "unsupported-source", "Use absolute local resource declarations in this pilot; native modifiers remain supported by the SDK");
        allow(path);
      }
    }
  }
  const eligibility: CatalogInput["eligibility"] = resource => { allow(resource.path); return { source: true, trust: resource.scope !== "project" || projectTrusted, profile: true }; };
  // Management inventory is not a profile-specific runtime selection. Profile
  // ceilings remain the runtime owner's responsibility; this grants no activation.
  const catalogInput: CatalogInput = { cwd: projectTrusted ? context.cwd! : agentDir, context: context.selection,
    discoveryAdmitted: true, globalSettings: settings.global, projectSettings: settings.project,
    projectTrusted, metadata, managedMetadataTrusted: true, eligibility };
  const first = await buildResourceCatalog(catalogInput);
  if (!first.ok) refuse(422, "catalog", first.diagnostics.filter(d => d.severity === "error").map(d => `${d.code}: ${d.message} (${d.path})`).join("; "));
  const paths = new Set<string>([agentDir, metadataPath, join(agentDir, "settings.json"), join(homedir(), ".agents"), join(homedir(), ".agents/skills"),
    ...plurals.map(kind => join(agentDir, kind))]);
  if (projectTrusted) for (const path of [context.cwd!, join(context.cwd!, ".pi"), join(context.cwd!, ".pi/settings.json"), join(context.cwd!, ".agents"), join(context.cwd!, ".agents/skills"), ...plurals.map(kind => join(context.cwd!, ".pi", kind))]) paths.add(path);
  for (const pkg of first.configuredPackages) if (pkg.installedPath) {
    for (const path of [pkg.installedPath, join(pkg.installedPath, "package.json"), ...plurals.map(kind => join(pkg.installedPath!, kind))]) paths.add(path);
  }
  for (const row of first.rows) if (row.kind !== "group") { paths.add(row.path); for (const path of row.observedPaths) paths.add(path); }
  if (paths.size > MAX_PATHS) refuse(422, "limit", "Native evidence exceeds the 1024-path pilot limit; reduce the resource context");
  for (const path of paths) allow(path);
  const observe = () => [...paths].map(path => observation(path, path === agentDir || path === context.cwd));
  const before = observe(), nativeMembership = membership(first);
  const current = () => {
    context.assertAdmissionCurrent();
    if (projectTrusted !== projectAdmitted()
      || hash(readSettings()) !== hash(text) || hash(observe()) !== hash(before)
      || readCatalogMetadata({ status: "configured", path: metadataPath, context: context.selection }).status !== "loaded") {
      refuse(409, "generation", "Native source, trust or catalog changed; refresh inventory before saving");
    }
    for (const path of paths) allow(path);
    context.assertAdmissionCurrent();
  };
  const guard = async () => {
    current();
    const fresh = await buildResourceCatalog(catalogInput);
    if (membership(fresh) !== nativeMembership) refuse(409, "generation", "Native membership changed; refresh inventory before saving");
    current();
  };
  await guard(); // Bind discovered evidence before any preference/import use.
  const token = hash([context.selection, context.cwd, before, hash(text), nativeMembership]);
  const snapshots = new Map<SelectionScope, PreferenceSnapshot>();
  for (const scope of ["global", "project"] as const) {
    const destination = target(context, scope); if (!destination) continue;
    // First-use importer runs for each applicable native scope, before ordinary
    // store reads/writes. No historical Session import and no callback facade.
    if (importNative) snapshots.set(scope, await ensureScopedNativeImport({ context, scope,
      catalog: { discoveryAdmitted: true, metadata, managedMetadataTrusted: true, eligibility },
      admittedEvidencePaths: [...paths], assertNativeReadAllowed: allow, assertPublicationCurrent: guard }));
  }
  const sessionTarget = target(context, "session");
  await guard();
  const choices = (identity: SelectionIdentity): ScopedChoices => Object.fromEntries([...snapshots].flatMap(([scope, snapshot]) => {
    if (scope === "global" && identity.origin.scope !== "global") return [];
    const choice = snapshot.choices.find(row => selectionKey(row.identity) === selectionKey(identity));
    return choice ? [[scope, choice.value]] : [];
  }));
  const selectionSnapshot = async () => {
    // Read the desired OWN scopes together after all applicable import work (and
    // after a save). No await between these reads: cooperating in-process writers
    // cannot interleave them. This is not a cross-process filesystem transaction.
    context.assertAdmissionCurrent();
    for (const scope of ["global", "project", "session"] as const) {
      const destination = target(context, scope);
      if (destination) snapshots.set(scope, readScopedPreferences(context.selection, destination));
    }
    context.assertAdmissionCurrent();
    // Edit revisions fence stale writes, even after a store-wide compaction.
    // An applied selection depends on these scopes' choices, not edit counters.
    const revision = hash([token, [...snapshots].map(([scope, snapshot]) => [scope, snapshot.choices])]);
    // Choices cannot change native membership or its captured hard ceilings.
    // Project them without another discovery; keep the independent fresh guard.
    const catalog = withResourceChoices(first, choices); await guard();
    return Object.freeze({ context: context.selection, cwd: context.cwd, catalog, revision, assertCurrent: guard });
  };
  const inventory = async () => {
    const { catalog, revision } = await selectionSnapshot();
    return { version: 1, state: "desired", runtime: typeof input.sessionId === "string" ? resourceStatus(agentDir, input.sessionId, revision) : null, contextToken: token,
      context: { cwd: context.cwd, sessionId: input.sessionId ?? null, scopes: { global: true, project: Boolean(target(context, "project")), session: Boolean(sessionTarget) } },
      scopes: Object.fromEntries((["global", "project", "session"] as const).map(scope => {
        const snapshot = snapshots.get(scope);
        return [scope, snapshot ? { revision: snapshot.revision, nativeImport: scope === "session" ? "not-applicable" : "completed",
          ownChoices: snapshot.choices.map(row => ({ selectionKey: selectionKey(row.identity), choice: row.value })) } : null];
      })),
      catalog: { coverage: catalog.coverage, diagnostics: catalog.diagnostics,
        presentation: metadata.status === "loaded" ? metadata.catalog : null,
        rows: catalog.rows.map(({ identity, parent, skill, selection, ...row }) => ({ ...row,
          selectionKey: identity ? selectionKey(identity) : null, parentKey: parent ? selectionKey(parent) : null, desired: selection ?? null,
          ...(skill ? { skill: { name: skill.name, description: skill.description, disableModelInvocation: skill.disableModelInvocation } } : {}) })) } };
  };
  return { context, token, guard, inventory, first, selectionSnapshot, allow };
}
/** Trusted startup consumer only: the same admitted catalog/import/store as HTTP,
 * including committed own-scope choices. A fixed construction snapshot, NOT a live
 * application receipt. Native/context fences do not silently recopy later saves. */
export async function readCommittedResourceSelection(input: ContextInput) {
  return (await prepare(input)).selectionSnapshot();
}
/** Inspection uses the inert native catalog, never first-use import, a loader or
 * management profile:true as Session read authority. No new filesystem roots. */
export async function prepareSkillInspection(input: ContextInput, key: string) {
  const prepared = await prepare(input, false);
  const row = prepared.first.rows.find(row => row.identity && selectionKey(row.identity) === key);
  if (row?.kind !== "skill" || row.membership !== "confirmed" || !row.skill
    || row.selection?.disabledReasons.some(reason => ["source-ineligible", "trust-ineligible", "profile-ineligible"].includes(reason.code))) {
    refuse(404, "inspection-member", "Skill is not a current admitted catalog member; refresh Skills & extensions and reconcile its source/trust");
  }
  let profileCurrent = () => {};
  if (typeof input.sessionId === "string") {
    const path = await resolveSessionPath(input.sessionId, { allowCatalogueScan: false });
    if (!path) refuse(403, "inspection-profile", "Saved Session profile is unavailable; reopen its own saved conversation or inspect without a Session");
    const profile = () => {
      prepared.context.assertAdmissionCurrent();
      const before = stamp(statSync(path, { bigint: true }));
      const text = readRegularFileText(path, 256 * 1024 * 1024);
      if (!text || before !== stamp(statSync(path, { bigint: true }))) refuse(409, "inspection-profile", "Saved Session changed; refresh before inspecting instructions");
      // Reuse the SDK JSONL parser and the actual saved child/tool ceiling owners.
      // Parsing loss is not evidence that restricted metadata was absent.
      const parsed = parseSessionEntries(text);
      if (parsed.length !== text.split("\n").filter(line => line.trim()).length
        || parsed[0]?.type !== "session" || parsed[0].id !== input.sessionId) {
        refuse(403, "inspection-profile", "Saved Session profile cannot be proved; repair the saved session or inspect without a Session");
      }
      const entries = parsed.slice(1) as unknown as SessionEntry[];
      const child = readSubagentSessionResources(entries);
      const hasChild = entries.some(entry => entry.type === "custom" && entry.customType === SUBAGENT_META_TYPE);
      let tools = hasChild ? child?.tools : readSessionToolSelection(entries);
      let defaultsEvidence: unknown;
      if (!hasChild && tools === undefined) {
        // Undefined (including a cleared pin) follows native defaults. Native
        // settings trust is independent of registered Project-edit support.
        const { cwd, selection: { agentDir } } = prepared.context;
        const projectTrusted = Boolean(cwd && getProjectTrustStatus(cwd, agentDir).trusted);
        const defaults = { global: nativeSettings(join(agentDir, "settings.json"), prepared.allow),
          project: projectTrusted ? nativeSettings(join(cwd!, ".pi/settings.json"), prepared.allow) : undefined };
        const manager = SettingsManager.fromStorage({ withLock(scope, fn) {
          if (fn(defaults[scope]) !== undefined) refuse(503, "native-write", "Native resource storage is read-only");
        } }, { projectTrusted });
        if (manager.drainErrors().length) refuse(422, "inspection-profile", "Repair native settings before inspecting with this Session's configured defaults");
        tools = manager.getDefaultTools() ?? PRESET_DEFAULT;
        defaultsEvidence = [projectTrusted, defaults];
      }
      if (hasChild && !child?.loadSkills || !tools?.includes("read")) {
        refuse(403, "inspection-profile", "This saved Session's profile or configured tools do not allow skill and Read access; review its existing tool settings. Child profile ceilings cannot be overridden here");
      }
      prepared.context.assertAdmissionCurrent();
      return hash([hasChild, child, tools, defaultsEvidence]);
    };
    const admitted = profile();
    profileCurrent = () => { if (profile() !== admitted) refuse(409, "inspection-profile", "Saved Session profile changed; refresh before inspecting instructions"); };
  }
  const assertCurrent = async () => { await prepared.guard(); profileCurrent(); };
  await assertCurrent();
  return { skill: row.skill, assertCurrent };
}
export async function getResourceInventory(input: ContextInput = {}) { return (await prepare(input)).inventory(); }
export async function patchResourceChoice(value: unknown) {
  const body = object(value, ["cwd", "sessionId", "scope", "revision", "contextToken", "selectionKey", "choice", "action"]);
  if (body.action !== undefined) {
    if (body.action !== "apply" || typeof body.sessionId !== "string" || Object.keys(body).some(key => !["cwd", "sessionId", "action"].includes(key))) refuse(400, "request", "Apply requires only cwd, own sessionId and action:apply");
    const input = { cwd: body.cwd, sessionId: body.sessionId };
    const context = await resolveResourceContext(input);
    context.assertAdmissionCurrent();
    const actual = resourceApplication(context.selection.agentDir, body.sessionId);
    if (!actual?.available?.() || !actual.apply) refuse(409, "runtime", "No live runtime to Apply. This conversation uses saved choices when opened; failed disposal still prevents unsafe reopen");
    await actual.apply();
    return getResourceInventory(input);
  }
  if (typeof body.scope !== "string" || !["global", "project", "session"].includes(body.scope)
    || typeof body.choice !== "string" || !["enabled", "disabled", "inherit"].includes(body.choice)
    || typeof body.selectionKey !== "string" || body.selectionKey.length > 49_152
    || typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision)
    || typeof body.contextToken !== "string" || !/^[a-f0-9]{64}$/.test(body.contextToken)) refuse(400, "request", "Provide scope, selectionKey, choice, revision and contextToken from the current inventory");
  const input = { ...(body.cwd === undefined ? {} : { cwd: body.cwd }), ...(body.sessionId === undefined ? {} : { sessionId: body.sessionId }) };
  const prepared = await prepare(input), scope = body.scope as SelectionScope;
  if (body.contextToken !== prepared.token) refuse(409, "context", "Context/catalog changed; refresh inventory and review the choice before saving");
  const row = prepared.first.rows.find(row => row.identity && selectionKey(row.identity) === body.selectionKey);
  const destination = target(prepared.context, scope);
  if (!row?.identity || row.membership !== "confirmed") refuse(409, "membership", "Resource is not a current confirmed catalog member; refresh inventory");
  if (!destination || !row.selection?.scopes[scope].editable) refuse(400, "scope", "This resource has no editable choice at the requested scope; select an available scope");
  await saveScopedPreference(prepared.context.selection, destination, body.revision as string, row.identity,
    body.choice as "enabled" | "disabled" | "inherit", prepared.guard);
  return prepared.inventory();
}
export function resourceApiFailure(error: unknown): { status: number; code: string; error: string } {
  if (error instanceof ResourceApplyError) return { status: error.status, code: "resource-apply", error: error.message };
  if (error instanceof ResourceApiError) return { status: error.status, code: error.code, error: error.message };
  if (error instanceof ResourceApplyError) return { status: error.status, code: "resource-apply", error: error.message };
  if (error instanceof ResourceContextError) return { status: error.code === "invalid" ? 400 : error.code === "generation" ? 409 : error.code === "unavailable" ? 503 : 403,
    code: `context-${error.code}`, error: `Resource context ${error.code}; select an admitted existing folder and its own saved session, then refresh` };
  if (error instanceof PreferencesError) return { status: ["generation", "conflict", "locked"].includes(error.code) ? 409 : error.code === "scope" ? 400 : 503,
    code: `preferences-${error.code}`, error: `Resource preferences ${error.code}; refresh for conflicts, or inspect/repair the private preferences store locally (do not delete import receipts)` };
  if (error instanceof NativeImportError) return { status: error.code === "generation" ? 409 : 422, code: `import-${error.code}`, error: error.message };
  if (error instanceof CatalogMetadataError) return { status: 422, code: `metadata-${error.code}`, error: `${error.message}; repair the producer v1 resource-catalog.json in the native agent context and refresh` };
  return { status: 503, code: "unavailable", error: "Resource inventory is unavailable; inspect native source/read permissions and refresh. No runtime application is acknowledged" };
}
