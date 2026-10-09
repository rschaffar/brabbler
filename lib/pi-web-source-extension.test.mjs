import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createPiWebSourceExtension, piWebSourceLocation } = await jiti.import("./pi-web-source-extension.ts");
const root = fileURLToPath(new URL("../", import.meta.url));

test("locates only a complete Pi Web source tree and reads its own version", () => {
  const path = mkdtempSync(join(tmpdir(), "pi-web-source-"));
  try {
    assert.equal(piWebSourceLocation(path), null);
    writeFileSync(join(path, "package.json"), JSON.stringify({ name: "other", version: "1.2.3" }));
    mkdirSync(join(path, "app"));
    mkdirSync(join(path, "lib"));
    writeFileSync(join(path, "app/layout.tsx"), "");
    writeFileSync(join(path, "lib/rpc-manager.ts"), "");
    assert.equal(piWebSourceLocation(path), null);
    writeFileSync(join(path, "package.json"), JSON.stringify({ name: "@agegr/pi-web", version: "1.2.3" }));
    assert.deepEqual(piWebSourceLocation(path), { path, version: "1.2.3" });
    rmSync(join(path, "lib/rpc-manager.ts"));
    assert.equal(piWebSourceLocation(path), null);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test("default lookup follows the running module, not an unrelated working directory", () => {
  const elsewhere = mkdtempSync(join(tmpdir(), "pi-web-other-cwd-"));
  const cwd = process.cwd();
  try {
    process.chdir(elsewhere);
    assert.deepEqual(piWebSourceLocation(), { path: resolve(root), version: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version });
  } finally {
    process.chdir(cwd);
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("source tool provides an on-demand pointer without reading the source", async () => {
  let tool;
  const extension = createPiWebSourceExtension(() => ({ path: "/installed/pi-web", version: "1.2.3" }));
  extension.factory({ registerTool: (registered) => { tool = registered; } });
  assert.equal(extension.hidden, true);
  assert.equal(tool.name, "pi_web_source");
  assert.deepEqual(tool.parameters.properties, {});
  const result = await tool.execute();
  assert.match(result.content[0].text, /Pi Web 1\.2\.3 source: \/installed\/pi-web/);
  assert.doesNotMatch(result.content[0].text, /system prompt/i);
  const unavailable = createPiWebSourceExtension(() => null);
  unavailable.factory({ registerTool: (registered) => { tool = registered; } });
  assert.equal((await tool.execute()).isError, true);
});

test("npm tarball allowlist contains version-matched first-party source, not local data", () => {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  }))[0];
  const files = new Set(packed.files.map((file) => file.path));
  for (const file of ["app/layout.tsx", "app/globals.css", "components/ChatWindow.tsx",
    "components/ChatMinimap.module.css", "hooks/useAgentSession.ts", "lib/rpc-manager.ts", "lib/pi-web-source-extension.ts", "proxy.ts", "instrumentation.ts",
    "plugins/git-workflow/index.ts", "next.config.ts", "tsconfig.json", "package.json"]) assert.ok(files.has(file), `missing ${file}`);
  assert.equal(packed.version, JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, "pack version must match checkout");
  if (existsSync(join(root, ".git"))) {
    const tracked = execFileSync("git", ["ls-files", "--", "app", "components", "hooks", "lib", "plugins"], { cwd: root, encoding: "utf8" });
    for (const file of tracked.trim().split("\n").filter((path) => /\.(ts|tsx|mjs|css|ico|LICENSE)$/.test(path))) {
      assert.ok(files.has(file), `tracked first-party source missing: ${file}`);
    }
  }
  for (const file of files) assert.doesNotMatch(file, /(^|\/)(\.env[^/]*|\.git|node_modules|\.agents)(\/|$)/);
});
