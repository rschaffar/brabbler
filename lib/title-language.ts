import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { isTitleLanguage, type TitleLanguage } from "./title-language-options";

export function getTitleLanguagePath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web", "title-settings.json");
}

export function readTitleLanguage(path = getTitleLanguagePath()): TitleLanguage {
  if (!existsSync(path)) return "auto";
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
      !isTitleLanguage((parsed as { language?: unknown }).language)) {
    throw new Error("Invalid title language settings");
  }
  return (parsed as { language: TitleLanguage }).language;
}

export function writeTitleLanguage(language: TitleLanguage, path = getTitleLanguagePath()): TitleLanguage {
  if (!isTitleLanguage(language)) throw new Error("Invalid title language");
  // Refuse to overwrite a damaged file without surfacing the error first.
  if (existsSync(path)) readTitleLanguage(path);
  mkdirSync(dirname(path), { recursive: true });
  writePrivateFileAtomicSync(path, JSON.stringify({ language }, null, 2));
  return language;
}
