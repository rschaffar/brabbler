import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { isTitleLanguage, type TitleLanguage } from "./title-language-options";

export function getTitleLanguagePath(agentDir = getAgentDir()): string {
  return join(agentDir, "brabbler", "title-settings.json");
}

export interface TitleModelSelection {
  provider: string;
  modelId: string;
}

export function isTitleModelSelection(value: unknown): value is TitleModelSelection {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { provider, modelId } = value as Partial<TitleModelSelection>;
  return typeof provider === "string" && provider.length > 0 && provider.length <= 200 && provider.trim() === provider &&
    typeof modelId === "string" && modelId.length > 0 && modelId.length <= 300 && modelId.trim() === modelId;
}

function readTitleSettings(path: string): { language: TitleLanguage; model: TitleModelSelection | null } {
  if (!existsSync(path)) return { language: "auto", model: null };
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Invalid title settings");
  const { language, model } = parsed as { language?: unknown; model?: unknown };
  if (!isTitleLanguage(language) || (model !== undefined && model !== null && !isTitleModelSelection(model))) {
    throw new Error("Invalid title settings");
  }
  return { language, model: model === undefined ? null : model as TitleModelSelection | null };
}

export function readTitleLanguage(path = getTitleLanguagePath()): TitleLanguage {
  return readTitleSettings(path).language;
}

export function readTitleModel(path = getTitleLanguagePath()): TitleModelSelection | null {
  return readTitleSettings(path).model;
}

function writeTitleSettings(settings: { language: TitleLanguage; model: TitleModelSelection | null }, path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(path, JSON.stringify({ language: settings.language, ...(settings.model ? { model: settings.model } : {}) }, null, 2));
}

export function writeTitleLanguage(language: TitleLanguage, path = getTitleLanguagePath()): TitleLanguage {
  if (!isTitleLanguage(language)) throw new Error("Invalid title language");
  writeTitleSettings({ ...readTitleSettings(path), language }, path);
  return language;
}

export function writeTitleModel(model: TitleModelSelection | null, path = getTitleLanguagePath()): TitleModelSelection | null {
  if (model !== null && !isTitleModelSelection(model)) throw new Error("Invalid title model");
  writeTitleSettings({ ...readTitleSettings(path), model }, path);
  return model;
}
