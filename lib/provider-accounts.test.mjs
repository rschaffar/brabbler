import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const {
  addProviderAccount, accountCredentialStore, getProjectAccounts, listProviderAccounts,
  removeProviderAccount, setProjectAccount, validateAccountSelection,
} = await createJiti(import.meta.url).import("./provider-accounts.ts");

const legacy = {
  async read(provider) { return provider === "anthropic" ? { type: "api_key", key: "legacy-key" } : undefined; },
  async list() { return [{ providerId: "anthropic", type: "api_key" }]; },
  async modify(provider, fn) { return fn(await this.read(provider)); },
  async delete() {},
};

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-accounts-"));
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

test("malformed account data is rejected rather than overwritten", async () => fixture(async (path) => {
  await writeFile(path, JSON.stringify({ version: 99, accounts: {}, projects: {} }), { mode: 0o600 });
  assert.throws(() => listProviderAccounts(path), /Unsupported/);
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
