"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import {
  DEFAULT_GIT_WORKFLOW_SETTINGS,
  type GitWorkflowField, type GitWorkflowOverrides, type GitWorkflowSettings,
  type GitWorkflowSettingsResponse, type WorkflowScope,
} from "@/lib/git-workflow-settings";
import {
  MAX_GIT_WORKFLOW_CHECKS, MAX_GIT_WORKFLOW_CHECK_ARGS, MAX_GIT_WORKFLOW_CHECK_LABEL,
  MAX_GIT_WORKFLOW_CHECK_EXECUTABLE, MAX_GIT_WORKFLOW_CHECK_ARG,
} from "@/lib/git-workflow-policy";
import type { SessionInfo } from "@/lib/types";
import { AUTOMATIC_COMMIT_UNAVAILABLE, AUTOMATIC_WORKFLOW_UNAVAILABLE } from "@/lib/git-workflow-permissions";
import {
  changedWorkflowFields, isUnpersistedWorkflowSession, receiveWorkflowSettings,
  resetWorkflowField, resolveWorkflowDraft, workflowDraftKey, workflowFields, workflowRequestTarget, workflowScopes,
  type WorkflowDrafts,
} from "./git-workflow-drafts";
import { GitWorkflowTaskBinding } from "./GitWorkflowTaskBinding";
import "./GitWorkflowHome.css";

export type WorkflowDetail = "workspace" | "commit" | "merge";
export type WorkflowChatStatus = { sessionId: string | null; busy: boolean; attention: boolean };
type Props = {
  visible: boolean;
  onClose: () => void;
  cwd: string | null;
  session: SessionInfo | null;
  busy: boolean;
  attention: boolean;
  detail: WorkflowDetail | null;
  onDetailChange: (detail: WorkflowDetail | null) => void;
  onDetailHost: (host: HTMLDivElement | null) => void;
};
type Snapshot = { context: string; data: GitWorkflowSettingsResponse; sessionBound: boolean; projectReason?: string };
type Stage = "workspace" | "commits" | "checks" | "integration" | "cleanup";
const scopeNames = { global: "Global", project: "Project", session: "Session" };
const saveLabels = { global: "Save global defaults", project: "Save project defaults", session: "Save session settings" };
const scopeDescriptions = {
  global: "Personal defaults · future chats and tasks",
  project: "Shared by this repository’s worktrees · future chats and tasks",
  session: "Only this chat · later tasks",
};
const stages: { id: Stage; label: string; fields: GitWorkflowField[] }[] = [
  { id: "workspace", label: "Workspace", fields: ["workspace", "baseBranch", "branch", "onCreate"] },
  { id: "commits", label: "Commits", fields: ["commits"] },
  { id: "checks", label: "Checks", fields: ["checks"] },
  { id: "integration", label: "Integration", fields: ["targetBranch", "method"] },
  { id: "cleanup", label: "Cleanup", fields: ["cleanup"] },
];
const fieldNames: Record<GitWorkflowField, string> = {
  enabled: "Integrated Git workflow", workspace: "Workspace strategy", baseBranch: "Local base branch",
  branch: "Require current branch", onCreate: "When a worktree is created", commits: "Commit behavior",
  checks: "Ordered checks", targetBranch: "Local integration target", method: "Integration method", cleanup: "After integration",
};
const resetLabels = { global: "Restore built-in default", project: "Use Global value", session: "Use Project value" };
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
function shortPath(path?: string | null) { return path?.replace(/\\/g, "/").replace(/\/$/, "").split("/").pop() || path || "No project"; }
function formatValue(value: GitWorkflowSettings[GitWorkflowField]): string {
  if (Array.isArray(value)) return value.length ? value.map((check) => check.label || "Unnamed check").join(" · ") : "No checks";
  if (value === null) return "Not set";
  if (typeof value === "boolean") return value ? "On" : "Off";
  return ({ current: "Current checkout", worktree: "Dedicated worktree", continue: "Continue this chat", fork: "Fork chat", stay: "Stay here", off: "Off", manual: "Manual", ask: "Ask", merge: "Non-fast-forward merge", ff: "Fast-forward (unsupported)", squash: "Squash (unsupported)", retain: "Retain" } as Record<string, string>)[value] ?? value;
}

function Field({ field, scope, data, draft, disabled, onReset, children }: {
  field: GitWorkflowField; scope: WorkflowScope; data: GitWorkflowSettingsResponse; draft: GitWorkflowOverrides;
  disabled: boolean; onReset: () => void; children: ReactNode;
}) {
  const origin = resolveWorkflowDraft(data, scope, draft).origins[field];
  const source = origin === scope ? "Set here" : origin === "builtin" ? "Built-in default" : `From ${scopeNames[origin]}`;
  return <div className="workflow-field">
    <label id={`workflow-label-${field}`} htmlFor={field === "checks" ? undefined : `workflow-${field}`}>{fieldNames[field]}<small>{source}</small></label>
    {children}
    <div className="workflow-field-meta">
      <details className="workflow-trace"><summary>Inheritance</summary>
        <dl><div><dt>Built-in</dt><dd>{formatValue(DEFAULT_GIT_WORKFLOW_SETTINGS[field])}</dd></div>
          {workflowScopes.slice(0, workflowScopes.indexOf(scope) + 1).map((level) => {
            const layer = level === scope ? draft : data[level] ?? {};
            const resolved = resolveWorkflowDraft(data, level, layer);
            return <div key={level}><dt>{scopeNames[level]}{level === scope ? " · editing" : " · saved"}</dt><dd>{Object.hasOwn(layer, field) ? "" : "Inherit · "}{formatValue(resolved.values[field])}</dd></div>;
          })}
        </dl>
      </details>
      {Object.hasOwn(draft, field) && <button type="button" className="workflow-link" disabled={disabled} onClick={onReset}>{resetLabels[scope]}</button>}
    </div>
    {scope !== "session" && data.session !== null && (() => {
      const downstream = scope === "global" && Object.hasOwn(data.project, field) ? "Project" : Object.hasOwn(data.session, field) ? "Session" : null;
      return downstream && <small className="workflow-muted">Saved {downstream} override still takes precedence for this chat.</small>;
    })()}
  </div>;
}

export function GitWorkflowHome({ visible, onClose, cwd, session, busy, attention, detail, onDetailChange, onDetailHost }: Props) {
  const [projectChoice, setProjectChoice] = useState<{ source: string | null; cwd: string } | null>(null);
  const defaultCwd = session?.cwd ?? cwd;
  const choiceSource = JSON.stringify([session?.id ?? null, defaultCwd]);
  const projectPath = projectChoice?.source === choiceSource ? projectChoice.cwd : undefined;
  const configCwd = projectPath ?? defaultCwd ?? undefined;
  const context = JSON.stringify([session?.id ?? null, configCwd ?? null, Boolean(session?.transient), projectPath ?? null]);
  const contextRef = useRef(context);
  contextRef.current = context;
  const [projectInput, setProjectInput] = useState(configCwd ?? "");
  const [scope, setScope] = useState<WorkflowScope>(session ? "session" : configCwd ? "project" : "global");
  const [expanded, setExpanded] = useState<Stage | null>(null);
  const [drafts, setDrafts] = useState<WorkflowDrafts>({});
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<string | null>(null);
  const operationRef = useRef(false);
  const [notice, setNotice] = useState<{ context: string; text: string } | null>(null);
  const [actionError, setActionError] = useState<{ context: string; text: string } | null>(null);
  const [reload, setReload] = useState(0);
  const readRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const detailBackRef = useRef<HTMLButtonElement>(null);
  const previousDetailRef = useRef<WorkflowDetail | null>(detail);
  const taskActionRefs = useRef<Partial<Record<WorkflowDetail, HTMLButtonElement | null>>>({});
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [covering, setCovering] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [sourceEvidenceOpen, setSourceEvidenceOpen] = useState(false);
  const widthRef = useRef(500);
  const getMaxWidth = useCallback(() => Math.min(800, (panelRef.current?.parentElement?.parentElement?.clientWidth ?? 1160) - 360), []);
  const resizer = useResizablePanel({ ariaLabel: "Resize Workflow", cssVariable: "--workflow-width", defaultWidth: 500,
    getMaxWidth, growthDirection: "right", minWidth: 480, maxWidth: 800, storageKey: "pi-workflow-width", widthRef });
  const data = snapshot?.context === context ? snapshot.data : null;
  const draftKey = workflowDraftKey(scope, data?.projectRoot, session?.id, data?.sessionScope);
  const entry = draftKey ? drafts[draftKey] : undefined;
  const draft = entry?.overrides ?? {};
  const resolution = data ? resolveWorkflowDraft(data, scope, draft) : null;
  const values = resolution?.values ?? DEFAULT_GIT_WORKFLOW_SETTINGS;
  const changes = entry ? changedWorkflowFields(entry.baseline, draft).length : 0;
  const sessionReason = !session ? "Select a saved chat to edit Session settings. No chat is created here."
    : session.transient ? "This chat is not persisted yet. Send a message first; no session settings are queued."
      : session.relation?.kind === "subagent" ? "Subagents cannot edit workflow settings."
        : data?.sessionReason ?? (busy ? "Wait for this chat to become idle." : "Session settings are not available yet.");
  const editable = !!data && !!entry && (scope !== "project" || !!data.projectRoot)
    && (scope !== "session" || !!session && !session.transient && session.relation?.kind !== "subagent" && data.sessionEditable && !busy);
  const disabled = !editable || !!operation;
  const sessionId = session?.id;
  const detailsAvailable = !!session && !session.transient && session.relation?.kind !== "subagent" && snapshot?.sessionBound === true;

  useEffect(() => {
    setScope(session?.id ? "session" : configCwd ? "project" : "global");
    setProjectInput(configCwd ?? "");
    setSourceEvidenceOpen(false);
  }, [session?.id, configCwd]);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1100px)");
    const parent = panelRef.current?.parentElement?.parentElement;
    const update = () => setCovering(query.matches || !!parent && parent.clientWidth < 950);
    const observer = new ResizeObserver(update);
    if (parent) observer.observe(parent);
    update(); query.addEventListener("change", update);
    return () => { observer.disconnect(); query.removeEventListener("change", update); };
  }, []);
  // Focus only on explicit open/close, never on data, scope, task or request updates.
  useEffect(() => {
    if (!visible) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
      else document.querySelector<HTMLButtonElement>('button[aria-controls="workflow-panel"]')?.focus({ preventScroll: true });
    };
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault(); event.stopPropagation(); onClose(); return;
      }
      if (!covering || event.key !== "Tab") return;
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') ?? [])
        .filter((element) => element.getClientRects().length && !element.closest("[hidden], [inert]"));
      const first = controls[0]; const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); titleRef.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (covering && event.target instanceof Node && !panelRef.current?.contains(event.target)) titleRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", containFocus);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("focusin", containFocus); };
  }, [visible, covering, onClose]);
  useEffect(() => {
    const previous = previousDetailRef.current;
    previousDetailRef.current = detail;
    if (!visible || previous === detail) return;
    if (detail) detailBackRef.current?.focus({ preventScroll: true });
    else if (previous) taskActionRefs.current[previous]?.focus({ preventScroll: true });
  }, [detail, visible]);
  const hasDrafts = Object.values(drafts).some((item) => changedWorkflowFields(item.baseline, item.overrides).length > 0);
  useEffect(() => {
    if (!hasDrafts) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDrafts]);

  const load = useCallback(async (replaceKey?: string) => {
    readRef.current?.abort();
    const controller = new AbortController(); readRef.current = controller;
    setLoading(true); setLoadError(null);
    let sessionBound = !!sessionId;
    let persistenceReason: string | undefined;
    let projectReason: string | undefined;
    const get = async (target: { sessionId?: string; cwd?: string; projectPath?: string }) => {
      const params = new URLSearchParams(target);
      const response = await fetch(`/api/git/workflow/settings?${params}`, { signal: controller.signal, cache: "no-store" });
      const body = await response.json() as GitWorkflowSettingsResponse & { error?: string; code?: string };
      if (!response.ok) throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`), { status: response.status, code: body.code });
      return body;
    };
    try {
      let body: GitWorkflowSettingsResponse;
      try { body = await get(workflowRequestTarget(sessionId, configCwd, projectPath)); }
      catch (cause) {
        const status = (cause as { status?: number }).status ?? 0;
        if (controller.signal.aborted) return;
        if (sessionId && isUnpersistedWorkflowSession(status, message(cause))) {
          sessionBound = false;
          persistenceReason = "This chat is not persisted yet. Global and Project settings are available; no session settings are queued.";
          try { body = await get(workflowRequestTarget(undefined, configCwd, projectPath)); }
          catch (fallbackCause) {
            if (![400, 403, 404].includes((fallbackCause as { status?: number }).status ?? 0)) throw fallbackCause;
            projectReason = message(fallbackCause);
            body = await get({});
          }
        } else if (configCwd && ((!sessionId && [400, 403, 404].includes(status))
          || projectPath !== undefined && ["access-denied", "invalid-selection", "unavailable", "selection-changed"].includes((cause as { code?: string }).code ?? ""))) {
          sessionBound = false;
          projectReason = message(cause);
          body = await get({}); // A non-repository must not make Global inaccessible.
        } else throw cause;
      }
      if (controller.signal.aborted || contextRef.current !== context) return;
      if (persistenceReason) body = { ...body, session: null, task: { kind: "none" }, sessionEditable: false, sessionReason: persistenceReason };
      setSnapshot({ context, data: body, sessionBound, projectReason });
      setDrafts((current) => receiveWorkflowSettings(current, body, sessionBound ? sessionId : undefined, replaceKey));
      setActionError(null);
    } catch (cause) {
      if (!controller.signal.aborted && contextRef.current === context) setLoadError(message(cause));
    } finally {
      if (!controller.signal.aborted && contextRef.current === context) setLoading(false);
    }
  }, [context, configCwd, sessionId, projectPath]);
  // Refresh editability when the chat settles, not on attention or metadata polls.
  useEffect(() => {
    if (visible) void load();
    return () => readRef.current?.abort();
  }, [visible, load, reload, busy]);

  function update(field: GitWorkflowField, value: GitWorkflowSettings[GitWorkflowField]) {
    if (disabled || !draftKey) return;
    setDrafts((current) => ({ ...current, [draftKey]: { ...current[draftKey], overrides: { ...current[draftKey].overrides, [field]: value }, error: current[draftKey].conflict ? current[draftKey].error : undefined } }));
  }
  function reset(field: GitWorkflowField) {
    if (disabled || !draftKey) return;
    setDrafts((current) => ({ ...current, [draftKey]: { ...current[draftKey], overrides: resetWorkflowField(current[draftKey].overrides, field), error: current[draftKey].conflict ? current[draftKey].error : undefined } }));
  }
  async function put(destination: WorkflowScope | "pause" | "task") {
    if (!data || operationRef.current || (destination === scope && (disabled || entry?.conflict || resolution?.validationError))) return;
    const key = destination === scope ? draftKey : null;
    operationRef.current = true; setOperation(destination); setActionError(null); setNotice(null);
    readRef.current?.abort(); setLoading(false);
    try {
      const response = await fetch("/api/git/workflow/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: destination, revision: key ? entry!.revision : data.revision,
          ...workflowRequestTarget(snapshot?.sessionBound ? sessionId : undefined, snapshot?.projectReason ? undefined : configCwd,
            snapshot?.projectReason ? undefined : projectPath),
          ...(key ? { overrides: draft } : destination === "pause" ? { paused: !data.paused } : {}),
        }),
      });
      const body = await response.json() as GitWorkflowSettingsResponse & { error?: string };
      if (!response.ok) {
        const text = response.status === 409 ? `${body.error ?? "Settings changed"}. Your draft has been kept. Reload and discard to resolve; nothing was retried.` : body.error ?? `HTTP ${response.status}`;
        if (key) setDrafts((current) => ({ ...current, [key]: { ...current[key], error: text, conflict: response.status === 409 || current[key].conflict } }));
        else setActionError({ context, text });
        return;
      }
      setDrafts((current) => receiveWorkflowSettings(current, body, snapshot?.sessionBound ? session?.id : undefined, key ?? undefined));
      if (contextRef.current === context) {
        readRef.current?.abort(); setLoading(false);
        setSnapshot({ context, data: body, sessionBound: snapshot!.sessionBound, projectReason: snapshot?.projectReason });
      }
      setNotice({ context, text: destination === "pause" ? body.paused ? "All managed Git actions paused. Shells and other applications are not sandboxed." : "Managed Git actions resumed, subject to saved settings and existing guards."
        : destination === "task" ? "Saved Session settings applied to this task. No Git operation was approved or started."
          : destination === "session" && body.sessionScope === "project" ? "Chat overrides saved for this project only. Legacy actions keep captured choices; disabling or restricting commits also limits their existing entry points. No operation started."
            : destination === "session" ? "Session settings saved for later tasks. Enablement and Commit Off are live restrictions; this task otherwise keeps its captured settings."
              : `${scopeNames[destination]} defaults saved. No operation started and no captured action was retargeted.` });
    } catch (cause) {
      if (key) setDrafts((current) => ({ ...current, [key]: { ...current[key], error: message(cause) } }));
      else setActionError({ context, text: message(cause) });
    } finally { operationRef.current = false; setOperation(null); }
  }

  function field(field: GitWorkflowField, control: ReactNode) {
    return data && <Field field={field} scope={scope} data={data} draft={draft} disabled={disabled} onReset={() => reset(field)}>{control}</Field>;
  }
  function select(fieldName: "workspace" | "onCreate" | "commits" | "method" | "cleanup", options: { value: string; label: string; disabled?: boolean }[]) {
    const parentValue = data ? resolveWorkflowDraft(data, scope, resetWorkflowField(draft, fieldName)).values[fieldName] : values[fieldName];
    return field(fieldName, <select id={`workflow-${fieldName}`} disabled={disabled} value={Object.hasOwn(draft, fieldName) ? String(values[fieldName]) : "inherit"}
      onChange={(event) => event.target.value === "inherit" ? reset(fieldName) : update(fieldName, event.target.value as GitWorkflowSettings[typeof fieldName])}>
      <option value="inherit">{scope === "global" ? "Built-in default" : "Use inherited value"} · {formatValue(parentValue)}</option>
      {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>);
  }
  function branchField(fieldName: "baseBranch" | "branch" | "targetBranch") {
    return field(fieldName, <input id={`workflow-${fieldName}`} disabled={disabled} maxLength={255} value={values[fieldName] ?? ""}
      placeholder={scope === "global" ? "Use project definition" : fieldName === "targetBranch" ? "No integration target" : "Not set"}
      onChange={(event) => update(fieldName, event.target.value || null)} />);
  }
  function changeCheck(index: number, part: "label" | "executable" | "arguments", value: string) {
    update("checks", values.checks.map((check, i) => i !== index ? check : part === "label" ? { ...check, label: value }
      : { ...check, argv: part === "executable" ? [value, ...check.argv.slice(1)] : [check.argv[0], ...(value === "" ? [] : value.split("\n"))] }));
  }
  function stageEditor(stage: Stage) {
    if (stage === "workspace") return <>
      {select("workspace", [{ value: "current", label: "Current checkout" }, { value: "worktree", label: "Dedicated worktree" }])}
      {values.workspace === "worktree" ? branchField("baseBranch") : branchField("branch")}
      {select("onCreate", [{ value: "continue", label: "Continue this chat" }, { value: "fork", label: "Fork conversation" }, { value: "stay", label: "Stay in current checkout" }])}
      <p className="workflow-muted">A preference, not a start command. Worktree creation needs an explicit request and exact local base checks. Move or fork an existing chat from Current task.</p>
    </>;
    if (stage === "commits") return <>
      {select("commits", [{ value: "off", label: "Off" }, { value: "manual", label: "Manual · human review only" }, { value: "ask", label: "Ask · agent may request review" }, { value: "automatic", label: "Automatic · unavailable", disabled: true }])}
      <p className="workflow-muted">Complete selected files only, with exact preview and confirmation. {AUTOMATIC_COMMIT_UNAVAILABLE}</p>
    </>;
    if (stage === "checks") return <>
      <label className="workflow-field">Execution<select value="ask" disabled aria-label="Check execution"><option value="ask">Ask before running</option><option disabled>Automatic · unavailable</option></select></label>
      {field("checks", <div id="workflow-checks" role="group" aria-labelledby="workflow-label-checks">
        <p className="workflow-muted">Ordered recipes replace the inherited list. Saving does not run them. Each argument is literal; no shell parsing. Checks can execute project code, change files, and access networks. Do not include URLs or credentials.</p>
        {values.checks.map((check, index) => <details className="workflow-recipe" key={index}>
          <summary>{index + 1}. {check.label || "New check"}</summary>
          <label>Label<input disabled={disabled} maxLength={MAX_GIT_WORKFLOW_CHECK_LABEL} value={check.label} onChange={(event) => changeCheck(index, "label", event.target.value)} /></label>
          <label>Executable<input disabled={disabled} maxLength={MAX_GIT_WORKFLOW_CHECK_EXECUTABLE} value={check.argv[0] ?? ""} onChange={(event) => changeCheck(index, "executable", event.target.value)} /></label>
          <label>Arguments · one literal argument per line<textarea disabled={disabled} rows={3} maxLength={MAX_GIT_WORKFLOW_CHECK_ARGS * (MAX_GIT_WORKFLOW_CHECK_ARG + 1)} value={check.argv.slice(1).join("\n")} onChange={(event) => changeCheck(index, "arguments", event.target.value)} /></label>
          <div className="workflow-actions"><button type="button" disabled={disabled || index === 0} onClick={() => { const checks = [...values.checks]; [checks[index - 1], checks[index]] = [checks[index], checks[index - 1]]; update("checks", checks); }}>Move up</button>
            <button type="button" disabled={disabled || index === values.checks.length - 1} onClick={() => { const checks = [...values.checks]; [checks[index], checks[index + 1]] = [checks[index + 1], checks[index]]; update("checks", checks); }}>Move down</button>
            <button type="button" disabled={disabled} onClick={() => update("checks", values.checks.filter((_, i) => i !== index))}>Remove</button></div>
        </details>)}
        <div className="workflow-actions"><button type="button" disabled={disabled || values.checks.length >= MAX_GIT_WORKFLOW_CHECKS} onClick={() => update("checks", [...values.checks, { label: "", argv: [""] }])}>Add check</button>
          <button type="button" disabled={disabled} onClick={() => update("checks", [])}>No checks at this scope</button></div>
      </div>)}
      <p className="workflow-muted">Runs from the bound feature checkout. Per-recipe directory, environment and timeout editing is not supported yet. {AUTOMATIC_WORKFLOW_UNAVAILABLE}</p>
    </>;
    if (stage === "integration") return <>
      {branchField("targetBranch")}
      {select("method", [{ value: "merge", label: "Non-fast-forward merge" }, { value: "ff", label: "Fast-forward · unsupported", disabled: true }, { value: "squash", label: "Squash · unsupported", disabled: true }])}
      <label className="workflow-field">Permission<select value="ask" disabled aria-label="Integration permission"><option value="ask">Ask · exact plan approval</option><option disabled>Automatic · unavailable</option></select></label>
      <p className="workflow-muted">Local integration only. Checks require separate authorization, then an exact merge review. Imported fast-forward/squash values are retained but cannot execute. {AUTOMATIC_WORKFLOW_UNAVAILABLE}</p>
    </>;
    return <>
      {select("cleanup", [{ value: "retain", label: "Retain worktree and local branch" }, { value: "ask", label: "Ask to clean up · unavailable", disabled: true }, { value: "automatic", label: "Automatic · unavailable", disabled: true }])}
      <p className="workflow-muted">No resources are removed. {AUTOMATIC_WORKFLOW_UNAVAILABLE} Ignored files are not necessarily disposable.</p>
    </>;
  }
  function stageSummary(stage: Stage) {
    if (stage === "workspace") return { mode: "On request", description: `${formatValue(values.workspace)} · ${values.workspace === "worktree" ? formatValue(values.onCreate) : values.branch || "Any current branch"}` };
    if (stage === "commits") return { mode: formatValue(values.commits), description: "Complete selected files · exact confirmation" };
    if (stage === "checks") return { mode: "Ask to run", description: formatValue(values.checks) };
    if (stage === "integration") return { mode: values.targetBranch ? "Ask" : "No target", description: values.targetBranch ? `${values.targetBranch} · ${formatValue(values.method)}` : scope === "global" ? "Use project definition" : "No local integration configured" };
    return { mode: "Retain", description: "Feature worktree and local branch" };
  }
  const task = data?.task;
  const taskValues = task?.kind === "managed" ? task.settings : null;
  const taskDifferent = !!data && (task?.kind === "legacy" || !!taskValues && changedWorkflowFields(taskValues, data.resolved.session.values).length > 0);
  const legacy = task?.kind === "legacy" ? task.policy : null;
  const legacySummary: Record<GitWorkflowField, string> | null = legacy ? {
    enabled: "Legacy tool-specific gates", workspace: formatValue(legacy.mode),
    baseBranch: legacy.mode === "worktree" ? legacy.baseBranch : "Not captured",
    branch: legacy.mode === "current" ? legacy.branch ?? "Any current branch" : "Not captured",
    onCreate: formatValue(legacy.onCreate), commits: legacy.commits === "agent" ? "Legacy agent consent" : "Manual",
    checks: formatValue(legacy.checks ?? []), targetBranch: legacy.integration?.targetBranch ?? "No target",
    method: legacy.integration ? formatValue(legacy.integration.method) : "Not captured", cleanup: "Separate approval",
  } : null;
  const currentError = entry?.error || resolution?.validationError || (actionError?.context === context ? actionError.text : null);

  return <div ref={resizer.panelRef} className="workflow-container" data-covering={covering} hidden={!visible}>
    <div ref={panelRef} id="workflow-panel" className="workflow-home" role={covering ? "dialog" : "region"} aria-modal={covering || undefined} aria-labelledby="workflow-title">
      <header className="workflow-header"><div><h2 ref={titleRef} tabIndex={-1} id="workflow-title">Workflow</h2><p>{shortPath(data?.projectRoot ?? configCwd)}{session ? ` / ${session.name || "This chat"}` : " / Configuration"}</p></div>
        <div className="workflow-actions"><button type="button" disabled={!data || !!operation || loading} aria-pressed={data?.paused ?? false} onClick={() => void put("pause")}>{data?.paused ? "Resume all" : "Pause all"}</button>
          <button type="button" onClick={onClose} aria-label="Close Workflow"><span className="workflow-desktop-close" aria-hidden="true">×</span><span className="workflow-mobile-close">Back to chat</span></button></div>
      </header>
      {data?.paused && <p className="workflow-banner" role="status">All managed Git actions are paused, at every scope.</p>}
      {attention && <p className="workflow-banner" role="status">A request needs your attention in chat. Your workflow draft is unchanged. <button type="button" onClick={onClose}>Go to chat to answer</button></p>}
      {busy && data?.sessionScope !== "project" && task?.kind === "managed" && task.settings.workspace === "worktree" && !task.settings.baseBranch &&
        <p className="workflow-banner" role="status">This chat is running, so Session Save and Apply are unavailable. To keep its captured worktree settings and automatic chat continuation, Stop the chat, save and apply the base, then resume. For one new worktree only, the agent can instead propose an explicit local base with exact approval; that does not save settings or move this chat.</p>}
      <div className="workflow-home-scroll" hidden={!!detail}>
        <details className="workflow-legacy" onToggle={(event) => { if (event.target === event.currentTarget) setLegacyOpen(event.currentTarget.open); }}>
          <summary>Existing chat actions · legacy compatibility</summary>
        <section className="workflow-task" aria-label="Current task">
          <div className="workflow-overline">Chat checkout actions</div>
          <div className="workflow-task-title"><strong>{!session ? "No active task" : !data ? "Loading task settings…" : data.sessionScope === "project" ? "Actions still use the chat checkout" : task?.kind === "managed" ? "Using captured task settings" : task?.kind === "legacy" ? "Legacy task · pinned policy" : "No managed task yet"}</strong><span>{session ? attention ? "Needs you" : busy ? "Working" : "Idle" : ""}</span></div>
          {session ? <>
            <p className="workflow-path">Action source: <code>{session.cwd}</code></p>
            <p className="workflow-muted">These existing mutation panels keep their captured chat settings. Selecting a configuration project does not retarget them.</p>
            {data?.sessionScope !== "project" && <>
            <details><summary>Task details{taskDifferent ? " · Defaults differ — compare" : ""}</summary>
              <p className="workflow-path">Chat checkout: <code>{data?.cwd ?? session.cwd}</code></p>
              {task?.kind === "legacy" && <p>Existing policy stays pinned until explicit adoption. {task.policy ? `${formatValue(task.policy.mode)} · ${task.policy.commits === "agent" ? "Legacy agent commit consent" : "Manual commits"}${task.policy.integration ? ` · target ${task.policy.integration.targetBranch}` : ""}` : "No saved policy (or explicit opt-out)."}</p>}
              {(taskValues || legacySummary) && <dl className="workflow-comparison">{workflowFields.map((field) => <div key={field}><dt>{fieldNames[field]}</dt><dd>Task: {taskValues ? formatValue(taskValues[field]) : legacySummary![field]}<br />Saved Session: {formatValue(data!.resolved.session.values[field])}</dd></div>)}</dl>}
              <p className="workflow-muted">Session saves affect later tasks, except enablement and Commit Off, which are live restrictions. Apply uses only saved settings, never these drafts. It starts no Git operation.</p>
              <button type="button" disabled={!detailsAvailable || !data?.sessionEditable || busy || !!operation || loading} onClick={() => void put("task")}>Apply saved settings to this task</button>
              {(!data?.sessionEditable || busy) && <p className="workflow-muted">{sessionReason}</p>}
            </details>
            {data?.permissions && <details aria-label="Current task permissions"><summary>Permissions &amp; blockers</summary>
              <p className="workflow-muted">Captured task and live restrictions, not editor drafts. These checks do not approve an action or inspect Git state; exact checkout and candidate checks still run before execution.</p>
              <dl className="workflow-comparison">{([['workspace', 'Worktree creation'], ['commit', 'Commits'], ['checks', 'Checks'], ['integration', 'Integration']] as const).map(([stage, label]) => <div key={stage}><dt>{label}</dt><dd>{(['agent', 'human'] as const).map((actor) => {
                const permission = data.permissions![actor][stage];
                return <p key={actor}><strong>{actor === 'agent' ? 'Agent' : 'You'}: {permission.kind === 'blocked' ? 'Blocked' : permission.kind === 'legacy-consent' ? 'Saved policy' : 'Approval required'}</strong><br />{permission.reason}</p>;
              })}</dd></div>)}</dl>
              {data.permissions.legacyAgentCommitConsent && <p className="workflow-muted">Legacy preview/confirm retains this chat’s saved agent-commit consent. It does not create a new standing grant.</p>}
              <p className="workflow-muted">{AUTOMATIC_WORKFLOW_UNAVAILABLE}</p>
            </details>}
            {detailsAvailable && data && sessionId && <details open={sourceEvidenceOpen} onToggle={(event) => { if (event.target === event.currentTarget) setSourceEvidenceOpen(event.currentTarget.open); }}>
              <summary>Source evidence · optional legacy metadata</summary>
              <p className="workflow-muted">Not a prerequisite for Git actions. Adoption does not grant execution or move this chat.</p>
              <GitWorkflowTaskBinding key={context} sessionId={sessionId} cwd={data.cwd ?? session.cwd} settingsRevision={data.revision} visible={visible && !detail && legacyOpen && sourceEvidenceOpen} busy={busy} />
            </details>}
            </>}
            <div className="workflow-actions workflow-task-actions">{([['workspace', 'Workspace details'], ['commit', 'Review & commit'], ['merge', 'Integration review']] as const).map(([view, label]) => <button key={view} ref={(element) => { taskActionRefs.current[view] = element; }} type="button" disabled={!detailsAvailable} onClick={() => onDetailChange(view)}>{label}</button>)}</div>
          </> : <p className="workflow-muted">Configure Global or Project defaults without creating a chat or starting an agent.</p>}
        </section>
        </details>
        <form className="workflow-project-picker" onSubmit={(event) => { event.preventDefault(); if (projectInput.trim()) setProjectChoice({ source: choiceSource, cwd: projectInput.trim() }); }}>
          <label htmlFor="workflow-project-cwd">Configuration project</label><div className="workflow-actions"><input id="workflow-project-cwd" value={projectInput} onChange={(event) => setProjectInput(event.target.value)} placeholder="Repository directory (optional)" /><button type="submit" disabled={!projectInput.trim()}>Use project</button></div>
          <small>Changes only the settings destination. No chat, checkout, pending action or shell directory is moved.</small>
          {projectPath !== undefined && <button type="button" className="workflow-link" onClick={() => setProjectChoice(null)}>Back to chat defaults</button>}
        </form>
        {data?.sessionScope === "project" && <p className="workflow-banner">Project: <code>{data.projectRoot}</code> · Chat overrides apply only to this project. Explicit-project Git tools currently support status and read-only review, not mutations.{data.legacySessionSettings && " Legacy unqualified chat settings remain on their compatibility path; they are not copied to this project."}</p>}
        {(snapshot?.context === context && snapshot.projectReason) && <p className="workflow-banner">Project unavailable: {snapshot.projectReason} Global defaults are still available.</p>}
        {loadError && <p className="workflow-banner" role="alert">{loadError} <button type="button" disabled={!!operation} onClick={() => setReload((value) => value + 1)}>Retry loading</button></p>}
        {!data ? <p className="workflow-banner" role="status">{loading ? "Loading workflow…" : "Workflow settings are unavailable."}</p> : <>
          <section className="workflow-scope-area" aria-label="Workflow configuration scope"><div className="workflow-section-label"><h3>Configure workflow</h3><span>{Object.keys(draft).length} override{Object.keys(draft).length === 1 ? "" : "s"}</span></div>
            <div className="workflow-scopes" role="group" aria-label="Edit scope">{workflowScopes.map((level) => {
              const key = workflowDraftKey(level, data.projectRoot, session?.id, data.sessionScope);
              const item = key ? drafts[key] : undefined;
              const dirtyCount = item ? changedWorkflowFields(item.baseline, item.overrides).length : 0;
              return <button key={level} type="button" aria-pressed={level === scope} disabled={level === "project" ? !data.projectRoot : level === "session" ? !session || session.transient || !data.sessionEditable || busy : false}
                onClick={() => setScope(level)}>{scopeNames[level]}{level === "session" && data.sessionScope === "project" && <small>This project only</small>}{level === "project" && data.projectRoot && <small>{shortPath(data.projectRoot)}</small>}{dirtyCount > 0 && <small>{dirtyCount} unsaved</small>}</button>;
            })}</div><p className="workflow-scope-note">{scope === "session" && data.sessionScope === "project" ? "This chat × selected project · no task adoption" : scopeDescriptions[scope]}<span>{changes ? `${changes} unsaved` : "Saved"}</span></p>
            {!data.projectRoot && <p className="workflow-muted">Choose an available Git repository for Project settings.</p>}
            {(!session || session.transient || !data.sessionEditable || busy) && <p className="workflow-muted">Session unavailable: {sessionReason}</p>}
          </section>
          <form id="workflow-config-form" className="workflow-editor" aria-describedby={currentError ? "workflow-error" : undefined} onSubmit={(event) => { event.preventDefault(); void put(scope); }}>
            {field("enabled", <button id="workflow-enabled" type="button" className="workflow-toggle" role="switch" aria-checked={values.enabled} aria-label={`Integrated Git workflow · ${scopeNames[scope]}`} disabled={disabled} onClick={() => update("enabled", !values.enabled)}>{values.enabled ? "On" : "Off"}</button>)}
            {!values.enabled && <p className="workflow-muted">Off at this scope disables managed actions where inherited. Explicit Project or Session overrides may still enable them. Use Pause all to stop all managed actions.</p>}
            <p className="workflow-muted">Managed Git controls are not a sandbox for shell commands or other applications.</p>
            {stages.map((stage) => {
              const summary = stageSummary(stage.id);
              const origins = new Set(stage.fields.map((field) => resolution?.origins[field]));
              const origin = resolution?.origins[stage.fields[0]];
              const source = origins.size > 1 ? "Mixed sources" : origin === scope ? "Set here" : origin === "builtin" ? "Built-in default" : origin ? `From ${scopeNames[origin]}` : "";
              return <section className="workflow-stage" key={stage.id}>
                <button type="button" className="workflow-stage-heading" aria-expanded={expanded === stage.id} aria-controls={`workflow-stage-${stage.id}`} onClick={() => setExpanded((current) => current === stage.id ? null : stage.id)}>
                  <span><strong>{stage.label}</strong><small>{summary.description}</small></span><span className="workflow-stage-value"><span>{summary.mode}</span><small>{source}</small></span><span aria-hidden="true">{expanded === stage.id ? "⌄" : "›"}</span>
                </button><div id={`workflow-stage-${stage.id}`} className="workflow-stage-editor" hidden={expanded !== stage.id}>{stageEditor(stage.id)}</div>
              </section>;
            })}
          </form>
        </>}
      </div>
      <div className="workflow-detail-heading" hidden={!detail}><button ref={detailBackRef} type="button" onClick={() => onDetailChange(null)}>← Back to workflow</button><h3>{detail === "workspace" ? "Workspace continuation" : detail === "commit" ? "Review & commit" : "Local integration review"}</h3><p className="workflow-muted">This chat · <code>{session?.cwd}</code></p></div>
      {/* Stable portal host: visibility and home/detail navigation never reparent the chat's action views. */}
      <div ref={onDetailHost} className="workflow-detail-host" hidden={!detail} />
      {currentError && <div id="workflow-error" className="workflow-banner" role="alert">{currentError}{entry?.conflict && <button type="button" disabled={loading || !!operation} onClick={() => void load(draftKey ?? undefined)}>Reload saved &amp; discard this draft</button>}{actionError?.context === context && !entry?.conflict && <button type="button" disabled={loading || !!operation} onClick={() => void load()}>Reload saved settings</button>}</div>}
      {!!changes && <footer className="workflow-footer"><p>{changes} {scopeNames[scope].toLowerCase()} change{changes === 1 ? "" : "s"} · {scope === "project" ? data?.projectRoot : scope === "session" ? session?.name || session?.id : "Personal global defaults"}</p><small>Only this scope is saved. No Git operation starts.</small>
        <div className="workflow-actions"><button type="button" disabled={loading || !!operation} onClick={() => entry?.conflict ? void load(draftKey ?? undefined) : draftKey && setDrafts((current) => ({ ...current, [draftKey]: { ...current[draftKey], overrides: current[draftKey].baseline, error: undefined } }))}>{entry?.conflict ? "Reload & discard" : "Discard"}</button><button type="submit" form="workflow-config-form" className="workflow-primary" disabled={disabled || !!entry?.conflict || !!resolution?.validationError}>{operation === scope ? "Saving…" : saveLabels[scope]}</button></div>
      </footer>}
      {notice?.context === context && <p className="workflow-notice" role="status">{notice.text}</p>}
    </div>
    <div className="workflow-resizer" {...resizer.separatorProps} />
  </div>;
}
