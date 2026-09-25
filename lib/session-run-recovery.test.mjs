import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  recordRunStart, recordRunSettlement, readPossibleInterruptedRun,
  acknowledgePossibleInterruptedRun, clearSessionRunRecovery, listPossibleInterruptedSessionIds,
} = await createJiti(import.meta.url).import("./session-run-recovery.ts");

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-runs-"));
  try { await fn(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("a live owner is not interrupted; an unsettled dead owner is only a possible interruption", async () => withRoot(async (root) => {
  const runId = recordRunStart("session-one", root);
  assert.equal(readPossibleInterruptedRun("session-one", root), null);
  assert.deepEqual(readPossibleInterruptedRun("session-one", root, () => false), {
    runId, startedAt: (await JSON.parse(await readFile(join(root, "session-one", `${runId}.start.json`), "utf8"))).startedAt,
  });
  recordRunSettlement("session-one", runId, root);
  assert.equal(readPossibleInterruptedRun("session-one", root, () => false), null);
}));

test("acknowledgement hides only the specified run and survives reload", async () => withRoot(async (root) => {
  const first = recordRunStart("session-one", root);
  const second = recordRunStart("session-one", root);
  assert.equal(acknowledgePossibleInterruptedRun("session-one", first, root), true);
  assert.equal(acknowledgePossibleInterruptedRun("session-one", first, root), true);
  assert.equal(readPossibleInterruptedRun("session-one", root, () => false)?.runId, second);
  assert.equal(acknowledgePossibleInterruptedRun("session-two", second, root), false);
  assert.equal(acknowledgePossibleInterruptedRun("session-one", "missing", root), false);
  clearSessionRunRecovery("session-one", root);
  assert.equal(readPossibleInterruptedRun("session-one", root, () => false), null);
  assert.deepEqual(await readdir(root), []);
}));

test("Activity journal listing excludes live, settled, acknowledged and malformed records", async () => withRoot(async (root) => {
  assert.deepEqual(listPossibleInterruptedSessionIds(join(root, "missing")), []);
  const pending = recordRunStart("pending", root);
  const settled = recordRunStart("settled", root);
  recordRunSettlement("settled", settled, root);
  const acknowledged = recordRunStart("acknowledged", root);
  acknowledgePossibleInterruptedRun("acknowledged", acknowledged, root);
  await mkdir(join(root, "invalid name"));
  assert.deepEqual(listPossibleInterruptedSessionIds(root), [], "live owner is not interrupted");
  assert.deepEqual(listPossibleInterruptedSessionIds(root, () => false), ["pending"]);
  acknowledgePossibleInterruptedRun("pending", pending, root);
  assert.deepEqual(listPossibleInterruptedSessionIds(root, () => false), []);
}));

test("reject path traversal and ignore malformed or unknown owners", async () => withRoot(async (root) => {
  assert.throws(() => recordRunStart("../escape", root), /Invalid session ID/);
  assert.throws(() => readPossibleInterruptedRun("/tmp", root), /Invalid session ID/);
  assert.throws(() => acknowledgePossibleInterruptedRun("session-one", "../escape", root), /Invalid run ID/);
  assert.equal(readPossibleInterruptedRun("session-one", root), null);
  const runId = recordRunStart("session-one", root);
  const file = join(root, "session-one", `${runId}.start.json`);
  const start = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...start, ownerPid: null }));
  assert.equal(readPossibleInterruptedRun("session-one", root, () => false), null);
  await writeFile(file, "{");
  assert.equal(readPossibleInterruptedRun("session-one", root, () => false), null);
}));
