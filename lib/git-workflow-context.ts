import type { InlineExtension } from "@earendil-works/pi-coding-agent";

const LEGACY_GIT_WORKFLOW_CONTEXT_TYPE = "pi-web:git-workflow-context";

/** Match only our retired synthetic message, never user quotations or flattened summaries. */
export function isGitWorkflowContextMessage(message: unknown): boolean {
  return message !== null && typeof message === "object"
    && "role" in message && message.role === "custom"
    && "customType" in message && message.customType === LEGACY_GIT_WORKFLOW_CONTEXT_TYPE;
}

/** Request-local projection; raw session history and the retained messages stay untouched. */
export function filterGitWorkflowContext<T>(messages: readonly T[]): T[] {
  return messages.filter((message) => !isGitWorkflowContextMessage(message));
}

/** Host-owned compatibility filter for Chat only: no guidance, tools, or resource discovery. */
export function createGitWorkflowContextFilterExtension(): InlineExtension {
  return {
    name: "pi-web-git-workflow-context-filter",
    hidden: true,
    factory: (pi) => {
      pi.on("context", (event) => ({ messages: filterGitWorkflowContext(event.messages) }));
    },
  };
}
