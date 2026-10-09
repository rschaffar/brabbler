import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export type SettingValue = boolean | string | null | RequiredCheck[];
export interface RequiredCheck { name: string; command: string; /** Omitted or zero means no deadline. */ timeoutMs?: number }
export interface PluginField {
  label: string;
  kind: "boolean" | "text" | "enum" | "checks";
  default: SettingValue;
  options?: readonly string[];
  nullable?: boolean;
  globalOnly?: boolean;
  description?: string;
  group?: string;
}
export interface PluginManifest {
  id: string;
  name: string;
  schemaVersion: number;
  fields: Readonly<Record<string, PluginField>>;
  /** Explicit UI recipes, never applied by a model or merely by selecting a scope. */
  presets?: Readonly<Record<string, { label: string; values: Overrides }>>;
}
export interface BundledPlugin {
  manifest: PluginManifest;
  extension(cwd: string): InlineExtension;
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
  markdown?: string;
  patch?: string;
  /** Durable exact review material; display pages never narrow authorization. */
  review?: PluginReviewReference;
  patchBefore?: string;
  patchAfter?: string;
  /** Optional plugin-owned, expiring immutable context handle; never execution authority. */
  patchContext?: string;
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
  summary?: string;
}
export interface PluginUiContext {
  /** Observed managed RPC/terminal use at this physical directory or below; not an OS lock. */
  isDirectoryInUse(path: string): boolean;
  /** Synchronously reject busy/overlapping use and block new managed admissions until release.
   * Release in finally only after the native effect settles, not merely on abort. */
  reserveDirectory(path: string): () => void;
  prepareReview(pluginId: string, operationId: string, build: (writer: PluginReviewWriter) => Promise<void>): Promise<PluginReviewReference>;
  pluginCard(pluginId: string, card: PluginCard, signal?: AbortSignal): Promise<string | null>;
  /** Synchronous durable append, outside model context. Throws on failure; never gated by abort. */
  operationReceipt(pluginId: string, receipt: PluginOperationReceipt): void;
}
