import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultResourceLoader, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { interopDefault: true, fsCache: false });
const { getProjectTrustStatus, getProjectTrustDetails, projectTrustReloadOptions, setProjectTrust, clearWorktreeTrust, trustProject } = await jiti.import("./project-trust.ts");
const { trustedGitRepository } = await jiti.import("./project-trust-repository.ts");

async function createProjectFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-project-trust-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, cwd, agentDir };
}

test("clean projects stay on the normal trusted load path", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);

  assert.deepEqual(getProjectTrustStatus(cwd, agentDir), {
    requiresTrust: false,
    trusted: true,
  });
  assert.equal(projectTrustReloadOptions(cwd, agentDir), undefined);
});

test("project extensions execute only after the project is trusted", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  const extensionDir = join(cwd, ".pi", "extensions");
  const marker = join(root, "extension-executed");
  await mkdir(extensionDir, { recursive: true });
  await writeFile(
    join(extensionDir, "probe.js"),
    `import { writeFileSync } from "node:fs";\nexport default () => { writeFileSync(${JSON.stringify(marker)}, "executed"); };\n`,
  );

  assert.deepEqual(getProjectTrustStatus(cwd, agentDir), {
    requiresTrust: true,
    trusted: false,
  });

  const restrictedLoader = new DefaultResourceLoader({ cwd, agentDir });
  await restrictedLoader.reload(projectTrustReloadOptions(cwd, agentDir));
  assert.equal(existsSync(marker), false);
  assert.equal(restrictedLoader.getExtensions().extensions.length, 0);

  assert.deepEqual(trustProject(cwd, agentDir), {
    requiresTrust: true,
    trusted: true,
  });

  const trustedLoader = new DefaultResourceLoader({ cwd, agentDir });
  await trustedLoader.reload(projectTrustReloadOptions(cwd, agentDir));
  assert.equal(existsSync(marker), true);
  assert.equal(trustedLoader.getExtensions().extensions.length, 1);
});

test("the reload resolver reads the latest persisted trust decision", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });

  const reloadOptions = projectTrustReloadOptions(cwd, agentDir);
  assert.ok(reloadOptions);
  assert.equal(await reloadOptions.resolveProjectTrust(), false);

  trustProject(cwd, agentDir);
  assert.equal(await reloadOptions.resolveProjectTrust(), true);
});

test("Git project trust covers registered future worktrees, but never siblings or explicit denials", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  const git = (path, ...args) => execFileSync("git", ["-C", path, ...args], { encoding: "utf8" }).trim();
  git(cwd, "init", "-qb", "main");
  git(cwd, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "base");
  const linked = join(root, "linked");
  git(cwd, "worktree", "add", "-qb", "linked", linked);
  await mkdir(join(root, ".agents", "skills"), { recursive: true });
  assert.equal(getProjectTrustStatus(linked, agentDir).trusted, false);
  const reload = projectTrustReloadOptions(linked, agentDir);
  assert.ok(reload);
  setProjectTrust(cwd, agentDir, "repository", true);
  assert.equal(getProjectTrustDetails(linked, agentDir).scope, "repository");
  const marker = join(root, "linked-extension-ran");
  await mkdir(join(linked, ".pi", "extensions"), { recursive: true });
  await writeFile(join(linked, ".pi", "extensions", "probe.js"),
    `import { writeFileSync } from "node:fs"; export default () => { writeFileSync(${JSON.stringify(marker)}, "yes"); };`);
  const loader = new DefaultResourceLoader({ cwd: linked, agentDir });
  await loader.reload(projectTrustReloadOptions(linked, agentDir));
  assert.equal(existsSync(marker), true, "repository grant reaches the SDK's resource loader");
  assert.equal(await reload.resolveProjectTrust(), true);
  const future = join(root, "future");
  git(cwd, "worktree", "add", "-qb", "future", future);
  assert.equal(getProjectTrustStatus(future, agentDir).trusted, true);
  const unrelated = join(root, "unrelated");
  await mkdir(unrelated);
  git(unrelated, "init", "-qb", "main");
  assert.equal(getProjectTrustStatus(unrelated, agentDir).trusted, false);
  const store = new ProjectTrustStore(agentDir);
  store.set(linked, false);
  assert.equal(getProjectTrustDetails(linked, agentDir).scope, "denied");
  assert.equal(await reload.resolveProjectTrust(), false);
  clearWorktreeTrust(linked, agentDir);
  assert.equal(await reload.resolveProjectTrust(), true);
  setProjectTrust(cwd, agentDir, "repository", false);
  assert.equal(await reload.resolveProjectTrust(), false);
  store.set(linked, true);
  assert.equal(getProjectTrustStatus(linked, agentDir).trusted, true);
  git(cwd, "worktree", "remove", future);
  assert.equal(trustedGitRepository(future), null);
});

test("a replacement repository at the same path does not inherit a project grant", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  const git = (...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  await mkdir(join(root, ".agents", "skills"), { recursive: true });
  git("init", "-qb", "main");
  setProjectTrust(cwd, agentDir, "repository", true);
  assert.equal(getProjectTrustStatus(cwd, agentDir).trusted, true);
  await rm(cwd, { recursive: true, force: true });
  await mkdir(cwd);
  git("init", "-qb", "main");
  assert.equal(getProjectTrustStatus(cwd, agentDir).trusted, false);
});


import * as sdk from "@earendil-works/pi-coding-agent";
import { loadBackend, next, backendCase, deferred } from "./backend-ownership.fixture.mjs";
import { rpcStartup } from "./rpc-startup.fixture.mjs";
const fileAccess = await jiti.import("./file-access.ts");
const requestSecurity = await jiti.import("./request-security.ts");
const trust = await jiti.import("./project-trust.ts");

function trustedRequest(path, body, headers = {}) {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
function access(cwd) { return { ...fileAccess, getAllowedFileRoots: async () => new Set([cwd]) }; }

async function trustApi(f, rpc = f.rpc, invalidated = [], trustBinding = trust) {
  return loadBackend(new URL("../app/api/project-trust/route.ts", import.meta.url), {
    "next/server": next, "@earendil-works/pi-coding-agent": { getAgentDir: () => f.agentDir },
    "@/lib/file-access": access(f.cwd), "@/lib/request-security": requestSecurity,
    "@/lib/project-trust": trustBinding, "@/lib/rpc-manager": rpc,
    "@/lib/models-cache": { invalidateModelsCache: () => invalidated.push(true) },
  }, { actual: true });
}

test("startup uses the saved cwd's live trust resolver, not the caller cwd", async t => {
  const f = await rpcStartup(t); await mkdir(join(f.cwd, ".pi", "extensions"), { recursive: true });
  const { session } = await f.start("/fixture/saved.jsonl"); await session.waitUntilReady();
  const reload = f.captures[0].input.resourceLoaderReloadOptions; assert.ok(reload);
  assert.equal(await reload.resolveProjectTrust(), false);
  trustProject(f.cwd, f.agentDir); assert.equal(await reload.resolveProjectTrust(), true);
  setProjectTrust(f.cwd, f.agentDir, "worktree", false); assert.equal(await reload.resolveProjectTrust(), false);
});

test("model, skills, plugin list/mutation and skill install read current persisted trust", async t => {
  const owner = backendCase(t); const { cwd, agentDir } = await createProjectFixture(t);
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  await mkdir(join(cwd, ".pi", "skills", "fixture"), { recursive: true });
  await writeFile(join(cwd, ".pi", "skills", "fixture", "SKILL.md"), "---\nname: fixture\ndescription: Trust fixture\n---\nInstructions");
  const common = { "next/server": next, "@/lib/file-access": access(cwd), "@/lib/request-security": requestSecurity, "@/lib/project-trust": trust };
  const serviceTrust = [], pluginTrust = [], effects = [];
  const settings = { getGlobalSettings: () => ({}), getProjectSettings: () => ({}), getEnabledModels: () => [],
    getDefaultProvider: () => undefined, getDefaultModel: () => undefined, getDefaultThinkingLevel: () => undefined, getModelThinkingLevel: () => undefined };
  const providerAccounts = await jiti.import("./provider-accounts.ts");
  const { GET: modelGet } = await loadBackend(new URL("../app/api/models/route.ts", import.meta.url), { ...common,
    "@earendil-works/pi-coding-agent": { ...sdk, getAgentDir: () => agentDir, createAgentSessionServices: async options => {
      assert.equal(options.cwd, cwd); assert.equal(options.agentDir, agentDir);
      serviceTrust.push(await options.resourceLoaderReloadOptions.resolveProjectTrust());
      return { settingsManager: settings, modelRuntime: { getError: () => undefined, getAvailable: async () => [] } };
    } },
    "@/lib/provider-accounts": { ...providerAccounts, getProjectAccounts: async () => ({}) },
    "@/lib/models-cache": { ...(await jiti.import("./models-cache.ts")), loadModelsWithCache: (_cwd, load) => load() },
  }, { actual: true });
  const skills = await loadBackend(new URL("./skills-service.ts", import.meta.url), { "@earendil-works/pi-coding-agent": { ...sdk, getAgentDir: () => agentDir } }, { actual: true });
  class Packages {
    async resolve() { return { extensions: [], skills: [], prompts: [], themes: [] }; }
    listConfiguredPackages() { return []; }
    async installAndPersist(...args) { effects.push(["plugin", ...args]); }
  }
  const plugins = await loadBackend(new URL("../app/api/plugins/route.ts", import.meta.url), { ...common,
    "@earendil-works/pi-coding-agent": { getAgentDir: () => agentDir, DefaultPackageManager: Packages, SettingsManager: { create: (_cwd, _dir, options) => { pluginTrust.push(options.projectTrusted); return settings; } } },
    "@/lib/settings-listing-runtime": { beginSettingsListingMutation: () => () => {} },
    "@/lib/models-cache": { invalidateModelsCache() {} },
  }, { actual: true });
  const install = await loadBackend(new URL("../app/api/skills/install/route.ts", import.meta.url), { ...common,
    "@earendil-works/pi-coding-agent": { getAgentDir: () => agentDir },
    "@/lib/npx": { runNpx: async (...args) => { effects.push(["skills", ...args]); return { stdout: "Installed 1 skill", stderr: "" }; } },
  });
  for (const trusted of [false, true, false]) {
    setProjectTrust(cwd, agentDir, "worktree", trusted);
    const modelResponse = await owner.response(modelGet(new Request(`http://localhost/api/models?cwd=${encodeURIComponent(cwd)}`)));
    assert.equal(modelResponse.status, 200); assert.deepEqual((await modelResponse.json()).modelList, []);
    assert.equal(serviceTrust.at(-1), trusted);
    const skillResponse = await owner.work(skills.loadSkillsWithInstallInfo(cwd));
    assert.equal(skillResponse.projectResourcesLoaded, trusted);
    assert.equal(skillResponse.skills.some(skill => skill.name === "fixture"), trusted);
    const listed = await owner.response(plugins.GET(new Request(`http://localhost/api/plugins?cwd=${encodeURIComponent(cwd)}`)));
    assert.equal(listed.status, 200); assert.equal((await listed.json()).projectResourcesLoaded, trusted);
    assert.equal(pluginTrust.at(-1), trusted, "listing SettingsManager uses current trust");
    const before = effects.length;
    const mutation = await owner.response(plugins.POST(trustedRequest("/api/plugins", { cwd, action: "install", source: "npm:synthetic", scope: "project" })));
    assert.equal(mutation.status, trusted ? 200 : 403); await mutation.json();
    const skillInstall = await owner.response(install.POST(trustedRequest("/api/skills/install", { cwd, package: "synthetic", scope: "project" })));
    assert.equal(skillInstall.status, trusted ? 200 : 403); await skillInstall.json();
    assert.equal(effects.length - before, trusted ? 2 : 0);
    assert.equal(pluginTrust.at(-1), trusted);
  }
});

test("trust POST refuses in-flight startup, then persists/invalidate before joining graceful shutdown", async t => {
  const f = await rpcStartup(t, { holdServices: true, holdShutdown: true });
  await mkdir(join(f.cwd, ".pi", "extensions"), { recursive: true });
  const invalidated = [], route = await trustApi(f, f.rpc, invalidated);
  const starting = f.start(); await f.serviceEntered.promise;
  const busy = await f.owner.response(route.POST(trustedRequest("/api/project-trust", { cwd: f.cwd })));
  assert.equal(busy.status, 409); await busy.json(); assert.equal(getProjectTrustStatus(f.cwd, f.agentDir).trusted, false); assert.deepEqual(invalidated, []);
  f.serviceGate.resolve(); const { session } = await starting; await session.waitUntilReady();
  const changing = f.owner.response(route.POST(trustedRequest("/api/project-trust", { cwd: f.cwd })));
  await f.shutdownEntered.promise;
  assert.equal(getProjectTrustStatus(f.cwd, f.agentDir).trusted, true); assert.deepEqual(invalidated, [true]);
  assert.equal(f.calls.some(([name]) => name === "dispose"), false);
  f.shutdownGate.resolve(); const response = await changing;
  assert.equal(response.status, 200); assert.equal((await response.json()).trusted, true);
  assert.equal(session.isAlive(), false); assert.equal(f.rpc.getRpcSession(session.sessionId), undefined);
});

test("trust API preserves origin/content-type/scope/action/path/busy refusal before decision writes", async t => {
  const f = await rpcStartup(t); await mkdir(join(f.cwd, ".pi", "extensions"), { recursive: true });
  const invalidated = [], route = await trustApi(f, { hasBusyRpcSessionWithin: () => false, destroyRpcSessionsInWorktrees: async () => {} }, invalidated);
  for (const [body, headers, status] of [
    [{ cwd: f.cwd }, { origin: "https://attacker.invalid" }, 403],
    [{ cwd: f.cwd }, { "content-type": "text/plain" }, 415],
    [{ cwd: f.cwd, scope: "invalid" }, {}, 400], [{ cwd: f.cwd, action: "invalid" }, {}, 400],
    [{ cwd: f.cwd, scope: "repository", action: "clear" }, {}, 400],
    [{ cwd: f.cwd, scope: "repository" }, {}, 409], [{ cwd: "/unadmitted" }, {}, 400],
  ]) {
    const response = await f.owner.response(route.POST(trustedRequest("/api/project-trust", body, headers))); assert.equal(response.status, status); await response.json();
  }
  assert.deepEqual(invalidated, []); assert.equal(getProjectTrustStatus(f.cwd, f.agentDir).trusted, false);
});

test("trust API binds worktree writes to registered root and repository writes to all linked checkouts", async t => {
  const owner = backendCase(t), f = await createProjectFixture(t);
  const git = (...args) => execFileSync("git", ["-C", f.cwd, ...args], { encoding: "utf8" });
  git("init", "-qb", "main"); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "base");
  const linked = join(f.root, "linked"); git("worktree", "add", "-qb", "linked", linked);
  const subdir = join(f.cwd, "subdir"); await mkdir(subdir); await mkdir(join(f.cwd, ".pi", "extensions"), { recursive: true });
  const checked = [], destroyed = [], invalidated = [], writes = [];
  const route = await trustApi(f, { hasBusyRpcSessionWithin: path => { checked.push(path); return false; }, destroyRpcSessionsInWorktrees: async paths => { destroyed.push(paths); } }, invalidated, {
    ...trust,
    setProjectTrust(...args) { writes.push(args); return trust.setProjectTrust(...args); },
  });
  const consume = async responsePromise => {
    const response = await owner.response(responsePromise);
    const body = await owner.work(response.json());
    return { status: response.status, body };
  };
  const diagnostic = (label, result) => `${label}: ${JSON.stringify(result).slice(0, 2000)}`;
  const snapshot = async cwd => {
    const request = new Request(`http://localhost/api/project-trust?cwd=${encodeURIComponent(cwd)}`, { headers: { host: "localhost", origin: "http://localhost" } });
    assert.equal(request.method, "GET");
    assert.deepEqual([...new URL(request.url).searchParams], [["cwd", cwd]]);
    return consume(route.GET(request));
  };
  const post = async (cwd, scope) => {
    const body = { cwd, scope };
    const request = trustedRequest("/api/project-trust", body);
    assert.equal(request.method, "POST"); assert.equal(new URL(request.url).pathname, "/api/project-trust");
    assert.equal(request.headers.get("host"), "localhost"); assert.equal(request.headers.get("origin"), "http://localhost");
    assert.equal(request.headers.get("content-type"), "application/json");
    assert.deepEqual(await owner.work(request.clone().json()), { cwd, scope });
    return consume(route.POST(request));
  };
  // Inspect actual native identity before admission. GET is not approval and is
  // never replayed as authority: each POST independently resolves membership.
  const nested = await snapshot(subdir);
  assert.equal(nested.status, 200, diagnostic("nested identity GET", nested));
  assert.equal(nested.body.checkoutRoot, null, diagnostic("nested checkout identity", nested));
  assert.equal(nested.body.requiresTrust, false, diagnostic("nested resource precondition", nested));
  const root = await snapshot(f.cwd);
  assert.equal(root.status, 200, diagnostic("registered identity GET", root));
  assert.equal(root.body.checkoutRoot, f.cwd, diagnostic("registered checkout identity", root));
  assert.equal(root.body.repositoryRoot, f.cwd, diagnostic("registered repository identity", root));
  assert.equal(root.body.requiresTrust, true, diagnostic("registered resources", root));
  assert.equal(root.body.worktreeDecision, null, diagnostic("initial worktree decision", root));
  assert.deepEqual(checked, []); assert.deepEqual(writes, []); assert.deepEqual(invalidated, []);

  // Preserve the original subdirectory tuple, but as its actual fail-closed
  // contract. It is not a registered root and has no gated resources of its own.
  const nestedWrite = await post(subdir, "worktree");
  assert.equal(nestedWrite.status, 409, diagnostic("nested worktree POST", nestedWrite));
  assert.deepEqual(nestedWrite.body, { error: "This directory has no resources that require trust" });
  assert.deepEqual(writes, []); assert.deepEqual(checked, []); assert.deepEqual(destroyed, []); assert.deepEqual(invalidated, []);
  assert.equal(new ProjectTrustStore(f.agentDir).get(subdir), null);

  // The positive write submits the independently known actual registered root,
  // not a manufactured checkoutRoot or a cached GET authority token.
  const worktree = await post(f.cwd, "worktree");
  assert.equal(worktree.status, 200, diagnostic("registered worktree POST", worktree));
  assert.equal(worktree.body.checkoutRoot, f.cwd, diagnostic("worktree response identity", worktree));
  assert.equal(worktree.body.worktreeDecision, true, diagnostic("worktree saved decision", worktree));
  assert.deepEqual(writes[0], [f.cwd, f.agentDir, "worktree", true]);
  assert.equal(new ProjectTrustStore(f.agentDir).get(f.cwd), true);
  assert.deepEqual(new ProjectTrustStore(f.agentDir).getEntry(subdir), { path: f.cwd, decision: true },
    "SDK lookup inherits the registered root entry; no nested grant is fabricated");
  assert.deepEqual(checked, [f.cwd]); assert.deepEqual(destroyed[0], [f.cwd]);
  const repository = await post(f.cwd, "repository");
  assert.equal(repository.status, 200, diagnostic("repository POST", repository));
  assert.equal(repository.body.repositoryTrusted, true, diagnostic("repository saved decision", repository));
  assert.deepEqual(writes[1], [f.cwd, f.agentDir, "repository", true]); assert.equal(writes.length, 2);
  assert.deepEqual(new Set(destroyed[1]), new Set([f.cwd, linked])); assert.equal(checked.includes(linked), true);
  assert.deepEqual(new Set(checked.slice(1)), new Set([f.cwd, linked]));
  assert.equal(new ProjectTrustStore(f.agentDir).get(linked), null, "repository grant does not fabricate a linked checkout-specific SDK grant");
  assert.equal(invalidated.length, 2);
});


test("startup busy identity follows physical aliases and releases on full startup settlement", async t => {
  const f = await rpcStartup(t, { holdServices: true });
  const alias = join(f.root, "alias"); await symlink(f.cwd, alias, "dir");
  const starting = f.start(); await f.serviceEntered.promise;
  assert.equal(f.rpc.hasBusyRpcSessionWithin(f.cwd), true);
  assert.equal(f.rpc.hasBusyRpcSessionWithin(alias), true);
  f.serviceGate.resolve(); const { session } = await starting; await session.waitUntilReady();
  assert.equal(f.rpc.hasBusyRpcSessionWithin(alias), false);
});

test("startup refuses a saved cwd change before any resource construction", async t => {
  const f = await rpcStartup(t, { headerCwd: "/different-header-cwd" });
  await f.owner.work(assert.rejects(f.rpc.startRpcSession("url-alias", "/fixture/saved.jsonl", f.cwd), /Session cwd changed during startup/));
  assert.equal(f.calls.some(([name]) => name === "services" || name === "construct"), false);
  assert.equal(globalThis.__piStartingSessionCwds.size, 0);
});


test("trust shutdown error waits for owned work and reports failure without pretending persisted decision rolled back", async t => {
  const f = await rpcStartup(t); await mkdir(join(f.cwd, ".pi", "extensions"), { recursive: true });
  const entered = deferred(), release = deferred(), invalidated = [];
  f.owner.release(() => release.resolve());
  const route = await trustApi(f, { hasBusyRpcSessionWithin: () => false, destroyRpcSessionsInWorktrees: async () => {
    entered.resolve(); await release.promise; throw new Error("controlled shutdown failure");
  } }, invalidated);
  let responded = false;
  const work = f.owner.work(route.POST(trustedRequest("/api/project-trust", { cwd: f.cwd })).then(async response => {
    responded = true; return { status: response.status, body: await response.json() };
  }));
  await entered.promise;
  assert.equal(responded, false); assert.equal(getProjectTrustStatus(f.cwd, f.agentDir).trusted, true); assert.deepEqual(invalidated, [true]);
  release.resolve(); const result = await work;
  assert.equal(result.status, 500); assert.match(result.body.error, /controlled shutdown failure/);
  assert.equal(getProjectTrustStatus(f.cwd, f.agentDir).trusted, true);
});
