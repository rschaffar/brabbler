import type { PluginCard } from "./types";

/** Bound payloads and action identities at the server transport boundary. */
export function validatePluginCard(card: PluginCard): void {
  if (!card || typeof card.title !== "string" || !card.title.trim() || card.title.length > 256
    || [card.text, card.markdown, card.patch].some((value) => value !== undefined && (typeof value !== "string" || value.length > 1_000_000))
    || !Array.isArray(card.actions) || card.actions.length > 8
    || card.actions.some((action) => !action || typeof action.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(action.id)
      || typeof action.label !== "string" || !action.label.trim() || action.label.length > 128)
    || new Set(card.actions.map((action) => action.id)).size !== card.actions.length) throw new Error("Invalid plugin card");
}
export function validPluginAction(card: PluginCard, action: unknown): action is string {
  return typeof action === "string" && card.actions.some((choice) => choice.id === action);
}
