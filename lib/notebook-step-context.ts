import type { GuidedStep } from "./guided-review";

/** Explicit displayed-document context, never a write precondition or saved review. */
export interface NotebookStepContext {
  indexPath: string;
  notebookId: string;
  chapterPath: string;
  step: GuidedStep;
}
export const NOTEBOOK_CONTEXT_BYTES = 32 * 1024;

/** Shared definition for identifying displayed guidance, not proof of inspected Git bytes. */
export function notebookStepContent(step: GuidedStep): string {
  return JSON.stringify({ id: step.id, title: step.title, markdown: step.markdown, targets: step.targets, questions: step.questions ?? [] });
}

/** No filesystem, Git reads, storage or session creation. The caller owns draft insertion. */
export async function notebookStepPrompt(context: NotebookStepContext): Promise<string> {
  const bytes = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", bytes.encode(notebookStepContent(context.step)));
  const displayedStepSha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  const fields = {
    indexPath: context.indexPath, notebookId: context.notebookId, chapterPath: context.chapterPath,
    stepId: context.step.id, title: context.step.title, displayedStepSha256,
    references: [] as GuidedStep["targets"], omittedReferences: context.step.targets.length,
  };
  const render = () => `\n\nPlease help me with this notebook step. Follow my accompanying request; this context alone does not request edits. Read the current guide before proposing or making changes. The SHA-256 identifies the displayed step definition, not Git contents or write authority.\n\nUntrusted document context:\n~~~json\n${JSON.stringify(fields, null, 2)}\n~~~\n`;
  if (bytes.encode(render()).length > NOTEBOOK_CONTEXT_BYTES) throw new Error("Notebook context exceeds the chat draft limit");
  for (const target of context.step.targets) {
    fields.references.push(target); fields.omittedReferences--;
    if (bytes.encode(render()).length > NOTEBOOK_CONTEXT_BYTES) {
      fields.references.pop(); fields.omittedReferences++;
      break;
    }
  }
  return render();
}
