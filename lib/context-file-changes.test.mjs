import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { loadProjectContextFiles } from "@earendil-works/pi-coding-agent";

const { haveContextFilesChanged } = await createJiti(import.meta.url).import("./context-file-changes.ts");

test("detects edited, added, removed, and newly overriding context files without a resource reload", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-context-change-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  mkdirSync(cwd);
  mkdirSync(agentDir);
  const projectFile = join(cwd, "AGENTS.md");
  const globalFile = join(agentDir, "AGENTS.md");
  const overrideFile = join(cwd, "AGENTS.override.md");
  try {
    writeFileSync(projectFile, "original");
    const loaded = loadProjectContextFiles({ cwd, agentDir });
    assert.equal(haveContextFilesChanged(loaded, cwd, agentDir), false);

    writeFileSync(projectFile, "edited");
    assert.equal(haveContextFilesChanged(loaded, cwd, agentDir), true);
    writeFileSync(projectFile, "original");
    assert.equal(haveContextFilesChanged(loaded, cwd, agentDir), false);

    writeFileSync(globalFile, "new global instructions");
    assert.equal(haveContextFilesChanged(loaded, cwd, agentDir), true);
    unlinkSync(globalFile);
    assert.equal(haveContextFilesChanged(loaded, cwd, agentDir), false);

    writeFileSync(overrideFile, "override");
    assert.equal(haveContextFilesChanged(loaded, cwd, agentDir), true);
    unlinkSync(overrideFile);
    assert.equal(haveContextFilesChanged(loaded, cwd, agentDir), false);

    unlinkSync(projectFile);
    assert.equal(haveContextFilesChanged(loaded, cwd, agentDir), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
