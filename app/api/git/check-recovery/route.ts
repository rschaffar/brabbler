import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { promisify } from "node:util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { readGitAction } from "@/lib/git-action-journal";
import { GIT_ACTION_ID_PATTERN } from "@/lib/git-action-types";
import { acquireGitCheckoutGate, isGitCheckoutGated } from "@/lib/git-checkout-gate";
import { gitExecEnv } from "@/lib/git-exec";
import { invalidateGitIntegrationPlansForResource } from "@/lib/git-integration";
import { readUnresolvedGitCheckRecovery, resolveHumanReviewedGitCheck } from "@/lib/git-operation-admission";
import { revalidateGitProjectResources, selectGitProjectResources } from "@/lib/git-project-resources";
import { reviewGitBranches } from "@/lib/git-review";
import { captureGitCheckRecoverySnapshot, gitCheckRecoveryDigest, invalidateGitVerificationReceiptsForCheckout, isGitVerificationRunning } from "@/lib/git-verification";
import { assertManagedGitWorkspace, managedGitSessionFacts } from "@/lib/git-workflow-access";
import { loadGitWorkflowSettings } from "@/lib/git-workflow-settings-store";
import { readCapturedSessionGitWorkflow } from "@/lib/git-workflow-policy";
import { readHumanGitSessionManager } from "@/lib/git-action-human";
import { samePath } from "@/lib/paths";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";
const exec = promisify(execFile);
const SESSION = /^[a-zA-Z0-9_-]{1,128}$/;
const TTL = 90_000;
const MAX_TICKETS = 128;
const denied = (reason = "Recovery unavailable; inspect both checkouts and the action history") => NextResponse.json({ eligible: false, reason });
const error = (message: string, status: number) => NextResponse.json({ error: message }, { status });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));

type Ticket = { sessionId: string; sessionFile: string; cwd: string; featureCwd: string; target: string; commonDir: string;
  id: string; actionId: string; actionRevision: number; snapshot: string; invocation: string; expiresAt: number };
// This is a one-use same-process human review latch, not a same-user security boundary.
const ticketKey = Symbol.for("pi-web:git-check-recovery:reviews");
function tickets(): Map<string, Ticket> {
  const shared = globalThis as unknown as Record<symbol, Map<string, Ticket> | undefined>;
  return shared[ticketKey] ??= new Map();
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec("git", ["--no-optional-locks", "-C", cwd, ...args], {
    encoding: "utf8", env: { ...gitExecEnv(), GIT_NO_REPLACE_OBJECTS: "1", GIT_PAGER: "cat" },
    timeout: 15_000, maxBuffer: 64 * 1024,
  })).stdout;
}
async function allowed(cwd: string) {
  const roots = await getAllowedFileRoots();
  return isExistingFilePathAllowed(cwd, roots) && statSync(cwd).isDirectory() && samePath(cwd, realpathSync(cwd));
}
async function scope(sessionId: string) {
  const sessionFile = await resolveSessionPath(sessionId);
  if (!sessionFile) throw new Error("session missing");
  const header = readSessionHeader(sessionFile);
  if (!header || header.id !== sessionId || !header.cwd || !await allowed(header.cwd)) throw new Error("session changed");
  const cwd = header.cwd, agentDir = getAgentDir();
  const bound = { sessionId, sessionFile, cwd };
  const manager = readHumanGitSessionManager(bound);
  const entries = manager.getEntries() as SessionEntry[];
  if (managedGitSessionFacts(entries).subagent) throw new Error("not ordinary chat");
  // Recovery is inspection and disposition, NOT another check or Git mutation.
  // In particular, paused/Off/Deny must not prevent inspection of an orphan.
  const settings = await loadGitWorkflowSettings(cwd, entries, agentDir, "active-session");
  const policy = readCapturedSessionGitWorkflow(entries);
  if (!policy?.checks?.length || policy.integration?.method !== "merge") throw new Error("no saved check");
  const chat = await selectGitProjectResources(cwd);
  const pending = readUnresolvedGitCheckRecovery(agentDir, chat.commonDir);
  const history = await readGitAction(pending.actionId, { includeArtifact: true }, agentDir);
  if (history.record?.sessionId !== sessionId || history.candidate?.kind !== "checks" ||
    !await allowed(history.candidate.repositoryRoot)) throw new Error("check owner changed");
  const feature = await selectGitProjectResources(history.candidate.repositoryRoot);
  if (!samePath(feature.cwd, history.candidate.repositoryRoot) || !samePath(feature.commonDir, chat.commonDir) ||
    !samePath(feature.projectRoot, chat.projectRoot) ||
    JSON.stringify(feature.identities.common) !== JSON.stringify(chat.identities.common) ||
    policy.mode === "current" && policy.branch && policy.branch !== feature.branch) throw new Error("feature changed");
  await assertManagedGitWorkspace(settings, feature.cwd);
  const target = await selectGitProjectResources(feature.cwd, policy.integration.targetBranch);
  if (target.branch !== policy.integration.targetBranch || samePath(target.cwd, feature.cwd) ||
    !samePath(feature.commonDir, target.commonDir) || !await allowed(target.cwd)) throw new Error("target changed");
  if (!getProjectTrustStatus(cwd, agentDir).trusted || !getProjectTrustStatus(feature.cwd, agentDir).trusted ||
    !getProjectTrustStatus(target.cwd, agentDir).trusted) throw new Error("untrusted");
  return { ...bound, agentDir, policy, feature, target };
}
type Scope = Awaited<ReturnType<typeof scope>>;
function idle(s: Scope) {
  return !isGitVerificationRunning(s.feature.cwd) && !isGitVerificationRunning(s.target.cwd);
}
async function unitStopped(unit: string, invocation: string): Promise<boolean> {
  if (process.platform !== "linux" || !/^pi-web-git-check-[a-f0-9-]{36}\.service$/.test(unit) || !/^[a-fA-F0-9]{32}$/.test(invocation)) return false;
  // Do not trust a PID, exit code, a fake backend, or the persisted proof alone.
  // A failed manager query (including missing user bus) is an unknown state.
  const properties = ["Id", "LoadState", "ActiveState", "SubState", "Result", "ControlGroup", "MainPID", "Restart", "InvocationID",
    "Delegate", "KillMode", "RemainAfterExit"];
  const { stdout } = await exec("systemctl", ["--user", "--no-pager", "show", ...properties.map((p) => `--property=${p}`), "--", unit],
    { encoding: "utf8", timeout: 2_000, maxBuffer: 16 * 1024 });
  const rows = new Map<string, string>();
  for (const line of stdout.trimEnd().split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0 || rows.has(line.slice(0, i))) return false;
    rows.set(line.slice(0, i), line.slice(i + 1));
  }
  if (rows.size !== properties.length || properties.some((p) => !rows.has(p)) || rows.get("Id") !== unit ||
    rows.get("ControlGroup") || rows.get("MainPID") !== "0") return false;
  // A collected transient unit has no live invocation. Its durable pinned
  // cleanup evidence binds the original invocation to the original cgroup.
  if (rows.get("LoadState") === "not-found" && rows.get("ActiveState") === "inactive")
    return !rows.get("InvocationID") || rows.get("InvocationID") === invocation;
  return rows.get("LoadState") === "loaded" && rows.get("Restart") === "no" &&
    rows.get("InvocationID") === invocation && rows.get("Delegate") === "no" &&
    rows.get("KillMode") === "control-group" && rows.get("RemainAfterExit") === "yes" &&
    (rows.get("ActiveState") === "inactive" && rows.get("SubState") === "dead" ||
      rows.get("ActiveState") === "failed" && rows.get("SubState") === "failed" && rows.get("Result") === "exit-code");
}
async function inspect(s: Scope) {
  if (!idle(s)) throw new Error("checkout busy");
  await revalidateGitProjectResources(s.feature);
  await revalidateGitProjectResources(s.target);
  const evidence = readUnresolvedGitCheckRecovery(s.agentDir, s.feature.commonDir);
  const proof = evidence.cleanupProof;
  if (evidence.source !== "linux-systemd" || !evidence.after || !proof || !evidence.outcome ||
    evidence.outcome.status === 0 && !evidence.outcome.timedOut && !evidence.outcome.overflow ||
    JSON.stringify(evidence.before) !== JSON.stringify(evidence.after) || !proof.empty || !proof.terminal ||
    proof.unit !== evidence.unit || !["release-attempted", "prevented-before-write"].includes(proof.payload)) throw new Error("incomplete proof");
  const history = await readGitAction(evidence.actionId, { includeArtifact: true }, s.agentDir);
  const action = history.record;
  const anchor = (readHumanGitSessionManager(s).getEntries() as SessionEntry[]).some((entry) =>
    entry.type === "custom" && entry.customType === "pi-web:git-action" &&
    record(entry.data) && entry.data.version === 1 && entry.data.actionId === evidence.actionId);
  const candidate = history.candidate;
  if (!action || !anchor || action.id !== evidence.actionId || action.sessionId !== s.sessionId ||
    !["human", "agent"].includes(action.source) || action.kind !== "checks" || !["failed", "cancelled"].includes(action.state) ||
    candidate?.kind !== "checks" || !samePath(candidate.repositoryRoot, s.feature.cwd) ||
    !candidate.checks?.length ||
    candidate.featureBranch !== s.feature.branch || candidate.targetBranch !== s.target.branch) throw new Error("not failed check action");
  const checks = s.policy.checks;
  if (!checks || evidence.after.policyDigest !== hash(s.policy)) throw new Error("policy changed");
  const matchingIndexes = checks.flatMap((check, index) =>
    gitCheckRecoveryDigest(index, check.argv) === evidence.after!.checkDigest ? [index] : []);
  if (matchingIndexes.length !== 1) throw new Error("check changed");
  const checkIndex = matchingIndexes[0];
  if (action.source === "human"
    ? candidate.checks.length !== 1 || JSON.stringify(candidate.checks[0]) !== JSON.stringify(checks[checkIndex]) ||
      action.outcome?.status !== action.state
    : JSON.stringify(candidate.checks) !== JSON.stringify(checks)) throw new Error("candidate changed");
  const review = await reviewGitBranches(s.feature.cwd, s.feature.branch, s.target.branch);
  if (candidate.featureOid !== undefined && candidate.featureOid !== review.featureOid ||
    candidate.targetOid !== undefined && candidate.targetOid !== review.targetOid ||
    candidate.candidateTreeOid !== undefined && candidate.candidateTreeOid !== review.mergeTreeOid) throw new Error("review changed");
  const snapshot = await captureGitCheckRecoverySnapshot(s.feature.cwd, s.target.cwd, review, hash(s.policy), evidence.after.checkDigest);
  if (JSON.stringify(snapshot) !== JSON.stringify(evidence.after)) throw new Error("post snapshot changed");
  if (!await unitStopped(evidence.unit, proof.invocation)) throw new Error("unit not proven stopped");
  return { evidence, action, snapshot, proof };
}
async function checkoutView(cwd: string) {
  const branch = (await git(cwd, "symbolic-ref", "--quiet", "--short", "HEAD")).trim();
  const head = (await git(cwd, "rev-parse", "--verify", "HEAD^{commit}")).trim();
  const raw = await git(cwd, "status", "--porcelain=v1", "-z", "--untracked-files=all");
  const fields = raw.split("\0").filter(Boolean);
  if (fields.length > 200 || fields.some((field) => Buffer.byteLength(field) > 1024)) throw new Error("status too large");
  const status: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (entry.length < 4 || entry[2] !== " ") throw new Error("invalid status");
    const renamed = /[RC]/.test(entry.slice(0, 2));
    const other = renamed ? fields[++i] : undefined;
    if (renamed && other === undefined) throw new Error("invalid rename status");
    status.push(`${entry.slice(0, 3)}${JSON.stringify(entry.slice(3))}${other === undefined ? "" : ` <- ${JSON.stringify(other)}`}`);
    if (status.length > 100) throw new Error("status too large");
  }
  return { path: cwd, branch, head, status };
}
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const sessionId = params.get("sessionId");
  if ([...params.keys()].length !== 1 || !sessionId || !SESSION.test(sessionId)) return error("Valid sessionId required", 400);
  try {
    const s = await scope(sessionId);
    if (isGitCheckoutGated(s.feature.cwd) || isGitCheckoutGated(s.target.cwd)) return denied();
    const release = acquireGitCheckoutGate([s.feature.cwd, s.target.cwd]);
    try {
      const { evidence, action, snapshot, proof } = await inspect(s);
      const [feature, target] = await Promise.all([checkoutView(s.feature.cwd), checkoutView(s.target.cwd)]);
      // No awaited operation after this final state check before issuing the review latch.
      const latest = await inspect(s);
      if (latest.action.revision !== action.revision || JSON.stringify(latest.snapshot) !== JSON.stringify(snapshot)) throw new Error("preview changed");
      const pending = tickets();
      for (const [name, item] of pending) if (item.expiresAt <= Date.now() ||
        item.sessionId === sessionId && item.actionId === evidence.actionId) pending.delete(name);
      if (pending.size >= MAX_TICKETS) throw new Error("review capacity");
      const expiresAt = Date.now() + TTL;
      const revision = randomUUID(); // unpredictable and one-use; journal revision stays server-side
      pending.set(revision, { sessionId, sessionFile: s.sessionFile, cwd: s.cwd, featureCwd: s.feature.cwd,
        target: s.target.cwd, commonDir: s.feature.commonDir, id: evidence.id, actionId: evidence.actionId,
        actionRevision: action.revision, snapshot: JSON.stringify(snapshot), invocation: proof.invocation, expiresAt });
      return NextResponse.json({ eligible: true, actionId: evidence.actionId, revision, unit: evidence.unit,
        feature, target, containment: { emptyEvidence: proof.emptyEvidence, payload: proof.payload }, expiresAt });
    } finally { release(); }
  } catch { return denied(); }
}

async function bodyOf(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length")) > 4096) throw new Error("oversized");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new Error("oversized"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function POST(req: Request) {
  let input: unknown;
  try { input = await bodyOf(req); } catch { return error("Invalid or oversized JSON", 400); }
  if (!record(input) || !exact(input, ["sessionId", "actionId", "revision", "acknowledged"]) ||
    typeof input.sessionId !== "string" || !SESSION.test(input.sessionId) ||
    typeof input.actionId !== "string" || !GIT_ACTION_ID_PATTERN.test(input.actionId) ||
    typeof input.revision !== "string" || !GIT_ACTION_ID_PATTERN.test(input.revision) ||
    input.acknowledged !== true) return error("Invalid recovery request", 400);
  const sessionId = input.sessionId, actionId = input.actionId, revision = input.revision;
  const ticket = tickets().get(revision);
  // Consume before the first await: concurrent or replayed confirmations cannot share a review.
  tickets().delete(revision);
  if (!ticket || ticket.sessionId !== sessionId || ticket.actionId !== actionId || ticket.expiresAt <= Date.now()) return error("Recovery review expired; inspect again", 409);
  try {
    const s = await scope(sessionId);
    if (ticket.sessionFile !== s.sessionFile || !samePath(ticket.cwd, s.cwd) ||
      !samePath(ticket.featureCwd, s.feature.cwd) || !samePath(ticket.target, s.target.cwd) ||
      !samePath(ticket.commonDir, s.feature.commonDir) || isGitCheckoutGated(s.feature.cwd) || isGitCheckoutGated(s.target.cwd)) throw new Error("selection changed");
    const release = acquireGitCheckoutGate([s.feature.cwd, s.target.cwd]);
    try {
      req.signal.throwIfAborted();
      const inspected = await inspect(s);
      if (inspected.evidence.id !== ticket.id || inspected.evidence.actionId !== actionId ||
        inspected.action.revision !== ticket.actionRevision || inspected.proof.invocation !== ticket.invocation ||
        JSON.stringify(inspected.snapshot) !== ticket.snapshot) throw new Error("review changed");
      // Re-read policy/session, trust, registered resources, manager and post-check
      // snapshot after all waits; no await between final snapshot and disposition.
      const fresh = await scope(sessionId);
      if (fresh.sessionFile !== ticket.sessionFile || !samePath(fresh.cwd, ticket.cwd) ||
        !samePath(fresh.feature.cwd, ticket.featureCwd) || !samePath(fresh.target.cwd, ticket.target) ||
        !samePath(fresh.feature.commonDir, ticket.commonDir)) throw new Error("selection changed");
      const final = await inspect(fresh);
      if (final.evidence.id !== ticket.id || final.action.revision !== ticket.actionRevision ||
        final.proof.invocation !== ticket.invocation || JSON.stringify(final.snapshot) !== ticket.snapshot ||
        !idle(fresh)) throw new Error("recovery changed");
      req.signal.throwIfAborted();
      const review = await reviewGitBranches(fresh.feature.cwd, fresh.feature.branch, fresh.target.branch);
      // Last async read immediately before the synchronous invalidation and ledger
      // disposition: include ref, index, status, path and resource identities.
      const finalSnapshot = await captureGitCheckRecoverySnapshot(fresh.feature.cwd, fresh.target.cwd, review,
        hash(fresh.policy), final.evidence.after!.checkDigest);
      if (JSON.stringify(finalSnapshot) !== ticket.snapshot || !idle(fresh)) throw new Error("checkout changed");
      req.signal.throwIfAborted();
      // These invalidate process-local success capabilities, never create one.
      // Any failure leaves the durable quarantine in place.
      invalidateGitIntegrationPlansForResource(fresh.feature.commonDir);
      invalidateGitVerificationReceiptsForCheckout(fresh.feature.cwd);
      resolveHumanReviewedGitCheck(fresh.agentDir, fresh.feature.commonDir, ticket.id, actionId, finalSnapshot,
        ticket.invocation, { kind: "human-reviewed-git-check-recovery", id: ticket.id, actionId,
          resource: fresh.feature.commonDir, unit: final.evidence.unit, proofIdentifier: ticket.invocation });
      return NextResponse.json({ recovered: true, actionId });
    } finally { release(); }
  } catch { return error("Recovery unavailable; inspect both checkouts and the action history", 409); }
}
