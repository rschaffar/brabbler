"use client";

import { useEffect, useRef, useState } from "react";
import { createAgentUsageCoordinator, readAgentUsage, type AgentUsageSnapshot, type AgentUsageWorkObserver } from "@/lib/agent-usage";

/** Only mounted by the open Agents panel; does not start or renew any wrapper. */
export function useAgentUsage(ids: readonly string[], runningSessionIds: ReadonlySet<string>, onWork?: AgentUsageWorkObserver): AgentUsageSnapshot {
  const observer = useRef(onWork);
  observer.current = onWork;
  const [snapshot, setSnapshot] = useState<AgentUsageSnapshot>(() => new Map());
  const owner = useRef<ReturnType<typeof createAgentUsageCoordinator> | null>(null);
  const idsKey = JSON.stringify([...new Set(ids)].sort());
  const runningKey = JSON.stringify([...new Set(ids)].filter((id) => runningSessionIds.has(id)).sort());

  useEffect(() => {
    const coordinator = createAgentUsageCoordinator({
      read: readAgentUsage, visible: () => document.visibilityState === "visible", publish: setSnapshot,
      observeWork: (work) => observer.current?.(work),
    });
    owner.current = coordinator;
    const onVisibility = () => coordinator.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      owner.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
      coordinator.dispose();
    };
  }, []);
  useEffect(() => {
    const running = JSON.parse(runningKey) as string[];
    owner.current?.update(JSON.parse(idsKey) as string[], running.length ? runningKey : "");
  }, [idsKey, runningKey]);
  return snapshot;
}
