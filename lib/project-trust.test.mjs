import assert from "node:assert/strict";
import fs, { existsSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
const nativeMkdtemp = fs.mkdtempSync;
let stagingHook;
fs.mkdtempSync = (...args) => {
  const path = nativeMkdtemp(...args);
  if (String(args[0]).includes("trust-stage-")) stagingHook?.(path);
  return path;
};
syncBuiltinESMExports();
after(() => { fs.mkdtempSync = nativeMkdtemp; syncBuiltinESMExports(); });
const jiti = createJiti(import.meta.url, { interopDefault: true });
const { getProjectTrustStatus, projectTrustReloadOptions, trustProject, createGitProjectTrustStore } = await jiti.import("./project-trust.ts");
const { readGitScopedAuthorityRevision } = await jiti.import("./git-scoped-authority.ts");
const { ProjectTrustStore } = await jiti.import("@earendil-works/pi-coding-agent");

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

test("all project resource loaders and reloads enforce project trust", async () => {
  const rpcSource = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const modelsSource = await readFile(new URL("../app/api/models/route.ts", import.meta.url), "utf8");
  const skillsSource = await readFile(new URL("./skills-service.ts", import.meta.url), "utf8");
  const skillsInstallSource = await readFile(new URL("../app/api/skills/install/route.ts", import.meta.url), "utf8");
  const pluginsSource = await readFile(new URL("../app/api/plugins/route.ts", import.meta.url), "utf8");

  assert.match(rpcSource, /const sessionCwd = sessionManager\.getCwd\(\)/);
  assert.match(rpcSource, /projectTrustReloadOptions\(sessionCwd, agentDir\)/);
  assert.match(rpcSource, /resourceLoaderReloadOptions: trustReloadOptions/);
  assert.equal(
    Array.from(rpcSource.matchAll(/this\.syncProjectTrust\(\);\s*await this\.inner\.reload/g)).length,
    2,
  );

  assert.match(modelsSource, /projectTrustReloadOptions\(cwd, agentDir\)/);
  assert.match(modelsSource, /resourceLoaderReloadOptions: trustReloadOptions/);
  assert.match(skillsSource, /loader\.reload\(projectTrustReloadOptions\(cwd, agentDir\)\)/);
  assert.match(pluginsSource, /projectTrusted: projectTrust\.trusted/);
  assert.match(
    skillsInstallSource,
    /getProjectTrustStatus\(cwd, getAgentDir\(\)\)\.trusted/,
  );
  assert.equal(
    Array.from(pluginsSource.matchAll(/projectTrusted: projectTrust\.trusted/g)).length,
    2,
  );
  assert.match(pluginsSource, /scope === "project" && !projectTrust\.trusted/);
});

test("the trust API invalidates cached models and restricted runtimes", async () => {
  const source = await readFile(new URL("../app/api/project-trust/route.ts", import.meta.url), "utf8");
  const rpcSource = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  assert.match(source, /trustProject\(result\.cwd, agentDir\)/);
  assert.match(source, /invalidateModelsCache\(\)/);
  assert.match(source, /destroyRpcSessionsForCwd\(result\.cwd\)/);
  assert.match(source, /hasBusyRpcSessionForCwd\(result\.cwd\)/);
  assert.match(rpcSource, /trackStartingSession\(sessionCwd\)/);
  assert.match(rpcSource, /realpathSync\(resolvedCwd\)/);
});

test("P2: staging-creation symlink retarget cannot publish Alpha decisions under Beta generations", async (t) => {
  const { root, cwd: alpha, agentDir } = await createProjectFixture(t);
  const beta = join(root, "Beta"), link = join(root, "selected-link");
  await mkdir(beta); await mkdir(join(alpha, ".pi", "extensions"), { recursive: true });
  fs.symlinkSync(beta, link, "dir");
  const store = createGitProjectTrustStore(agentDir);
  store.set(alpha, true);
  const file = join(agentDir, "trust.json"), bytes = await readFile(file, "utf8");
  const scope = { projectRoots: [alpha], sessionId: "A", trustPaths: [alpha] };
  const original = readGitScopedAuthorityRevision(agentDir, scope);
  const failures = [], observed = [];
  let injected = 0;
  stagingHook = () => { injected++; fs.unlinkSync(link); fs.symlinkSync(alpha, link, "dir"); };
  try {
    for (const decision of [true, false, true]) {
      fs.unlinkSync(link); fs.symlinkSync(beta, link, "dir");
      try { store.setMany([{ path: link, decision }]); failures.push(undefined); }
      catch (cause) { failures.push(cause.message); }
      observed.push(getProjectTrustStatus(alpha, agentDir).trusted);
    }
  } finally { stagingHook = undefined; }
  assert.equal(injected, 3);
  assert.ok(failures.every((message) => /trust.*(target|destination|delta).*changed/i.test(message ?? "")),
    `must reject all retargeted effects, not silently rescope: ${JSON.stringify({ failures, observed })}`);
  assert.deepEqual(observed, [true, true, true]);
  assert.equal(await readFile(file, "utf8"), bytes);
  assert.equal(readGitScopedAuthorityRevision(agentDir, scope), original, "rejected Beta attempt changed no Alpha authority");
});

test("P2: restored ancestor swap inside the actual staged SDK cannot hide equal-value or false/true writes", async (t) => {
  const { root, cwd: alphaParent, agentDir } = await createProjectFixture(t);
  const betaParent = join(root, "Beta"), alpha = join(alphaParent, "child"), beta = join(betaParent, "child"), parked = `${betaParent}.parked`;
  await mkdir(alpha, { recursive: true }); await mkdir(beta, { recursive: true });
  await mkdir(join(alpha, ".pi", "extensions"), { recursive: true });
  const store = createGitProjectTrustStore(agentDir);
  store.setMany([{ path: alpha, decision: true }, { path: beta, decision: true }]);
  const file = join(agentDir, "trust.json"), bytes = await readFile(file, "utf8");
  const scope = { projectRoots: [alpha], sessionId: "A", trustPaths: [alpha] };
  const original = readGitScopedAuthorityRevision(agentDir, scope), native = ProjectTrustStore.prototype.setMany;
  const failures = []; let swaps = 0;
  ProjectTrustStore.prototype.setMany = function (updates) {
    assert.ok(updates.every((update) => update.path === beta), "adapter must pass captured canonical destinations");
    swaps++; fs.renameSync(betaParent, parked); fs.symlinkSync(alphaParent, betaParent, "dir");
    try { return native.call(this, updates); }
    finally { fs.unlinkSync(betaParent); fs.renameSync(parked, betaParent); }
  };
  try {
    for (const decision of [true, false, true]) {
      try { store.setMany([{ path: beta, decision }]); failures.push(undefined); }
      catch (cause) { failures.push(cause.message); }
    }
  } finally { ProjectTrustStore.prototype.setMany = native; }
  assert.ok(swaps >= 3, "the actual staged SDK must have normalized through the transient ancestor");
  assert.ok(failures.every((message) => /staged delta changed/.test(message ?? "")), JSON.stringify(failures));
  assert.equal(fs.realpathSync(beta), beta, "restored paths/physical target identities alone cannot detect this race");
  assert.equal(await readFile(file, "utf8"), bytes, "publish only verified SDK bytes, never the unexpected Alpha delta");
  assert.equal(readGitScopedAuthorityRevision(agentDir, scope), original);
  assert.equal(getProjectTrustStatus(alpha, agentDir).trusted, true);
});

test("pinned setMany retains SDK 1.0.0 normalized keys, duplicate ordering, null removal and exact format", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  const alias = join(root, "alias"), missing = join(root, "future-project"), referenceDir = join(root, "reference-agent");
  fs.symlinkSync(cwd, alias, "dir");
  const store = createGitProjectTrustStore(agentDir), reference = new ProjectTrustStore(referenceDir);
  const cases = [
    [{ path: alias, decision: true }],
    [{ path: relative(process.cwd(), cwd), decision: false }],
    [{ path: pathToFileURL(cwd).href, decision: true }],
    [{ path: `~/${relative(homedir(), cwd)}`, decision: false }],
    [{ path: missing, decision: true }],
    [{ path: cwd, decision: true }, { path: alias, decision: null }, { path: cwd, decision: false }],
    [{ path: cwd, decision: null }], [],
  ];
  for (const updates of cases) {
    store.setMany(updates); reference.setMany(updates);
    assert.equal(await readFile(join(agentDir, "trust.json"), "utf8"), await readFile(join(referenceDir, "trust.json"), "utf8"));
  }
});

test("accounted SDK setMany preserves closest ancestor precedence, null removal and scoped change-and-restore", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  const sibling = join(root, "sibling"); await mkdir(sibling);
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  const store = createGitProjectTrustStore(agentDir);
  const scope = { projectRoots: [cwd], sessionId: "A", trustPaths: [cwd] };
  const revision = () => readGitScopedAuthorityRevision(agentDir, scope);
  const initial = revision();
  store.setMany([{ path: sibling, decision: true }]); assert.equal(revision(), initial);
  store.setMany([{ path: root, decision: true }]); assert.notEqual(revision(), initial);
  assert.equal(getProjectTrustStatus(cwd, agentDir).trusted, true);
  store.set(cwd, false); assert.equal(getProjectTrustStatus(cwd, agentDir).trusted, false);
  store.setMany([{ path: root, decision: false }, { path: cwd, decision: null }]);
  assert.equal(getProjectTrustStatus(cwd, agentDir).trusted, false);
  store.set(root, true); const beforeRestore = revision();
  store.set(root, false); store.set(root, true);
  assert.notEqual(revision(), beforeRestore); assert.equal(getProjectTrustStatus(cwd, agentDir).trusted, true);
  const equal = revision(); store.set(root, true); assert.notEqual(revision(), equal);
});
