import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });

test("HTML export patches the installed Pi SDK template", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "brabbler-export-sdk-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = "1";
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previousOffline;
    rmSync(agentDir, { recursive: true, force: true });
  });

  const cwd = join(agentDir, "project");
  mkdirSync(cwd);
  const manager = SessionManager.create(cwd);
  manager.appendMessage({ role: "user", content: "Hello", timestamp: Date.now() });

  const { GET } = await jiti.import("./route.ts");
  const response = await GET(
    new Request(`http://127.0.0.1/api/sessions/${manager.getSessionId()}/export?inline=1`),
    { params: Promise.resolve({ id: manager.getSessionId() }) },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /function sortChildren\(root\)/);
  assert.match(html, /const stack = \[\.\.\.tree\]\.reverse\(\)/);
  assert.match(html, /function markActive\(root\)/);
  assert.doesNotMatch(html, /node\.children\.forEach\(sortChildren\)/);
});
