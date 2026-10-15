import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export const LOCAL_FILE_LINK_GUIDELINES = [
  "In Pi Web chat, prefer Markdown links with absolute filesystem destinations for local files, especially across repositories or worktrees: [file](/absolute/path/file.ts#L36). Never prepend Pi Web's hostname or origin to a filesystem path.",
  "Relative chat file links resolve against the session working directory and cannot escape it with ../. Markdown-preview links resolve from the document directory but must remain within the session's relative-link root. Use absolute filesystem paths for files outside that root; file-access permissions still apply.",
  "For local source links, use known one-based line coordinates such as #L36 or #L36-L48, not invented symbol or heading anchors. Filesystem existence checks alone do not prove that a link opens in Pi Web; distinguish source checks from actual browser verification.",
] as const;

/** Host guidance augments SDK rules; it never replaces a user/profile system prompt. */
export function createLocalFileLinkGuidanceExtension(): InlineExtension {
  return {
    name: "pi-web-local-file-link-guidance",
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", (event) => {
        const guidelines = event.systemPromptOptions.promptGuidelines;
        for (const rule of LOCAL_FILE_LINK_GUIDELINES) {
          if (!guidelines.includes(rule)) guidelines.push(rule);
        }
      });
    },
  };
}
