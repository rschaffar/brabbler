import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultResourceLoader, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { interopDefault: true });
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
    Array.from(rpcSource.matchAll(/this\.syncProjectTrust\(\);\s*invalidateSettingsListingRuntime\(\);\s*try \{\s*await this\.inner\.reload/g)).length,
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

  assert.match(source, /setProjectTrust\(scope === "worktree" \? worktreeCwd : result\.cwd, agentDir/);
  assert.match(source, /isApiRequestAllowed\(req\)/);
  assert.match(source, /invalidateModelsCache\(\)/);
  assert.match(source, /affected\.some\(hasBusyRpcSessionWithin\)/);
  assert.match(source, /destroyRpcSessionsInWorktrees\(affected\)/);
  assert.match(rpcSource, /trackStartingSession\(expectedCwd\)/);
  assert.match(rpcSource, /samePath\(sessionCwd, expectedCwd\)/);
  assert.match(rpcSource, /realpathSync\(resolvedCwd\)/);
});
