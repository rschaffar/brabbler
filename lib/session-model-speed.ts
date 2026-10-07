import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { isModelSpeed, type ModelSpeed } from "./model-speed";
import type { SessionEntry } from "./types";

export const SESSION_MODEL_SPEED_TYPE = "pi-web:model-speed";

/** Session-wide, not branch-local: the latest valid snapshot wins. */
export function readSessionModelSpeed(entries: readonly SessionEntry[]): ModelSpeed {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== SESSION_MODEL_SPEED_TYPE) continue;
    const data = entry.data as { version?: unknown; modelSpeed?: unknown } | null;
    if (data?.version === 1 && isModelSpeed(data.modelSpeed)) return data.modelSpeed;
  }
  return "standard";
}

export function appendSessionModelSpeed(manager: Pick<SessionManager, "appendCustomEntry">, modelSpeed: ModelSpeed): void {
  if (!isModelSpeed(modelSpeed)) throw new Error("Invalid model speed: expected standard or fast");
  manager.appendCustomEntry(SESSION_MODEL_SPEED_TYPE, { version: 1, modelSpeed });
}
