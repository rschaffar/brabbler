/*
 * Web-focused adaptation of pi-ask-user 0.15.0 (edlsh/pi-ask-user).
 * Copyright (c) 2026 Enzo Lucchesi. MIT license: ./ask-user.LICENSE.
 */
import { Type } from "@earendil-works/pi-ai";
import { type InlineExtension, type LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import {
  askUserSummary, coerceAskUserOption, normalizeAskUserAnswer, parseAskUserPreference,
  type AskUserAnswer, type AskUserDetails, type AskUserQuestion,
} from "./ask-user";

import { normalizeSetAnswers, parseQuestionSet, questionSetSummary, type QuestionSet, type SetAnswer } from "./question-set";

const setQuestionSchema = Type.Object({
  id: Type.String({ description: "Stable unique question ID", pattern: "^[a-zA-Z0-9_-]{1,64}$" }),
  shortLabel: Type.String({ minLength: 1, maxLength: 60, description: "Short navigation label" }),
  question: Type.String({ minLength: 1, maxLength: 2000 }),
  context: Type.Optional(Type.String({ maxLength: 8000 })),
  type: Type.Unsafe<"single" | "multiple" | "text">({ type: "string", enum: ["single", "multiple", "text"] }),
  required: Type.Optional(Type.Boolean({ description: "Default true. Optional questions may be explicitly skipped." })),
  options: Type.Optional(Type.Array(Type.Object({
    id: Type.String({ pattern: "^[a-zA-Z0-9_-]{1,64}$" }),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    recommended: Type.Optional(Type.Boolean()),
    exclusive: Type.Optional(Type.Boolean({ description: "Cannot be selected with another option, e.g. None" })),
  }), { maxItems: 12, description: "Required for choice questions; omit for text. Every question also allows an alternative written answer and additive details." })),
});

export const HOST_ASK_USER_EXTENSION_NAME = "pi-web-ask-user";
const HOST_PATH = `<inline:${HOST_ASK_USER_EXTENSION_NAME}>`;

/** Only the per-session Pi Web UI context supplies this method. */
export interface AskUserUiContext {
  askUser(question: AskUserQuestion, timeout?: number, signal?: AbortSignal): Promise<AskUserAnswer | null>;
  askUserBatch(set: QuestionSet, timeout?: number, signal?: AbortSignal): Promise<SetAnswer[] | null>;
}

export function createAskUserExtension(): InlineExtension {
  return {
    name: HOST_ASK_USER_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.registerTool({
        name: "ask_user",
        label: "Ask User",
        description: "Ask the user a question, or a small set of related independent questions answered together. Use either question (legacy single) or title and questions (1–6 mixed single/multiple/text questions), never both. Users can revise all answers before submitting the set. Every batch question supports an alternative written answer and separate additive details. Gather context first and include a short summary.",
        promptSnippet: "Ask one question or a small set of related independent questions, with editable drafts and one submission",
        promptGuidelines: [
          "Before calling ask_user, gather context with tools (read/web/ref) and pass a short summary via the context field.",
          "Use ask_user when the user's intent is ambiguous, when a decision requires explicit user input, or when multiple valid options exist.",
          "Batch 2–4 related independent decisions in questions (maximum 6); use stable question and option IDs and concise shortLabel values.",
          "Keep each question focused. Do not bundle unrelated decisions or questions that depend on an earlier answer; ask dependent follow-ups after receiving the set.",
          "Use question for a single legacy question OR title and questions for a set, never both. Batch questions always offer alternative text plus additive details; do not add separate questions just to collect comments.",
        ],
        executionMode: "sequential",
        parameters: Type.Object({
          question: Type.Optional(Type.String({ description: "Single question; mutually exclusive with questions" })),
          title: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: "Required for a question set" })),
          questions: Type.Optional(Type.Array(setQuestionSchema, { minItems: 1, maxItems: 6, description: "Related independent questions submitted together; do not combine with legacy single-question fields" })),
          context: Type.Optional(Type.String({ description: "Relevant context to show before the question (summary of findings)" })),
          options: Type.Optional(Type.Array(Type.Object({
            title: Type.String({ description: "Short title for this option" }),
            description: Type.Optional(Type.String({ description: "Longer description explaining this option" })),
          }), { description: "List of options for the user to choose from" })),
          allowMultiple: Type.Optional(Type.Boolean({ description: "Allow selecting multiple options. Default: false" })),
          allowFreeform: Type.Optional(Type.Boolean({ description: "Add a freeform text option. Default: true" })),
          allowComment: Type.Optional(Type.Boolean({ description: "Collect additional details alongside choices or a written answer. Default: PI_ASK_USER_ALLOW_COMMENT env var if set, otherwise true." })),
          displayMode: Type.Optional(Type.Unsafe<"overlay" | "inline">({ type: "string", enum: ["overlay", "inline"], description: "UI rendering mode. Pi Web presents a browser form regardless of terminal layout." })),
          singleSelectLayout: Type.Optional(Type.Unsafe<"auto" | "list">({ type: "string", enum: ["auto", "list"], description: "Terminal single-select layout; ignored by Pi Web." })),
          contextExpanded: Type.Optional(Type.Boolean({ description: "Start with oversized context expanded. Default: PI_ASK_USER_CONTEXT_EXPANDED env var if set, otherwise true." })),
          overlayToggleKey: Type.Optional(Type.String({ description: "Terminal overlay shortcut; ignored by Pi Web." })),
          commentToggleKey: Type.Optional(Type.String({ description: "Terminal comment shortcut; ignored by Pi Web." })),
          timeout: Type.Optional(Type.Number({ description: "Auto-dismiss after N milliseconds. Returns null (cancelled) when expired." })),
        }),
        async execute(_toolCallId, params, signal, onUpdate, ctx) {
          if (params.questions !== undefined) {
            if ([params.question, params.options, params.allowMultiple, params.allowFreeform, params.allowComment].some((v) => v !== undefined)) {
              throw new Error("Use either question with legacy fields or title and questions, never both.");
            }
            const set = parseQuestionSet(params);
            if (!set) throw new Error("Invalid question set: provide a title, 1–6 questions with unique IDs, shortLabel and type, and unique option IDs for choice questions.");
            const ui = ctx.ui as typeof ctx.ui & Partial<AskUserUiContext>;
            const details = (answers: SetAnswer[] | null) => ({ ...set, answers, cancelled: answers === null });
            if (!ctx.hasUI || !ui.askUserBatch) return {
              content: [{ type: "text" as const, text: `Questions require interactive mode:\n${set.questions.map((q) => q.question).join("\n")}` }],
              isError: true, details: details(null),
            };
            if (signal?.aborted) return { content: [{ type: "text" as const, text: "Cancelled" }], details: details(null) };
            pi.events.emit("herdr:blocked", { active: true, label: "Waiting for user response" });
            let answers: SetAnswer[] | null;
            try {
              const timeout = typeof params.timeout === "number" && Number.isFinite(params.timeout) && params.timeout > 0
                ? Math.min(params.timeout, 2_147_483_647) : undefined;
              answers = normalizeSetAnswers(await ui.askUserBatch(set, timeout, signal), set);
            } finally {
              pi.events.emit("herdr:blocked", { active: false });
            }
            const emitFull = parseAskUserPreference(process.env.PI_ASK_USER_EMIT_FULL_EVENTS) ?? false;
            pi.events.emit(answers ? "ask:answered" : "ask:cancelled", emitFull ? details(answers)
              : { title: set.title, questionCount: set.questions.length, cancelled: answers === null });
            return { content: [{ type: "text" as const, text: answers ? `User answered:\n\n${questionSetSummary(set, answers)}` : "User cancelled the question set" }], details: details(answers) };
          }
          if (!params.question?.trim() || params.title !== undefined) throw new Error("Provide question, or title and questions.");
          const rawOptions: unknown[] = Array.isArray(params.options) ? params.options : [];
          const options = rawOptions.map(coerceAskUserOption).filter((option) => option !== null);
          const question: AskUserQuestion = {
            question: params.question,
            context: params.context?.trim() || undefined,
            options,
            allowMultiple: params.allowMultiple ?? false,
            allowFreeform: params.allowFreeform ?? true,
            allowComment: params.allowComment ?? parseAskUserPreference(process.env.PI_ASK_USER_ALLOW_COMMENT) ?? true,
            contextExpanded: params.contextExpanded ?? parseAskUserPreference(process.env.PI_ASK_USER_CONTEXT_EXPANDED) ?? true,
          };
          const details = (response: AskUserAnswer | null): AskUserDetails => ({
            question: question.question, context: question.context, options, response, cancelled: response === null,
          });
          if (rawOptions.length && !options.length) return {
            content: [{ type: "text" as const, text: `All ${rawOptions.length} option(s) were malformed, so nothing could be shown to the user. Each option must be a plain string or an object like { "title": "Short label", "description": "Optional detail" }. Call ask_user again with corrected options.` }],
            isError: true,
            details: { error: "Malformed options: no entry had a usable title" },
          };
          const ui = ctx.ui as typeof ctx.ui & Partial<AskUserUiContext>;
          if (!ctx.hasUI || !ui.askUser) {
            const contextText = question.context ? `\n\nContext:\n${question.context}` : "";
            const optionText = options.length ? `\n\nOptions:\n${options.map((option, index) =>
              `${index + 1}. ${option.title}${option.description ? ` — ${option.description}` : ""}`).join("\n")}` : "";
            const freeformHint = question.allowFreeform ? "\n\nYou can also answer freely." : "";
            const commentHint = question.allowComment ? "\n\nAfter choosing an option, you may add an optional comment." : "";
            return {
              content: [{ type: "text" as const, text: `Ask requires interactive mode. Please answer:\n\n${question.question}${contextText}${optionText}${freeformHint}${commentHint}` }],
              isError: true,
              details: details(null),
            };
          }
          if (signal?.aborted) return { content: [{ type: "text" as const, text: "Cancelled" }], details: details(null) };
          if (options.length) onUpdate?.({
            content: [{ type: "text", text: "Waiting for user input..." }], details: { ...details(null), cancelled: false },
          });

          pi.events.emit("herdr:blocked", { active: true, label: "Waiting for user response" });
          let answer: AskUserAnswer | null;
          try {
            const timeout = typeof params.timeout === "number" && Number.isFinite(params.timeout) && params.timeout > 0
              ? Math.min(params.timeout, 2_147_483_647) : undefined;
            answer = await ui.askUser(question, timeout, signal);
          } catch (error) {
            if (signal?.aborted) answer = null;
            else return {
              content: [{ type: "text" as const, text: `Ask tool failed: ${error instanceof Error ? error.message : String(error)}` }],
              isError: true, details: { error: error instanceof Error ? error.message : String(error) },
            };
          } finally {
            pi.events.emit("herdr:blocked", { active: false });
          }
          const emitFull = parseAskUserPreference(process.env.PI_ASK_USER_EMIT_FULL_EVENTS) ?? false;
          if (!answer) {
            if (options.length) pi.events.emit("ask:cancelled", emitFull
              ? { question: question.question, context: question.context, options }
              : { question: question.question });
            return { content: [{ type: "text" as const, text: "User cancelled the question" }], details: details(null) };
          }
          // Even an in-process UI result must pass the same boundary checks as an HTTP response.
          const response = normalizeAskUserAnswer(answer, question);
          if (!response) return { content: [{ type: "text" as const, text: "User cancelled the question" }], details: details(null) };
          pi.events.emit("ask:answered", emitFull
            ? { question: question.question, context: question.context, response }
            : { question: question.question, response: { kind: response.kind } });
          return { content: [{ type: "text" as const, text: `User answered: ${askUserSummary(response)}` }], details: details(response) };
        },
      });
    },
  };
}

/** Suppress only the recognized external package; do not swallow other tool collisions. */
export function preferPiWebAskUserExtension(base: LoadExtensionsResult): LoadExtensionsResult {
  const host = base.extensions.find((extension) => extension.path === HOST_PATH);
  if (!host?.tools.has("ask_user")) return base;
  const legacyPaths = new Set(base.extensions
    .filter((extension) => extension.path !== HOST_PATH)
    .filter((extension) => {
      const source = extension.sourceInfo?.source ?? "";
      const sourcePackage = source.replace(/^npm:/, "").split("@")[0];
      return sourcePackage === "pi-ask-user"
        || extension.path.replaceAll("\\", "/").split("/").some((segment) =>
          segment === "pi-ask-user" || /^[a-z0-9]{32}-pi-ask-user-\d/.test(segment));
    })
    .filter((extension) => extension.tools.has("ask_user"))
    .map((extension) => extension.path));
  if (!legacyPaths.size) return base;
  return {
    ...base,
    extensions: base.extensions.filter((extension) => !legacyPaths.has(extension.path)),
    errors: base.errors.filter((error) => error.path !== HOST_PATH
      ? !legacyPaths.has(error.path)
      : ![...legacyPaths].some((path) => error.error === `Tool "ask_user" conflicts with ${path}`)),
  };
}
