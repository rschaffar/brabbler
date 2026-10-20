import type { AgentMessage, AssistantContentBlock, AssistantMessage, ThinkingContent, ToolCallContent } from "./types";

interface DisplayOptions {
  isStreaming?: boolean;
}

export function getThinkingPreview(thinking: string): string {
  return thinking.trimStart().match(/^[^\r\n]{0,240}/u)?.[0].trimEnd() ?? "";
}

export const THINKING_PIECE_CHARS = 8_000;
export interface ThinkingPiece { text: string; lineBreak: boolean }

/** Bounded searches/hard cuts; cuts depend only on their preceding text. */
export function splitThinkingPieces(thinking: string): ThinkingPiece[] {
  const pieces: ThinkingPiece[] = [];
  let start = 0;
  while (thinking.length - start > THINKING_PIECE_CHARS) {
    const from = start + THINKING_PIECE_CHARS;
    const hardCut = from + THINKING_PIECE_CHARS;
    const window = thinking.slice(from, hardCut + 1);
    let found = window.indexOf("\n");
    // A block boundary must not swallow an empty line.
    while (found >= 0 && /\n\r?$/.test(thinking.slice(from + found - 2, from + found))) {
      found = window.indexOf("\n", found + 1);
    }
    if (found >= 0) {
      const lineBreak = from + found;
      if (lineBreak === thinking.length - 1) break;
      pieces.push({ text: thinking.slice(start, lineBreak), lineBreak: true });
      start = lineBreak + 1;
    } else if (thinking.length > hardCut) {
      const last = thinking.charCodeAt(hardCut - 1);
      const cut = last >= 0xd800 && last <= 0xdbff ? hardCut - 1 : hardCut;
      pieces.push({ text: thinking.slice(start, cut), lineBreak: false });
      start = cut;
    } else break;
  }
  pieces.push({ text: thinking.slice(start), lineBreak: false });
  return pieces;
}

export function isMessageGroupAnchor(message: { role?: AgentMessage["role"]; customType?: string }): boolean {
  // Durable receipts and subagent completions must remain independently visible,
  // not disappear inside a turn's collapsed process details.
  return message.role === "user"
    || (message.role === "custom" && (
      message.customType === "compaction"
      || message.customType === "pi-web:interaction-receipt"
      || message.customType === "pi-web:operation-receipt"
      || message.customType === "pi-web:subagent-notification"
    ));
}

export function isEmptyThinkingBlock(block: AssistantContentBlock, options: DisplayOptions = {}): block is ThinkingContent {
  return block.type === "thinking" && !block.deferred && !options.isStreaming && block.thinking.trim() === "";
}

export function getDisplayableAssistantBlocks(
  message: AssistantMessage,
  options: DisplayOptions = {},
): AssistantContentBlock[] {
  return (message.content ?? []).filter((block) => !isEmptyThinkingBlock(block, options));
}

export function getAssistantErrorMessage(
  message: AssistantMessage,
  options: DisplayOptions = {},
): string | null {
  if (options.isStreaming || message.stopReason !== "error") return null;
  return message.errorMessage?.trim() || "Unknown provider error";
}

/**
 * A turn that ended on `stopReason: "length"` spent its whole output budget
 * (often on reasoning alone) and produced no final answer; without a notice it
 * looks like a hung session. The copy lives in i18n (`chat.truncatedByOutputLimit`).
 */
export function isAssistantTruncated(
  message: AssistantMessage,
  options: DisplayOptions = {},
): boolean {
  return !options.isStreaming && message.stopReason === "length";
}

function isFinalAnswerBlock(block: AssistantContentBlock): boolean {
  return block.type === "text" || block.type === "image";
}

export function splitFinalAssistantBlocks(
  message: AssistantMessage,
  options: DisplayOptions = {},
): { answerBlocks: AssistantContentBlock[]; processBlocks: AssistantContentBlock[] } {
  const blocks = getDisplayableAssistantBlocks(message, options);
  const lastProcessIndex = blocks.findLastIndex((block) => !isFinalAnswerBlock(block));
  if (lastProcessIndex === -1) {
    return { answerBlocks: blocks, processBlocks: [] };
  }
  return {
    answerBlocks: blocks.slice(lastProcessIndex + 1),
    processBlocks: blocks.slice(0, lastProcessIndex + 1),
  };
}

export function countToolCallBlocks(blocks: AssistantContentBlock[]): number {
  return blocks.filter((block): block is ToolCallContent => block.type === "toolCall").length;
}
