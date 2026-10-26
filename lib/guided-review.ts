import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Code } from "mdast";
import { isReviewSourcePath, parseReviewBlock, type ReviewBlock } from "./review-notebook";
import { isNotebookAssetPath } from "./guided-review-assets";

/** Declarative identities, never access grants. All counts apply to the complete package. */
export const GUIDED_LIMITS = { documentBytes: 256 * 1024, packageBytes: 2 * 1024 * 1024, chapters: 32, steps: 256, targets: 512 } as const;
export interface NotebookIndex { version: 1; id: string; title: string; chapters: { id: string; title: string; path: string }[] }
export type Evidence = ReviewBlock | { version: 1; id: string; title: string } & (
  { kind: "compare"; cwd: string; branch: string; base: string; candidate: string; path: string } |
  { kind: "file"; path: string } | { kind: "web"; url: string });
export interface GuidedStep { id: string; title: string; markdown: string; targets: Evidence[] }
export interface GuidedChapter { id: string; title: string; path: string; steps: GuidedStep[] }
export interface GuidedNotebook { index: NotebookIndex; chapters: GuidedChapter[] }
const id = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(v);
const title = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 240 && !/[\x00-\x1f]/.test(v);
function object(source: string): Record<string, unknown> {
  if (source.length > 16_384 || new TextEncoder().encode(source).length > 16_384) throw new Error("Metadata exceeds 16,384 bytes");
  const v: unknown = JSON.parse(source);
  // JSON.parse validates grammar but silently overwrites duplicate properties.
  // Walk actual string tokens (including escaped quotes/backslashes); decode key
  // escapes before comparison. Arrays count toward the same bounded nesting depth.
  const scopes: (Set<string> | null)[] = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "{" || char === "[") {
      scopes.push(char === "{" ? new Set() : null);
      if (scopes.length > 32) throw new Error("Metadata exceeds nesting depth 32");
    } else if (char === "}" || char === "]") scopes.pop();
    else if (char === '"') {
      const start = i++;
      for (; i < source.length; i++) {
        if (source[i] === "\\") i++;
        else if (source[i] === '"') break;
      }
      let next = i + 1; while (next < source.length && /\s/.test(source[next])) next++;
      if (source[next] === ":") {
        const key = JSON.parse(source.slice(start, i + 1)) as string, scope = scopes.at(-1)!;
        if (scope!.has(key)) throw new Error("Duplicate metadata property");
        scope!.add(key);
      }
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Expected a JSON object");
  return v as Record<string, unknown>;
}
function fields(v: Record<string, unknown>, keys: string[]) {
  if (Object.keys(v).some(k => !keys.includes(k)) || keys.some(k => !(k in v))) throw new Error("Unknown or missing metadata field");
}
function header(v: Record<string, unknown>) {
  if (v.version !== 1 || !id(v.id) || !title(v.title)) throw new Error("Expected version 1, stable id and short title");
}
function nodes(markdown: string) {
  if (new TextEncoder().encode(markdown).length > GUIDED_LIMITS.documentBytes) throw new Error("Document exceeds 256 KiB");
  return unified().use(remarkParse).parse(markdown).children;
}
function fences(markdown: string, lang: string): Code[] {
  return nodes(markdown).filter((n): n is Code => n.type === "code" && n.lang === lang);
}
export function parseNotebookIndex(markdown: string): NotebookIndex | null {
  const markers = fences(markdown, "pi-notebook");
  if (!markers.length) return null;
  if (markers.length !== 1) throw new Error("Expected exactly one top-level pi-notebook fence");
  const v = object(markers[0].value); fields(v, ["version", "id", "title", "chapters"]); header(v);
  if (!Array.isArray(v.chapters) || !v.chapters.length || v.chapters.length > GUIDED_LIMITS.chapters) throw new Error("Expected 1–32 chapters");
  const ids = new Set<string>(), paths = new Set<string>();
  for (const chapter of v.chapters) {
    if (!chapter || typeof chapter !== "object" || Array.isArray(chapter)) throw new Error("Invalid chapter");
    const c = chapter as Record<string, unknown>; fields(c, ["id", "title", "path"]);
    if (!id(c.id) || !title(c.title) || !isReviewSourcePath(c.path) || !c.path.endsWith(".md") || c.path.toLowerCase() === "index.md") throw new Error("Invalid chapter identity/path (index cycles are forbidden)");
    if (ids.has(c.id) || paths.has(c.path.toLowerCase())) throw new Error("Duplicate chapter id/path");
    ids.add(c.id); paths.add(c.path.toLowerCase());
  }
  return v as unknown as NotebookIndex;
}
export function parseEvidence(source: string): Evidence {
  const v = object(source); header(v);
  if (v.kind === "compare") {
    fields(v, ["version", "id", "title", "kind", "cwd", "branch", "base", "candidate", "path"]);
    // Reuse the unchanged v1 reference validator rather than defining weaker identities.
    const probe = parseReviewBlock(JSON.stringify({ version: 1, id: v.id, title: v.title, kind: "source", cwd: v.cwd, branch: v.branch, oid: v.candidate, path: v.path, start: 1, end: 1 }));
    if (probe.error || typeof v.base !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(v.base)) throw new Error(probe.error ?? "Invalid base commit");
  } else if (v.kind === "file") {
    fields(v, ["version", "id", "title", "kind", "path"]);
    if (!isReviewSourcePath(v.path) || !isNotebookAssetPath(v.path)) throw new Error("File evidence supports local Markdown, text, JSON, CSV/TSV, Mermaid, raster images or PDF only");
  } else if (v.kind === "web") {
    fields(v, ["version", "id", "title", "kind", "url"]);
    if (typeof v.url !== "string" || v.url.length > 4096 || !/^https?:\/\//.test(v.url)) throw new Error("Expected an HTTP(S) link");
    const url = new URL(v.url); if (url.username || url.password) throw new Error("Web links cannot contain credentials");
  } else throw new Error("Unknown evidence kind");
  return v as unknown as Evidence;
}
export function parseNotebookChapter(markdown: string): GuidedStep[] {
  const tree = nodes(markdown), steps: GuidedStep[] = [];
  let step: GuidedStep | undefined, start = 0;
  const ids = new Set<string>();
  for (const node of tree) {
    if (node.type !== "code") continue;
    if (node.lang === "pi-notebook") throw new Error("Nested notebook manifests/cycles are forbidden");
    if (node.lang === "pi-step") {
      if (step) step.markdown = markdown.slice(start, node.position!.start.offset);
      const v = object(node.value); fields(v, ["version", "id", "title"]); header(v);
      if (ids.has(v.id as string)) throw new Error("Duplicate step id"); ids.add(v.id as string);
      step = { id: v.id as string, title: v.title as string, markdown: "", targets: [] }; steps.push(step);
      start = node.position!.end.offset!;
    } else if (node.lang === "pi-review" || node.lang === "pi-evidence") {
      if (!step) throw new Error("Evidence must follow a pi-step boundary");
      object(node.value); // Guided-package ambiguity/depth policy also covers unchanged v1 targets.
      const parsed = node.lang === "pi-review" ? parseReviewBlock(node.value) : { value: parseEvidence(node.value), error: undefined };
      if (parsed.error) throw new Error(parsed.error);
      step.targets.push(parsed.value!);
    }
  }
  if (step) step.markdown = markdown.slice(start);
  if (!steps.length || steps.length > GUIDED_LIMITS.steps) throw new Error("Expected 1–256 steps");
  return steps;
}
export function validateNotebook(notebook: GuidedNotebook): GuidedNotebook {
  const steps = new Set<string>(), targets = new Set<string>();
  for (const chapter of notebook.chapters) for (const step of chapter.steps) {
    if (steps.has(step.id)) throw new Error("Duplicate package step id"); steps.add(step.id);
    for (const target of step.targets) { if (targets.has(target.id)) throw new Error("Duplicate package target id"); targets.add(target.id); }
  }
  if (steps.size > GUIDED_LIMITS.steps || targets.size > GUIDED_LIMITS.targets) throw new Error("Notebook count limit exceeded");
  return notebook;
}
/** Remove only parser-owned top-level evidence, not example fences inside code. */
export function stepProse(markdown: string): string {
  const evidence = fences(markdown, "pi-review").concat(fences(markdown, "pi-evidence")).sort((a, b) => b.position!.start.offset! - a.position!.start.offset!);
  for (const node of evidence) markdown = markdown.slice(0, node.position!.start.offset) + markdown.slice(node.position!.end.offset);
  return markdown;
}
