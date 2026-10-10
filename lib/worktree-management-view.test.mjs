import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { managementRows, managementPendingOrder, managementPage, managementDatesComplete, managementRowKind, managementSelection, managementRemovalBlockers, managementRemovalPayload, managementAcknowledgmentKey, managementOperationPresentation } = await jiti.import("./worktree-management-view.ts");
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
const oid = "a".repeat(40), targetOid = "b".repeat(40);
const checkout = (path, extra = {}) => ({ path, head: oid, branch: "feature", main: false, selected: false, detached: false, locked: null, prunable: null, missing: false, ...extra });
const status = (path, state = "clean") => ({ path, state, trackedDirty: state === "dirty", untracked: [], ignored: [], submodules: "ignored" });
const removable = (extra = {}) => ({ ...row("feature", "unknown", "2020-01-01"), tip: oid, symbolic: false, blockers: [], ...extra });
const both = { resource: "both", worktreePath: "/one" };
test("normalization handles branch/detached/diagnostic transitions even at the same path and old fixtures", () => {
  const branch = removable({ worktrees: [checkout("/one")] });
  const detached = removable({ id: "registration:stable", kind: "detached", branch: null, worktrees: [checkout("/one", { detached: true, branch: null })] });
  assert.deepEqual(managementSelection(detached, both), { resource: "worktree", worktreePath: "/one" });
  assert.deepEqual(managementSelection(branch, { resource: "branch", worktreePath: "/gone" }), both);
  assert.deepEqual(managementSelection(removable(), both), { resource: "branch", worktreePath: "" });
  assert.deepEqual(managementSelection({ ...detached, kind: "diagnostic" }, both), { resource: "worktree", worktreePath: "/one" });
  assert.equal(managementRowKind({ ...detached, kind: undefined }), "detached");
  assert.equal(managementRowKind({ ...branch, id: "registration:dangling", kind: undefined }), "diagnostic");
  const replacement = { ...branch, worktrees: [checkout("/new")] };
  assert.deepEqual(managementSelection(replacement, both), { resource: "both", worktreePath: "/new" });
});
test("Unknown/not-integrated/no-target removals use literal subjects and optional comparison evidence", () => {
  for (const integration of ["unknown", "not-integrated", "integrated"]) {
    const r = removable({ integration });
    assert.deepEqual(managementRemovalBlockers(r, both), []);
    assert.deepEqual(managementRemovalPayload(r, both, { branch: null, tip: null }), {
      subject: { kind: "branch", branch: "feature", tip: oid }, removeWorktree: false, deleteBranch: true,
    });
  }
  assert.deepEqual(managementRemovalBlockers(removable({ blockers: ["current-tip-not-proven-integrated"] }), both), [], "old containment-only fixtures remain reviewable");
  const r = removable({ worktrees: [checkout("/one")] });
  assert.deepEqual(managementRemovalPayload(r, both, { branch: "main", tip: targetOid }), {
    subject: { kind: "branch", branch: "feature", tip: oid }, worktreePath: "/one", removeWorktree: true, deleteBranch: true,
    comparisonTarget: { branch: "main", tip: targetOid },
  });
  assert.equal("comparisonTarget" in managementRemovalPayload(r, both, { branch: "main", tip: null }), false);
  const detached = removable({ kind: "detached", branch: null, worktrees: [checkout("/one", { branch: null, detached: true })] });
  assert.deepEqual(managementRemovalBlockers(detached, both, [status("/one")]), []);
  assert.deepEqual(managementRemovalPayload(detached, { resource: "branch", worktreePath: "/gone" }), {
    subject: { kind: "detached", head: oid }, worktreePath: "/one", removeWorktree: true, deleteBranch: false,
  });
  assert.equal(managementRemovalPayload({ ...detached, kind: "diagnostic" }, both), null);
  assert.equal(managementRemovalPayload({ ...r, tip: "short" }, both), null);
});
test("only the selected removal path requires successful clean status; another checkout's branch is retained", () => {
  const r = removable({ worktrees: [checkout("/one"), checkout("/two")] });
  assert.deepEqual(managementSelection(r, both), { resource: "worktree", worktreePath: "/one" });
  assert.deepEqual(managementRemovalBlockers(r, both, [status("/one"), status("/two", "unavailable")]), []);
  assert.deepEqual(managementRemovalBlockers(r, both, [status("/one"), status("/two", "dirty")]), []);
  assert.deepEqual(managementRemovalBlockers(r, both, [status("/two")]), ["status-pending"]);
  assert.deepEqual(managementRemovalBlockers(r, both, [status("/one", "dirty"), status("/two")]), ["dirty-checkout"]);
  assert.deepEqual(managementRemovalBlockers(r, both, [status("/one", "unavailable")]), ["status-unavailable"]);
  assert.deepEqual(managementRemovalBlockers(r, { ...both, worktreePath: "/two" }, [status("/one")]), ["status-pending"]);
  for (const resource of ["branch", "both", "worktree"]) assert.equal(managementRemovalPayload(r, { ...both, resource }).deleteBranch, false);
});
test("target, main, selected, diagnostic, identity and arbitrary error blockers are not waived by containment", () => {
  for (const blockers of [["configured-target"], ["comparison-target"], ["symbolic-ref"], ["unexpected-safety-error"]]) {
    const r = removable({ blockers, integration: "integrated" });
    assert.deepEqual(managementRemovalBlockers(r, both), blockers);
  }
  for (const [extra, blocker] of [[{ main: true }, "main-checkout"], [{ selected: true }, "selected-checkout"], [{ missing: true }, "diagnostic-registration"], [{ locked: "" }, "diagnostic-registration"], [{ prunable: "" }, "diagnostic-registration"]]) {
    assert.ok(managementRemovalBlockers(removable({ worktrees: [checkout("/one", extra)] }), both, [status("/one")]).includes(blocker));
  }
  const detached = removable({ kind: "detached", branch: null, worktrees: [checkout("/one", { detached: true, branch: null, head: targetOid })] });
  assert.ok(managementRemovalBlockers(detached, both, [status("/one")]).includes("diagnostic-registration"));
  assert.ok(managementRemovalBlockers({ ...detached, kind: "diagnostic" }, both, [status("/one")]).includes("diagnostic-registration"));
});
test("acknowledgment scope preserves unchanged polls but not replacements, context, operation or history", () => {
  const live = { id: "op", state: "review", card: { requiredAcknowledgment: "I accept loss" }, acknowledgment: { cardDigest: "server-digest", label: "I accept loss" } };
  const key = managementAcknowledgmentKey("context", live);
  assert.ok(key);
  assert.equal(managementAcknowledgmentKey("context", structuredClone(live)), key);
  assert.notEqual(managementAcknowledgmentKey("new-context", live), key);
  assert.notEqual(managementAcknowledgmentKey("context", { ...live, id: "other" }), key);
  assert.notEqual(managementAcknowledgmentKey("context", { ...live, acknowledgment: { ...live.acknowledgment, cardDigest: "replacement" } }), key);
  assert.equal(managementAcknowledgmentKey("context", { ...live, acknowledgment: undefined }), null);
  assert.equal(managementAcknowledgmentKey("context", { ...live, acknowledgment: { ...live.acknowledgment, label: "foreign" } }), null);
  assert.equal(managementAcknowledgmentKey("context", { ...live, acknowledgment: { ...live.acknowledgment, cardDigest: "" } }), null);
  assert.equal(managementAcknowledgmentKey("context", { ...live, state: "succeeded", acknowledgment: { ...live.acknowledgment, accepted: true } }), null);
  assert.equal(managementAcknowledgmentKey("context", { ...live, card: undefined, receipt: { card: live.card } }), null);
  assert.equal(managementAcknowledgmentKey("context", null), null);
});
test("approved waiting operations retain Stop without presenting an actionable or untouched review", () => {
  const operation = { state: "review", cwd: "/selected", card: { title: "Review" } };
  assert.deepEqual(managementOperationPresentation(operation, "/selected"), { state: "review", review: true, stop: false });
  assert.deepEqual(managementOperationPresentation({ ...operation, card: undefined, decision: "approve" }, "/selected"), { state: "dispatched", review: false, stop: true });
  assert.equal(managementOperationPresentation({ ...operation, card: undefined }, "/selected").stop, true);
  assert.equal(managementOperationPresentation(operation, "/other").stop, true);
  for (const state of ["succeeded", "failed", "cancelled", "outcome-unknown"])
    assert.deepEqual(managementOperationPresentation({ ...operation, state, card: undefined }, "/selected"), { state, review: false, stop: false });
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
