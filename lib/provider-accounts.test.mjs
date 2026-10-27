import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const {
  addProviderAccount, accountCredentialStore, getProjectAccounts, listProviderAccounts,
  removeProviderAccount, renameProviderAccount, setProjectAccount, validateAccountSelection,
} = await createJiti(import.meta.url).import("./provider-accounts.ts");

const { prepareAccountModelRuntime, createAccountModelRuntime } = await createJiti(import.meta.url).import("./account-model-runtime.ts");
const originalFetch = globalThis.fetch;
let unexpectedHttp = 0;
globalThis.fetch = async () => { unexpectedHttp++; throw new Error("Unexpected HTTP request in account tests"); };
after(() => { globalThis.fetch = originalFetch; assert.equal(unexpectedHttp, 0); });

const legacy = {
  async read(provider) { return provider === "anthropic" ? { type: "api_key", key: "legacy-key" } : undefined; },
  async list() { return [{ providerId: "anthropic", type: "api_key" }]; },
  async modify(provider, fn) { return fn(await this.read(provider)); },
  async delete() {},
};

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "brabbler-accounts-"));
  try { await fn(join(dir, "accounts.json"), dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("accounts isolate concurrent sessions and OAuth refreshes without touching Pi auth", async () => fixture(async (path) => {
  const first = await addProviderAccount("anthropic", "Work", "oauth", path);
  const second = await addProviderAccount("anthropic", "Personal", "oauth", path);
  const a = accountCredentialStore({ anthropic: first.id }, path, legacy);
  const b = accountCredentialStore({ anthropic: second.id }, path, legacy);
  const token = (access) => ({ type: "oauth", access, refresh: access, expires: Date.now() + 900_000 });
  await Promise.all([
    a.modify("anthropic", async () => token("work")),
    b.modify("anthropic", async () => token("personal")),
  ]);
  assert.equal((await a.read("anthropic")).access, "work");
  assert.equal((await b.read("anthropic")).access, "personal");
  assert.equal((await legacy.read("anthropic")).key, "legacy-key");
  await Promise.all([
    a.modify("anthropic", async (current) => token(`${current.access}-refresh`)),
    b.modify("anthropic", async (current) => token(`${current.access}-refresh`)),
  ]);
  assert.equal((await a.read("anthropic")).access, "work-refresh");
  assert.equal((await b.read("anthropic")).access, "personal-refresh");
  assert.deepEqual((await a.list()).map((entry) => entry.providerId), ["anthropic"]);
  assert.deepEqual(listProviderAccounts(path).map(({ label, authorized }) => [label, authorized]), [
    ["Work", true], ["Personal", true],
  ]);
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.equal(saved.accounts[first.id].credential.access, "work-refresh");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
}));

test("a bound deleted or unauthenticated account fails closed instead of using legacy auth", async () => fixture(async (path) => {
  const account = await addProviderAccount("anthropic", "Work", "api_key", path);
  const store = accountCredentialStore({ anthropic: account.id }, path, legacy);
  await assert.rejects(store.read("anthropic"), /not authorized/);
  const loginStore = accountCredentialStore({ anthropic: account.id }, path, legacy, { allowPendingLogin: true });
  assert.equal(await loginStore.read("anthropic"), undefined);
  await ModelRuntime.create({ credentials: loginStore, modelsPath: null });
  assert.throws(() => validateAccountSelection({ anthropic: account.id }, path), /unavailable/);
  await store.modify("anthropic", async () => ({ type: "api_key", key: "work-key" }));
  validateAccountSelection({ anthropic: account.id }, path);
  const runtime = await ModelRuntime.create({ credentials: store, modelsPath: null, refreshOnCreate: false });
  assert.equal((await runtime.getAuth("anthropic")).auth.apiKey, "work-key");
  await removeProviderAccount(account.id, path);
  await assert.rejects(store.read("anthropic"), /unavailable/);
  await assert.rejects(runtime.getAuth("anthropic"), /unavailable/);
  await assert.rejects(store.list(), /unavailable/);
  assert.equal((await legacy.read("anthropic")).key, "legacy-key");
}));

test("catalog identity uses the sorted complete snapshot, not labels or credentials", async () => fixture(async (path, dir) => {
  const a = await addProviderAccount("anthropic", "A", "api_key", path);
  const b = await addProviderAccount("openrouter", "B", "api_key", path);
  for (const account of [a, b]) await accountCredentialStore({ [account.provider]: account.id }, path, legacy)
    .modify(account.provider, async () => ({ type: "api_key", key: "synthetic" }));
  const options = { agentDir: dir, accountsPath: path, legacy, refreshOnCreate: false };
  const selection = { openrouter: b.id, anthropic: a.id };
  const binding = prepareAccountModelRuntime(selection, options);
  const reordered = prepareAccountModelRuntime({ anthropic: a.id, openrouter: b.id }, options);
  assert.equal(binding.modelsStorePath, reordered.modelsStorePath);
  assert.match(binding.modelsStorePath, /brabbler\/model-stores\/v1\/[a-f0-9]{64}\/models-store\.json$/);
  assert.equal(prepareAccountModelRuntime({}, options).modelsStorePath, join(dir, "models-store.json"));
  assert.notEqual(prepareAccountModelRuntime({ anthropic: a.id }, options).modelsStorePath, binding.modelsStorePath);
  selection.anthropic = "missing";
  assert.ok(Object.isFrozen(binding.accounts));
  assert.equal(binding.accounts.anthropic, a.id);
  assert.equal((await binding.runtimeOptions.credentials.read("anthropic")).key, "synthetic");
  await accountCredentialStore({ anthropic: a.id }, path, legacy).modify("anthropic", async () => ({ type: "api_key", key: "rotated" }));
  await renameProviderAccount(a.id, "Renamed", path);
  assert.equal(prepareAccountModelRuntime(binding.accounts, options).modelsStorePath, binding.modelsStorePath);
  let directory = join(binding.modelsStorePath, "..");
  for (let i = 0; i < 4; i++, directory = join(directory, "..")) assert.equal((await stat(directory)).mode & 0o777, 0o700);
  for (const bad of [null, [], { anthropic: 7 }, { anthropic: "" }, { anthropic: "missing" }, { anthropic: b.id }]) {
    assert.throws(() => prepareAccountModelRuntime(bad, options), /Invalid|unavailable/);
    assert.throws(() => prepareAccountModelRuntime(bad, { ...options, allowPendingLogin: true }), /Invalid|unavailable/);
  }
  await removeProviderAccount(a.id, path);
  assert.throws(() => prepareAccountModelRuntime(binding.accounts, options), /unavailable/);
  await assert.rejects(binding.runtimeOptions.credentials.read("anthropic"), /unavailable/);
}));

test("pending-login catalog construction allows only existing provider-owned identities", async () => fixture(async (path, dir) => {
  const account = await addProviderAccount("anthropic", "Pending", "api_key", path);
  const options = { agentDir: dir, accountsPath: path, legacy };
  assert.throws(() => prepareAccountModelRuntime({ anthropic: account.id }, options), /unavailable/);
  validateAccountSelection({ anthropic: account.id }, path, { allowPendingLogin: true });
  const binding = prepareAccountModelRuntime({ anthropic: account.id }, { ...options, allowPendingLogin: true });
  assert.equal(await binding.runtimeOptions.credentials.read("anthropic"), undefined);
  const runtime = await createAccountModelRuntime(binding.accounts, { ...options, allowPendingLogin: true });
  assert.equal(await runtime.getAuth("anthropic"), undefined);
  await binding.runtimeOptions.credentials.modify("anthropic", async () => ({ type: "api_key", key: "authorized" }));
  assert.equal(prepareAccountModelRuntime(binding.accounts, options).modelsStorePath, binding.modelsStorePath);
}));

test("catalog directories reject symlink aliases instead of sharing an unknown scope", async () => fixture(async (path, dir) => {
  const account = await addProviderAccount("anthropic", "Test", "api_key", path);
  await accountCredentialStore({ anthropic: account.id }, path, legacy).modify("anthropic", async () => ({ type: "api_key", key: "synthetic" }));
  await symlink(dir, join(dir, "brabbler"));
  assert.throws(() => prepareAccountModelRuntime({ anthropic: account.id }, { agentDir: dir, accountsPath: path, legacy }), /catalog directory/);
}));

test("catalog files reject symlink aliases to the shared store", async () => fixture(async (path, dir) => {
  const account = await addProviderAccount("anthropic", "Test", "api_key", path);
  await accountCredentialStore({ anthropic: account.id }, path, legacy).modify("anthropic", async () => ({ type: "api_key", key: "synthetic" }));
  const options = { agentDir: dir, accountsPath: path, legacy };
  const binding = prepareAccountModelRuntime({ anthropic: account.id }, options);
  await writeFile(join(dir, "models-store.json"), "{}", { mode: 0o600 });
  await symlink(join(dir, "models-store.json"), binding.modelsStorePath);
  assert.throws(() => prepareAccountModelRuntime(binding.accounts, options), /catalog file/);
}));

test("malformed account data is rejected rather than overwritten", async () => fixture(async (path, dir) => {
  await writeFile(path, JSON.stringify({ version: 99, accounts: {}, projects: {} }), { mode: 0o600 });
  assert.throws(() => listProviderAccounts(path), /Unsupported/);
  assert.equal(prepareAccountModelRuntime({}, { agentDir: dir, accountsPath: path }).modelsStorePath, join(dir, "models-store.json"));
  await assert.rejects(addProviderAccount("anthropic", "Work", "api_key", path), /Unsupported/);
  assert.equal(JSON.parse(await readFile(path, "utf8")).version, 99);
}));

test("project defaults share the main Git root with linked worktrees", async () => fixture(async (path, dir) => {
  const repo = join(dir, "repo");
  const linked = join(dir, "linked");
  const git = (...args) => execFileSync("git", args, { stdio: "ignore" });
  git("init", "-q", repo);
  git("-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", "initial");
  git("-C", repo, "worktree", "add", "-q", "-b", "feature", linked);
  const account = await addProviderAccount("anthropic", "Work", "api_key", path);
  const store = accountCredentialStore({ anthropic: account.id }, path, legacy);
  await store.modify("anthropic", async () => ({ type: "api_key", key: "work-key" }));
  await setProjectAccount(linked, "anthropic", account.id, path);
  assert.deepEqual(await getProjectAccounts(repo, path), { anthropic: account.id });
  await setProjectAccount(repo, "anthropic", null, path);
  assert.deepEqual(await getProjectAccounts(linked, path), {});
}));
