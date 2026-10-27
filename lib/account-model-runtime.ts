import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { accountCredentialStore, validateAccountSelection, type AccountSelection } from "./provider-accounts";

export interface AccountModelRuntimeOptions {
  agentDir?: string;
  accountsPath?: string;
  legacy?: CredentialStore;
  allowPendingLogin?: boolean;
  refreshOnCreate?: boolean;
}

// Shared symbol identity also survives independent module loaders; the marker is
// non-enumerable and self-bound so spreading/rebuilding a binding cannot authorize it.
const bindingMarker: unique symbol = Symbol.for("brabbler.account-model-runtime.binding.v1");

export interface AccountModelRuntimeBinding {
  readonly [bindingMarker]: AccountModelRuntimeBinding;
  readonly accounts: Readonly<AccountSelection>;
  readonly modelsStorePath: string;
  readonly runtimeOptions: NonNullable<Parameters<typeof ModelRuntime.create>[0]>;
}

/** Accept only immutable bindings produced by this construction boundary. */
export function accountModelRuntimeOptions(binding: AccountModelRuntimeBinding): AccountModelRuntimeBinding["runtimeOptions"] {
  if (!binding || typeof binding !== "object" || binding[bindingMarker] !== binding
    || !Object.isFrozen(binding) || !binding.runtimeOptions || !Object.isFrozen(binding.runtimeOptions)) {
    throw new Error("Invalid account model runtime binding");
  }
  return binding.runtimeOptions;
}

/** Capture identity and validate ownership synchronously, before any SDK awaits. */
export function prepareAccountModelRuntime(
  selection: Readonly<AccountSelection> = {},
  options: AccountModelRuntimeOptions = {},
): AccountModelRuntimeBinding {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) throw new Error("Invalid account selection");
  const entries = Object.entries(selection).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const accounts = Object.freeze(Object.fromEntries(entries));
  const loginConfig = Object.freeze({ allowPendingLogin: options.allowPendingLogin === true });
  const agentDir = options.agentDir ?? getAgentDir();
  const accountsPath = options.accountsPath ?? join(agentDir, "brabbler-accounts.json");
  validateAccountSelection(accounts, accountsPath, loginConfig);
  let modelsStorePath = join(agentDir, "models-store.json");
  let credentials: CredentialStore | undefined;
  if (Object.keys(accounts).length) {
    // Only the complete provider/account-ID snapshot participates, never labels or credentials.
    const identity = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
    let directory = agentDir;
    for (const part of ["brabbler", "model-stores", "v1", identity]) {
      directory = join(directory, part);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (!lstatSync(directory).isDirectory()) throw new Error("Invalid account catalog directory");
      chmodSync(directory, 0o700);
    }
    modelsStorePath = join(directory, "models-store.json");
    const storedFile = lstatSync(modelsStorePath, { throwIfNoEntry: false });
    if (storedFile && !storedFile.isFile()) throw new Error("Invalid account catalog file");
    if (storedFile) chmodSync(modelsStorePath, 0o600);
    // Do not seed from the shared store: its personalized catalog has no known owner.
    credentials = accountCredentialStore(accounts, accountsPath, options.legacy, loginConfig);
  }
  const binding = {
    accounts,
    modelsStorePath,
    runtimeOptions: Object.freeze({
      modelsPath: join(agentDir, "models.json"),
      modelsStorePath,
      ...(credentials ? { credentials } : {}),
      ...(options.refreshOnCreate === undefined ? {} : { refreshOnCreate: options.refreshOnCreate }),
    }),
  } as AccountModelRuntimeBinding;
  Object.defineProperty(binding, bindingMarker, { value: binding });
  return Object.freeze(binding);
}

export function createAccountModelRuntime(
  selection: Readonly<AccountSelection> = {},
  options: AccountModelRuntimeOptions = {},
): Promise<ModelRuntime> {
  return ModelRuntime.create(prepareAccountModelRuntime(selection, options).runtimeOptions);
}
