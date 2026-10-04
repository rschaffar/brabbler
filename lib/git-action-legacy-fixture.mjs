// Test-only creation of historical v1 JSON. Production journal has NO v1 writer.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const nativeRecipe = value.snapshot?.version === 2 && Object.hasOwn(value, "checkIndex") && Object.hasOwn(value, "recipe");
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${nativeRecipe && key === "recipe" ? JSON.stringify(value[key]) : canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export const hash = value => createHash("sha256").update(value).digest("hex");
export const document = record => canonical({ version: 1, record, sha256: hash(canonical(record)) });
export function writeLegacyGitActionFixture(agentDir, record, candidate) {
  assert.ok(process.env.NODE_TEST_CONTEXT, "fixture writer is test-only");
  assert.match(record.id, /^[a-f0-9-]{36}$/);
  assert.ok(fs.statSync(agentDir).isDirectory(), "explicit existing disposable directory required");
  const dir = join(agentDir, "pi-web", "git-actions", "v1", record.id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const paths = { dir, record: join(dir, "record.json"), artifact: join(dir, "candidate.json") };
  fs.writeFileSync(paths.artifact, canonical({ version: 1, candidate }), { flag: "wx", mode: 0o600 });
  fs.writeFileSync(paths.record, document(record), { flag: "wx", mode: 0o600 });
  return paths;
}
