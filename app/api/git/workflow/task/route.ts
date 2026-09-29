import { NextResponse } from "next/server";
import { cancelGitTaskBindingPreview, confirmGitTaskBinding, getGitTaskBinding, previewGitTaskBinding, releaseGitTaskBinding } from "@/lib/git-workflow-binding";
import { GitTaskBindingError } from "@/lib/git-workflow-binding-io";
import { GitRuleSourceTargetsRequired, validateSourceTargets } from "@/lib/git-workflow-rule-sources";
import { GIT_BINDING_LIMITS } from "@/lib/git-workflow-binding-types";

export const dynamic = "force-dynamic";
function sessionId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new GitTaskBindingError("A persisted sessionId is required.", 400);
  return value;
}
function fields(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw new GitTaskBindingError("Unexpected task review fields.", 400);
}
function text(value: unknown, max = 4096): string {
  if (typeof value !== "string" || !value || value.includes("\0") || Buffer.byteLength(value) > max) throw new GitTaskBindingError("Invalid task review field.", 400);
  return value;
}
function failure(cause: unknown) {
  return NextResponse.json({ error: cause instanceof GitTaskBindingError ? cause.message : "Task binding could not be inspected or recorded. Reload status before taking another action.",
    ...(cause instanceof GitRuleSourceTargetsRequired ? { sourceTargets: cause.targets } : {}) },
  { status: cause instanceof GitTaskBindingError ? cause.status : 409 });
}
async function body(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-type")?.startsWith("application/json")) throw new GitTaskBindingError("A JSON request is required.", 400);
  const reader = req.body?.getReader();
  if (!reader) throw new GitTaskBindingError("A JSON request is required.", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256 * 1024) { await reader.cancel(); throw new GitTaskBindingError("Task review request too large.", 413); }
      chunks.push(value);
    }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object");
    return value as Record<string, unknown>;
  } catch (cause) { if (cause instanceof GitTaskBindingError) throw cause; throw new GitTaskBindingError("Invalid JSON task review request.", 400); }
  finally { reader.releaseLock(); }
}
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    if ([...params].length !== 1 || !params.has("sessionId")) throw new GitTaskBindingError("Use only sessionId to inspect a task binding.", 400);
    return NextResponse.json(await getGitTaskBinding(sessionId(params.get("sessionId"))));
  } catch (cause) { return failure(cause); }
}
export async function POST(req: Request) {
  try {
    const input = await body(req), id = sessionId(input.sessionId);
    if (input.operation === "preview") {
      fields(input, ["operation", "sessionId", "revision", "settingsRevision", "workspaceBranch", "requestEntryId", "goal", "dependencies", "targets"]);
      if (!Array.isArray(input.dependencies) || input.dependencies.length > GIT_BINDING_LIMITS.dependencies) throw new GitTaskBindingError("Invalid source dependency list.", 400);
      return NextResponse.json(await previewGitTaskBinding({ sessionId: id, revision: text(input.revision), settingsRevision: text(input.settingsRevision),
        workspaceBranch: text(input.workspaceBranch, 255), requestEntryId: text(input.requestEntryId, 128), goal: text(input.goal, GIT_BINDING_LIMITS.goal),
        dependencies: input.dependencies.map((value) => text(value)), targets: validateSourceTargets(input.targets) }));
    }
    if (input.operation === "adopt" || input.operation === "cancel") {
      fields(input, ["operation", "sessionId", "previewId"]);
      const previewId = text(input.previewId, 36);
      if (input.operation === "adopt") return NextResponse.json(await confirmGitTaskBinding(id, previewId));
      cancelGitTaskBindingPreview(id, previewId);
      return NextResponse.json({ cancelled: true });
    }
    if (input.operation === "release") {
      fields(input, ["operation", "sessionId", "revision"]);
      return NextResponse.json(await releaseGitTaskBinding(id, text(input.revision)));
    }
    throw new GitTaskBindingError("Unsupported task review operation.", 400);
  } catch (cause) { return failure(cause); }
}
