import type { PluginCard, PluginCardField } from "./types";

export function isOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function text(value: unknown, max: number, optional = true): boolean {
  return optional && value === undefined || typeof value === "string" && value.length <= max;
}
function flag(value: unknown): boolean { return value === undefined || typeof value === "boolean"; }
function fields(value: unknown): boolean {
  return value === undefined || Array.isArray(value) && value.length <= 32 && value.every((field: PluginCardField) =>
    field && text(field.label, 128, false) && field.label.trim() && text(field.value, 65536, false) && flag(field.code));
}
/** Bound payloads and action identities at the server transport boundary. */
export function validatePluginCard(card: PluginCard): void {
  if (!card || !text(card.title, 256, false) || !card.title.trim()
    || card.operationId !== undefined && !isOperationId(card.operationId)
    || [card.text, card.markdown, card.patch].some((value) => !text(value, 1_000_000))
    || [card.patchBefore, card.patchAfter].some((value) => !text(value, 256))
    || card.patchContext !== undefined && (typeof card.patch !== "string" || typeof card.patchContext !== "string"
      || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(card.patchContext))
    || !text(card.subtitle, 4096) || !text(card.scope, 4096) || !fields(card.fields)
    || card.sections !== undefined && (!Array.isArray(card.sections) || card.sections.length > 16 || card.sections.some((section) =>
      !section || !text(section.title, 128, false) || !section.title.trim() || !text(section.text, 1_000_000)
      || !fields(section.fields) || !flag(section.code) || !flag(section.collapsible) || !flag(section.notice)))
    || !Array.isArray(card.actions) || card.actions.length > 8
    || card.actions.some((action) => !action || typeof action.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(action.id)
      || !text(action.label, 128, false) || !action.label.trim() || !flag(action.primary))
    || new Set(card.actions.map((action) => action.id)).size !== card.actions.length
    || card.actions.filter((action) => action.primary).length > 1) throw new Error("Invalid plugin card");
  // Keep the existing separately bounded patch; cap all other presentation together.
  if (JSON.stringify({ ...card, patch: undefined }).length > 1_100_000) throw new Error("Invalid plugin card");
}
export function validPluginAction(card: PluginCard, action: unknown): action is string {
  return typeof action === "string" && card.actions.some((choice) => choice.id === action);
}
