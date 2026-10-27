import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { createPluginExtension } from "../../lib/plugins/runtime";
import type { BundledPlugin, PluginUiContext } from "../../lib/plugins/types";
import { sessionLaunchManifest } from "./manifest";
import { executeSessionLaunch } from "./server";

export const sessionLaunchPlugin: BundledPlugin = {
  manifest: sessionLaunchManifest,
  extension(cwd) {
    const launch = defineTool({
      name: "start_session", label: "Start session", executionMode: "sequential", exposure: "model-only",
      description: "Start one fresh ordinary Brabbler session with an initial prompt, only when the user requested a session launch. It runs independently, with no copied conversation history or completion report to you. Defaults copy your directory, model/account, thinking, speed and tool preset; explicit changes are shown for approval. Destination-project Deny/Ask/Allow applies; Allow skips approval but NEVER grants unsolicited delegation. Never modify your own permissions. Request changes returns user feedback without creating a session; propose a revised exact prompt. The result links to the new session; do not wait for its task to finish or retry an accepted/partially created launch.",
      parameters: Type.Object({
        prompt: Type.String({ minLength: 1, maxLength: 100000, description: "Exact initial user prompt. Include all needed task context explicitly; conversation history is not copied." }),
        cwd: Type.Optional(Type.String({ description: "Absolute existing directory; defaults to this session's cwd" })),
        provider: Type.Optional(Type.String()), modelId: Type.Optional(Type.String()),
        thinkingLevel: Type.Optional(Type.Union([Type.Literal("off"), Type.Literal("minimal"), Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("xhigh"), Type.Literal("max")])),
        modelSpeed: Type.Optional(Type.Union([Type.Literal("standard"), Type.Literal("fast")])),
        toolNames: Type.Optional(Type.Array(Type.String({ description: "Built-in coding tools; an empty array creates a Chat-only session" }))),
        accounts: Type.Optional(Type.Record(Type.String(), Type.String({ description: "Provider-to-account ID snapshot, not credentials; omit to inherit" }))),
      }),
      execute: (id, params, signal, _update, ctx) => executeSessionLaunch(params,
        { id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd }, ctx.ui as unknown as PluginUiContext, signal, id),
    });
    return createPluginExtension(sessionLaunchManifest, cwd, [launch]);
  },
};
