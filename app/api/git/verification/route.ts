import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { bindHumanGitCheckReceiptAuthority, createGitCheckAuthorityFence, createHumanGitCommitVerificationContext } from "@/lib/git-check-authority-fence";
import { beginGitActionWithId, gitActionAttribution, type GitActionHandle } from "@/lib/git-action-controller";
import { humanGitActionSink, readHumanGitSessionManager, type HumanGitScope } from "@/lib/git-action-human";
import { captureGitCheckoutCheckRecoverySnapshot, readGitCheckoutVerificationNativeExecution, runGitCheckoutVerification, validateGitCheckoutVerificationReceipt,
  type GitCheckoutVerificationOptions, type GitCheckoutVerificationReceipt } from "@/lib/git-checkout-verification";
import { normalizeGitCheckRecipe, selectGitCheckRecipesForStage } from "@/lib/git-check-recipe";
import { selectGitProjectResources, type GitProjectResources } from "@/lib/git-project-resources";
import { captureGitScopedAuthorityRevision, readGitScopedAuthorityRevision } from "@/lib/git-scoped-authority";
import { gitExecEnv } from "@/lib/git-exec";
import { sanitizeProjectCommandEnvironment } from "@/lib/project-command-env";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { samePath } from "@/lib/paths";
import { createGitCheckCohort, retireGitCheckCohort, gitCheckSourceReadSync, type GitCheckCohort } from "@/lib/git-check-runner";
import type { GitActionCheckExecution, GitActionCheckoutVerificationBinding, GitActionDiagnosticWarning } from "@/lib/git-action-types";
import { captureGitActionCandidateSnapshot } from "@/lib/git-action-journal";
import { GitCommitVerificationError } from "@/lib/git-commit-verification";

export const dynamic = "force-dynamic";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const digestString = (value: string) => createHash("sha256").update(value).digest("hex");
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const limitation = { evidenceScope: "working-workspace", candidateTreeVerified: false, repositoryChecksWaived: false } as const;
const unavailable = { status: "unavailable", reason: "storage-unavailable" } as const;
const error = (message: string, status = 409) => NextResponse.json({ error: message, ...limitation }, { status });
function exact(input: Record<string, unknown>, keys: string[]) { return Object.keys(input).sort().join() === keys.sort().join(); }
function ids(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 12 && value.every((id) => typeof id === "string" && ID.test(id)) && new Set(value).size === value.length;
}
interface CheckCapture { checkIndex: number; snapshotDigest: string; policyDigest: string; policyRevision: string; environmentDigest: string;
  recipeDigest: string; sourceOid: string; sourceTreeOid: string; executionCwd: string }
interface CheckAction { id: string; handle?: GitActionHandle; binding: GitActionCheckoutVerificationBinding; measured?: Readonly<GitActionCheckExecution>; diagnostics?: GitActionDiagnosticWarning }
interface Pending { context: Context; scope: HumanGitScope; source: GitProjectResources; checks: CheckCapture[]; actions: CheckAction[];
  cohort: GitCheckCohort; revision: string; authorityRevision: string; expiresAt: number; timer: ReturnType<typeof setTimeout>; controller?: AbortController }
interface Runtime { pending: Map<string, Pending>; receipts: Map<string, { scope: HumanGitScope; checkIndex: number; authorityRevision: string; expiresAt: number }>; creating: number }
const key = Symbol.for("pi-web:human-commit-checks:v2");
function runtime(): Runtime { const g = globalThis as unknown as Record<symbol, Runtime>; return g[key] ??= { pending: new Map(), receipts: new Map(), creating: 0 }; }
function sameScope(a: HumanGitScope, b: HumanGitScope) { return a.sessionId === b.sessionId && samePath(a.sessionFile, b.sessionFile) && samePath(a.cwd, b.cwd); }
function retire(id: string) { const p = runtime().pending.get(id); if (!p || p.controller) return;
  runtime().pending.delete(id); clearTimeout(p.timer); retireGitCheckCohort(p.cohort); p.actions.forEach(({ handle }) => handle?.release()); }
async function scopeFor(id: unknown) {
  if (typeof id !== "string" || !id || id.length > 128 || id.trim() !== id) throw new Error("invalid session");
  const agentDir = getAgentDir(), original = captureGitScopedAuthorityRevision(agentDir);
  const file = await resolveSessionPath(id);
  if (!file) throw new Error("missing session");
  const header = readSessionHeader(file);
  if (header?.id !== id || !header.cwd) throw new Error("saved session changed");
  const scope = { sessionId: id, sessionFile: file, cwd: header.cwd };
  readHumanGitSessionManager(scope);
  // Own persisted/live owner is observed before canonical discovery or policy work.
  const ownFence = createGitCheckAuthorityFence({ scope, agentDir, projectRoots: [], checkouts: [scope.cwd] });
  const ownRevision = ownFence();
  const source = await selectGitProjectResources(scope.cwd);
  if (!samePath(source.cwd, scope.cwd)) throw new Error("checkout root required");
  const dependencies = { sessionId: id, projectRoots: [source.projectRoot], trustPaths: [scope.cwd, source.projectRoot] };
  const assertOriginal = () => {
    if (ownFence() !== ownRevision || original(dependencies) !== readGitScopedAuthorityRevision(agentDir, dependencies)) throw new Error("original authority revoked");
  };
  assertOriginal();
  const authority = createHumanGitCommitVerificationContext(scope, [], source, agentDir);
  const read = authority.readAuthorityRevisionSync!;
  const authorityRevision = read();
  authority.readAuthorityRevisionSync = () => { assertOriginal(); const revision = read();
    if (revision !== authorityRevision) throw new Error("original authority revoked"); return revision; };
  const policy = await authority.sourceGetPolicy(source);
  if (!await authority.isTrusted(source.projectRoot)) throw new Error("trust required");
  authority.readAuthorityRevisionSync();
  const required = selectGitCheckRecipesForStage(policy.settings.checks, "commit");
  return { scope, source, authority, policy, required, authorityRevision };
}
type Context = Awaited<ReturnType<typeof scopeFor>>;
function optionsFor(c: Context, checkIndex: number, signal?: AbortSignal): GitCheckoutVerificationOptions {
  return { sessionId: c.scope.sessionId, selector: { repositoryPath: c.source.projectRoot, checkoutPath: c.source.cwd },
    agentDir: c.authority.agentDir, checkIndex, stage: "commit", signal,
    getPolicy: c.authority.sourceGetPolicy, isSelectionAuthorized: c.authority.isSelectionAuthorized,
    isTrusted: c.authority.isTrusted, readAuthorityRevisionSync: c.authority.readAuthorityRevisionSync,
    isActorAuthorized: async (candidate) => {
      if (candidate.stage !== "commit" || !c.required.some((check) => check.checkIndex === candidate.checkIndex)) return false;
      await c.authority.isSelectionAuthorized(candidate.selection);
      const authorized = await c.authority.isCheckExecutionAuthorized(candidate.selection);
      c.authority.readAuthorityRevisionSync!();
      return authorized;
    } };
}
function requireV3(value: { version: number }) {
  if (value.version !== 3) throw new Error("native v3 working-workspace adapter unavailable");
}
async function capture(c: Context, checkIndex: number): Promise<CheckCapture> {
  const recipe = c.policy.settings.checks[checkIndex];
  if (!c.required.some((check) => check.checkIndex === checkIndex) || !recipe) throw new Error("required commit check index only");
  if (!await c.authority.isCheckExecutionAuthorized(c.source)) throw new Error("checks denied");
  const normalized = normalizeGitCheckRecipe(recipe);
  const env = sanitizeProjectCommandEnvironment({ ...gitExecEnv(), ...normalized.env });
  const environmentDigest = digest(Object.entries(env).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)));
  const policyDigest = digest(c.policy.settings);
  const snapshot = await captureGitCheckoutCheckRecoverySnapshot(c.source, { recipe, checkIndex, stage: "commit",
    policyDigest, policyRevision: c.policy.policyRevision, environmentDigest }, true);
  requireV3(snapshot);
  if (snapshot.dependencyVersion !== 2) throw new Error("scoped dependencies required");
  const sourceOid = gitCheckSourceReadSync(c.source, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  const sourceTreeOid = gitCheckSourceReadSync(c.source, ["rev-parse", "--verify", "HEAD^{tree}"]).trim();
  if (digestString(sourceOid) !== snapshot.head || digestString(sourceTreeOid) !== snapshot.tree) throw new Error("source changed");
  c.authority.readAuthorityRevisionSync!();
  return { checkIndex, snapshotDigest: digest(snapshot), policyDigest, policyRevision: c.policy.policyRevision, environmentDigest,
    sourceOid, sourceTreeOid, recipeDigest: snapshot.recipeDigest, executionCwd: join(c.source.cwd, normalized.cwd) };
}
function publicReceipt(r: GitCheckoutVerificationReceipt) { requireV3(r); return { id: r.id, checkIndex: r.checkIndex,
  startedAt: r.startedAt, finishedAt: r.finishedAt, expiresAt: r.expiresAt, freshness: "current", ...limitation }; }
async function status(c: Context, requested?: string[]) {
  const receipts: ReturnType<typeof publicReceipt>[] = [];
  for (const [id, entry] of runtime().receipts) {
    if (!sameScope(entry.scope, c.scope) || requested && !requested.includes(id)) continue;
    try {
      if (entry.expiresAt <= Date.now() || c.authority.readAuthorityRevisionSync!() !== entry.authorityRevision) throw new Error("original receipt authority changed");
      receipts.push(publicReceipt(await validateGitCheckoutVerificationReceipt(id, optionsFor(c, entry.checkIndex))));
    } catch { runtime().receipts.delete(id); }
  }
  if (requested && requested.some((id) => !receipts.some((r) => r.id === id))) throw new Error("stale or wrong receipts");
  return receipts;
}
export async function GET(req: Request) {
  try {
    const query = new URL(req.url).searchParams;
    if ([...query.keys()].join() !== "sessionId") return error("Only saved sessionId is accepted", 400);
    const c = await scopeFor(query.get("sessionId"));
    req.signal.throwIfAborted();
    return NextResponse.json({ ...limitation, status: !c.policy.settings.checks.length ? "no-defined" : !c.required.length ? "no-required" : "required",
      revision: digest({ source: c.source, policy: c.policy }),
      checks: c.required.map(({ checkIndex, recipe }) => ({ checkIndex, label: recipe.label })), receipts: await status(c),
      instructionWarning: "Project instructions still apply even when no commit-stage checks are configured. Working workspace evidence does not verify the selected commit tree." });
  } catch (cause) { return refusal(cause); }
}
async function bodyOf(req: Request) {
  const reader = req.body?.getReader(); if (!reader) throw new SyntaxError();
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 8192) { await reader.cancel(); throw new SyntaxError(); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyntaxError();
  return value as Record<string, unknown>;
}
function refusal(cause: unknown) {
  if (cause instanceof GitCommitVerificationError) return NextResponse.json({ error: cause.message, code: cause.code, ...limitation }, { status: 409 });
  return error(cause instanceof SyntaxError ? "Invalid or oversized verification request" : "Commit checks unavailable or evidence stale; refresh requirements and inspect the working workspace", cause instanceof SyntaxError ? 400 : 409);
}
async function diagnostic(action: CheckAction, state: Parameters<GitActionHandle["update"]>[0], extra?: Parameters<GitActionHandle["update"]>[1]) {
  try { if (action.handle) await action.handle.update(state, extra); else action.diagnostics = unavailable; }
  catch { action.diagnostics = unavailable; }
  const handle = action.handle;
  if (handle?.diagnosticsUnavailable || handle?.diagnostics) {
    const warning = handle.diagnostics ?? unavailable;
    if (!action.diagnostics || warning.reason === "storage-unavailable") action.diagnostics = warning;
  }
}
function authenticExecution(actual: object, action: CheckAction, c: Context, check: CheckCapture) {
  const measured = readGitCheckoutVerificationNativeExecution(actual);
  if (!measured || measured.actionId !== action.id || measured.sessionId !== c.scope.sessionId || measured.stage !== "commit" ||
    measured.checkIndex !== check.checkIndex || measured.recipeDigest !== check.recipeDigest || measured.policyDigest !== check.policyDigest ||
    measured.snapshotDigest !== check.snapshotDigest || measured.environmentDigest !== check.environmentDigest || !samePath(measured.executionCwd, check.executionCwd)) throw new Error("native execution binding mismatched");
  return measured;
}
export async function POST(req: Request) {
  try {
    const input = await bodyOf(req), op = input.operation;
    if (!(op === "preview" && exact(input, ["sessionId", "operation", "checkIndexes"]) && Array.isArray(input.checkIndexes) && input.checkIndexes.length > 0 && input.checkIndexes.length <= 12 && input.checkIndexes.every((i) => Number.isInteger(i) && i >= 0 && i < 12) && new Set(input.checkIndexes).size === input.checkIndexes.length) &&
      !(["run", "decline", "cancel"].includes(op as string) && exact(input, ["sessionId", "operation", "previewId", "revision"]) && typeof input.previewId === "string" && ID.test(input.previewId) && typeof input.revision === "string") &&
      !(op === "status" && exact(input, ["sessionId", "operation", "receiptIds"]) && ids(input.receiptIds))) return error("Only defined commit-stage indexes or exact process previews/receipt IDs are accepted", 400);
    const c = await scopeFor(input.sessionId);
    if (op === "status") return NextResponse.json({ receipts: await status(c, input.receiptIds as string[]), ...limitation });
    const state = runtime();
    for (const [id, p] of state.pending) if (p.expiresAt <= Date.now()) retire(id);
    if (op === "cancel") {
      const p = state.pending.get(input.previewId as string);
      if (!p || !sameScope(p.scope, c.scope) || p.revision !== input.revision || !p.controller) throw new Error("live run required");
      p.controller.abort(); return NextResponse.json({ status: "cancelling", ...limitation });
    }
    req.signal.throwIfAborted();
    if (op === "preview") {
      if (state.pending.size + state.creating >= 128) throw new Error("preview capacity");
      state.creating++;
      const actions: CheckAction[] = [];
      try {
        const checks = []; for (const index of input.checkIndexes as number[]) checks.push(await capture(c, index));
        for (const check of checks) {
          const binding: GitActionCheckoutVerificationBinding = { ...limitation, stage: "commit", requiredSavedIndexes: [check.checkIndex],
            sourceOid: check.sourceOid, sourceTreeOid: check.sourceTreeOid, snapshotDigest: check.snapshotDigest,
            policyDigest: check.policyDigest, policyRevision: check.policyRevision };
          const action: CheckAction = { id: randomUUID(), binding }; actions.push(action);
          const candidate = captureGitActionCandidateSnapshot({ kind: "checkout-verification", repositoryRoot: c.source.cwd,
            ...gitActionAttribution(c.source), featureBranch: c.source.branch, checkoutVerification: { ...binding,
              source: { gitDir: c.source.gitDir, checkoutIdentity: c.source.identities.checkout, gitIdentity: c.source.identities.git, markerIdentity: c.source.identities.marker },
              checks: [{ checkIndex: check.checkIndex, recipe: c.policy.settings.checks[check.checkIndex], recipeDigest: check.recipeDigest,
                environmentDigest: check.environmentDigest, executionCwd: check.executionCwd }] } });
          action.handle = await beginGitActionWithId(action.id, humanGitActionSink(c.scope), "human", candidate, c.authority.agentDir);
          await diagnostic(action, "awaiting-decision");
        }
        c.authority.readAuthorityRevisionSync!();
        const revision = digest({ source: c.source, checks, authorityRevision: c.authorityRevision }), previewId = randomUUID(), expiresAt = Date.now() + 60_000;
        const cohort = createGitCheckCohort(checks.map((check) => check.checkIndex));
        const timer = setTimeout(() => retire(previewId), 60_000); timer.unref?.();
        state.pending.set(previewId, { context: c, scope: c.scope, source: c.source, checks, actions, cohort, revision, authorityRevision: c.authorityRevision, expiresAt, timer });
        return NextResponse.json({ previewId, revision, expiresAt, actionId: actions[0].id, actionIds: actions.map(({ id }) => id), source: c.source.cwd, ...limitation,
          ...(actions.some((a) => a.diagnostics) ? { diagnostics: actions.find(a => a.diagnostics)!.diagnostics } : {}),
          checks: checks.map((check) => { const recipe = normalizeGitCheckRecipe(c.policy.settings.checks[check.checkIndex]);
            return { checkIndex: check.checkIndex, label: recipe.label, argv: recipe.argv, cwd: check.executionCwd, envOverrides: recipe.env, environmentDigest: check.environmentDigest }; }) });
      } catch (cause) { for (const action of actions) { await diagnostic(action, "blocked"); action.handle?.release(); } throw cause; }
      finally { state.creating--; }
    }
    const p = state.pending.get(input.previewId as string);
    if (!p || p.controller || !sameScope(p.scope, c.scope) || p.revision !== input.revision || p.expiresAt <= Date.now()) throw new Error("single-use preview required");
    if (op === "decline") {
      state.pending.delete(input.previewId as string); clearTimeout(p.timer); retireGitCheckCohort(p.cohort);
      for (const action of p.actions) { await diagnostic(action, "declined", { decision: "declined" }); action.handle?.release(); }
      return NextResponse.json({ status: "declined", actionId: p.actions[0].id, ...limitation });
    }
    // Consume the exact process preview before awaits. Keep the ORIGINAL authority
    // and cohort; a fresh request context cannot rebaseline the human waiting period.
    p.controller = new AbortController(); clearTimeout(p.timer);
    const abort = () => p.controller!.abort(); req.signal.addEventListener("abort", abort, { once: true });
    if (req.signal.aborted) abort();
    let started = false, passed = false;
    const original = p.context;
    try {
      original.authority.readAuthorityRevisionSync!();
      if (c.authorityRevision !== p.authorityRevision || JSON.stringify(c.source) !== JSON.stringify(p.source)) throw new Error("source changed");
      for (const check of p.checks) if (digest(await capture(original, check.checkIndex)) !== digest(check)) throw new Error("preview stale");
      const receipts: ReturnType<typeof publicReceipt>[] = [];
      for (const [index, check] of p.checks.entries()) {
        const action = p.actions[index], binding = action.binding;
        await diagnostic(action, "executing", { decision: "approved", intended: { kind: "checkout-verification", status: "passed", checkoutVerification: { ...binding, runs: [] } } });
        p.controller.signal.throwIfAborted(); original.authority.readAuthorityRevisionSync!();
        const options = optionsFor(original, check.checkIndex, p.controller.signal), authorize = options.isActorAuthorized;
        options.isActorAuthorized = async (candidate) => await authorize(candidate) &&
          candidate.policyRevision === check.policyRevision && candidate.policyDigest === check.policyDigest && digest(candidate.snapshot) === check.snapshotDigest;
        started = true;
        const receipt = await runGitCheckoutVerification({ ...options, actionId: action.id, cohort: p.cohort,
          onExecution: (execution) => {
            // Prepublication measurements are diagnostic only, even after exit 0.
            // Keep these in memory: immutable journal runs cannot be upgraded
            // later with publication metadata. Store the completed run once.
            action.measured = authenticExecution(execution, action, original, check);
          } });
        // This private reader attests the genuine POSTPUBLICATION receipt. Missing
        // callback diagnostics never veto it; copies/history are not proof.
        const measured = authenticExecution(receipt, action, original, check);
        if (measured.receipt?.id !== receipt.id || measured.receipt.sha256 !== digest(receipt) || measured.receipt.expiresAt !== receipt.expiresAt || receipt.version !== 3) throw new Error("native completion unattested");
        action.measured = measured;
        if (receipt.diagnostics) action.diagnostics = unavailable;
        await diagnostic(action, "succeeded", { outcome: { kind: "checkout-verification", status: "passed", checkoutVerification: { ...binding, runs: [structuredClone(measured)] } } });
        // Diagnostics may await arbitrary storage. Revalidate actual bytes and
        // the same original authority again, not just a receipt-shaped outcome.
        await validateGitCheckoutVerificationReceipt(receipt.id, options);
        original.authority.readAuthorityRevisionSync!();
        bindHumanGitCheckReceiptAuthority(p.scope, receipt, p.authorityRevision);
        for (const [id, entry] of state.receipts) if (entry.expiresAt <= Date.now()) state.receipts.delete(id);
        if (state.receipts.size >= 4096) throw new Error("receipt registry capacity");
        state.receipts.set(receipt.id, { scope: p.scope, checkIndex: check.checkIndex, authorityRevision: p.authorityRevision, expiresAt: receipt.expiresAt }); receipts.push(publicReceipt(receipt));
      }
      original.authority.readAuthorityRevisionSync!();
      passed = true;
      return NextResponse.json({ status: "passed", actionId: p.actions[0].id, actionIds: p.actions.map(({ id }) => id), receipts,
        ...(p.actions.some((a) => a.diagnostics) ? { diagnostics: p.actions.find(a => a.diagnostics)!.diagnostics } : {}), ...limitation });
    } catch {
      retireGitCheckCohort(p.cohort);
      for (const action of p.actions) if (action.handle?.record.state !== "succeeded") await diagnostic(action, started ? "failed" : "blocked");
      return NextResponse.json({ actionId: p.actions[0].id, knownRuns: p.actions.flatMap(({ measured }) => measured ? [measured] : []),
        error: started ? "Checks did not produce current evidence. Commands can change files; inspect the working workspace." : "Check preview stale or blocked before execution; prepare a new preview.",
        ...(p.actions.some((a) => a.diagnostics) ? { diagnostics: p.actions.find(a => a.diagnostics)!.diagnostics } : {}), ...limitation }, { status: 409 });
    } finally {
      if (!passed) retireGitCheckCohort(p.cohort);
      state.pending.delete(input.previewId as string); req.signal.removeEventListener("abort", abort); p.actions.forEach(({ handle }) => handle?.release());
    }
  } catch (cause) { return refusal(cause); }
}
