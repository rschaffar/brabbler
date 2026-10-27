import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { searchSessionContents } from "./session-search.ts";

test("demo content search returns a message target and preserves archived metadata", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "brabbler-demo-search-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "session.jsonl");
  writeFileSync(path, JSON.stringify({ type: "message", id: "entry-1", message: {
    role: "assistant", content: [{ type: "text", text: "First block" }, { type: "text", text: "A searchable detail" }],
  } }) + "\n");
  const session = { id: "demo-search", path, modified: "2026-10-13T00:00:00Z", archived: true };
  const response = await searchSessionContents([session], "searchable");
  assert.equal(response.truncated, false);
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].kind, "message");
  assert.equal(response.results[0].entryId, "entry-1");
  assert.equal(response.results[0].blockIndex, 1);
  assert.equal(response.results[0].session.archived, true);
  assert.equal(response.results[0].match, "searchable");
});

test("demo content search keeps entry IDs optional without losing the result kind", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "brabbler-demo-search-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "session.jsonl");
  writeFileSync(path, JSON.stringify({ type: "message", message: { role: "user", content: "A match" } }) + "\n");
  const response = await searchSessionContents([{ id: "demo-search", path, modified: "2026-10-13T00:00:00Z" }], "match");
  assert.equal(response.results[0].kind, "message");
  assert.equal(response.results[0].blockIndex, 0);
  assert.equal("entryId" in response.results[0], false);
});
