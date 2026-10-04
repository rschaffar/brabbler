// Disposable read-only display fixture: real SDK owner and RPC UI issuance,
// no native completion, mutation capability, receipt or model request.
import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { SessionManager, SettingsManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { beginGitAction, gitActionSink } = await jiti.import("./git-action-controller.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionManagerCache } = await jiti.import("./session-reader.ts");

export async function pendingGitReadFixture(t, agentDir, kind = "workspace") {
  const cwd = join(agentDir, randomUUID()); await mkdir(cwd); allowFileRoot(cwd);
  const manager = SessionManager.create(cwd);
  manager.appendMessage({ role: "user", content: "read fixture", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const id = manager.getSessionId(), file = manager.getSessionFile(); cacheSessionPath(id, file);
  const inner = { sessionId: id, sessionFile: file, sessionManager: manager, settingsManager: SettingsManager.create(cwd, agentDir),
    agent: { state: {} }, isStreaming: false, isCompacting: false, isBashRunning: false,
    dispose() {}, setActiveToolsByName() {}, getActiveToolNames: () => ["read", "edit"] };
  const wrapper = new AgentSessionWrapper(inner);
  const registry = globalThis.__piSessions;
  globalThis.__piSessions = new Map(registry ?? []); globalThis.__piSessions.set(id, wrapper);
  const ui = wrapper.createExtensionUiContext();
  const info = await stat(cwd, { bigint: true });
  const identity = { device: String(info.dev), inode: String(info.ino), birthtime: String(info.birthtimeNs) };
  const physical = { gitDir: join(cwd, ".git"), checkoutIdentity: identity, gitIdentity: identity, markerIdentity: identity };
  const oid = (value) => value.repeat(40);
  const patch = "diff --git a/one.txt b/one.txt\n--- a/one.txt\n+++ b/one.txt\n@@ -1 +1 @@\n-old\n+exact pending captured bytes\n";
  const snapshot = { kind, repositoryRoot: cwd, projectRoot: cwd, sourceCheckoutRoot: cwd,
    resourceAttribution: { version: 2, commonDir: physical.gitDir, commonIdentity: identity, projectIdentity: identity },
    diff: { fromTreeOid: oid("a"), toTreeOid: oid("b"), hasBinaryChanges: false, patch },
    ...(kind === "workspace" ? { workspace: { mode: "create", destinationPath: join(cwd, "feature"),
      baseBranch: "main", baseOid: oid("c"), branch: "feature", tipOid: oid("c"), treeOid: oid("b") } }
      : { featureBranch: "feature", targetBranch: "main", targetCheckoutRoot: join(cwd, "target"),
        preparation: { oldSourceOid: oid("c"), newSourceOid: oid("d"), targetMainOid: oid("e"), resultTreeOid: oid("b"), emptyRetention: "keep",
          commitCount: 1, commitMapping: [{ oldOid: oid("c"), newOid: oid("d"), oldTreeOid: oid("a"), newTreeOid: oid("b"), emptyAfterReplay: false }], source: physical, target: physical } }),
  };
  let anchorAttempts = 0;
  const action = await beginGitAction(gitActionSink(manager, () => { anchorAttempts++; throw new Error("optional anchor fixture failure"); }), "agent", snapshot, agentDir);
  await action.update("awaiting-decision");
  const decision = ui.gitAction({ ...snapshot, actionId: action.record.id });
  void decision.catch(() => {}); // Teardown cancellation is expected, never an approval.
  const request = [...wrapper.pendingUiRequests.values()][0];
  const response = wrapper.pendingUiResponses.get(request.id);
  t.after(() => { wrapper.destroy(); action.release(); globalThis.__piSessions = registry;
    invalidateSessionPathCache(id); invalidateSessionManagerCache(file); });
  return { cwd, id, file, manager, inner, wrapper, ui, action, request, response, snapshot, patch, decision, anchorAttempts };
}
