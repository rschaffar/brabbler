import { isWriteToolName } from "./tool-names";

/** Adapted from upstream pi-web #1324 (083fd11b): all fields or complete JSON. */
export interface ToolField {
  key: string;
  value: string;
  multiline: boolean;
}

/** Presentation only. Callers must exclude partial input before classifying it. */
export function toolFieldsOfInput(input: unknown): ToolField[] | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const entries = Object.entries(input);
  if (entries.length === 0) return null;
  const fields: ToolField[] = [];
  for (const [key, value] of entries) {
    if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    const text = value === null ? "null" : String(value);
    fields.push({ key, value: text, multiline: /[\r\n]/.test(text) });
  }
  return fields;
}

/** A conservative version of upstream #1024: never hide extra or ambiguous fields. */
export function writtenFileText(toolName: string, input: Record<string, unknown>): string | null {
  if (!isWriteToolName(toolName)) return null;
  const keys = Object.keys(input);
  const pathKey = keys.includes("path") ? "path" : "file_path";
  if (keys.length !== 2 || !keys.includes(pathKey) || !keys.includes("content")) return null;
  if (typeof input[pathKey] !== "string" || input[pathKey] === "") return null;
  return typeof input.content === "string" && input.content !== "" ? input.content : null;
}
