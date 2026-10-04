import { createHash } from "node:crypto";
import { readGitPreparationCompletion } from "./git-preparation-apply";
import { readSelectedIntegrationNativeProof } from "./git-selected-integration";
import { readGitWorkspaceNativeProof } from "./git-workspace-operation";
import { lookupGitCheckoutVerificationReceipt, readGitCheckoutVerificationNativeExecution, type GitCheckoutVerificationReceipt } from "./git-checkout-verification";
import type { GitCleanupCompletedProof } from "./git-cleanup-operation";
import type { ProjectAuthorizationOwner } from "./git-project-authorization";
import type { GitProjectResources } from "./git-project-resources";
import type { SelectedCompletionEnvelope, SelectedNativeCandidate, SelectedNativeFailure,
  SelectedSealedCleanupPrerequisites } from "./git-selected-operation-controller";

const digest = (value: unknown) => {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, stable((v as Record<string, unknown>)[key])])) : v;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
};
function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
const key = (owner: ProjectAuthorizationOwner, source: GitProjectResources) => digest([owner, source]);
// Process-only registries. History, action IDs and restarts cannot restore handles.
const sealed = new WeakMap<object, { owner: ProjectAuthorizationOwner; envelope: SelectedCompletionEnvelope; nativeHandle: object }>();
const creations = new Map<string, object>(), integrations = new Map<string, object>();
const sealedReceipts = new Map<string, { owner: ProjectAuthorizationOwner; receipt: GitCheckoutVerificationReceipt }>();

/** Internal trusted runtime storage. No exported singleton writer, serialization,
 * action-ID lookup, or history-to-capability conversion. Sealing authenticates the
 * actual leaf identity independently of optional journal publication. */
export function createGitSelectedOperationRegistry(owner: ProjectAuthorizationOwner, readers: {
  readCleanupProof(handle: object): GitCleanupCompletedProof | undefined;
  readRecoveryProof(handle: object): { before: SelectedCompletionEnvelope["before"]; after: SelectedCompletionEnvelope["after"] } | undefined;
  readPreparationNoEffect(handle: object): Extract<SelectedCompletionEnvelope["completion"], { operation: "prepare" }>["result"] | undefined;
}) {
  const captures = new WeakMap<object, { candidate: SelectedNativeCandidate; payload: unknown }>();
  const originalCandidates = new Map<string, { candidate: SelectedNativeCandidate; payload: unknown }>();
  const results = new WeakMap<object, { envelope: SelectedCompletionEnvelope; leaf: object; noEffect: boolean }>();
  const failures = new WeakMap<object, SelectedNativeFailure>();
  function authenticate(envelope: SelectedCompletionEnvelope, leaf: object, noEffect: boolean) {
    const c = envelope.completion;
    const original = originalCandidates.get(envelope.candidateRevision), candidate = original?.candidate;
    if (!candidate || candidate.operation !== c.operation) throw new Error("Original invocation capture required");
    if (c.operation === "prepare") {
      if (c.result.status === "already-prepared") {
        const actual = readers.readPreparationNoEffect(leaf);
        if (!noEffect || !actual || digest(actual) !== digest(c.result) || c.result.oldSourceOid !== c.result.newSourceOid) throw new Error("Actual native no-effect identity required");
      } else {
        const proof = readGitPreparationCompletion(leaf);
        if (proof?.stage !== "completed" || proof.actionId !== envelope.actionId || digest(proof.result) !== digest(c.result) ||
          !candidate.invocationOwner || digest(proof.invocationOwner) !== digest(candidate.invocationOwner)) {
          throw new Error("Completed native preparation identity required");
        }
      }
    } else if (c.operation === "integrate") {
      const proof = readSelectedIntegrationNativeProof(leaf);
      if (!proof || !candidate.invocationOwner || digest(proof.invocationOwner) !== digest(candidate.invocationOwner) || digest(proof) !== digest(c.integration)) {
        throw new Error("Native integration identity required");
      }
    } else if (c.operation === "workspace") {
      const proof = readGitWorkspaceNativeProof(leaf);
      if (!proof || proof.actionId !== envelope.actionId || digest(proof) !== digest(c.proof) ||
        !candidate.invocationOwner || digest(proof.invocationOwner) !== digest(candidate.invocationOwner)) throw new Error("Native workspace identity required");
    } else if (c.operation === "verify") {
      const receipts = leaf as readonly GitCheckoutVerificationReceipt[];
      const own = original?.payload as { receipts?: unknown; cohort?: object; executing?: { actionId: string } } | undefined;
      if (!own?.cohort || own.receipts !== leaf || own.executing?.actionId !== envelope.actionId ||
        !Array.isArray(receipts) || receipts.length !== c.receiptIds.length || receipts.some((r, i) =>
        lookupGitCheckoutVerificationReceipt(c.receiptIds[i]) !== r || r.sessionId !== owner.sessionId || r.exitStatus !== 0 ||
        readGitCheckoutVerificationNativeExecution(r)?.receipt?.id !== r.id ||
        readGitCheckoutVerificationNativeExecution(r)?.actionId !== envelope.actionId)) {
        throw new Error("Actual completed native receipts required");
      }
    } else if (c.operation === "cleanup") {
      const proof = readers.readCleanupProof(leaf);
      if (!proof || proof.actionId !== envelope.actionId || digest(proof) !== digest(c.proof) ||
        !candidate.invocationOwner || digest(proof.removal.invocationOwner) !== digest(candidate.invocationOwner)) throw new Error("Actual completed native cleanup required");
    } else {
      const proof = readers.readRecoveryProof(c.recoveryHandle);
      if (leaf !== c.recoveryHandle || !proof || digest(proof.before) !== digest(envelope.before) || digest(proof.after) !== digest(envelope.after)) {
        throw new Error("Independent native recovery identity required");
      }
    }
  }
  return Object.freeze({
    capture<T>(candidate: SelectedNativeCandidate, payload: T): object {
      const handle = Object.freeze(Object.create(null)) as object;
      const captured = structuredClone(candidate);
      // Preserve opaque native/durable identities: JSON/copies are never handles.
      if (candidate.cleanup) captured.cleanup = { ...candidate.cleanup, ignoredNames: [...candidate.cleanup.ignoredNames] };
      captures.set(handle, { candidate: immutable(captured), payload });
      originalCandidates.set(captured.revision, { candidate: captured, payload });
      return handle;
    },
    readCandidate(handle: object) { return captures.get(handle)?.candidate; },
    readCapture<T>(handle: object): T | undefined { return captures.get(handle)?.payload as T | undefined; },
    retire(handle: object) {
      const saved = captures.get(handle);
      if (saved) originalCandidates.delete(saved.candidate.revision);
      captures.delete(handle);
    },
    completed(envelope: SelectedCompletionEnvelope, leaf: object, noEffect = false): object {
      authenticate(envelope, leaf, noEffect);
      const handle = Object.freeze(Object.create(null)) as object;
      const captured = structuredClone(envelope);
      if (envelope.completion.operation === "reconcile") captured.completion = { ...envelope.completion };
      results.set(handle, { envelope: immutable(captured), leaf, noEffect });
      return handle;
    },
    readNativeCompletion(handle: object) { return results.get(handle)?.envelope; },
    failure(cause: object, failure: SelectedNativeFailure) {
      if (failure.kind !== "partial") throw new Error("Unsupported native failure; no retry provenance");
      failures.set(cause, immutable(structuredClone(failure)));
    },
    readNativeFailure(cause: unknown) { return cause && typeof cause === "object" ? failures.get(cause) : undefined; },
    async seal(handle: object): Promise<object> {
      const result = results.get(handle);
      if (!result) throw new Error("Actual native result required");
      authenticate(result.envelope, result.leaf, result.noEffect);
      const token = Object.freeze(Object.create(null)) as object;
      sealed.set(token, { owner: immutable(structuredClone(owner)), envelope: result.envelope, nativeHandle: handle });
      const c = result.envelope.completion;
      if (c.operation === "verify") for (const receipt of result.leaf as readonly GitCheckoutVerificationReceipt[]) {
        sealedReceipts.set(receipt.id, { owner, receipt });
      }
      if (c.operation === "workspace") creations.set(key(owner, c.creation.destination), token);
      if (c.operation === "integrate") integrations.set(key(owner, c.integration.feature), token);
      return token;
    },
    readDurableCompletion(token: object) {
      const value = sealed.get(token);
      if (!value || digest(value.owner) !== digest(owner)) return;
      return { stage: "completed" as const, actionId: value.envelope.actionId,
        candidateRevision: value.envelope.candidateRevision, nativeHandle: value.nativeHandle };
    },
    readSealedReceipt(id: string) {
      const value = sealedReceipts.get(id);
      return value && digest(value.owner) === digest(owner) && lookupGitCheckoutVerificationReceipt(id) === value.receipt &&
        readGitCheckoutVerificationNativeExecution(value.receipt)?.receipt?.id === id ? value.receipt : undefined;
    },
    readCreation(token: object) {
      const value = sealed.get(token);
      return value && digest(value.owner) === digest(owner) && value.envelope.completion.operation === "workspace" ? value.envelope.completion.creation : undefined;
    },
    readIntegration(token: object) {
      const value = sealed.get(token);
      if (!value || digest(value.owner) !== digest(owner) || value.envelope.completion.operation !== "integrate") return undefined;
      const p = value.envelope.completion.integration;
      return { completedAt: p.completedAt, delivery: p.delivery, method: p.method, actualFF: p.actualFF, feature: p.feature, target: p.target,
        featureOid: p.featureOid, previousTargetOid: p.previousTargetOid, resultOid: p.resultOid, resultTree: p.resultTree, parents: p.parents };
    },
    async readCleanupPrerequisites(source: GitProjectResources): Promise<SelectedSealedCleanupPrerequisites | undefined> {
      const creator = creations.get(key(owner, source)), integration = integrations.get(key(owner, source));
      const c = creator && sealed.get(creator), i = integration && sealed.get(integration);
      if (!creator || !integration || c?.envelope.completion.operation !== "workspace" || i?.envelope.completion.operation !== "integrate") return;
      return { creation: { handle: creator, proof: c.envelope.completion.creation },
        integration: { handle: integration, proof: i.envelope.completion.integration } };
    },
  });
}
