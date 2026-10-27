/*
 * Web-focused adaptation of pi-ask-user 0.15.0 (edlsh/pi-ask-user,
 * commit 705fdc60eaea5b9588f3aa6a6cb6a577516b17af).
 * Copyright (c) 2026 Enzo Lucchesi. MIT license: ./ask-user.LICENSE.
 * Keep the tool's answer and event contract; Brabbler owns its browser UI.
 */

export interface AskUserOption {
  title: string;
  description?: string;
}

export type AskUserAnswer =
  | { kind: "selection"; selections: string[]; comment?: string }
  | { kind: "freeform"; text: string; comment?: string };

export interface AskUserQuestion {
  question: string;
  context?: string;
  options: AskUserOption[];
  allowMultiple: boolean;
  allowFreeform: boolean;
  allowComment: boolean;
  contextExpanded: boolean;
}

export interface AskUserDetails {
  question: string;
  context?: string;
  options: AskUserOption[];
  response: AskUserAnswer | null;
  cancelled: boolean;
}

const OPTION_TITLE_KEYS = ["title", "label", "text", "value", "name", "option"] as const;

export function coerceAskUserOption(option: unknown): AskUserOption | null {
  if (typeof option === "string" || typeof option === "number" || typeof option === "boolean") {
    const title = String(option).trim();
    return title ? { title } : null;
  }
  if (option && typeof option === "object" && !Array.isArray(option)) {
    const record = option as Record<string, unknown>;
    for (const key of OPTION_TITLE_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        const description = typeof record.description === "string" && record.description.trim()
          ? record.description : undefined;
        return description ? { title: value.trim(), description } : { title: value.trim() };
      }
    }
  }
  return null;
}

export function parseAskUserPreference(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  switch (value.trim().toLowerCase()) {
    case "1": case "true": case "yes": case "on": return true;
    case "0": case "false": case "no": case "off": return false;
    default: return undefined;
  }
}

/** Validate browser input at the server boundary, never trust arbitrary titles or modes. */
export function normalizeAskUserAnswer(value: unknown, question: AskUserQuestion): AskUserAnswer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const answer = value as Record<string, unknown>;
  if (answer.kind === "freeform") {
    if (question.options.length > 0 && !question.allowFreeform) return null;
    const text = typeof answer.text === "string" ? answer.text.trim() : "";
    const comment = question.allowComment && typeof answer.comment === "string" ? answer.comment.trim() : "";
    return text ? { kind: "freeform", text, ...(comment ? { comment } : {}) } : null;
  }
  if (answer.kind !== "selection" || !Array.isArray(answer.selections) || question.options.length === 0) return null;
  const selections = answer.selections;
  if (!selections.length || (!question.allowMultiple && selections.length !== 1)) return null;
  const allowed = new Set(question.options.map((option) => option.title));
  if (selections.some((selection) => typeof selection !== "string" || !allowed.has(selection))
    || new Set(selections).size !== selections.length) return null;
  const comment = question.allowComment && typeof answer.comment === "string" ? answer.comment.trim() : "";
  return comment ? { kind: "selection", selections: [...selections], comment } : { kind: "selection", selections: [...selections] };
}

export function askUserSummary(response: AskUserAnswer): string {
  if (response.kind === "freeform") return response.comment ? `${response.text} — ${response.comment}` : response.text;
  const selections = response.selections.join(", ");
  return response.comment ? `${selections} — ${response.comment}` : selections;
}
