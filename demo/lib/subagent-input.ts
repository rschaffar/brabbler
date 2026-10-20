import { readFileSync, realpathSync, statSync } from "fs";
import { relative, resolve } from "path";
import { isPathWithinRoots } from "./path-security";
import { toSlashPath } from "./paths";

export const MAX_SUBAGENT_INPUT_FILES = 8;
export const MAX_SUBAGENT_INPUT_BYTES = 512 * 1024;

export interface SubagentInputFile {
  path: string;
  content: string;
  /** Original UTF-8 bytes, including a BOM the decoder may remove. */
  byteLength: number;
}

export interface SubagentInputLimits {
  maxBytes?: number;
  model?: string;
}

/** A file-payload allowance, not an exact token count or whole-prompt admission guarantee. */
export function subagentInputLimits(model: { provider: string; id: string; contextWindow?: number } | undefined): SubagentInputLimits {
  const window = model?.contextWindow;
  if (!model || !window || !Number.isFinite(window) || window < 0) return {};
  const maxBytes = Math.min(MAX_SUBAGENT_INPUT_BYTES, Math.floor(window * 4 / 10));
  return { maxBytes, model: `${model.provider}/${model.id}` };
}

function assertInputBytes(bytes: number, limits: SubagentInputLimits): void {
  const maxBytes = limits.maxBytes ?? MAX_SUBAGENT_INPUT_BYTES;
  if (bytes <= maxBytes) return;
  const scope = limits.model ? ` for ${limits.model} (about a tenth of its context window)` : "";
  throw new Error(`Agent input_files exceeds the ${maxBytes}-byte total limit${scope}. Pass fewer or smaller files, or name the paths in prompt if the subagent can read them.`);
}

/** Recheck the already loaded snapshot after trusted child services resolve the final model. */
export function assertSubagentInputBudget(files: readonly SubagentInputFile[], limits: SubagentInputLimits): void {
  assertInputBytes(files.reduce((bytes, file) => bytes + file.byteLength, 0), limits);
}

export function loadSubagentInputFiles(cwd: string, requestedPaths: readonly string[], limits: SubagentInputLimits = {}): SubagentInputFile[] {
  if (requestedPaths.length > MAX_SUBAGENT_INPUT_FILES) {
    throw new Error(`Agent input_files accepts at most ${MAX_SUBAGENT_INPUT_FILES} files`);
  }

  const realCwd = realpathSync(cwd);
  const allowedRoots = new Set([realCwd]);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const seen = new Set<string>();
  const files: SubagentInputFile[] = [];
  let totalBytes = 0;

  for (const requestedPath of requestedPaths) {
    if (!requestedPath.trim()) throw new Error("Agent input_files paths must not be empty");

    let filePath: string;
    try {
      filePath = realpathSync(resolve(cwd, requestedPath));
    } catch {
      throw new Error(`Agent input file does not exist: ${requestedPath}`);
    }
    if (!isPathWithinRoots(filePath, allowedRoots)) {
      throw new Error(`Agent input file is outside the session cwd: ${requestedPath}`);
    }
    if (!statSync(filePath).isFile()) {
      throw new Error(`Agent input path is not a file: ${requestedPath}`);
    }
    if (seen.has(filePath)) continue;
    seen.add(filePath);

    // Reject obvious oversized files before allocating their contents; the second check
    // remains authoritative if a file changes between stat and read.
    assertInputBytes(totalBytes + statSync(filePath).size, limits);
    const buffer = readFileSync(filePath);
    totalBytes += buffer.byteLength;
    assertInputBytes(totalBytes, limits);

    let content: string;
    try {
      content = decoder.decode(buffer);
    } catch {
      throw new Error(`Agent input file is not valid UTF-8 text: ${requestedPath}`);
    }
    files.push({
      path: toSlashPath(relative(realCwd, filePath)),
      content,
      byteLength: buffer.byteLength,
    });
  }

  return files;
}

export function appendSubagentInputFiles(task: string, files: readonly SubagentInputFile[]): string {
  if (files.length === 0) return task;
  const documents = files.map((file) =>
    `<document path=${JSON.stringify(file.path)}>\n${file.content}\n</document>`
  ).join("\n\n");
  return `${task}\n\n<documents>\n${documents}\n</documents>`;
}
