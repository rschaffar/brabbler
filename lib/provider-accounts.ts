import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { updateStoredCredentials } from "./provider-credential-store";
import lockfile from "proper-lockfile";
import { resolveProject } from "./worktree";

export type AccountSelection = Record<string, string>;
export interface ProviderAccount { id: string; provider: string; label: string; type: Credential["type"]; authorized: boolean }
interface StoredAccount extends Omit<ProviderAccount, "authorized"> { credential: Credential | null }
interface AccountFile {
  version: 1;
  accounts: Record<string, StoredAccount>;
  projects: Record<string, AccountSelection>;
}

const emptyFile = (): AccountFile => ({ version: 1, accounts: {}, projects: {} });
const defaultPath = () => join(getAgentDir(), "brabbler-accounts.json");
const own = (obj: object, key: string) => Object.hasOwn(obj, key);

function parseFile(path: string): AccountFile {
  if (!existsSync(path)) return emptyFile();
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid provider accounts file");
  const data = value as Partial<AccountFile>;
  if (data.version !== 1 || !data.accounts || !data.projects
    || typeof data.accounts !== "object" || Array.isArray(data.accounts)
    || typeof data.projects !== "object" || Array.isArray(data.projects)) {
    throw new Error("Unsupported provider accounts file");
  }
  return data as AccountFile;
}

async function changeFile<T>(path: string, change: (data: AccountFile) => Promise<T> | T): Promise<T> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (!existsSync(path)) writeFileSync(path, JSON.stringify(emptyFile()), { mode: 0o600, flag: "wx" });
  const release = await lockfile.lock(path, { retries: { retries: 10, minTimeout: 100, maxTimeout: 10_000 }, stale: 30_000 });
  try {
    const data = parseFile(path);
    const result = await change(data);
    writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
    chmodSync(path, 0o600);
    return result;
  } finally {
    await release();
  }
}

export function listProviderAccounts(path = defaultPath()): ProviderAccount[] {
  const data = parseFile(path);
  return Object.values(data.accounts).map(({ id, provider, label, type, credential }) => ({ id, provider, label, type, authorized: Boolean(credential) }));
}

export async function addProviderAccount(provider: string, label: string, type: Credential["type"], path = defaultPath()): Promise<ProviderAccount> {
  if (!provider || !label.trim() || label.length > 100) throw new Error("Provider and account label are required (maximum 100 characters)");
  const account: StoredAccount = { id: randomUUID(), provider, label: label.trim(), type, credential: null };
  await changeFile(path, (data) => { data.accounts[account.id] = account; });
  return { id: account.id, provider: account.provider, label: account.label, type: account.type, authorized: false };
}

export async function renameProviderAccount(id: string, label: string, path = defaultPath()): Promise<void> {
  if (!label.trim() || label.length > 100) throw new Error("Account label is required (maximum 100 characters)");
  await changeFile(path, (data) => {
    const account = own(data.accounts, id) ? data.accounts[id] : undefined;
    if (!account) throw new Error("Account not found");
    account.label = label.trim();
  });
}

export async function removeProviderAccount(id: string, path = defaultPath()): Promise<void> {
  await changeFile(path, (data) => {
    if (!own(data.accounts, id)) throw new Error("Account not found");
    delete data.accounts[id];
    // Keep session bindings intact so deleted accounts fail closed. Project defaults
    // are for future sessions and should not point to deleted credentials.
    for (const selection of Object.values(data.projects)) {
      for (const [provider, selected] of Object.entries(selection)) {
        if (selected === id) delete selection[provider];
      }
    }
  });
}

export async function getProjectAccounts(cwd: string, path = defaultPath()): Promise<AccountSelection> {
  const { projectRoot } = await resolveProject(cwd);
  const data = parseFile(path);
  return { ...(data.projects[projectRoot] ?? {}) };
}

export async function setProjectAccount(cwd: string, provider: string, accountId: string | null, path = defaultPath()): Promise<AccountSelection> {
  const { projectRoot } = await resolveProject(cwd);
  return changeFile(path, (data) => {
    if (accountId !== null && (!own(data.accounts, accountId) || data.accounts[accountId].provider !== provider || !data.accounts[accountId].credential)) {
      throw new Error("Account is not authorized for this provider");
    }
    const selected = data.projects[projectRoot] ?? {};
    if (accountId === null) delete selected[provider];
    else selected[provider] = accountId;
    data.projects[projectRoot] = selected;
    return { ...selected };
  });
}

export function validateAccountSelection(
  selection: Readonly<AccountSelection>,
  path = defaultPath(),
  config: { allowPendingLogin?: boolean } = {},
): void {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) throw new Error("Invalid account selection");
  // Pi default has no extra-account dependency, even if that separate file is broken.
  if (Object.keys(selection).length === 0) return;
  const data = parseFile(path);
  for (const [provider, id] of Object.entries(selection)) {
    if (!provider || typeof id !== "string" || !id || !own(data.accounts, id) || data.accounts[id].provider !== provider
      || (!data.accounts[id].credential && !config.allowPendingLogin)) {
      throw new Error(`Selected account is unavailable for ${provider}`);
    }
  }
}

/** Bind a runtime to an immutable provider → account snapshot. No process-wide active account. */
function legacyStore(path = join(getAgentDir(), "auth.json")): CredentialStore {
  const readData = (): Record<string, Credential> => {
    if (!existsSync(path)) return {};
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid auth.json");
    return data as Record<string, Credential>;
  };
  return {
    async read(provider) { const data = readData(); return own(data, provider) ? data[provider] : undefined; },
    async list() { return Object.entries(readData()).filter(([, c]) => c?.type === "oauth" || c?.type === "api_key")
      .map(([providerId, c]) => ({ providerId, type: c.type })); },
    modify(provider, fn) { return updateStoredCredentials(path, async (data) => {
      const next = await fn(own(data, provider) ? data[provider] as Credential : undefined);
      if (next) data[provider] = next;
      return { result: (next ?? data[provider]) as Credential | undefined, changed: Boolean(next) };
    }); },
    async delete(provider) { await updateStoredCredentials(path, (data) => {
      const changed = own(data, provider);
      delete data[provider];
      return { result: undefined, changed };
    }); },
  };
}

export function accountCredentialStore(
  selection: Readonly<AccountSelection>,
  path = defaultPath(),
  legacy: CredentialStore = legacyStore(),
  config: { allowPendingLogin?: boolean } = {},
): CredentialStore {
  const bound = Object.isFrozen(selection) ? selection : Object.freeze({ ...selection });
  const accountFor = (provider: string, data: AccountFile) => {
    const id = bound[provider];
    const account = id && own(data.accounts, id) ? data.accounts[id] : undefined;
    if (!account || account.provider !== provider) throw new Error(`Selected account is unavailable for ${provider}`);
    return account;
  };
  return {
    async read(provider, options) {
      if (!own(bound, provider)) return legacy.read(provider, options);
      const account = accountFor(provider, parseFile(path));
      if (!account.credential && !config.allowPendingLogin) throw new Error(`Selected account is not authorized for ${provider}`);
      return account.credential ?? undefined;
    },
    async list(options) {
      const entries = await legacy.list(options);
      const unbound = entries.filter(({ providerId }) => !own(bound, providerId));
      const data = parseFile(path);
      return [...unbound, ...Object.keys(bound).flatMap((providerId) => {
        const account = accountFor(providerId, data);
        if (!account.credential) {
          if (config.allowPendingLogin) return [];
          throw new Error(`Selected account is not authorized for ${providerId}`);
        }
        return [{ providerId, type: account.type }];
      })];
    },
    async modify(provider, fn, options) {
      if (!own(bound, provider)) return legacy.modify(provider, fn, options);
      return changeFile(path, async (data) => {
        const account = accountFor(provider, data);
        const next = await fn(account.credential ?? undefined);
        if (next) {
          if (next.type !== account.type) throw new Error("Account credential type mismatch");
          account.credential = next;
        }
        return account.credential ?? undefined;
      });
    },
    async delete(provider, options) {
      if (!own(bound, provider)) return legacy.delete(provider, options);
      await changeFile(path, (data) => { accountFor(provider, data).credential = null; });
    },
  };
}
