import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { bindHumanGitCheckReceiptAuthority, createHumanGitCommitVerificationContext } from "@/lib/git-check-authority-fence";
import { beginGitAction, failGitAction, finishVerifiedNativeGitAction, gitActionAttribution, type GitActionHandle } from "@/lib/git-action-controller";
import { humanGitActionSink, readHumanGitSessionManager, type HumanGitScope } from "@/lib/git-action-human";
import { acquireGitCheckoutGate, isGitCheckoutGated } from "@/lib/git-checkout-gate";
import { captureGitCheckoutCheckRecoverySnapshot, readGitCheckoutVerificationNativeExecution, runGitCheckoutVerification, validateGitCheckoutVerificationReceipt,
  type GitCheckoutVerificationOptions, type GitCheckoutVerificationReceipt } from "@/lib/git-checkout-verification";
import { normalizeGitCheckRecipe, selectGitCheckRecipesForStage } from "@/lib/git-check-recipe";
import { assertGitOperationAdmission, GitOperationRecoveryError } from "@/lib/git-operation-admission";
import { selectGitProjectResources, type GitProjectResources } from "@/lib/git-project-resources";
import { gitExecEnv } from "@/lib/git-exec";
import { sanitizeProjectCommandEnvironment } from "@/lib/project-command-env";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { samePath } from "@/lib/paths";
import { gitCheckSourceReadSync } from "@/lib/git-check-runner";
import type { GitActionCheckExecution, GitActionCheckoutVerificationBinding, GitActionNativeOutcome } from "@/lib/git-action-types";
import { GitCommitVerificationError } from "@/lib/git-commit-verification";

export const dynamic = "force-dynamic";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const digestString = (value: string) => createHash("sha256").update(value).digest("hex");
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const limitation = { evidenceScope: "working-workspace", candidateTreeVerified: false, repositoryChecksWaived: false } as const;
const error = (message: string, status = 409) => NextResponse.json({ error: message, ...limitation }, { status });
function exact(input: Record<string, unknown>, keys: string[]) { return Object.keys(input).sort().join() === keys.sort().join(); }
function ids(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 12 && value.every((id) => typeof id === "string" && ID.test(id)) && new Set(value).size === value.length;
}
interface CheckCapture { checkIndex: number; snapshotDigest: string; policyDigest: string; policyRevision: string; environmentDigest: string;
  recipeDigest: string; sourceOid: string; sourceTreeOid: string; executionCwd: string }
interface CheckAction { handle: GitActionHandle; binding: GitActionCheckoutVerificationBinding; measured?: GitActionCheckExecution }
interface Pending { scope: HumanGitScope; source: GitProjectResources; checks: CheckCapture[]; actions: CheckAction[]; revision: string; authorityRevision: string;
  expiresAt: number; timer: ReturnType<typeof setTimeout>; controller?: AbortController }
interface Runtime { pending: Map<string, Pending>; receipts: Map<string, { scope: HumanGitScope; checkIndex: number; authorityRevision: string; expiresAt: number }>; creating: number }
const key = Symbol.for("pi-web:human-commit-checks:v1");
function runtime(): Runtime { const g = globalThis as unknown as Record<symbol, Runtime>; return g[key] ??= { pending: new Map(), receipts: new Map(), creating: 0 }; }
function sameScope(a: HumanGitScope, b: HumanGitScope) { return a.sessionId === b.sessionId && samePath(a.sessionFile, b.sessionFile) && samePath(a.cwd, b.cwd); }
function retire(id: string) { const p = runtime().pending.get(id); if (!p || p.controller) return;
  runtime().pending.delete(id); clearTimeout(p.timer); p.actions.forEach(({ handle }) => handle.release()); }
async function scopeFor(id: unknown) {
  if (typeof id !== "string" || !id || id.length > 128 || id.trim() !== id) throw new Error("invalid session");
  const file = await resolveSessionPath(id);
  if (!file) throw new Error("missing session");
  const header = readSessionHeader(file);
  if (header?.id !== id || !header.cwd) throw new Error("saved session changed");
  const scope = { sessionId: id, sessionFile: file, cwd: header.cwd };
  readHumanGitSessionManager(scope);
  const source = await selectGitProjectResources(scope.cwd);
  if (!samePath(source.cwd, scope.cwd)) throw new Error("checkout root required");
  const authority = createHumanGitCommitVerificationContext(scope, [], source);
  const policy = await authority.sourceGetPolicy(source);
  if (!await authority.isTrusted(source.projectRoot)) throw new Error("trust required");
  const required = selectGitCheckRecipesForStage(policy.settings.checks, "commit");
  return { scope, source, authority, policy, required };
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
      return c.authority.isCheckExecutionAuthorized(candidate.selection);
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
  // Never fabricate a v3 manifest or run the legacy paired runner for direct-main.
  requireV3(snapshot);
  const sourceOid = gitCheckSourceReadSync(c.source, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  const sourceTreeOid = gitCheckSourceReadSync(c.source, ["rev-parse", "--verify", "HEAD^{tree}"]).trim();
  if (digestString(sourceOid) !== snapshot.head || digestString(sourceTreeOid) !== snapshot.tree) throw new Error("source changed");
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
    }
    catch { runtime().receipts.delete(id); }
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
    await assertGitOperationAdmission(c.source, c.authority.agentDir);
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
  if (cause instanceof GitOperationRecoveryError) return NextResponse.json({ error: cause.message, recoveryRequired: true, actionId: cause.actionId, ...limitation }, { status: 409 });
  return error(cause instanceof SyntaxError ? "Invalid or oversized verification request" : "Commit checks unavailable or evidence stale; refresh requirements and inspect the working workspace", cause instanceof SyntaxError ? 400 : 409);
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
    if (isGitCheckoutGated(c.scope.cwd)) throw new Error("checkout busy");
    const release = acquireGitCheckoutGate([c.scope.cwd]);
    try {
      req.signal.throwIfAborted();
      if (op === "preview") {
        if (state.pending.size + state.creating >= 128) throw new Error("preview capacity");
        state.creating++;
        const actions: CheckAction[] = [];
        try {
          await assertGitOperationAdmission(c.source, c.authority.agentDir);
          const authorityRevision = c.authority.readAuthorityRevisionSync!();
          const checks = []; for (const index of input.checkIndexes as number[]) checks.push(await capture(c, index));
          for (const check of checks) {
            const binding: GitActionCheckoutVerificationBinding = { ...limitation, stage: "commit", requiredSavedIndexes: [check.checkIndex],
              sourceOid: check.sourceOid, sourceTreeOid: check.sourceTreeOid, snapshotDigest: check.snapshotDigest,
              policyDigest: check.policyDigest, policyRevision: check.policyRevision };
            const handle = await beginGitAction(humanGitActionSink(c.scope), "human", { kind: "checkout-verification", repositoryRoot: c.source.cwd,
              ...gitActionAttribution(c.source), featureBranch: c.source.branch, checkoutVerification: { ...binding,
                source: { gitDir: c.source.gitDir, checkoutIdentity: c.source.identities.checkout, gitIdentity: c.source.identities.git, markerIdentity: c.source.identities.marker },
                checks: [{ checkIndex: check.checkIndex, recipe: c.policy.settings.checks[check.checkIndex], recipeDigest: check.recipeDigest,
                  environmentDigest: check.environmentDigest, executionCwd: check.executionCwd }] } });
            actions.push({ handle, binding }); await handle.update("awaiting-decision");
          }
          if (c.authority.readAuthorityRevisionSync!() !== authorityRevision) throw new Error("authority changed during preview");
          const revision = digest({ source: c.source, checks, authorityRevision }), previewId = randomUUID(), expiresAt = Date.now() + 60_000;
          const timer = setTimeout(() => retire(previewId), 60_000); timer.unref?.();
          state.pending.set(previewId, { scope: c.scope, source: c.source, checks, actions, revision, authorityRevision, expiresAt, timer });
          return NextResponse.json({ previewId, revision, expiresAt, actionId: actions[0].handle.record.id,
            actionIds: actions.map(({ handle }) => handle.record.id), source: c.source.cwd, ...limitation,
            checks: checks.map((check) => { const recipe = normalizeGitCheckRecipe(c.policy.settings.checks[check.checkIndex]);
              return { checkIndex: check.checkIndex, label: recipe.label, argv: recipe.argv, cwd: check.executionCwd, envOverrides: recipe.env, environmentDigest: check.environmentDigest }; }) });
        } catch (cause) { for (const { handle } of actions) { try { await failGitAction(handle, false, req.signal, cause); } finally { handle.release(); } } throw cause; }
        finally { state.creating--; }
      }
      const p = state.pending.get(input.previewId as string);
      if (!p || p.controller || !sameScope(p.scope, c.scope) || p.revision !== input.revision || p.expiresAt <= Date.now()) throw new Error("single-use preview required");
      if (op === "decline") {
        state.pending.delete(input.previewId as string); clearTimeout(p.timer);
        try { for (const { handle } of p.actions) await handle.update("declined", { decision: "declined" }); }
        finally { p.actions.forEach(({ handle }) => handle.release()); }
        return NextResponse.json({ status: "declined", actionId: p.actions[0].handle.record.id, ...limitation });
      }
      // Consumption precedes any await. Keep only a cancellable running identity;
      // another run cannot replay it and a decline never launches a command.
      p.controller = new AbortController(); clearTimeout(p.timer);
      const abort = () => p.controller!.abort(); req.signal.addEventListener("abort", abort, { once: true });
      if (req.signal.aborted) abort();
      let started = false;
      try {
        if (c.authority.readAuthorityRevisionSync!() !== p.authorityRevision || JSON.stringify(c.source) !== JSON.stringify(p.source)) throw new Error("source changed");
        for (const check of p.checks) if (digest(await capture(c, check.checkIndex)) !== digest(check)) throw new Error("preview stale");
        await assertGitOperationAdmission(c.source, c.authority.agentDir);
        if (c.authority.readAuthorityRevisionSync!() !== p.authorityRevision) throw new Error("authority changed before execution");
        const receipts: ReturnType<typeof publicReceipt>[] = [];
        for (const [index, check] of p.checks.entries()) {
          const action = p.actions[index], { handle, binding } = action;
          await handle.update("executing", { decision: "approved", intended: { kind: "checkout-verification", status: "passed", checkoutVerification: { ...binding, runs: [] } } });
          p.controller.signal.throwIfAborted();
          const options = optionsFor(c, check.checkIndex, p.controller.signal), authorize = options.isActorAuthorized;
          options.isActorAuthorized = async (candidate) => await authorize(candidate) && c.authority.readAuthorityRevisionSync!() === p.authorityRevision &&
            candidate.policyRevision === check.policyRevision && candidate.policyDigest === check.policyDigest && digest(candidate.snapshot) === check.snapshotDigest;
          started = true;
          const outcomeFor = (measured: Readonly<GitActionCheckExecution>): Extract<GitActionNativeOutcome, { kind: "checkout-verification" }> => ({ kind: "checkout-verification",
            status: measured.receipt ? "passed" : p.controller!.signal.aborted ? "cancelled" : "failed",
            checkoutVerification: { ...binding, runs: [structuredClone(measured)] } });
          const runOptions: GitCheckoutVerificationOptions = {
            ...options, actionId: handle.record.id, onExecution: async (execution) => {
              // The original opaque native object, not a receipt-shaped clone or
              // an action/history ID, attests these actual measurements.
              const measured = readGitCheckoutVerificationNativeExecution(execution);
              if (!measured || measured.actionId !== handle.record.id || measured.sessionId !== c.scope.sessionId ||
                measured.stage !== "commit" || measured.checkIndex !== check.checkIndex || measured.recipeDigest !== check.recipeDigest ||
                measured.policyDigest !== check.policyDigest || measured.snapshotDigest !== check.snapshotDigest ||
                measured.environmentDigest !== check.environmentDigest || !samePath(measured.executionCwd, check.executionCwd)) throw new Error("native execution binding mismatched");
              action.measured = structuredClone(measured);
              // Stay executing: receipt metadata is proposed, not yet usable.
              // A failed write must throw back into native supervision, retaining
              // its original unit/intent. Native settlement follows this await.
              await handle.update("executing", { outcome: outcomeFor(measured) });
            } };
          const receipt = await runGitCheckoutVerification(runOptions);
          const measured = readGitCheckoutVerificationNativeExecution(receipt);
          if (!measured || !action.measured || digest(measured) !== digest(action.measured) || measured.receipt?.id !== receipt.id ||
            measured.receipt.sha256 !== digest(receipt) || measured.receipt.expiresAt !== receipt.expiresAt) throw new Error("native completion unattested");
          const view = publicReceipt(receipt);
          // Only an actually published native receipt attests successful admission
          // settlement; final history cannot be inferred from callback metadata.
          await finishVerifiedNativeGitAction(handle, receipt, (actual) => {
            const completed = readGitCheckoutVerificationNativeExecution(actual);
            return actual === receipt && completed && digest(completed) === digest(action.measured) && completed.receipt?.id === receipt.id
              ? { actionId: completed.actionId, outcome: outcomeFor(completed) } : undefined;
          });
          if (c.authority.readAuthorityRevisionSync!() !== p.authorityRevision) throw new Error("authority changed before receipt publication");
          for (const [id, entry] of state.receipts) if (entry.expiresAt <= Date.now()) state.receipts.delete(id);
          if (state.receipts.size >= 4096) throw new Error("receipt registry capacity");
          if (receipt.version !== 3) throw new Error("native v3 receipt required");
          bindHumanGitCheckReceiptAuthority(c.scope, receipt, p.authorityRevision);
          state.receipts.set(receipt.id, { scope: c.scope, checkIndex: check.checkIndex, authorityRevision: p.authorityRevision, expiresAt: receipt.expiresAt }); receipts.push(view);
        }
        return NextResponse.json({ status: "passed", actionId: p.actions[0].handle.record.id,
          actionIds: p.actions.map(({ handle }) => handle.record.id), receipts, ...limitation });
      } catch (cause) {
        for (const { handle, binding, measured } of p.actions) if (!["succeeded", "recovery-required"].includes(handle.record.state)) {
          if (measured) {
            try { await handle.update("recovery-required", { reason: "Execution or final recording could not be proven; inspect the original unit and workspace, do not retry.",
              outcome: { kind: "checkout-verification", status: "partial-state", checkoutVerification: { ...binding, runs: [measured] } } }); }
            catch { /* Preserve native measured facts in the refusal even when outcome I/O fails. */ }
          } else await failGitAction(handle, started && handle.record.state === "executing", p.controller.signal, cause);
        }
        return NextResponse.json({ actionId: p.actions[0].handle.record.id,
          knownRuns: p.actions.flatMap(({ measured }) => measured ? [measured] : []), error: started ? "Checks did not produce current evidence. Commands can change files; inspect the working workspace and recovery history." : "Check preview stale or blocked before execution; prepare a new preview.",
          ...(started ? { recoveryRequired: true } : {}), ...limitation }, { status: 409 });
      } finally { state.pending.delete(input.previewId as string); req.signal.removeEventListener("abort", abort); p.actions.forEach(({ handle }) => handle.release()); }
    } finally { release(); }
  } catch (cause) { return refusal(cause); }
}
