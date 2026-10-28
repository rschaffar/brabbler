import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export type SettingValue = boolean | string | null | RequiredCheck[];
export interface RequiredCheck { name: string; command: string; /** Omitted or zero means no deadline. */ timeoutMs?: number }
export type PluginSettingScope = "global" | "project" | "session";
export interface PluginField {
  label: string;
  /** Optional catalog keys and display-only dependencies; never execution authority. */
  presentation?: {
    labelKey?: string;
    descriptionKey?: string;
    groupKey?: string;
    optionLabelKeys?: Readonly<Record<string, string>>;
    nullLabelKey?: string;
    emptyLabelKey?: string;
    relatedChoice?: { field: string; unresolvedValue: SettingValue };
  };
  kind: "boolean" | "text" | "enum" | "checks";
  default: SettingValue;
  options?: readonly string[];
  nullable?: boolean;
  globalOnly?: boolean;
  /** False for operations whose policy deliberately omits session overrides. */
  sessionOverridable?: boolean;
  description?: string;
  group?: string;
}
export interface PluginManifest {
  id: string;
  name: string;
  schemaVersion: number;
  /** Allow canonical directory scopes outside Git; Git plugins keep repository-only identity. */
  directoryProjects?: boolean;
  /** Opt-in presentation; other bundled plugins keep their existing editor. */
  settingsLayout?: "scope-matrix";
  fields: Readonly<Record<string, PluginField>>;
  /** Explicit UI recipes, never applied by a model or merely by selecting a scope. */
  presets?: Readonly<Record<string, { label: string; values: Overrides }>>;
}
export interface BundledPlugin {
  manifest: PluginManifest;
  extension(cwd: string): InlineExtension;
  /** Bounded browser project actions. Core transports opaque payloads; plugin owns semantics. */
  projectActions?: {
    /** Read-only identity/admission, available even while execution is disabled. */
    resolveProject(cwd: string): Promise<{ identity: string; anchor: string; relatedDirectories: string[] }>;
    execute(cwd: string, action: string, payload: unknown, ui: PluginUiContext, signal: AbortSignal, progress: (text: string) => void): Promise<unknown>;
  };
  /** Read-only opaque display resources; repository semantics remain plugin-owned. */
  readPatchContext?(handle: string, fileId: string): Promise<import("../diff-context").DiffContext>;
}
export type Overrides = Record<string, SettingValue>;
/** Trusted host identity, never tool arguments. cwd is the session's own cwd. */
export interface PluginSession { id: string; cwd: string }
export interface PluginSettings {
  pluginId: string;
  schemaVersion: number;
  project: string | null;
  enabled: boolean;
  global: Overrides;
  overrides: Overrides;
  effective: Overrides;
  sessionId?: string;
  sessionProject?: string | null;
  sessionApplicable?: boolean;
  sessionOverrides?: Overrides;
  sources: Record<string, "builtin" | "global" | "project" | "session">;
}

export interface PluginCardField { label: string; value: string; code?: boolean }
export interface PluginCardSection {
  title: string;
  text?: string;
  fields?: PluginCardField[];
  code?: boolean;
  collapsible?: boolean;
  notice?: boolean;
}
export interface PluginReviewReference {
  version: 1; id: string; operationId: string; sha256: string; entries: number; bytes: number;
}
/** Sequential streaming writer. The host publishes only a completely settled bundle. */
export interface PluginReviewWriter {
  begin(label: string, kind: "text" | "patch"): Promise<void>;
  write(chunk: Uint8Array): Promise<void>;
  end(): Promise<void>;
}
/** Browser presentation only; never instructions or execution authority. */
export interface PluginCard {
  /** Correlates a decision card with durable operation stage snapshots. */
  operationId?: string;
  title: string;
  text?: string;
  subtitle?: string;
  fields?: PluginCardField[];
  sections?: PluginCardSection[];
  scope?: string;
  requiredAcknowledgment?: string;
  markdown?: string;
  patch?: string;
  /** Durable exact review material; display pages never narrow authorization. */
  review?: PluginReviewReference;
  patchBefore?: string;
  patchAfter?: string;
  /** Optional plugin-owned, expiring immutable context handle; never execution authority. */
  patchContext?: string;
  /** Optional feedback, never silently applied to an approved operation. */
  allowDetails?: boolean;
  sessionLinks?: Array<{ sessionId: string; label: string }>;
  actions: Array<{ id: string; label: string; primary?: boolean }>;
}
export interface PluginOperationReceipt {
  version: 1;
  operationId: string;
  toolCallId?: string;
  card: PluginCard;
  phase: "prepared" | "authorized" | "checking" | "executing" | "succeeded" | "failed" | "cancelled";
  authorization: {
    mode: "ask" | "allow";
    source: string;
    revision: string;
    decision: "pending" | "user-approved" | "policy-authorized" | "not-approved";
  };
  checks: Array<{ name: string; status: "pending" | "running" | "passed" | "failed" }>;
  effectStarted: boolean;
  completedEffects?: string[];
  attemptedEffect?: string;
  summary?: string;
}
export interface PluginUiContext {
  /** Ordinary-session lifecycle stays host-owned, not re-imported by extensions. */
  sessionLaunchHost?: import("../session-launch-types").SessionLaunchHost;
  /** Observed managed RPC/terminal use at this physical directory or below; not an OS lock. */
  isDirectoryInUse(path: string): boolean;
  /** Synchronously reject busy/overlapping use and block new managed admissions until release.
   * Release in finally only after the native effect settles, not merely on abort. */
  reserveDirectory(path: string): () => void;
  prepareReview(pluginId: string, operationId: string, build: (writer: PluginReviewWriter) => Promise<void>): Promise<PluginReviewReference>;
  pluginCard(pluginId: string, card: PluginCard, signal?: AbortSignal): Promise<string | null>;
  pluginCardWithDetails?(pluginId: string, card: PluginCard, signal?: AbortSignal): Promise<{ action: string; details?: string } | null>;
  /** Synchronous durable append, outside model context. Throws on failure; never gated by abort. */
  operationReceipt(pluginId: string, receipt: PluginOperationReceipt): void;
}
