import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const { appendSessionAccounts, readSessionAccounts } = await createJiti(import.meta.url).import("./session-accounts.ts");

test("session account snapshots are append-only and legacy sessions stay on Pi default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brabbler-session-accounts-"));
  try {
    const manager = SessionManager.create(dir, dir);
    assert.equal(readSessionAccounts(manager.getEntries()), undefined);
    appendSessionAccounts(manager, { anthropic: "work", openai: "personal" });
    assert.deepEqual(readSessionAccounts(manager.getEntries()), { anthropic: "work", openai: "personal" });
    appendSessionAccounts(manager, { openai: "personal" });
    assert.deepEqual(readSessionAccounts(manager.getEntries()), { openai: "personal" });
    appendSessionAccounts(manager, {});
    assert.deepEqual(readSessionAccounts(manager.getEntries()), {});
  } finally { await rm(dir, { recursive: true, force: true }); }
});
