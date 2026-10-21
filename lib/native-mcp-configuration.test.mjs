import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { captureMcpConfiguration: capture, listMcpConfiguration: list } = await jiti.import("./native-mcp-configuration.ts");
async function fixture(t, global = {}, project) {
  const root = await mkdtemp(join(tmpdir(), "native-mcp-config-")), agentDir = join(root, "agent"), cwd = join(root, "project");
  await mkdir(agentDir); await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: global }));
  if (project !== undefined) await writeFile(join(cwd, ".pi/mcp.json"), JSON.stringify({ mcpServers: project }));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, agentDir, cwd, projectTrusted: true };
}
test("inert metadata neither resolves references nor returns native values or provisions state", async t => {
  const f = await fixture(t, { selected: { command: "synthetic-executable", args: ["SYNTHETIC_PRIVATE_ARG"], env: { TOKEN: "${SYNTHETIC_UNAVAILABLE}" } },
    header: { url: "https://example.invalid/private", headers: { Authorization: "Bearer SYNTHETIC_PRIVATE_HEADER" } } });
  const rows = await list(f), serialized = JSON.stringify(rows);
  assert.equal(rows.ok, true); assert.equal(rows.servers.length, 2);
  for (const value of ["synthetic-executable", "SYNTHETIC_PRIVATE", "SYNTHETIC_UNAVAILABLE", "example.invalid", f.root]) assert.equal(serialized.includes(value), false);
  assert.equal(existsSync(join(f.agentDir, "pi-web")), false); assert.equal(existsSync(join(f.agentDir, "mcp-auth.json")), false);
});
test("project replacement and partial overrides preserve exact native scope and global origin", async t => {
  const f = await fixture(t, { replaced: { command: "global" }, limited: { command: "global", env: { KEY: "literal" } } },
    { replaced: { command: "project" }, limited: { exposure: "hidden" } });
  const result = await capture(f); assert.equal(result.listing.ok, true);
  const replaced = result.entries.find(entry => entry.name === "replaced"), limited = result.entries.find(entry => entry.name === "limited");
  assert.equal(replaced.scope, "project"); assert.equal(replaced.config.command, "project");
  assert.equal(limited.scope, "global"); assert.equal(limited.config.command, "global"); assert.equal(limited.config.env.KEY, "literal");
  assert.equal(limited.config.exposure, "hidden"); assert.equal(result.listing.servers.find(row => row.name === "limited").projectOverride, true);
});
test("untrusted project files are not read, even if malformed", async t => {
  const f = await fixture(t, { allowed: { command: "global" } });
  await writeFile(join(f.cwd, ".pi/mcp.json"), "SYNTHETIC_MALFORMED_PRIVATE_VALUE");
  const result = await list({ ...f, projectTrusted: false });
  assert.equal(result.ok, true); assert.deepEqual(result.servers.map(row => row.scope), ["global"]);
});
test("OAuth, provider forwarding, helpers, disabled entries and embedded credentials are ineligible", async t => {
  const f = await fixture(t, { oauth: { url: "https://example.invalid", oauth: { clientId: "synthetic" } },
    provider: { url: "https://example.invalid", auth: { provider: "synthetic" } }, helper: { command: "node", env: { KEY: "!must-not-run" } },
    disabled: { command: "node", enabled: false }, embedded: { url: "https://user:synthetic@example.invalid" },
    public: { url: "https://example.invalid" } });
  const result = await list(f); assert.equal(result.ok, true);
  assert.deepEqual(Object.fromEntries(result.servers.map(row => [row.name, row.limitation])), {
    disabled: "disabled", embedded: "invalid-endpoint", helper: "command-helper", oauth: "oauth", provider: "provider-auth", public: undefined,
  });
});
for (const servers of [{ "secret-private-name!": { command: "node" } }, { collision_a: { command: "node" }, "collision-a": { command: "node" } },
  { contradictory: { command: "node", url: "https://example.invalid" } }]) test("invalid effective configuration returns no partial catalogue or rejected values", async t => {
  const f = await fixture(t, { allowed: { command: "node" }, ...servers });
  const result = await capture(f); assert.equal(result.listing.ok, false); assert.deepEqual(result.entries, []); assert.deepEqual(result.listing.servers, []);
  assert.equal(JSON.stringify(result.listing).includes("secret-private-name"), false);
});
test("intentional native/Nix leaf symlinks are readable without migrating them", async t => {
  const f = await fixture(t), target = join(f.root, "declaration.json");
  await writeFile(target, JSON.stringify({ mcpServers: { linked: { command: "node" } } }));
  await rm(join(f.agentDir, "mcp.json")); await symlink(target, join(f.agentDir, "mcp.json"));
  assert.equal((await list(f)).servers[0].name, "linked");
});
