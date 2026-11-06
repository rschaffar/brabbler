import { SessionManager } from "@earendil-works/pi-coding-agent";
import { BTW_CONTEXT_TYPE, BTW_META_TYPE, btwQuestionText, btwSnapshotMessage, captureBtwSnapshot, readBtwMetadata, readBtwSnapshot, type BtwSnapshot } from "./btw";
import { getRpcSession, isRpcSessionStarting } from "./rpc-manager";
import { cacheSessionPath, getLatestModelChange, invalidateSessionListCache, listAllSessions, openSessionManager, resolveSessionPath } from "./session-reader";
import { withSessionMoveLock } from "./session-move";
import { appendSessionAccounts, readSessionAccounts } from "./session-accounts";
import { appendSessionModelSpeed, readSessionModelSpeed } from "./session-model-speed";
import { appendSessionToolSelection, readSessionToolSelection } from "./session-tool-selection";
import { appendNativeResourceSelection, readNativeResourceSelection } from "./session-native-resources";
import { PRESET_FULL } from "./tool-presets";
import { readBtwSource } from "./btw-source-reader";
import { flushSessionEntries, quarantineSessionAfterSaveFailure, sessionSaveBarrier } from "./session-save";
import type { SessionEntry, SessionInfo } from "./types";

export interface BtwConversation { session: SessionInfo | null; snapshot: BtwSnapshot | null }

async function managerFor(id: string, mutable = false) {
  const live = getRpcSession(id);
  if (live?.isAlive()) return live.inner.sessionManager;
  const path = await resolveSessionPath(id);
  if (!path) throw new Error("Session not found");
  const manager = openSessionManager(path, { mutable });
  if (manager.getSessionId() !== id) throw new Error("Session identity changed");
  return manager;
}

async function sourceFor(id: string) {
  const live = getRpcSession(id);
  if (live?.isAlive()) return live.inner.sessionManager;
  const path = await resolveSessionPath(id);
  if (!path) throw new Error("Source session not found");
  return readBtwSource(path, id);
}

export async function getBtwConversation(parentSessionId: string, force = false): Promise<BtwConversation> {
  const matches = (await listAllSessions({ force })).filter(session => session.relation?.kind === "btw" && session.relation.parentSessionId === parentSessionId);
  if (matches.length > 1) throw new Error("Multiple BTW conversations found; no conversation was selected automatically");
  const session = matches[0] ?? null;
  return { session, snapshot: session ? readBtwSnapshot((await managerFor(session.id)).getBranch() as unknown as SessionEntry[], parentSessionId) : null };
}

export function saveBtwSnapshot(manager: SessionManager, snapshot: BtwSnapshot): void {
  try {
    manager.appendCustomEntry(BTW_CONTEXT_TYPE, snapshot);
    manager.appendCustomMessageEntry(BTW_CONTEXT_TYPE, btwSnapshotMessage(snapshot), true, { capturedAt: snapshot.capturedAt });
    flushSessionEntries(manager);
    sessionSaveBarrier(manager);
  } catch (error) { quarantineSessionAfterSaveFailure(manager); throw error; }
}

/** Read only the reference's anchored branch; never navigate or prompt its owner. */
export async function readBtwSourceBranch(parentSessionId: string, leafId: string | null): Promise<SessionEntry[]> {
  if (leafId === null) return [];
  const manager = await sourceFor(parentSessionId);
  if (!manager.getEntry(leafId)) throw new Error("Source reference anchor is unavailable; refresh context explicitly");
  return manager.getBranch(leafId) as unknown as SessionEntry[];
}

/** Serialize with relocation and other creation attempts. No source runtime is
 * constructed, awaited for idle, prompted, navigated or written. */
export async function ensureBtwConversation(parentSessionId: string, refresh = false): Promise<BtwConversation> {
  return withSessionMoveLock(async () => {
    const existing = await getBtwConversation(parentSessionId, true);
    if (existing.session && !refresh) return existing;
    const parent = await sourceFor(parentSessionId);
    if (parent.getSessionId() !== parentSessionId) throw new Error("Source session identity changed");
    const sourceLeafId = parent.getLeafId();
    const entries = parent.getEntries() as unknown as SessionEntry[];
    const branch = parent.getBranch(sourceLeafId ?? undefined) as unknown as SessionEntry[];
    const snapshot = captureBtwSnapshot(parentSessionId, sourceLeafId, branch,
      btwQuestionText(getRpcSession(parentSessionId)?.getBtwWaitingQuestion()));
    if (existing.session) {
      const child = getRpcSession(existing.session.id);
      if (child?.isRunning() || isRpcSessionStarting(existing.session.id)) throw new Error("Wait for BTW to finish before refreshing its context");
      if (child?.isAlive()) await child.appendBtwContext(snapshot);
      else {
        const manager = await managerFor(existing.session.id, true);
        // Lookup yielded: a startup/prompt may now own this file. Never write a
        // stale disk manager underneath a newly constructed runtime.
        if (getRpcSession(existing.session.id)?.isAlive() || isRpcSessionStarting(existing.session.id)) throw new Error("BTW started while context was refreshing; retry when idle");
        if (!readBtwMetadata(manager.getEntries() as unknown as SessionEntry[], manager.getSessionId())) throw new Error("BTW identity changed");
        saveBtwSnapshot(manager, snapshot);
      }
    } else {
      const child = SessionManager.create(parent.getCwd(), parent.getSessionDir(), { parentSession: parent.getSessionFile() });
      try {
        child.appendCustomEntry(BTW_META_TYPE, { version: 1, sessionId: child.getSessionId(), parentSessionId, sourceLeafId, createdAt: snapshot.capturedAt });
        const live = getRpcSession(parentSessionId);
        const liveTools = live?.inner.getActiveToolNames?.()
          .map(name => name === "powershell" ? "bash" : name).filter(name => PRESET_FULL.includes(name));
        const toolNames = readSessionToolSelection(entries)
          ?? (live?.isChatOnly?.() ? [] : liveTools?.length ? liveTools : undefined);
        if (toolNames !== undefined) appendSessionToolSelection(child, toolNames);
        appendNativeResourceSelection(child, readNativeResourceSelection(entries));
        appendSessionAccounts(child, readSessionAccounts(entries) ?? {});
        appendSessionModelSpeed(child, readSessionModelSpeed(entries));
        const liveModel = getRpcSession(parentSessionId)?.inner.model;
        const model = liveModel ? { provider: liveModel.provider, modelId: liveModel.id } : getLatestModelChange(branch);
        if (model) child.appendModelChange(model.provider, model.modelId);
        const thinking = branch.findLast(entry => entry.type === "thinking_level_change");
        if (thinking?.type === "thinking_level_change") child.appendThinkingLevelChange(thinking.thinkingLevel);
        child.appendSessionInfo("BTW");
        saveBtwSnapshot(child, snapshot);
        cacheSessionPath(child.getSessionId(), child.getSessionFile()!);
      } catch (error) { quarantineSessionAfterSaveFailure(child); invalidateSessionListCache(); throw error; }
    }
    invalidateSessionListCache();
    return getBtwConversation(parentSessionId);
  });
}
