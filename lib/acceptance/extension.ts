import { defineTool, type ExtensionContext, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { acceptanceProject, digest, readProfiles } from "./config";
import { acceptanceCoordinator } from "./coordinator";
import { acceptanceLog, allowedAcceptanceProject } from "./server";
import { createPluginExtension } from "../plugins/runtime";
import { acceptanceManifest } from "../../plugins/acceptance/manifest";
import { acceptanceEnabled, withAcceptanceAdmission } from "../../plugins/acceptance/policy";

/** Tools never accept commands, profiles/settings mutations or caller identity from model arguments. */
export function createAcceptanceExtension(cwd: string): InlineExtension {
    const scope = async (ctx: ExtensionContext, cwd?: string) => {
      const own = acceptanceProject(ctx.cwd), selected = await allowedAcceptanceProject(cwd ?? ctx.cwd);
      if (selected.identity !== own.identity) throw new Error("Acceptance tools only control this session's own project; use a session in the other project");
      return selected;
    };
    const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details: value });
    const tools = [defineTool({
      name: "acceptance_run", label: "Request acceptance", exposure: "model-only", executionMode: "sequential",
      description: "Request a configured acceptance profile for this session's project. Brabbler captures declared source inputs, joins an identical eligible in-flight run or queues a new managed job. No arbitrary commands or settings changes. Ask profiles require exact recipe approval; never change your own permissions. Returns immediately after admission. The run is independent: session Stop/closed chat does not cancel it. Keep the returned run ID; use acceptance_status to collect results and acceptance_cancel explicitly to cancel. A pass covers only its recorded snapshot/selection, not later edits or Git integration. Shell-launched tests are outside this coordinator.",
      parameters: Type.Object({ profile: Type.String({ maxLength: 48 }), cwd: Type.Optional(Type.String()), requestId: Type.Optional(Type.String({ pattern: "^[a-zA-Z0-9_-]{1,128}$", description: "Reuse this exact retry key after an uncertain response; never change inputs under it" })) }),
      execute(callId, params, signal, _update, ctx) {
        return withAcceptanceAdmission(signal, async (admissionSignal) => {
          const project = await scope(ctx, params.cwd), profile = readProfiles(project).find((p) => p.name === params.profile);
          if (!profile || profile.permission === "deny") throw new Error("Acceptance profile unavailable/denied; ask the user to configure it in Acceptance");
          const expected = digest(profile);
          if (profile.permission === "ask") {
            if (!ctx.hasUI || !await ctx.ui.confirm("Run project acceptance?", `${profile.label}\nProject: ${project.cwd}\nCoverage: ${profile.coverage}\nCommand argv: ${JSON.stringify(profile.argv)}\nSnapshot inputs: ${profile.inputs.join(", ")}\nBudget estimate: ${profile.cpus} CPUs / ${profile.memoryMiB} MiB\nThis independently managed run continues after session Stop. Cancellation is a separate action.`, { signal: admissionSignal })) throw new Error("Acceptance request not approved");
          }
          admissionSignal.throwIfAborted();
          return result(await acceptanceCoordinator().submit(project, params.profile, `session_${ctx.sessionManager.getSessionId()}`, params.requestId ?? digest([ctx.sessionManager.getSessionId(), callId]), expected, admissionSignal));
        });
      },
    }),
    defineTool({
      name: "acceptance_status", label: "Acceptance status", exposure: "model-only",
      description: "Read configured project profiles and managed acceptance runs without starting tests. With runId, optionally wait up to 30 seconds and include a bounded log tail. Waiting cancellation affects only this wait. No automatic model-turn notifications. Historical/cached/focused results do not establish fresh complete acceptance for different inputs.",
      parameters: Type.Object({ cwd: Type.Optional(Type.String()), runId: Type.Optional(Type.String()), wait: Type.Optional(Type.Boolean()) }),
      async execute(_id, params, signal, _update, ctx) {
        const project = await scope(ctx, params.cwd), coordinator = acceptanceCoordinator();
        const deadline = Date.now() + (params.wait && params.runId ? 30000 : 0);
        let view = coordinator.view(project);
        while (params.runId && view.runs.some((r) => r.id === params.runId && ["queued", "running", "cancelling"].includes(r.state)) && Date.now() < deadline) {
          signal?.throwIfAborted();
          await new Promise((resolve) => setTimeout(resolve, 250));
          view = coordinator.view(project);
        }
        signal?.throwIfAborted();
        const run = params.runId ? view.runs.find((r) => r.id === params.runId) : undefined;
        if (params.runId && !run) throw new Error("Acceptance run not found in this project");
        return result({ project, enabled: acceptanceEnabled(), profiles: readProfiles(project), ...view, runs: run ? [run] : view.runs.slice(0, 20), ...(run ? { log: acceptanceLog(project, run.id) } : {}) });
      },
    }),
    defineTool({
      name: "acceptance_cancel", label: "Cancel acceptance", exposure: "model-only", executionMode: "sequential",
      description: "Explicitly cancel a queued/running acceptance job initiated by this session. Joining/observing does not confer cancellation rights. A cancellation request is not process settlement: inspect status until settled or outcome-unknown. Never replay an unknown run automatically; browser recovery is separate.",
      parameters: Type.Object({ runId: Type.String(), cwd: Type.Optional(Type.String()) }),
      async execute(_id, params, signal, _update, ctx) {
        signal?.throwIfAborted();
        return result(await acceptanceCoordinator().cancel(await scope(ctx, params.cwd), params.runId, `session_${ctx.sessionManager.getSessionId()}`));
      },
    })];
    return createPluginExtension(acceptanceManifest, cwd, tools, undefined, { registerHidden: true });
}
