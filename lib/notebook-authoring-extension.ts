import { Type } from "typebox";
import { defineTool, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots } from "./file-access";
import { inspectNotebook, updateNotebookStep } from "./notebook-authoring";
import { filterNotebookTools } from "./notebook-tool-policy";
import { analyzeNotebookReferences, applyNotebookReferences } from "./notebook-reference-refresh";

type RefreshResult = Awaited<ReturnType<typeof analyzeNotebookReferences>> | Awaited<ReturnType<typeof applyNotebookReferences>>;
const filePath = () => Type.String({ minLength: 1, maxLength: 4096, description: "Explicit absolute physical path; does not grant file access" });
const stableId = () => Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$" });
const revision = () => Type.String({ pattern: "^[a-f0-9]{64}$" });
const pageFields = { offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 512 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })) };
const referenceBindingSchema = Type.Object({ version: Type.Literal(1), digest: revision() }, { additionalProperties: false });
export const notebookBindingSchema = Type.Object({
  indexPath: filePath(), notebookId: stableId(), manifestRevision: revision(),
  chapterPath: filePath(), chapterRevision: revision(), stepId: stableId(),
}, { additionalProperties: false });
const result = <T>(value: T) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value });

/** Trusted host roots only. Authored paths, saved results and transcript links
 * never add roots. Kept injectable for real offline SDK/native-file fixtures. */
export function createNotebookAuthoringExtension(roots: () => Promise<Set<string>> = getAllowedFileRoots): InlineExtension {
  return { name: "brabbler-notebook-authoring", hidden: true, factory(pi) {
    let retired = false;
    const assertGrant = (name: string, edit: boolean, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      const active = new Set(pi.getActiveTools());
      if (retired || !active.has(name) || !active.has("read") || edit && !active.has("edit")) throw new Error("Notebook operation is not permitted by the current tool grants");
    };
    const prune = () => {
      const active = pi.getActiveTools(), permitted = filterNotebookTools(active);
      if (active.length !== permitted.length) pi.setActiveTools(permitted);
    };
    pi.on("session_start", prune);
    pi.on("before_agent_start", prune);
    pi.on("session_shutdown", () => { retired = true; });
    pi.registerTool(defineTool({
      name: "notebook_inspect", label: "Inspect notebook", exposure: "direct", annotations: { readOnlyHint: true },
      description: "Inspect a guided Markdown notebook's outline, or supply inventory for target definitions in 1–32-item/48-KiB complete-response pages (continue with its revision). Supply stepId instead for complete step source and edit binding. Reads only declared index/chapters, not assets, Git or saved records. Requires read; paths grant no access.",
      parameters: Type.Object({ indexPath: filePath(), stepId: Type.Optional(stableId()), inventory: Type.Optional(Type.Object({ ...pageFields, revision: Type.Optional(revision()) }, { additionalProperties: false })) }, { additionalProperties: false }),
      async execute(_id, params, signal) {
        const check = () => assertGrant("notebook_inspect", false, signal);
        if (params.stepId !== undefined && params.inventory !== undefined) throw new Error("Choose a step or inventory, not both");
        check(); const admitted = await roots(); check();
        return result(inspectNotebook(params.indexPath, admitted, params.stepId, params.inventory));
      },
    }));
    pi.registerTool(defineTool({
      name: "notebook_refresh_references", label: "Refresh notebook references", exposure: "direct", executionMode: "sequential",
      description: "Analyze explicit checkout-scoped one-to-one full-OID maps for named targets or targetIds:'mapped' (discover only mapped Git targets in that checkout). Optional source destinations explicitly override path/range; no rename/correspondence guessing. Analyzes the whole selection (max 512) under unchanged Git budgets; returns summary, full-selection binding and 1–32-item/48-KiB complete-response report pages. Continue with report.binding; detail:'full' shows proposals/source previews, filter:'attention' shows exceptions. Apply explicit acceptedTargets with the same mappings/binding after prose review; report is analyze-only. Read required; apply also needs edit and fresh package/repository/evidence validation. Partial saves stop without rollback/replay. No Git mutations/tests; historical claims remain pinned.",
      parameters: Type.Object({
        mode: Type.Union([Type.Literal("analyze"), Type.Literal("apply")]), indexPath: filePath(),
        mappings: Type.Array(Type.Object({ cwd: filePath(), targetIds: Type.Union([Type.Array(stableId(), { minItems: 1, maxItems: 512 }), Type.Literal("mapped")]),
          pairs: Type.Array(Type.Object({ oldOid: Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }), newOid: Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }) }, { additionalProperties: false }), { minItems: 1, maxItems: 64 }),
          destinations: Type.Optional(Type.Array(Type.Object({ targetId: stableId(), path: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })), start: Type.Optional(Type.Integer({ minimum: 1 })), end: Type.Optional(Type.Integer({ minimum: 1 })) }, { additionalProperties: false }), { minItems: 1, maxItems: 512 })),
        }, { additionalProperties: false }), { minItems: 1, maxItems: 8 }),
        report: Type.Optional(Type.Object({ ...pageFields, filter: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("attention")])), detail: Type.Optional(Type.Union([Type.Literal("compact"), Type.Literal("full")])), binding: Type.Optional(referenceBindingSchema) }, { additionalProperties: false })),
        binding: Type.Optional(referenceBindingSchema),
        acceptedTargets: Type.Optional(Type.Array(stableId(), { minItems: 1, maxItems: 512 })),
      }, { additionalProperties: false }),
      async execute(_id, params, signal) {
        const apply = params.mode === "apply";
        if (params.mode !== "analyze" && !apply) throw new Error("Unknown reference refresh mode");
        if (apply ? !params.binding || !params.acceptedTargets || params.report !== undefined : params.binding !== undefined || params.acceptedTargets !== undefined) throw new Error("Analyze takes mappings/report only; apply requires binding and explicit accepted targets, without report");
        const read = () => assertGrant("notebook_refresh_references", false, signal);
        const write = () => assertGrant("notebook_refresh_references", true, signal);
        const check = apply ? write : read;
        check(); const admitted = await roots(); check();
        const access = { roots: admitted, assertRead: read, assertWrite: write, signal };
        if (!apply) return result<RefreshResult>(await analyzeNotebookReferences(params.indexPath, params.mappings, access, params.report));
        const applied = await applyNotebookReferences(params.indexPath, params.mappings, params.binding!, params.acceptedTargets!, access);
        return { ...result<RefreshResult>(applied), ...(applied.status === "applied" ? {} : { isError: true }) };
      },
    }));
    pi.registerTool(defineTool({
      name: "notebook_update_step", label: "Update notebook step", exposure: "direct", executionMode: "sequential",
      description: "Replace one inspected notebook step with complete Markdown, starting with its original brabbler-step ID and retaining a separator before its neighbor. Pass the exact binding from notebook_inspect. Refuses changed manifest/chapter, malformed fences or changed neighbors; preserves outside-step bytes. Requires active read AND edit, never commits or edits saved reviewer records. Reread after uncertain results before retrying.",
      parameters: Type.Object({ indexPath: filePath(), stepId: stableId(), binding: notebookBindingSchema, source: Type.String({ maxLength: 262144 }) }, { additionalProperties: false }),
      async execute(_id, params, signal) {
        const check = () => assertGrant("notebook_update_step", true, signal);
        check(); const admitted = await roots(); check();
        return result(updateNotebookStep(params.indexPath, params.stepId, params.binding, params.source, { roots: admitted, assertWrite: check }));
      },
    }));
  } };
}
