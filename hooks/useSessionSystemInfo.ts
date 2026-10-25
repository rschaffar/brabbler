"use client";
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ToolEntry } from "@/lib/tool-presets";
import { useNavigationWork } from "@/lib/navigation-work";
export type TopPanel = "agents" | "branches" | "system" | "tools" | "session" | null;
export function useSystemInfoState() {
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [systemTools, setSystemTools] = useState<ToolEntry[] | null>(null);
  const [systemInfoLoading, setSystemInfoLoading] = useState(false);
  const systemInfoLoaderRef = useRef<(() => Promise<void>) | null>(null);
  const systemInfoLoadIdRef = useRef(0);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
    setSystemInfoLoading(false);
  }, []);

  const handleSystemToolsChange = useCallback((tools: ToolEntry[] | null) => {
    setSystemTools(tools);
  }, []);

  const handleSystemInfoLoaderChange = useCallback((loader: (() => Promise<void>) | null) => {
    systemInfoLoadIdRef.current += 1;
    systemInfoLoaderRef.current = loader;
    setSystemInfoLoading(false);
  }, []);

  return { systemPrompt, setSystemPrompt, systemTools, setSystemTools, systemInfoLoading, setSystemInfoLoading, systemInfoLoaderRef, systemInfoLoadIdRef, handleSystemPromptChange, handleSystemToolsChange, handleSystemInfoLoaderChange };
}

export function useTopPanelToggle(isMobile: boolean, setSidebarOpen: Dispatch<SetStateAction<boolean>>, setActiveTopPanel: Dispatch<SetStateAction<TopPanel>>) {
  const toggleTopPanel = useCallback((
    panel: "agents" | "branches" | "system" | "tools" | "session",
  ) => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel((cur) => cur === panel ? null : panel);
  }, [isMobile, setSidebarOpen, setActiveTopPanel]);

  return toggleTopPanel;
}

export function useSystemInfoActions(state: ReturnType<typeof useSystemInfoState>, activeTopPanel: TopPanel, toggleTopPanel: (panel: Exclude<TopPanel, null>) => void) {
  const { systemInfoLoaderRef, systemInfoLoadIdRef, systemInfoLoading, setSystemInfoLoading } = state;
  const work = useNavigationWork();
  const handleSystemInfoToggle = useCallback((panel: "system" | "tools") => {
    const opening = activeTopPanel !== panel;
    toggleTopPanel(panel);
    if (!opening || systemInfoLoading) return;

    const load = systemInfoLoaderRef.current;
    if (!load) return;
    const loadId = ++systemInfoLoadIdRef.current;
    setSystemInfoLoading(true);
    work.observe(load().catch((error) => {
      console.error("Failed to load system information:", error);
    }).finally(() => {
      if (systemInfoLoadIdRef.current === loadId) {
        setSystemInfoLoading(false);
      }
    }));
  }, [activeTopPanel, systemInfoLoading, toggleTopPanel, systemInfoLoaderRef, systemInfoLoadIdRef, setSystemInfoLoading, work]);

  return handleSystemInfoToggle;
}
