import assert from "node:assert/strict";
import test from "node:test";
import { parseReviewBlock, reviewExplorerUrl } from "./review-notebook.ts";

const base = { version: 1, kind: "source", id: "factory", title: "Authenticate first", cwd: "/repo", branch: "feature/review", oid: "a".repeat(40), path: "src/Factory.cs", start: 2, end: 8 };
const parse = (extra = {}) => parseReviewBlock(JSON.stringify({ ...base, ...extra }));
test("versioned source and commit blocks preserve literal, portable references", () => {
  assert.deepEqual(parse().value, base);
  for (const cwd of ["/repo", "C:\\projects\\repo", "\\\\server\\share\\repo", "//server/share/repo"]) assert.ok(parse({ cwd }).value);
  assert.ok(parse({ oid: "b".repeat(64), end: 401 }).value);
  const commit = Object.fromEntries(Object.entries({ ...base, kind: "commit" }).filter(([key]) => !["path", "start", "end"].includes(key)));
  assert.deepEqual(parseReviewBlock(JSON.stringify(commit)).value, commit);
  const log = new URL(reviewExplorerUrl(base, "log"), "http://localhost");
  assert.deepEqual(Object.fromEntries(log.searchParams), { cwd: "/repo", branch: "feature/review", op: "log" });
  const patch = new URL(reviewExplorerUrl(base, "patch", { head: "c".repeat(40), path: ":(glob)*" }), "http://localhost");
  assert.equal(patch.searchParams.get("path"), ":(glob)*");
});
test("invalid or future blocks never become active objects", () => {
  for (const source of ["", "{", "[]", "null", "true", '"text"', " ".repeat(16385)]) assert.ok(parseReviewBlock(source).error);
  for (const extra of [
    { version: 2 }, { kind: "shell" }, { command: "git status" }, { id: "" }, { id: "../stop" },
    { title: "\n" }, { title: "x".repeat(241) }, { cwd: "../repo" }, { cwd: "/repo\0" },
    { branch: "" }, { branch: "main\n" }, { oid: "HEAD" }, { oid: "a".repeat(8) }, { oid: "A".repeat(40) },
    { priority: "approved" }, { priority: ["thorough"] }, { priority: {} },
    { path: "../secret" }, { path: "/secret" }, { path: "a/../secret" }, { path: "C:/secret" },
    { path: "a\\secret" }, { path: "a//b" }, { path: "./a" }, { path: "" }, { path: "a\0b" },
    { start: 0 }, { start: 9 }, { start: 1.5 }, { end: 402 }, { end: Number.MAX_SAFE_INTEGER + 1 }, { end: "8" },
  ]) assert.ok(parse(extra).error, JSON.stringify(extra));
  assert.ok(parse({ kind: "commit" }).error, "commit blocks cannot silently ignore source fields");
});
