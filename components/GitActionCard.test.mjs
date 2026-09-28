import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { GitActionCardView } = await jiti.import("./GitActionCard.tsx");
const id = "12345678-1234-1234-1234-123456789abc";
const oid = (char) => char.repeat(40);
const record = { version: 1, id, sessionId: "old-owner", source: "agent", kind: "commit", state: "succeeded", revision: 4, createdAt: 1000, updatedAt: 2000, processId: "private",
  summary: { kind: "commit", repositoryRoot: "/deleted/worktree", featureBranch: "feature", targetBranch: "target", message: "Captured message", paths: ["gone.txt"], parentOid: oid("a"), candidateTreeOid: oid("b") },
  artifact: { sha256: "digest", bytes: 100 }, decision: "approved", outcome: { status: "committed", commit: oid("c"), tree: oid("b"), parents: [oid("a")], authorEmail: "human@example.test" } };
const live = { type: "extension_ui_request", method: "git_action", id: "actual-live-request", candidate: { actionId: id, kind: "commit", message: "Exact LIVE message", preview: { repositoryRoot: "/live", branch: "feature", head: oid("a"), tree: oid("b"), paths: ["gone.txt"] }, diff: { fromTreeOid: oid("a"), toTreeOid: oid("b"), patch: "", hasBinaryChanges: false } } };
const render = (props = {}) => renderToStaticMarkup(React.createElement(GitActionCardView, { actionId: id, history: { record }, expanded: false, onToggle: () => {}, artifact: null, ...props }));

test("compact durable card reports captured message, branch, time, actual result and author", () => {
  const html = render();
  assert.match(html, /Succeeded/);
  for (const value of ["Captured message", "feature", "target", "human@example.test", oid("c"), oid("a")]) assert.ok(html.includes(value));
  assert.match(html, /<time dateTime=/);
  assert.match(html, /Captured candidate · 1 file/);
  assert.doesNotMatch(html, /Approve exact commit|\/deleted\/worktree|private/);
});

test("prepared intent is visible during recovery but never called a confirmed result", () => {
  const intended = { commit: oid("d"), mergeOid: oid("e"), tree: oid("f"), parents: [oid("a")], featureOid: oid("1"), targetOid: oid("2"), authorEmail: "prepared@example.test" };
  const html = render({ history: { record: { ...record, state: "recovery-required", intended, outcome: undefined } } });
  assert.match(html, /Prepared OIDs only — not confirmation of a ref or index update/);
  for (const label of ["Prepared commit", "Prepared merge", "Prepared tree", "Prepared parents", "Prepared feature", "Prepared target", "Prepared author"]) assert.ok(html.includes(`${label}:`));
  for (const value of [intended.commit, intended.mergeOid, intended.tree, intended.featureOid, intended.targetOid, intended.authorEmail]) assert.ok(html.includes(value));
  assert.doesNotMatch(html, />Commit:|Merged commit:|Result tree:|Outcome:|Succeeded/);
  const completed = render({ history: { record: { ...record, intended } } });
  assert.match(completed, new RegExp(`Prepared commit: <span[^>]*>${intended.commit}`));
  assert.match(completed, new RegExp(`>Commit: <span[^>]*>${record.outcome.commit}`));
});

test("partial-state integration reports a proposed recovery merge, not a ref-updated commit", () => {
  const merge = { ...record, kind: "integration", state: "recovery-required", outcome: { status: "partial-state", mergeOid: oid("e"), tree: oid("f"), parents: [oid("a"), oid("b")], authorEmail: "prepared@example.test" } };
  const partial = render({ history: { record: merge } });
  assert.match(partial, /Outcome: partial-state/);
  assert.match(partial, new RegExp(`Proposed/recovery merge: <span[^>]*>${oid("e")}`));
  assert.match(partial, /Ref\/index completion is unconfirmed; files may have changed/);
  assert.match(partial, /Proposed\/recovery tree:/);
  assert.doesNotMatch(partial, />Commit:|Merged commit:|Result tree:|Succeeded/);
  const completed = render({ history: { record: { ...merge, state: "succeeded", outcome: { ...merge.outcome, status: "integrated" } } } });
  assert.match(completed, /Merged commit:/);
  assert.match(completed, /Result tree:/);
  assert.doesNotMatch(completed, /Proposed\/recovery merge:|completion is unconfirmed/);
  const partialCommit = render({ history: { record: { ...record, state: "recovery-required", outcome: { ...record.outcome, status: "partial-success" } } } });
  assert.match(partialCommit, new RegExp(`>Commit: <span[^>]*>${record.outcome.commit}`));
  assert.match(partialCommit, /Outcome: partial-success/);
  assert.doesNotMatch(partialCommit, /Proposed\/recovery commit/);
});

test("every historical state is read-only, especially awaiting decision and interrupted execution", () => {
  for (const state of ["proposed", "awaiting-decision", "executing", "succeeded", "declined", "cancelled", "expired", "blocked", "failed", "recovery-required"]) {
    const html = render({ history: { record: { ...record, state, outcome: undefined } } });
    assert.doesNotMatch(html, /Approve|Run these checks|Decline commit|I reviewed/);
    if (state !== "succeeded") assert.doesNotMatch(html, /Succeeded/);
    if (state === "recovery-required") assert.match(html, /Inspect before any new action/);
    if (state === "expired") assert.match(html, /Expired \/ interrupted/);
    if (state === "awaiting-decision") assert.match(html, /No live approval request is attached/);
  }
});

test("only the matching CURRENT request and real responder render actionable controls", () => {
  const pending = { history: { record: { ...record, state: "awaiting-decision", outcome: undefined } } };
  assert.doesNotMatch(render({ ...pending, liveRequest: live }), /Approve exact commit/);
  assert.doesNotMatch(render({ history: { record: null, unavailable: "corrupt" }, liveRequest: live, onRespond: () => {} }), /Approve exact commit/);
  assert.doesNotMatch(render({ ...pending, liveRequest: { ...live, candidate: { ...live.candidate, actionId: "another" } }, onRespond: () => {} }), /Approve exact commit/);
  for (const state of ["succeeded", "executing", "expired", "cancelled", "recovery-required"]) {
    assert.doesNotMatch(render({ history: { record: { ...record, state } }, liveRequest: live, onRespond: () => {} }), /Approve exact commit/);
  }
  const html = render({ ...pending, liveRequest: live, onRespond: () => {}, interactionBlocked: true });
  assert.equal((html.match(/Approve exact commit/g) ?? []).length, 1);
  assert.match(html, /Exact LIVE message/);
  assert.match(html, /inert=""/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /Captured candidate/);
});

test("expand shows captured identities and honest missing/corrupt/oversized placeholders", () => {
  for (const unavailable of ["missing", "corrupt", "oversized"]) {
    const html = render({ expanded: true, artifact: { record, unavailable } });
    assert.match(html, new RegExp(`Captured artifact unavailable: ${unavailable}`));
    assert.match(html, /No current worktree data is substituted/);
    assert.match(html, /\/deleted\/worktree/);
    assert.match(html, /not included in the standard session HTML export/);
    assert.doesNotMatch(html, /Approve exact commit/);
  }
  assert.match(render({ history: { record: null, unavailable: "record pruned" } }), /record pruned/);
  assert.match(render({ expanded: true, artifact: { record, candidate: { ...record.summary, diffUnavailable: "Patch not captured" } } }), /Patch not captured/);
});

test("artifact request is gated on expansion; no focus theft, model calls or approval reconstruction", async () => {
  const source = await readFile(new URL("./GitActionCard.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!expanded \|\| !sessionId \|\| liveRequest\) return/);
  assert.match(source, /readGitActionHistory\(sessionId, actionId, true, controller.signal\)/);
  const artifactRead = source.slice(source.indexOf("void readGitActionHistory"), source.indexOf("  return <div ref="));
  assert.doesNotMatch(artifactRead, /setHistory\(/, "slow artifact reads cannot restore live state");
  assert.match(source, /registerAnchor\?\.\(actionId\)/);
  assert.match(source, /GitActionDialog key=\{request.id\} request=\{request\} onRespond=\{onRespond\}/);
  assert.doesNotMatch(source, /\.focus\(|autoFocus|sendAgentCommand|approvePlanId|reviewToken|\/api\/agent|\/api\/files/);
});
