import { createHash, randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { LaunchRequest, SessionLaunchHost } from "../../lib/session-launch-types";
import { onPluginSettingsChange, readPluginSettings } from "../../lib/plugins/settings";
import type { PluginCard, PluginOperationReceipt, PluginSession, PluginSettings, PluginUiContext } from "../../lib/plugins/types";
import { sessionLaunchManifest } from "./manifest";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function launchDirectory(cwd: string): { cwd: string; identity: string } {
  if (!isAbsolute(cwd) || cwd.includes("\0")) throw new Error("An absolute existing directory is required");
  const physical = realpathSync(cwd);
  const stat = statSync(physical);
  if (!stat.isDirectory()) throw new Error("Launch destination is not a directory");
  return { cwd: physical, identity: `${physical}:${stat.dev}:${stat.ino}` };
}
function policy(cwd: string, caller: PluginSession): PluginSettings {
  const value = readPluginSettings(sessionLaunchManifest, cwd, undefined, caller);
  if (!value.enabled || value.effective.launch === "deny") throw new Error("Starting sessions is denied by current settings");
  return value;
}
function revision(value: PluginSettings): string {
  return digest({ project: value.project, sessionProject: value.sessionProject, enabled: value.enabled,
    launch: value.effective.launch, source: value.sources.launch });
}
export async function executeSessionLaunch(request: LaunchRequest, caller: PluginSession,
  ui: Partial<PluginUiContext>, signal?: AbortSignal, toolCallId?: string, host?: SessionLaunchHost) {
  let receipt: PluginOperationReceipt | undefined;
  let createdSessionId: string | undefined;
  let accepted = false;
  const record = (phase: PluginOperationReceipt["phase"], summary?: string) => {
    if (!receipt || !ui.operationReceipt) throw new Error("Session launch requires durable Pi Web operation receipts");
    receipt = { ...receipt, phase, effectStarted: Boolean(createdSessionId), ...(summary ? { summary } : {}) };
    ui.operationReceipt(sessionLaunchManifest.id, structuredClone(receipt));
  };
  const result = (extra: Record<string, unknown>) => ({
    content: [{ type: "text" as const, text: JSON.stringify({ accepted, ...(createdSessionId ? { sessionId: createdSessionId, url: `/?session=${encodeURIComponent(createdSessionId)}` } : {}), ...extra }) }],
    details: { accepted, ...(createdSessionId ? { sessionId: createdSessionId } : {}), ...extra },
  });
  try {
    const proposal = structuredClone(request);
    if (typeof proposal.prompt !== "string" || !proposal.prompt.trim() || proposal.prompt.length > 100000 || proposal.prompt.includes("\0")) throw new Error("A nonempty initial prompt of at most 100,000 characters is required");
    signal?.throwIfAborted();
    const directory = launchDirectory(proposal.cwd ?? caller.cwd);
    const initialPolicy = policy(directory.cwd, caller);
    const capturedRevision = revision(initialPolicy);
    host ??= ui.sessionLaunchHost;
    if (!host) throw new Error("Session launch requires the ordinary Pi Web session host");
    const config = await host.resolve({ ...proposal, cwd: directory.cwd }, caller);
    if (launchDirectory(config.cwd).identity !== directory.identity) throw new Error("Launch destination changed during preparation");
    const revalidate = () => {
      signal?.throwIfAborted();
      if (launchDirectory(proposal.cwd ?? caller.cwd).identity !== directory.identity
        || revision(policy(directory.cwd, caller)) !== capturedRevision) throw new Error("Stale launch proposal: destination or permission changed; propose again");
    };
    revalidate();
    const operationId = randomUUID();
    const mode = initialPolicy.effective.launch as "ask" | "allow";
    const card: PluginCard = { operationId, title: "Start a new session", subtitle: mode === "ask" ? "Session launch approval" : "Policy-authorized session launch",
      fields: [
        { label: "Directory", value: config.cwd, code: true },
        { label: "Model", value: `${config.provider}/${config.modelId}` },
        { label: "Thinking", value: config.thinkingLevel }, { label: "Speed", value: config.modelSpeed },
        { label: "Tools", value: config.toolNames.length ? config.toolNames.join(", ") : "Chat only" },
        { label: "Provider accounts", value: Object.entries(config.accounts).length ? JSON.stringify(config.accounts) : "Pi defaults", code: true },
      ],
      sections: [{ title: "Initial prompt", text: proposal.prompt, code: true }],
      scope: "Start one fresh ordinary session with this exact literal prompt and settings (no slash-command or template expansion). It runs independently; no conversation history or session permission overrides are copied. Details are feedback only and never change an approved prompt.",
      allowDetails: true,
      actions: [{ id: "reject", label: "Reject" }, { id: "request-changes", label: "Request changes" }, { id: "approve", label: "Approve & start", primary: true }],
    };
    receipt = { version: 1, operationId, ...(toolCallId ? { toolCallId } : {}), card, phase: "prepared", effectStarted: false,
      authorization: { mode, source: initialPolicy.sources.launch, revision: capturedRevision, decision: mode === "allow" ? "policy-authorized" : "pending" }, checks: [] };
    record("prepared");
    if (mode === "ask") {
      if (!ui.pluginCardWithDetails) throw new Error("Ask requires the live Pi Web approval card");
      const cancellation = new AbortController();
      const unsubscribe = onPluginSettingsChange((id) => {
        if (id !== sessionLaunchManifest.id) return;
        try { revalidate(); } catch { cancellation.abort(); }
      });
      let answer: { action: string; details?: string } | null;
      try { answer = await ui.pluginCardWithDetails(sessionLaunchManifest.id, structuredClone(card),
        signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal); }
      finally { unsubscribe(); }
      if (answer?.action !== "approve") {
        receipt.authorization.decision = "not-approved";
        const feedback = answer?.details?.slice(0, 20000);
        record("cancelled", answer?.action === "request-changes" ? "User requested changes; no session started." : "Launch not approved; no session started.");
        return result({ requestChanges: answer?.action === "request-changes", ...(feedback ? { feedback } : {}), cancelled: true });
      }
      receipt.authorization.decision = "user-approved";
    }
    revalidate();
    record("authorized");
    record("executing");
    revalidate();
    const preflightCancellation = new AbortController();
    const unsubscribe = onPluginSettingsChange((id) => {
      if (id !== sessionLaunchManifest.id) return;
      try { revalidate(); } catch { preflightCancellation.abort(); }
    });
    let sessionId: string;
    try {
      sessionId = await host.start(structuredClone(config), proposal.prompt, caller, operationId, (id) => {
        const firstCreated = createdSessionId === undefined;
        createdSessionId = id;
        receipt!.card.sessionLinks = [{ sessionId: id, label: "Open started session" }];
        if (firstCreated) record("executing", "Session created; initial prompt acceptance not yet confirmed.");
        revalidate();
      }, signal ? AbortSignal.any([signal, preflightCancellation.signal]) : preflightCancellation.signal);
    } finally { unsubscribe(); }
    createdSessionId = sessionId;
    accepted = true;
    record("succeeded", "Initial prompt accepted. The new session runs independently; this is not a claim that its task succeeded.");
    return result({ completed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let receiptError: string | undefined;
    if (receipt) {
      try { record(signal?.aborted && !createdSessionId ? "cancelled" : "failed", `${message}${createdSessionId ? ". Created session retained." : ""}${accepted ? " Initial prompt was accepted." : ""}`.slice(0, 16000)); }
      catch (failure) { receiptError = failure instanceof Error ? failure.message : String(failure); }
    }
    return { ...result({ error: message, ...(receiptError ? { receiptError } : {}) }), isError: true };
  }
}
