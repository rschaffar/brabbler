import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export type SettingValue = boolean | string | null | RequiredCheck[];
export interface RequiredCheck { name: string; command: string }
export interface PluginField {
  label: string;
  kind: "boolean" | "text" | "enum" | "checks";
  default: SettingValue;
  options?: readonly string[];
  nullable?: boolean;
  globalOnly?: boolean;
}
export interface PluginManifest {
  id: string;
  name: string;
  schemaVersion: number;
  fields: Readonly<Record<string, PluginField>>;
}
export interface BundledPlugin {
  manifest: PluginManifest;
  extension(cwd: string): InlineExtension;
}
export type Overrides = Record<string, SettingValue>;
export interface PluginSettings {
  pluginId: string;
  schemaVersion: number;
  project: string | null;
  enabled: boolean;
  global: Overrides;
  overrides: Overrides;
  effective: Overrides;
  sources: Record<string, "builtin" | "global" | "project">;
}

/** Browser presentation only; never instructions or execution authority. */
export interface PluginCard {
  title: string;
  text?: string;
  markdown?: string;
  patch?: string;
  actions: Array<{ id: string; label: string }>;
}
export interface PluginUiContext {
  pluginCard(pluginId: string, card: PluginCard, signal?: AbortSignal): Promise<string | null>;
}
