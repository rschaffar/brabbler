import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Code } from "mdast";
import { isReviewSourcePath, parseReviewBlock, type ReviewBlock } from "./review-notebook";
import { isNotebookAssetPath } from "./guided-review-assets";
import { parseQuestionSet, type SetQuestion } from "./question-set";
export interface NotebookQuestion extends SetQuestion { explanation?: string }

/** Declarative identities, never access grants. All counts apply to the complete package. */
export const GUIDED_LIMITS = { documentBytes: 256 * 1024, packageBytes: 2 * 1024 * 1024, chapters: 32, steps: 256, targets: 512 } as const;
export interface NotebookIndex { version: 1; id: string; title: string; chapters: { id: string; title: string; path: string }[] }
export type Evidence = ReviewBlock | { version: 1; id: string; title: string } & (
  { kind: "compare"; cwd: string; branch: string; base: string; candidate: string; path: string } |
  { kind: "file"; path: string } | { kind: "web"; url: string });
export interface GuidedStep { id: string; title: string; markdown: string; targets: Evidence[]; questions?: NotebookQuestion[] }
export interface GuidedChapter { id: string; title: string; path: string; steps: GuidedStep[] }
export interface GuidedNotebook { index: NotebookIndex; chapters: GuidedChapter[] }
const id = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(v);
const title = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 240 && !/[\x00-\x1f]/.test(v);
export function strictJsonObject(source: string, maximum = 16_384): Record<string, unknown> {
  if (source.length > maximum || new TextEncoder().encode(source).length > maximum) throw new Error(maximum === 16_384 ? "Metadata exceeds 16,384 bytes" : `JSON exceeds ${maximum} bytes`);
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
const object = strictJsonObject;
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
  const markers = fences(markdown, "brabbler-notebook");
  if (!markers.length) return null;
  if (markers.length !== 1) throw new Error("Expected exactly one top-level brabbler-notebook fence");
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
    if (node.lang === "brabbler-notebook") throw new Error("Nested notebook manifests/cycles are forbidden");
    if (node.lang === "brabbler-step") {
      if (step) step.markdown = markdown.slice(start, node.position!.start.offset);
      const v = object(node.value); fields(v, ["version", "id", "title"]); header(v);
      if (ids.has(v.id as string)) throw new Error("Duplicate step id"); ids.add(v.id as string);
      step = { id: v.id as string, title: v.title as string, markdown: "", targets: [] }; steps.push(step);
      start = node.position!.end.offset!;
    } else if (node.lang === "brabbler-question") {
      if (!step) throw new Error("Questions must follow a brabbler-step boundary");
      const v = object(node.value);
      const allowed = ["version", "id", "shortLabel", "question", "context", "type", "required", "options", "explanation"];
      if (Object.keys(v).some(k => !allowed.includes(k)) || v.version !== 1) throw new Error("Invalid question fields/version");
      if (v.explanation !== undefined && (typeof v.explanation !== "string" || v.explanation.length > 8000)) throw new Error("Invalid author explanation");
      if (Array.isArray(v.options) && v.options.some(o => !o || typeof o !== "object" || Object.keys(o).some(k => !["id", "title", "description", "recommended", "exclusive"].includes(k)))) throw new Error("Invalid option fields");
      const parsed = parseQuestionSet({ title: "Notebook", questions: [v] });
      if (!parsed) throw new Error("Invalid authored question");
      const questions = step.questions ??= [];
      if (questions.length >= 6 || questions.some(q => q.id === v.id)) throw new Error("Duplicate question id or more than six questions per step");
      questions.push({ ...parsed.questions[0], ...(v.explanation !== undefined ? { explanation: v.explanation as string } : {}) });
    } else if (node.lang === "brabbler-review" || node.lang === "brabbler-evidence") {
      if (!step) throw new Error("Evidence must follow a brabbler-step boundary");
      object(node.value); // Guided-package ambiguity/depth policy also covers unchanged v1 targets.
      const parsed = node.lang === "brabbler-review" ? parseReviewBlock(node.value) : { value: parseEvidence(node.value), error: undefined };
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
  const evidence = fences(markdown, "brabbler-review").concat(fences(markdown, "brabbler-evidence"), fences(markdown, "brabbler-question")).sort((a, b) => b.position!.start.offset! - a.position!.start.offset!);
  for (const node of evidence) markdown = markdown.slice(0, node.position!.start.offset) + markdown.slice(node.position!.end.offset);
  return markdown;
}
