import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { searchSessionContents } from "./session-search.ts";

function fixture(t, entries, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "brabbler-search-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return { id: "session", path, cwd: dir, created: "2026-01-01", modified: "2026-01-01", firstMessage: "first", messageCount: entries.length, ...overrides };
}

function message(role, content) {
  return { type: "message", message: { role, content } };
}

test("finds one literal, case-insensitive snippet per session, newest first", async (t) => {
  const older = fixture(t, [{ ...message("user", "before NEEDLE after"), id: "matched-entry" }, message("user", "needle again")], { id: "older" });
  const newer = fixture(t, [message("assistant", [{ type: "text", text: "another needle" }])], { id: "newer", modified: "2026-02-01" });
  const result = await searchSessionContents([older, newer], " needle ");
  assert.deepEqual(result.results.map(({ session }) => session.id), ["newer", "older"]);
  assert.deepEqual(result.results[1], { session: older, kind: "message", entryId: "matched-entry", blockIndex: 0, before: "before ", match: "NEEDLE", after: " after" });
  assert.equal(result.truncated, false);

  const literal = fixture(t, [message("user", "a".repeat(40) + "!"), message("user", "literal (a+)+$ and [test].*")]);
  assert.equal((await searchSessionContents([literal], "(a+)+$")).results[0].match, "(a+)+$");
  assert.equal((await searchSessionContents([literal], "[test].*")).results[0].match, "[test].*");
});

test("finds full and partial session UUIDs without reading files or duplicating text hits", async (t) => {
  const id = "67a8c11d-88e2-4e75-a123-903f1026ab4e";
  const session = fixture(t, [message("user", `also mentions ${id}`)], { id });
  const missing = { ...session, path: join(session.cwd, "missing.jsonl") };
  const full = await searchSessionContents([missing], id.toUpperCase());
  assert.deepEqual(full.results, [{ session: missing, kind: "id", blockIndex: 0, before: "", match: id, after: "" }]);
  assert.equal(full.truncated, false);
  assert.deepEqual(await searchSessionContents([missing], id, AbortSignal.abort()), { results: [], truncated: true });

  const partial = await searchSessionContents([session], "E75-A123");
  assert.deepEqual(partial.results, [{ session, kind: "id", blockIndex: 0, before: id.slice(0, 15), match: "e75-a123", after: id.slice(23) }]);
  assert.equal(partial.truncated, false);
});

test("finds an old session by ID beyond the content scan limit", async (t) => {
  const old = fixture(t, [message("user", "unrelated")], { id: "01234567-89ab-4cde-8f01-23456789abcd", modified: "2025-01-01" });
  const recent = Array.from({ length: 500 }, (_, i) => ({ ...old, id: `recent-${i}`, modified: "2026-01-01" }));
  const result = await searchSessionContents([...recent, old], old.id);
  assert.deepEqual(result.results.map(({ session }) => session.id), [old.id]);
  assert.equal(result.truncated, false, "the ID hit is excluded from the 500 remaining content candidates");
});

test("ranks exact and prefix metadata before content, deduplicates, and bounds results", async (t) => {
  const content = fixture(t, [message("user", "foobar content")], { id: "content", firstMessage: "other", modified: "2026-03-01" });
  const prefix = fixture(t, [message("user", "foobar content")], { id: "prefix", name: "FooBar title", modified: "2026-01-01" });
  const exact = fixture(t, [message("user", "foobar content")], { id: "exact", name: "FooBar", modified: "2026-01-01" });
  const preview = fixture(t, [message("user", "unrelated")], { id: "preview", firstMessage: "a foobar preview", modified: "2026-02-01" });
  const result = await searchSessionContents([content, prefix, exact, preview], "foobar");
  assert.deepEqual(result.results.map(({ session, kind }) => [session.id, kind]),
    [["exact", "title"], ["prefix", "title"], ["preview", "preview"], ["content", "message"]]);
  assert.equal(result.truncated, false);
  const jump = fixture(t, [{ ...message("user", "first foobar message"), id: "first-entry" }], { id: "jump", firstMessage: "first foobar message" });
  const previewHit = (await searchSessionContents([jump], "foobar")).results[0];
  assert.equal(previewHit.kind, "preview");
  assert.equal(previewHit.entryId, "first-entry", "preview matches keep the message jump target");
  const many = Array.from({ length: 31 }, (_, i) => ({ ...exact, id: `title-${i}`, name: "foobar" }));
  assert.equal((await searchSessionContents(many, "foobar")).truncated, true);
  assert.equal((await searchSessionContents(many.slice(0, 30), "foobar")).truncated, false);
});

test("title-only search excludes previews, IDs and bodies without reading transcripts", async (t) => {
  const title = fixture(t, [message("user", "needle body")], { id: "title", name: "NEEDLE title", firstMessage: "needle" });
  const body = fixture(t, [message("user", "needle body")], { id: "body", name: "Other title" });
  const preview = { ...body, id: "preview", firstMessage: "needle preview" };
  const id = { ...body, id: "needle-id" };
  const unnamed = { ...body, id: "unnamed", name: undefined, firstMessage: "needle" };
  const missing = { ...title, path: join(title.cwd, "missing.jsonl") };
  const search = (sessions, query = "needle") => searchSessionContents(sessions, query, undefined, { titlesOnly: true });
  const result = await search([missing, body, preview, id, unnamed]);
  assert.deepEqual(result.results, [{ session: missing, kind: "title", blockIndex: 0, before: "", match: "NEEDLE", after: " title" }]);
  assert.equal(result.truncated, false, "unreadable files do not make title search incomplete");
  assert.equal((await searchSessionContents([body], "needle")).results[0].kind, "message");
  assert.deepEqual(await search([{ ...missing, name: "other" }]), { results: [], truncated: false });
  assert.equal((await search([{ ...missing, name: "literal [test].*" }], "[test].*")).results[0].match, "[test].*");
  assert.deepEqual(await search([{ ...missing, transient: true }]), { results: [], truncated: false });
  assert.deepEqual(await searchSessionContents([missing], "needle", AbortSignal.abort(), { titlesOnly: true }), { results: [], truncated: true });
});

test("title-only search ranks and caps the whole catalogue, not the file scan window", async (t) => {
  const base = fixture(t, [], { path: "/missing.jsonl", name: "Other title" });
  const recent = Array.from({ length: 501 }, (_, i) => ({ ...base, id: `recent-${i}`, modified: "2026-02-01" }));
  const older = { ...base, id: "old", name: "needle", modified: "2025-01-01" };
  const prefix = { ...base, id: "prefix", name: "needle title" };
  const substring = { ...base, id: "substring", name: "a needle title" };
  const search = (sessions) => searchSessionContents(sessions, "needle", undefined, { titlesOnly: true });
  const result = await search([...recent, substring, prefix, older]);
  assert.deepEqual(result.results.map(({ session }) => session.id), ["old", "prefix", "substring"]);
  assert.equal(result.truncated, false);
  const many = Array.from({ length: 31 }, (_, i) => ({ ...older, id: `title-${String(i).padStart(2, "0")}` }));
  assert.equal((await search(many.slice(0, 30).concat(recent))).truncated, false);
  const capped = await search(many);
  assert.equal(capped.results.length, 30);
  assert.equal(capped.truncated, true);
  assert.deepEqual(capped.results.map(({ session }) => session.id), many.slice(0, 30).map(({ id }) => id));
});

test("identifies the matching text block across thinking, tools and multiple text blocks", async (t) => {
  const session = fixture(t, [message("assistant", [
    { type: "thinking", thinking: "brabbler-cwd-spark" },
    { type: "text", text: "earlier text" },
    { type: "toolCall", name: "read", arguments: {} },
    { type: "text", text: "正文 brabbler-cwd-spark" },
    { type: "text", text: "later text" },
  ])]);
  assert.equal((await searchSessionContents([session], "brabbler-cwd-spark")).results[0].blockIndex, 3);
  assert.equal((await searchSessionContents([session], "earlier text")).results[0].blockIndex, 1);
  assert.equal((await searchSessionContents([session], "later text")).results[0].blockIndex, 4);
  assert.equal((await searchSessionContents([session], "spark\nlater")).results[0].blockIndex, 3);
});

test("searches historical text, excluding tools, thinking, images, summaries and transient sessions", async (t) => {
  const hidden = fixture(t, [
    message("toolResult", "needle"),
    message("assistant", [{ type: "thinking", thinking: "needle" }, { type: "toolCall", arguments: { text: "needle" } }, { type: "image", data: "needle" }]),
    { type: "compaction", summary: "needle" },
    { type: "custom", data: "needle" },
    message("user", null),
    null,
  ]);
  assert.deepEqual((await searchSessionContents([hidden], "needle")).results, []);
  const history = fixture(t, [message("user", "needle before compaction"), { type: "compaction", summary: "summary" }, message("user", "current")]);
  assert.equal((await searchSessionContents([history], "needle")).results.length, 1);
  assert.deepEqual((await searchSessionContents([{ ...history, transient: true }], "needle")).results, []);
});

test("keeps Unicode offsets correct and bounds snippets around the actual match", async (t) => {
  const session = fixture(t, [message("user", `${"x".repeat(200)}\n\u0130 中文 NEEDLE \n${"y".repeat(200)}`)]);
  const result = await searchSessionContents([session], "needle");
  assert.equal(result.results[0].match, "NEEDLE");
  assert.ok(result.results[0].before.startsWith("..."));
  assert.ok(result.results[0].after.endsWith("..."));
  assert.ok(result.results[0].before.length <= 83);
  assert.doesNotMatch(result.results[0].before, /\n/);
  assert.equal((await searchSessionContents([session], "中文")).results[0].match, "中文");
});

test("skips malformed lines and reports unreadable or oversized content as incomplete", async (t) => {
  const session = fixture(t, [message("user", "x".repeat(1024 * 1024 + 1)), message("user", "needle")]);
  const missing = { ...session, id: "missing", path: join(session.cwd, "missing.jsonl") };
  const result = await searchSessionContents([missing, session], "needle");
  assert.equal(result.results.length, 1);
  assert.equal(result.truncated, true);
  writeFileSync(session.path, `invalid\n${JSON.stringify(message("user", "needle"))}\n{"type":`);
  assert.equal((await searchSessionContents([session], "needle")).results.length, 1);
});

test("handles empty, oversized and cancelled queries without reading a session", async (t) => {
  const session = fixture(t, [message("user", "needle")]);
  assert.deepEqual(await searchSessionContents([session], "  "), { results: [], truncated: false });
  await assert.rejects(searchSessionContents([session], "x".repeat(201)), RangeError);
  assert.deepEqual(await searchSessionContents([session], "needle", AbortSignal.abort()), { results: [], truncated: true });
});

test("bounds bytes read from a single file and reports the unsearched remainder", async (t) => {
  const session = fixture(t, []);
  // The real 16 MiB cap exceeds a supervised check's 8 MiB hard file-size
  // limit. Exercise the identical read boundary with a smaller safe budget.
  writeFileSync(session.path, " ".repeat(256 * 1024) + "\n" + JSON.stringify(message("user", "needle")));
  assert.deepEqual(await searchSessionContents([session], "needle", undefined, { maxFileBytes: 128 * 1024 }),
    { results: [], truncated: true });
  await assert.rejects(searchSessionContents([session], "needle", undefined, { maxFileBytes: 16 * 1024 * 1024 + 1 }),
    RangeError);
});

test("checks the deadline inside the final file, before the matching line", async (t) => {
  const session = fixture(t, [message("user", "no match"), message("user", "needle")]);
  let ticks = 0;
  t.mock.method(Date, "now", () => ++ticks <= 3 ? 0 : 4000);
  assert.deepEqual(await searchSessionContents([session], "needle"), { results: [], truncated: true });
});

test("reports file and result caps even when no conversations match", async (t) => {
  const session = fixture(t, [message("user", "needle")]);
  const sessions = Array.from({ length: 501 }, (_, index) => ({ ...session, id: String(index) }));
  const noMatches = await searchSessionContents(sessions, "absent");
  assert.deepEqual(noMatches, { results: [], truncated: true });
  const capped = await searchSessionContents(sessions, "needle");
  assert.equal(capped.results.length, 30);
  assert.equal(capped.truncated, true);
  assert.equal((await searchSessionContents(sessions.slice(0, 30), "needle")).truncated, false);
});
