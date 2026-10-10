import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { managementRows, managementPendingOrder, managementPage, managementDatesComplete } = await jiti.import("./worktree-management-view.ts");
const managerCopy = await jiti.import("./i18n/worktree-manager-messages.ts");
const { worktreeManagerEnglish } = managerCopy;
const { enLocale } = await jiti.import("./i18n/messages/en.ts");
const defaults = { search: "", integration: "all", checkout: "all", sort: "integrated-first", descending: false };
function row(branch, integration, tipDate = null, worktrees = [], mergeDate = { state: "not-loaded" }) {
  return { id: `branch:${branch}`, branch, integration, tipDate, worktrees, mergeDate };
}
test("whole-inventory default is integrated first then oldest tip with name tie-break", () => {
  const rows = [row("other", "not-integrated", "2020-01-01"), row("z", "integrated", "2022-01-01"), row("a", "integrated", "2021-01-01"), row("b", "integrated", "2021-01-01")];
  assert.deepEqual(managementRows(rows, defaults).map((r) => r.branch), ["a", "b", "z", "other"]);
  assert.equal(rows[0].branch, "other");
});
test("filters combine over names and worktree paths, not just a page", () => {
  const w = { path: "/Project/Worker", detached: false, missing: false, locked: null, prunable: null };
  const rows = [row("a", "integrated", null, [w]), row("b", "integrated"), row("other", "not-integrated", null, [w])];
  assert.deepEqual(managementRows(rows, { ...defaults, search: "worker", integration: "integrated", checkout: "has" }).map((r) => r.branch), ["a"]);
  assert.deepEqual(managementRows(rows, { ...defaults, checkout: "none" }).map((r) => r.branch), ["b"]);
  assert.deepEqual(managementRows([row("locked", "unknown", null, [{ ...w, locked: "" }])], { ...defaults, checkout: "diagnostic" }).map((r) => r.branch), ["locked"]);
});
test("unavailable dates remain last even when descending and are distinct from not loaded", () => {
  const rows = [row("unknown", "integrated", null, [], { state: "unavailable", reason: "history-budget" }), row("old", "integrated", null, [], { state: "available", date: "2020-01-01" }), row("new", "integrated", null, [], { state: "available", date: "2021-01-01" })];
  assert.deepEqual(managementRows(rows, { ...defaults, sort: "merge", descending: true }).map((r) => r.branch), ["new", "old", "unknown"]);
  assert.equal(managementDatesComplete(rows), true);
  assert.equal(managementDatesComplete([...rows, row("unread", "integrated")]), false);
});
test("incomplete date refresh preserves complete order, filters removed rows and appends new matches without mutation", () => {
  const rows = [row("new", "integrated"), row("a", "integrated"), row("b", "integrated"), row("another", "integrated")];
  assert.deepEqual(managementPendingOrder(rows, ["branch:b", "removed", "branch:a"]).map((r) => r.branch), ["b", "a", "new", "another"]);
  assert.deepEqual(rows.map((r) => r.branch), ["new", "a", "b", "another"]);
});
test("pagination clamps after cleanup without resetting an unaffected page", () => {
  assert.equal(managementPage(2, 151), 2);
  assert.equal(managementPage(2, 100), 1);
  assert.equal(managementPage(2, 0), 0);
});
test("manager copy contributes nonempty namespaced messages to the English-only catalog", () => {
  assert.equal(worktreeManagerEnglish["manager.title"], "Manage branches & worktrees");
  for (const [key, value] of Object.entries(worktreeManagerEnglish)) {
    assert.ok(key.startsWith("manager."));
    assert.ok(typeof value === "string" && value.length);
    assert.equal(enLocale.messages[key], value);
  }
  assert.equal("worktreeManagerSimplifiedChinese" in managerCopy, false);
  assert.equal("worktreeManagerTraditionalChinese" in managerCopy, false);
});
