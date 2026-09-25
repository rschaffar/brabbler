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

export const HOST_ASK_USER_EXTENSION_NAME = "pi-web-ask-user";
const HOST_PATH = `<inline:${HOST_ASK_USER_EXTENSION_NAME}>`;

/** Only the per-session Pi Web UI context supplies this method. */
export interface AskUserUiContext {
  askUser(question: AskUserQuestion, timeout?: number, signal?: AbortSignal): Promise<AskUserAnswer | null>;
}

export function createAskUserExtension(): InlineExtension {
  return {
    name: HOST_ASK_USER_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.registerTool({
        name: "ask_user",
        label: "Ask User",
        description: "Ask the user a question with optional multiple-choice answers. Use this to gather information interactively. Ask exactly one focused question per call. Before calling, gather context with tools (read/web/ref) and pass a short summary via the context field.",
        promptSnippet: "Ask the user one focused question with optional multiple-choice answers to gather information interactively",
        promptGuidelines: [
          "Before calling ask_user, gather context with tools (read/web/ref) and pass a short summary via the context field.",
          "Use ask_user when the user's intent is ambiguous, when a decision requires explicit user input, or when multiple valid options exist.",
          "Ask exactly one focused question per ask_user call.",
          "Do not combine multiple numbered, multipart, or unrelated questions into one ask_user prompt.",
        ],
        executionMode: "sequential",
        parameters: Type.Object({
          question: Type.String({ description: "The question to ask the user" }),
          context: Type.Optional(Type.String({ description: "Relevant context to show before the question (summary of findings)" })),
          options: Type.Optional(Type.Array(Type.Object({
            title: Type.String({ description: "Short title for this option" }),
            description: Type.Optional(Type.String({ description: "Longer description explaining this option" })),
          }), { description: "List of options for the user to choose from" })),
          allowMultiple: Type.Optional(Type.Boolean({ description: "Allow selecting multiple options. Default: false" })),
          allowFreeform: Type.Optional(Type.Boolean({ description: "Add a freeform text option. Default: true" })),
          allowComment: Type.Optional(Type.Boolean({ description: "Collect an optional comment after selecting one or more options. Default: PI_ASK_USER_ALLOW_COMMENT env var if set, otherwise false." })),
          displayMode: Type.Optional(Type.Unsafe<"overlay" | "inline">({ type: "string", enum: ["overlay", "inline"], description: "UI rendering mode. Pi Web presents a browser form regardless of terminal layout." })),
          singleSelectLayout: Type.Optional(Type.Unsafe<"auto" | "list">({ type: "string", enum: ["auto", "list"], description: "Terminal single-select layout; ignored by Pi Web." })),
          contextExpanded: Type.Optional(Type.Boolean({ description: "Start with oversized context expanded. Default: PI_ASK_USER_CONTEXT_EXPANDED env var if set, otherwise false." })),
          overlayToggleKey: Type.Optional(Type.String({ description: "Terminal overlay shortcut; ignored by Pi Web." })),
          commentToggleKey: Type.Optional(Type.String({ description: "Terminal comment shortcut; ignored by Pi Web." })),
          timeout: Type.Optional(Type.Number({ description: "Auto-dismiss after N milliseconds. Returns null (cancelled) when expired." })),
        }),
        async execute(_toolCallId, params, signal, onUpdate, ctx) {
          const rawOptions: unknown[] = Array.isArray(params.options) ? params.options : [];
          const options = rawOptions.map(coerceAskUserOption).filter((option) => option !== null);
          const question: AskUserQuestion = {
            question: params.question,
            context: params.context?.trim() || undefined,
            options,
            allowMultiple: params.allowMultiple ?? false,
            allowFreeform: params.allowFreeform ?? true,
            allowComment: params.allowComment ?? parseAskUserPreference(process.env.PI_ASK_USER_ALLOW_COMMENT) ?? false,
            contextExpanded: params.contextExpanded ?? parseAskUserPreference(process.env.PI_ASK_USER_CONTEXT_EXPANDED) ?? false,
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
