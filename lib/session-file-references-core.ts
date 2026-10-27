import type { SessionEntry } from "./types";
import { extractApplyPatchPaths, getApplyPatchInputText } from "./apply-patch";
import { samePath } from "./paths";

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionId(sessionId: string | null): sessionId is string {
  return !!sessionId && SESSION_ID_RE.test(sessionId);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function isPathChar(ch: string): boolean {
  return /[A-Za-z0-9._~+%@/\\:-]/.test(ch);
}

function hasReferenceBoundaryAfter(text: string, index: number): boolean {
  if (index >= text.length) return true;
  const ch = text[index];
  if (ch === ":") return /\d/.test(text[index + 1] ?? "");
  return !isPathChar(ch);
}

function containsExactPathReference(text: string, filePath: string): boolean {
  const target = normalizeSlashes(filePath);
  const targets = target.startsWith("/") ? [target, `file://${target}`] : [target];
  const haystacks = new Set([normalizeSlashes(text), normalizeSlashes(safeDecode(text))]);

  for (const haystack of haystacks) {
    for (const t of targets) {
      let index = haystack.indexOf(t);
      while (index !== -1) {
        const before = index === 0 ? "" : haystack[index - 1];
        const afterIndex = index + t.length;
        if ((index === 0 || !isPathChar(before)) && hasReferenceBoundaryAfter(haystack, afterIndex)) {
          return true;
        }
        index = haystack.indexOf(t, index + 1);
      }
    }
  }

  return false;
}

const CODING_TOOLS = new Set(["read", "bash", "powershell", "edit", "write", "grep", "find", "ls", "apply_patch"]);
const SUBAGENT_TOOLS = new Set(["Agent", "get_subagent_result", "steer_subagent"]);

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key] : undefined;
}

// Exact aliases only. UI tool-name heuristics deliberately recognize arbitrary
// MCP prefixes/suffixes and must never decide file-read authority.
function pathReportingTool(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.startsWith("functions.") ? value.slice("functions.".length) : value;
  return CODING_TOOLS.has(name) || SUBAGENT_TOOLS.has(name) ? name : null;
}

function collectText(content: unknown, out: string[]): void {
  if (typeof content === "string") out.push(content);
  else if (Array.isArray(content)) {
    for (const block of content) {
      if (field(block, "type") === "text" && typeof field(block, "text") === "string") out.push(field(block, "text") as string);
    }
  }
}

interface FileReferences { text: string[]; paths: string[] }

function collectCodingArguments(name: string | null, args: unknown, references: FileReferences): void {
  if (!name) return;
  if (name === "apply_patch") {
    const patch = getApplyPatchInputText(args, typeof args === "string" ? args : undefined);
    references.paths.push(...extractApplyPatchPaths(patch));
    for (const match of patch.matchAll(/^\*\*\* Move to: (.+)$/gm)) references.paths.push(match[1].trim());
  } else if (name === "bash" || name === "powershell") {
    const command = field(args, "command");
    if (typeof command === "string") references.text.push(command);
  } else if (name === "Agent") {
    const files = field(args, "input_files");
    if (Array.isArray(files)) for (const file of files) if (typeof file === "string") references.paths.push(file);
  } else if (CODING_TOOLS.has(name)) {
    for (const key of ["path", "file_path"]) {
      const path = field(args, key);
      if (typeof path === "string") references.paths.push(path);
    }
  }
}

function callName(call: unknown): string | null {
  const raw = field(call, "name"), normalized = field(call, "toolName");
  if (raw !== undefined && normalized !== undefined && pathReportingTool(raw) !== pathReportingTool(normalized)) return null;
  return pathReportingTool(raw ?? normalized);
}

function collectAssistantContent(content: unknown, references: FileReferences): void {
  collectText(content, references.text);
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (field(block, "type") === "toolCall") collectCodingArguments(callName(block), field(block, "arguments") ?? field(block, "input"), references);
  }
}

function resultTool(entry: SessionEntry, byId: Map<string, SessionEntry>): string | null {
  const message = field(entry, "message"), declared = field(message, "toolName");
  const claimed = pathReportingTool(declared);
  if (declared !== undefined && !claimed) return null;
  const id = field(message, "toolCallId");
  let parent = entry.parentId;
  const visited = new Set<string>();
  // Legacy unnamed results may borrow identity only from their own ancestors,
  // never from a same-ID call on a sibling branch.
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    const ancestor = byId.get(parent);
    if (!ancestor) break;
    if (ancestor.type === "message" && ancestor.message.role === "assistant" && Array.isArray(ancestor.message.content)) {
      for (const call of ancestor.message.content) {
        if (field(call, "type") !== "toolCall" || (field(call, "id") ?? field(call, "toolCallId")) !== id) continue;
        const name = callName(call);
        return claimed && claimed !== name ? null : name;
      }
    }
    parent = ancestor.parentId;
  }
  return claimed;
}

function collectNestedCodingArguments(message: unknown, references: FileReferences): void {
  // SDK 1.3 NestedToolCalls records arguments, not remote result content.
  const calls = field(field(message, "nestedCalls"), "calls");
  if (!Array.isArray(calls)) return;
  for (const call of calls) {
    const name = pathReportingTool(field(call, "name"));
    if (name && CODING_TOOLS.has(name)) collectCodingArguments(name, field(call, "arguments"), references);
  }
}

function collectSubagentNotification(entry: unknown, out: string[]): void {
  if (field(entry, "customType") !== "brabbler:subagent-notification" || field(entry, "display") !== true) return;
  const details = field(entry, "details");
  const sessionId = field(details, "sessionId");
  if (field(details, "kind") !== "brabbler-subagent" || typeof sessionId !== "string" || !isValidSessionId(sessionId)
    || typeof field(details, "profile") !== "string" || field(details, "runInBackground") !== true
    || !["completed", "failed", "aborted", "interrupted"].includes(String(field(details, "status")))) return;
  collectText(field(entry, "content"), out);
}

export function isFilePathReferencedByEntries(filePath: string, entries: SessionEntry[]): boolean {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of entries) {
    const references: FileReferences = { text: [], paths: [] };
    const strings = references.text;
    if (entry.type === "custom_message") collectSubagentNotification(entry, strings);
    if (entry.type === "message") {
      const message = entry.message;
      if (message.role === "user") collectText(message.content, strings);
      else if (message.role === "assistant") collectAssistantContent(message.content, references);
      else if (message.role === "bashExecution") {
        strings.push(message.command, message.output);
        if (typeof message.fullOutputPath === "string") references.paths.push(message.fullOutputPath);
      } else if (message.role === "toolResult") {
        const name = resultTool(entry, byId);
        if (name) collectText(message.content, strings);
        // This exact field is part of SDK BashToolDetails; arbitrary tool details
        // and receipt fields are not authority, even if named fullOutputPath.
        const output = field(message.details, "fullOutputPath");
        if ((name === "bash" || name === "powershell") && typeof output === "string") references.paths.push(output);
        collectNestedCodingArguments(message, references);
      } else if (message.role === "custom") collectSubagentNotification(message, strings);
    }
    // Literal filenames are not Markdown/URLs: never decode them or strip a
    // fragment/source location to accidentally authorize a different file.
    if (references.paths.some((path) => samePath(path, filePath))
      || strings.some((text) => containsExactPathReference(text, filePath))) return true;
  }
  return false;
}

export function isBashOutputPathReferencedByEntries(filePath: string, entries: SessionEntry[]): boolean {
  return entries.some((entry) => (
    entry.type === "message"
    && entry.message.role === "bashExecution"
    && entry.message.fullOutputPath === filePath
  ));
}
