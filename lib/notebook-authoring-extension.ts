import { Type } from "@earendil-works/pi-ai";
import { defineTool, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots } from "./file-access";
import { inspectNotebook, updateNotebookStep } from "./notebook-authoring";
import { filterNotebookTools } from "./notebook-tool-policy";

const filePath = () => Type.String({ minLength: 1, maxLength: 4096, description: "Explicit absolute physical path; does not grant file access" });
const stableId = () => Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$" });
const revision = () => Type.String({ pattern: "^[a-f0-9]{64}$" });
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
      description: "Inspect a guided Markdown notebook's compact outline and validation. Supply a stable stepId to obtain that complete step's source, pinned references and revision binding. Reads only declared index/chapters, not assets, Git or saved review records. Requires active read permission; no browser pane needed.",
      parameters: Type.Object({ indexPath: filePath(), stepId: Type.Optional(stableId()) }, { additionalProperties: false }),
      async execute(_id, params, signal) {
        const check = () => assertGrant("notebook_inspect", false, signal);
        check(); const admitted = await roots(); check();
        return result(inspectNotebook(params.indexPath, admitted, params.stepId));
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
