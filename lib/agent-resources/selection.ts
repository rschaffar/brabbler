import { posix } from "node:path";

/** Desired availability only: no discovery, storage, migration or applied-state claims.
 * Callers supply admitted origin/binding context and independent hard ceilings.
 * Paths are lexical POSIX installed names (the local catalog pilot), never realpaths.
 * Parent/origin admission and physical alias/name conflicts belong to the catalog;
 * this module validates logical identity conflicts and the flat gate graph. */
export type SelectionScope = "global" | "project" | "session";
export type SelectionChoice = "inherit" | "enabled" | "disabled";
export type ScopedChoices = Readonly<Partial<Record<SelectionScope, SelectionChoice>>>;
export type ResourceKind = "skill" | "extension";
export type ResourceOrigin = Readonly<{ scope: "global" } | { scope: "project"; binding: string }>;
export type SelectionIdentity = Readonly<{
  agentDir: string;
  origin: ResourceOrigin;
} & ({ kind: "group"; groupKey: string } | { kind: "package" | ResourceKind; path: string })>;

/** Opaque bindings are supplied by the canonical project / own-session owner.
 * No filesystem lookup or provider-account namespace is inferred here. */
export interface SelectionContext {
  readonly agentDir: string;
  readonly projectBinding: string | null;
  readonly sessionBinding: string | null;
}
export interface SelectionEligibility {
  readonly source: boolean;
  readonly trust: boolean;
  readonly profile: boolean;
}
export interface SelectionObject {
  readonly identity: SelectionIdentity;
  readonly parent?: SelectionIdentity;
  /** Only choices for this admitted context, not an entire persisted preference store. */
  readonly choices: ScopedChoices;
  readonly eligibility: SelectionEligibility;
}
export interface OwnSelection {
  readonly enabled: boolean;
  readonly source: SelectionScope | "default";
}
export interface ScopeSelection {
  readonly editable: boolean;
  /** null means this scope is unavailable, not an editable Inherit value. */
  readonly choice: SelectionChoice | null;
  readonly own: OwnSelection | null;
}
export type DisabledReason =
  | Readonly<{ code: "own-disabled"; scope: SelectionScope }>
  | Readonly<{ code: "source-ineligible" | "trust-ineligible" | "profile-ineligible" }>
  | Readonly<{ code: "parent-disabled"; key: string }>;
export interface ResolvedSelection {
  readonly key: string;
  readonly identity: SelectionIdentity;
  readonly own: OwnSelection;
  readonly scopes: Readonly<Record<SelectionScope, ScopeSelection>>;
  /** Root-to-parent order; each gate's enabled value includes its own parents. */
  readonly gates: readonly Readonly<{ key: string; enabled: boolean }>[];
  readonly enabled: boolean;
  readonly disabledReasons: readonly DisabledReason[];
}
export type SelectionErrorCode = "invalid-input" | "context-mismatch" | "unavailable-scope"
  | "conflict" | "missing-parent" | "cycle" | "invalid-parent";
export class SelectionModelError extends Error {
  readonly keys: readonly string[];
  constructor(readonly code: SelectionErrorCode, message: string, keys: readonly string[] = []) {
    super(message);
    this.name = "SelectionModelError";
    this.keys = Object.freeze([...keys]);
  }
}
const scopes: readonly SelectionScope[] = ["global", "project", "session"];
function requireInput(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SelectionModelError("invalid-input", message);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}
function installedPath(value: string): string {
  requireInput(text(value) && posix.isAbsolute(value), "Expected an absolute lexical installed path");
  const normalized = posix.normalize(value);
  return normalized === "/" ? normalized : normalized.replace(/\/$/, "");
}
/** Copy/freeze identities; parent placement and store targets are deliberately absent. */
export function createSelectionIdentity(input: SelectionIdentity): SelectionIdentity {
  requireInput(input && typeof input === "object", "Expected a selection identity");
  const agentDir = installedPath(input.agentDir);
  const origin = input.origin;
  requireInput(origin && (origin.scope === "global" || origin.scope === "project"), "Invalid admitted origin");
  if (origin.scope === "project") requireInput(text(origin.binding), "Expected an admitted project binding");
  const copiedOrigin: ResourceOrigin = origin.scope === "global"
    ? Object.freeze({ scope: "global" }) : Object.freeze({ scope: "project", binding: origin.binding });
  if (input.kind === "group") {
    requireInput(text(input.groupKey), "Expected an exact group key");
    return Object.freeze({ agentDir, origin: copiedOrigin, kind: "group", groupKey: input.groupKey });
  }
  requireInput(input.kind === "package" || input.kind === "skill" || input.kind === "extension", "Unsupported availability kind");
  return Object.freeze({ agentDir, origin: copiedOrigin, kind: input.kind, path: installedPath(input.path) });
}
/** An encoding of current identity, not a permanent ID or alias registry. */
export function selectionKey(input: SelectionIdentity): string {
  const identity = createSelectionIdentity(input);
  return JSON.stringify([identity.agentDir,
    identity.origin.scope === "global" ? ["global"] : ["project", identity.origin.binding],
    identity.kind, identity.kind === "group" ? identity.groupKey : identity.path]);
}
function validateContext(context: SelectionContext): void {
  installedPath(context.agentDir);
  requireInput(context.projectBinding === null || text(context.projectBinding), "Invalid project binding");
  requireInput(context.sessionBinding === null || text(context.sessionBinding), "Invalid session binding");
}
function editableScopes(identity: SelectionIdentity, context: SelectionContext): Record<SelectionScope, boolean> {
  validateContext(context);
  if (identity.agentDir !== installedPath(context.agentDir)
    || (identity.origin.scope === "project" && identity.origin.binding !== context.projectBinding)) {
    throw new SelectionModelError("context-mismatch", "Object is outside the admitted agentDir/project context", [selectionKey(identity)]);
  }
  return { global: identity.origin.scope === "global", project: context.projectBinding !== null, session: context.sessionBinding !== null };
}
function isChoice(value: unknown): value is SelectionChoice {
  return value === "inherit" || value === "enabled" || value === "disabled";
}
function resolveOwn(object: SelectionObject, identity: SelectionIdentity, context: SelectionContext) {
  const editable = editableScopes(identity, context), choices = object.choices;
  requireInput(choices && typeof choices === "object" && !Array.isArray(choices), "Expected scoped choices");
  for (const [scope, choice] of Object.entries(choices)) {
    requireInput(scopes.includes(scope as SelectionScope) && isChoice(choice), "Invalid scoped choice");
    if (!editable[scope as SelectionScope]) {
      throw new SelectionModelError("unavailable-scope", `No ${scope} choice in this admitted context`, [selectionKey(identity)]);
    }
  }
  let own: OwnSelection = Object.freeze({ enabled: true, source: "default" });
  const rows = {} as Record<SelectionScope, ScopeSelection>;
  for (const scope of scopes) {
    if (!editable[scope]) {
      rows[scope] = Object.freeze({ editable: false, choice: null, own: null });
      continue;
    }
    const choice = choices[scope] ?? "inherit";
    if (choice !== "inherit") own = Object.freeze({ enabled: choice === "enabled", source: scope });
    rows[scope] = Object.freeze({ editable: true, choice, own });
  }
  return { own, scopes: Object.freeze(rows) };
}
/** Pure edit/reset helper. Off parents never participate in editing availability.
 * Reset deletes just this scope; all other choices are preserved. Stores own retention. */
export function setSelectionChoice(object: SelectionObject, context: SelectionContext, scope: SelectionScope, choice: SelectionChoice): ScopedChoices {
  requireInput(scopes.includes(scope) && isChoice(choice), "Invalid scoped edit");
  const identity = createSelectionIdentity(object.identity);
  resolveOwn(object, identity, context);
  if (!editableScopes(identity, context)[scope]) {
    throw new SelectionModelError("unavailable-scope", `Cannot edit unavailable ${scope} scope`, [selectionKey(identity)]);
  }
  const next = { ...object.choices };
  if (choice === "inherit") delete next[scope];
  else next[scope] = choice;
  return Object.freeze(next);
}

/** Reject the entire invalid graph; never select an arbitrary conflict winner.
 * Single parent permits only group -> package -> resource or group -> standalone,
 * plus ungrouped packages/resources. All input objects and preferences stay untouched. */
export function resolveSelection(objects: readonly SelectionObject[], context: SelectionContext): readonly ResolvedSelection[] {
  validateContext(context);
  const nodes = new Map<string, {
    identity: SelectionIdentity; parent: string | undefined;
    own: OwnSelection; scopes: Readonly<Record<SelectionScope, ScopeSelection>>; reasons: DisabledReason[];
  }>();
  for (const object of objects) {
    const identity = createSelectionIdentity(object.identity), key = selectionKey(identity);
    if (nodes.has(key)) throw new SelectionModelError("conflict", "Duplicate normalized identity; resolve catalog ownership", [key]);
    const own = resolveOwn(object, identity, context), eligibility = object.eligibility;
    requireInput(eligibility && [eligibility.source, eligibility.trust, eligibility.profile].every(value => typeof value === "boolean"),
      "Explicit source, trust and profile eligibility ceilings are required");
    const reasons: DisabledReason[] = [];
    if (!own.own.enabled && own.own.source !== "default") reasons.push(Object.freeze({ code: "own-disabled", scope: own.own.source }));
    if (!eligibility.source) reasons.push(Object.freeze({ code: "source-ineligible" }));
    if (!eligibility.trust) reasons.push(Object.freeze({ code: "trust-ineligible" }));
    if (!eligibility.profile) reasons.push(Object.freeze({ code: "profile-ineligible" }));
    nodes.set(key, { identity, parent: object.parent === undefined ? undefined : selectionKey(object.parent), ...own, reasons });
  }
  for (const [key, node] of nodes) {
    if (node.parent !== undefined && !nodes.has(node.parent)) {
      throw new SelectionModelError("missing-parent", "Controlling parent is missing from the admitted catalog", [key, node.parent]);
    }
  }
  // Check cycles before kind constraints so even malformed cyclic hierarchies diagnose safely.
  const checked = new Set<string>();
  for (const key of nodes.keys()) {
    const chain = new Set<string>();
    let current: string | undefined = key;
    while (current !== undefined && !checked.has(current)) {
      if (chain.has(current)) throw new SelectionModelError("cycle", "Cyclic controlling parents", [...chain, current]);
      chain.add(current);
      current = nodes.get(current)!.parent;
    }
    for (const member of chain) checked.add(member);
  }
  for (const [key, node] of nodes) {
    if (node.parent === undefined) continue;
    const parent = nodes.get(node.parent)!;
    if (node.identity.kind === "group" || (node.identity.kind === "package" && parent.identity.kind !== "group")
      || (parent.identity.kind !== "group" && parent.identity.kind !== "package")) {
      throw new SelectionModelError("invalid-parent", "Expected a flat group/package/resource hierarchy", [key, node.parent]);
    }
  }
  const results = new Map<string, ResolvedSelection>();
  const resolve = (key: string): ResolvedSelection => {
    const existing = results.get(key);
    if (existing) return existing;
    const node = nodes.get(key)!;
    const parent = node.parent === undefined ? undefined : resolve(node.parent);
    const gates = Object.freeze(parent ? [...parent.gates, Object.freeze({ key: parent.key, enabled: parent.enabled })] : []);
    const disabledReasons = Object.freeze([...node.reasons,
      ...gates.filter(gate => !gate.enabled).map(gate => Object.freeze({ code: "parent-disabled" as const, key: gate.key }))]);
    const result = Object.freeze({ key, identity: node.identity, own: node.own, scopes: node.scopes,
      gates, enabled: disabledReasons.length === 0, disabledReasons });
    results.set(key, result);
    return result;
  };
  return Object.freeze([...nodes.keys()].map(resolve));
}
