import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { isHistoryOnlySession } = await jiti.import("./session-directory.ts");
const { attachSessionProjectInfo } = await jiti.import("./session-reader.ts");

test("directory state is advisory and missing/unavailable histories never imply a fallback", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-history-directory-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const missing = join(dir, "missing"), file = join(dir, "file");
  await writeFile(file, "not a directory");
  const rows = await attachSessionProjectInfo([dir, missing, file].map((cwd, index) => ({ cwd, id: String(index), path: "/fixture.jsonl", created: "created", modified: "modified", messageCount: 0, firstMessage: "history" })));
  assert.deepEqual(rows.map(row => row.cwdState), ["present", "missing", "unavailable"]);
  assert.deepEqual(rows.map(row => row.cwd), [dir, missing, file]);
  assert.deepEqual(rows.map(isHistoryOnlySession), [false, true, true]);
  assert.equal(existsSync(missing), false);
  assert.equal(isHistoryOnlySession(null), false);
  assert.equal(isHistoryOnlySession({}), false, "transient and legacy metadata retain existing behavior");
});
