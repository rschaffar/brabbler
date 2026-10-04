import { isAbsolute, normalize } from "node:path";
import { types } from "node:util";

export type GitInvocationKind = "verify" | "commit" | "prepare" | "integrate" | "workspace" | "cleanup" | "reconcile";
export interface GitInvocationDirectoryIdentity {
  readonly device: string;
  readonly inode: string;
  readonly birthtime: string;
}
/** Descriptive data, not proof of physical identity. The trusted guard must
 * validate these names/identities against the actual native resources. */
export interface GitInvocationResource {
  readonly projectRoot: string;
  readonly cwd: string;
  readonly branch: string;
  readonly commonDir: string;
  readonly gitDir: string;
  readonly identities: {
    readonly project: GitInvocationDirectoryIdentity;
    readonly checkout: GitInvocationDirectoryIdentity;
    readonly common: GitInvocationDirectoryIdentity;
    readonly git: GitInvocationDirectoryIdentity;
    readonly marker: GitInvocationDirectoryIdentity & { readonly changed?: string; readonly size?: string };
  };
}
export interface GitInvocationBinding {
  readonly kind: GitInvocationKind;
  readonly source: GitInvocationResource;
  readonly target?: GitInvocationResource;
  readonly candidateSha256: string;
  readonly owner: { readonly sessionId: string; readonly sessionFile: string; readonly generation: string };
}
export interface GitInvocationGuards {
  /** Trusted owner adapter only. Must observe relevant monotonic mutation
   * revisions, including change-and-restore, not merely hash current values.
   * Unrelated sessions' activity must not advance this invocation's revision. */
  readAuthorityRevisionSync(): string;
  /** Revalidate actual caller authority, owner instance, exact candidate,
   * physical resources, approval and required evidence. Must return undefined.
   * Never accept this callback (or the revision reader) from a request payload. */
  assertCurrentSync(binding: GitInvocationBinding): void;
}
declare const invocationBrand: unique symbol;
export type GitInvocationHandle = { readonly [invocationBrand]: true };

type Phase = "ready" | "consumed" | "retired";
interface Entry {
  readonly binding: GitInvocationBinding;
  readonly guards: GitInvocationGuards;
  readonly revision: string;
  phase: Phase;
  validating: boolean;
}
// Intentionally module-local: hot reload/restart loses authority. No resource
// registry, historical lookup, native-success claim or cross-invocation gate.
const invocations = new WeakMap<GitInvocationHandle, Entry>();
const kinds: readonly string[] = ["verify", "commit", "prepare", "integrate", "workspace", "cleanup", "reconcile"];
function invalid(detail: string): never { throw new Error(`Invalid Git invocation: ${detail}`); }

/** Read descriptors, never getters. Reject proxies before any reflective trap. */
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value)) invalid("plain data object required");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid("plain data prototype required");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || (!required.includes(key) && !optional.includes(key))) invalid("unknown field");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor) || !descriptor.enumerable) invalid("own enumerable data fields required");
    result[key] = descriptor.value;
  }
  if (required.some((key) => !Object.hasOwn(result, key))) invalid("missing field");
  return result;
}
function text(value: unknown, maximum = 512): string {
  if (typeof value !== "string" || !value || value.length > maximum || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value)) invalid("bounded nonempty string required");
  return value;
}
function physicalPath(value: unknown): string {
  const path = text(value, 4096);
  if (!isAbsolute(path) || normalize(path) !== path) invalid("canonical absolute path required");
  return path;
}
function decimal(value: unknown): string {
  const number = text(value, 128);
  if (!/^(?:0|[1-9][0-9]*)$/.test(number)) invalid("canonical unsigned decimal identity required");
  return number;
}
function directory(value: unknown, marker = false): GitInvocationDirectoryIdentity & { readonly changed?: string; readonly size?: string } {
  const data = record(value, ["device", "inode", "birthtime"], marker ? ["changed", "size"] : []);
  return Object.freeze({ device: decimal(data.device), inode: decimal(data.inode), birthtime: decimal(data.birthtime),
    ...(Object.hasOwn(data, "changed") ? { changed: decimal(data.changed) } : {}),
    ...(Object.hasOwn(data, "size") ? { size: decimal(data.size) } : {}) });
}
function resource(value: unknown): GitInvocationResource {
  const data = record(value, ["projectRoot", "cwd", "branch", "commonDir", "gitDir", "identities"]);
  const identities = record(data.identities, ["project", "checkout", "common", "git", "marker"]);
  const branch = text(data.branch, 4096);
  if (branch === "@" || branch.startsWith("-") || /[ ~^:?*\[\\]/.test(branch) || branch.includes("..") || branch.includes("@{") ||
    branch.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock"))) invalid("local branch name required");
  return Object.freeze({ projectRoot: physicalPath(data.projectRoot), cwd: physicalPath(data.cwd), branch,
    commonDir: physicalPath(data.commonDir), gitDir: physicalPath(data.gitDir),
    identities: Object.freeze({ project: directory(identities.project), checkout: directory(identities.checkout),
      common: directory(identities.common), git: directory(identities.git), marker: directory(identities.marker, true) }) });
}
function bindingCopy(value: unknown): GitInvocationBinding {
  const data = record(value, ["kind", "source", "candidateSha256", "owner"], ["target"]);
  const kind = text(data.kind);
  if (!kinds.includes(kind)) invalid("unsupported kind");
  const candidateSha256 = text(data.candidateSha256, 64);
  if (!/^[a-f0-9]{64}$/.test(candidateSha256)) invalid("candidate SHA256 required");
  const owner = record(data.owner, ["sessionId", "sessionFile", "generation"]);
  return Object.freeze({ kind: kind as GitInvocationKind, source: resource(data.source),
    ...(Object.hasOwn(data, "target") ? { target: resource(data.target) } : {}), candidateSha256,
    owner: Object.freeze({ sessionId: text(owner.sessionId), sessionFile: physicalPath(owner.sessionFile), generation: text(owner.generation) }) });
}

// Promise.resolve installs rejection handling and safely assimilates thenables,
// including throwing then getters. Do not inspect .then ourselves or await it.
function drain(value: unknown): void {
  if (value !== null && (typeof value === "object" || typeof value === "function")) void Promise.resolve(value).catch(() => {});
}
function callSync(callback: () => unknown): unknown {
  try { return callback(); } catch (cause) { drain(cause); throw cause; }
}
function guardsCopy(value: unknown): GitInvocationGuards {
  const data = record(value, ["readAuthorityRevisionSync", "assertCurrentSync"]);
  for (const callback of Object.values(data)) {
    if (typeof callback !== "function" || types.isProxy(callback) || types.isAsyncFunction(callback) || types.isGeneratorFunction(callback)) invalid("synchronous guards required");
  }
  return Object.freeze({ readAuthorityRevisionSync: data.readAuthorityRevisionSync as GitInvocationGuards["readAuthorityRevisionSync"],
    assertCurrentSync: data.assertCurrentSync as GitInvocationGuards["assertCurrentSync"] });
}
function readRevision(guards: GitInvocationGuards): string {
  const value = callSync(() => guards.readAuthorityRevisionSync());
  if (typeof value !== "string") { drain(value); invalid("synchronous revision string required"); }
  return text(value);
}
function assertAuthority(guards: GitInvocationGuards, binding: GitInvocationBinding): void {
  const result = callSync(() => guards.assertCurrentSync(binding));
  if (result !== undefined) { drain(result); invalid("guard must return undefined synchronously"); }
}
function entryFor(handle: GitInvocationHandle): Entry {
  const entry = invocations.get(handle);
  if (!entry) invalid("unknown handle");
  return entry;
}
function checkPhase(entry: Entry, expected: Phase): void {
  if (entry.phase !== expected || entry.phase === "retired") invalid("retired or changed lifecycle");
}

/** Invocation foundation. Capture does not create permission or prove native
 * success. Only trusted owners may supply guards; their genuineness cannot be
 * inferred from a JavaScript function. No caller-supplied baseline is accepted. */
export function captureGitInvocation(binding: GitInvocationBinding, guards: GitInvocationGuards): GitInvocationHandle {
  const captured = bindingCopy(binding), callbacks = guardsCopy(guards);
  const revision = readRevision(callbacks);
  assertAuthority(callbacks, captured);
  if (readRevision(callbacks) !== revision) invalid("authority changed during capture");
  const handle = Object.freeze(Object.create(null)) as GitInvocationHandle;
  invocations.set(handle, { binding: captured, guards: callbacks, revision, phase: "ready", validating: false });
  return handle;
}
function validate(handle: GitInvocationHandle, expectedBinding: GitInvocationBinding, consume: boolean): void {
  const entry = entryFor(handle);
  try {
    if (entry.phase === "retired" || entry.validating || (consume && entry.phase !== "ready")) invalid("retired, reentrant or already consumed handle");
    entry.validating = true;
    const phase = entry.phase;
    // Canonical copies contain only validated own scalar fields in fixed order.
    // A structural match authenticates the binding, never the handle itself.
    const expected = bindingCopy(expectedBinding);
    if (JSON.stringify(expected) !== JSON.stringify(entry.binding)) invalid("binding mismatch");
    checkPhase(entry, phase);
    if (readRevision(entry.guards) !== entry.revision) invalid("original authority revoked");
    checkPhase(entry, phase);
    assertAuthority(entry.guards, entry.binding);
    checkPhase(entry, phase);
    if (readRevision(entry.guards) !== entry.revision) invalid("authority changed during validation");
    checkPhase(entry, phase);
    if (consume) entry.phase = "consumed";
  } catch (cause) {
    entry.phase = "retired";
    throw cause;
  } finally {
    entry.validating = false;
  }
}
/** Independently derive expectedBinding in the trusted consumer. Allowed after
 * consumption for this invocation's later native boundaries, including awaits. */
export function assertGitInvocationCurrentSync(handle: GitInvocationHandle, expectedBinding: GitInvocationBinding): void {
  validate(handle, expectedBinding, false);
}
/** The caller must invoke this directly before its first native effect, without
 * an intervening await. This is single-use authorization fencing, not a native
 * transaction, success receipt, or protection against concurrent filesystem IO. */
export function consumeGitInvocationSync(handle: GitInvocationHandle, expectedBinding: GitInvocationBinding): void {
  validate(handle, expectedBinding, true);
}
/** Idempotent for an authentic handle; copies/history never acquire authority. */
export function retireGitInvocation(handle: GitInvocationHandle): void {
  entryFor(handle).phase = "retired";
}
