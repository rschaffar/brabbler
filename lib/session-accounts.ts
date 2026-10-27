import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "./types";
import type { AccountSelection } from "./provider-accounts";

export const SESSION_ACCOUNTS_TYPE = "brabbler:provider-accounts";

/** A complete snapshot; an empty map explicitly returns the session to Pi defaults. */
export function readSessionAccounts(entries: readonly SessionEntry[]): AccountSelection | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== SESSION_ACCOUNTS_TYPE) continue;
    const data = entry.data as { version?: unknown; accounts?: unknown } | null;
    if (!data || data.version !== 1 || !data.accounts || typeof data.accounts !== "object" || Array.isArray(data.accounts)) continue;
    const accounts = data.accounts as Record<string, unknown>;
    if (Object.entries(accounts).every(([provider, id]) => provider.length > 0 && typeof id === "string" && id.length > 0)) {
      return accounts as AccountSelection;
    }
  }
  return undefined;
}

export function appendSessionAccounts(manager: SessionManager, accounts: AccountSelection): void {
  manager.appendCustomEntry(SESSION_ACCOUNTS_TYPE, { version: 1, accounts: { ...accounts } });
}
