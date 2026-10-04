import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
const home = await mkdtemp(join(tmpdir(), "rpc-pending-read-"));
const previous = new Map(["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"].map((key) => [key, process.env[key]]));
process.env.HOME = home; process.env.XDG_CONFIG_HOME = join(home, "config"); process.env.PI_CODING_AGENT_DIR = join(home, "agent");
await mkdir(process.env.PI_CODING_AGENT_DIR);
after(async () => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await rm(home, { recursive: true, force: true }); });
const { pendingGitReadFixture } = await import("./rpc-pending-git-read-fixture.mjs");

test("opaque original pending read ticket is non-consuming and cannot be copied", async (t) => {
  const f = await pendingGitReadFixture(t, process.env.PI_CODING_AGENT_DIR);
  const ticket = f.wrapper.capturePendingGitActionRead(f.action.record.id);
  assert.ok(ticket); assert.deepEqual(Object.keys(ticket), []);
  assert.equal(f.wrapper.readPendingGitActionRead({ ...ticket }), undefined);
  assert.deepEqual(f.wrapper.readPendingGitActionRead(ticket), { kind: "workspace", sessionFile: f.file, cwd: f.cwd });
  assert.deepEqual(f.wrapper.readPendingGitActionRead(ticket), { kind: "workspace", sessionFile: f.file, cwd: f.cwd });
  assert.equal(f.wrapper.pendingUiRequests.get(f.request.id), f.request);
  assert.equal(f.wrapper.pendingUiResponses.get(f.request.id), f.response);
});

test("pending read binds both original map entries, candidate kind/object and actual wrapper/owner", async (t) => {
  for (const mutation of ["request-copy", "response-copy", "candidate-copy", "kind", "method", "request-id", "missing-response", "owner", "file", "cwd", "wrapper"]) {
    await t.test(mutation, async (t) => {
      const f = await pendingGitReadFixture(t, process.env.PI_CODING_AGENT_DIR);
      const ticket = f.wrapper.capturePendingGitActionRead(f.action.record.id); assert.ok(ticket);
      if (mutation === "request-copy") f.wrapper.pendingUiRequests.set(f.request.id, structuredClone(f.request));
      if (mutation === "response-copy") f.wrapper.pendingUiResponses.set(f.request.id, { ...f.response });
      if (mutation === "candidate-copy") f.request.candidate = structuredClone(f.request.candidate);
      if (mutation === "kind") f.request.candidate.kind = "preparation";
      if (mutation === "method") f.request.method = "confirm";
      if (mutation === "request-id") f.request.id = "replacement";
      if (mutation === "missing-response") f.wrapper.pendingUiResponses.delete(f.request.id);
      if (mutation === "owner") f.inner.sessionId = "forked-owner";
      if (mutation === "file") f.inner.sessionFile += ".replacement";
      if (mutation === "cwd") f.manager.getCwd = () => join(f.cwd, "changed");
      if (mutation === "wrapper") globalThis.__piSessions.set(f.id, { ...f.wrapper });
      assert.equal(f.wrapper.readPendingGitActionRead(ticket), undefined);
      if (["request-copy", "response-copy", "missing-response", "owner", "file", "cwd", "wrapper"].includes(mutation)) {
        assert.equal(f.wrapper.capturePendingGitActionRead(f.action.record.id), undefined);
      }
    });
  }
});

test("settled original cannot be revived by restoring identical objects/IDs or a newer question", async (t) => {
  const f = await pendingGitReadFixture(t, process.env.PI_CODING_AGENT_DIR);
  const ticket = f.wrapper.capturePendingGitActionRead(f.action.record.id); assert.ok(ticket);
  f.response.cancel(); await assert.rejects(f.decision, /cancelled/);
  f.wrapper.pendingUiRequests.set(f.request.id, f.request);
  f.wrapper.pendingUiResponses.set(f.request.id, f.response);
  assert.equal(f.wrapper.readPendingGitActionRead(ticket), undefined);
  assert.equal(f.wrapper.capturePendingGitActionRead(f.action.record.id), undefined);
  f.wrapper.pendingUiRequests.delete(f.request.id); f.wrapper.pendingUiResponses.delete(f.request.id);
  const replacement = f.ui.gitAction({ ...f.snapshot, actionId: f.action.record.id }); void replacement.catch(() => {});
  assert.ok(f.wrapper.capturePendingGitActionRead(f.action.record.id));
  assert.equal(f.wrapper.readPendingGitActionRead(ticket), undefined);
});
