import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ModelSpeed } from "./model-speed";
import type { PluginSession } from "./plugins/types";

export interface LaunchRequest {
  prompt: string; cwd?: string; provider?: string; modelId?: string; thinkingLevel?: ThinkingLevel;
  modelSpeed?: ModelSpeed; toolNames?: string[]; accounts?: Record<string, string>;
}
export interface LaunchConfiguration {
  cwd: string; provider: string; modelId: string; thinkingLevel: ThinkingLevel;
  modelSpeed: ModelSpeed; toolNames: string[]; accounts: Record<string, string>;
}
/** Trusted ordinary-session host service, never supplied by model arguments. */
export interface SessionLaunchHost {
  resolve(request: LaunchRequest, caller: PluginSession): Promise<LaunchConfiguration>;
  start(config: LaunchConfiguration, prompt: string, caller: PluginSession, operationId: string,
    beforePrompt: (sessionId: string) => void, signal?: AbortSignal): Promise<string>;
}
