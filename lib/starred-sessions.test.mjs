import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { parseStarredSessionIds, serializeStarredSessionIds } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./starred-sessions.ts");

test("starred session ids round-trip deterministically", () => {
  const ids = parseStarredSessionIds('["session-b","session-a","session-a"]');
  assert.deepEqual([...ids], ["session-b", "session-a"]);
  assert.equal(serializeStarredSessionIds(ids), '["session-a","session-b"]');
});

test("invalid or malformed starred-session storage fails closed", () => {
  assert.deepEqual([...parseStarredSessionIds(null)], []);
  assert.deepEqual([...parseStarredSessionIds("not json")], []);
  assert.deepEqual([...parseStarredSessionIds('{"id":"session"}')], []);
  assert.deepEqual([...parseStarredSessionIds('["ok",null,1,""]')], ["ok"]);
});
