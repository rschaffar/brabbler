import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(), "pi-web-skills-listing-"));
const agentDir = join(root, "agent"), home = join(root, "home"), pkg = join(root, "pkg");
const cwd = join(root, "project"), restricted = join(root, "restricted");
process.env.PI_CODING_AGENT_DIR = agentDir; process.env.HOME = home; process.env.PI_OFFLINE = "1";
const originalFetch = globalThis.fetch, requests = [];
globalThis.fetch = async (input) => { requests.push(String(input)); throw new Error("Unexpected fixture HTTP"); };
const extension = `(globalThis as any).__skillListingImports = ((globalThis as any).__skillListingImports ?? 0) + 1;
export default function(pi: any) { pi.on("resources_discover", () => ({ skillPaths: [${JSON.stringify(join(root, "discovered"))}] })); }`;
async function skill(base, name) {
  const dir = join(base, name); await mkdir(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  await writeFile(file, `---\nname: ${name}\ndescription: ${name} skill\n---\n# Instructions\n`);
  return file;
}
await mkdir(home); await mkdir(join(agentDir, "extensions"), { recursive: true });
await writeFile(join(agentDir, "extensions", "global.ts"), extension);
await skill(join(agentDir, "skills"), "global-skill");
await skill(join(home, ".agents", "skills"), "global-agents-skill");
await skill(join(root, "discovered"), "extension-skill");
await mkdir(join(pkg, "extensions"), { recursive: true });
await writeFile(join(pkg, "extensions", "index.ts"), extension);
await skill(join(pkg, "skills"), "package-skill");
await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "listing-fixture", version: "1.0.0", pi: { skills: ["./skills"], extensions: ["./extensions"] } }));
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [pkg] }));
let projectSkill;
for (const project of [cwd, restricted]) {
  await mkdir(join(project, ".pi", "extensions"), { recursive: true });
  await writeFile(join(project, ".pi", "extensions", "project.ts"), extension);
  const file = await skill(join(project, ".pi", "skills"), "project-skill");
  await skill(join(project, ".agents", "skills"), "project-agents-skill");
  if (project === cwd) projectSkill = file;
}
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const { loadSkillsWithInstallInfo } = await jiti.import("./skills-service.ts");
const { trustProject, projectTrustReloadOptions, setProjectTrust } = await jiti.import("./project-trust.ts");
const { DefaultResourceLoader } = await import("@earendil-works/pi-coding-agent");
const { allowFileRoot, isExistingFilePathAllowed, getAllowedFileRoots } = await jiti.import("./file-access.ts");
const { GET } = await jiti.import("../app/api/skills/content/route.ts");
trustProject(cwd, agentDir); allowFileRoot(cwd);
const names = (skills) => skills.map((item) => item.name).sort();
const content = () => GET(new Request(`http://localhost/api/skills/content?${new URLSearchParams({ cwd, filePath: projectSkill })}`));
after(async () => { globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); assert.deepEqual(requests, []); });

test("fresh listing imports no extensions and preserves global/package/trusted project discovery", async () => {
  const listed = await loadSkillsWithInstallInfo(cwd);
  assert.equal(globalThis.__skillListingImports ?? 0, 0);
  assert.equal(listed.projectResourcesLoaded, true);
  assert.deepEqual(names(listed.skills), ["global-agents-skill", "global-skill", "package-skill", "project-agents-skill", "project-skill"]);
  const denied = await loadSkillsWithInstallInfo(restricted);
  assert.equal(denied.projectResourcesLoaded, false);
  assert.ok(!names(denied.skills).includes("project-skill"));
  assert.equal(globalThis.__skillListingImports ?? 0, 0);
});

test("full loader parity proves extension resource events were never part of listings", async () => {
  const listed = await loadSkillsWithInstallInfo(cwd);
  const full = new DefaultResourceLoader({ cwd, agentDir }); await full.reload(projectTrustReloadOptions(cwd, agentDir));
  assert.ok(globalThis.__skillListingImports > 0);
  const paths = (skills) => skills.map(({ name, filePath }) => [name, filePath]).sort();
  assert.deepEqual(paths(listed.skills), paths(full.getSkills().skills));
  assert.ok(!names(listed.skills).includes("extension-skill"));
});

test("disabled package skills immediately lose content authorization", async () => {
  const filePath = join(pkg, "skills", "package-skill", "SKILL.md");
  const read = () => GET(new Request(`http://localhost/api/skills/content?${new URLSearchParams({ cwd, filePath })}`));
  assert.equal((await read()).status, 200);
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [{ source: pkg, extensions: [], skills: [], prompts: [], themes: [] }] }));
  assert.equal((await read()).status, 404);
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [pkg] }));
  assert.equal((await read()).status, 200);
});

test("content membership is fresh after exclusion, removal and trust revocation; no new file root", async () => {
  assert.equal((await content()).status, 200);
  await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ skills: [`-${projectSkill}`] }));
  assert.equal((await content()).status, 404);
  await writeFile(join(cwd, ".pi", "settings.json"), "{}");
  assert.equal((await content()).status, 200);
  setProjectTrust(cwd, agentDir, "worktree", false);
  assert.equal((await content()).status, 404);
  trustProject(cwd, agentDir);
  await rm(projectSkill);
  assert.equal((await content()).status, 404);
  assert.equal(isExistingFilePathAllowed(join(pkg, "skills", "package-skill", "SKILL.md"), await getAllowedFileRoots()), false);
});
