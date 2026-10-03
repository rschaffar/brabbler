// Trusted native callbacks only. No action-history rehydration, usage fence or execution grant.
import fs from "node:fs";
import path from "node:path";
import { assertGitOperationAdmission, beginSupervisedGitOperationIntent } from "./git-operation-admission";
import type { GitProjectResources } from "./git-project-resources";
import type { GitCleanupAdapters, GitCleanupCompletedProof, GitCleanupEvidence, GitCleanupInventory,
  GitCleanupRemovalProof, GitCleanupDurableAck, GitCleanupFailure } from "./git-cleanup-operation";
import { admissionAbsent, admissionBytes, admissionClean, admissionEqual, admissionGit, admissionHash,
  admissionIdentity, admissionInventory, admissionKeys, admissionPhysical, admissionRefuse, admissionRows, admissionTracked, admissionSafeFiles } from "./git-workspace-admission";

function inventory(r: GitProjectResources): GitCleanupInventory {
  const current = admissionInventory(r), admins: Record<string, string> = {}, root = path.join(r.commonDir, "worktrees");
  try {
    const rootId = admissionIdentity(root); admissionPhysical(root, rootId);
    const names = fs.readdirSync(root).sort(); if (names.length > 256) admissionRefuse();
    for (const name of names) {
      const dir = path.join(root, name), id = admissionIdentity(dir); admissionPhysical(dir, id);
      const meta: unknown[] = [id]; let count = 0;
      const scan = (relative: string) => {
        const names = fs.readdirSync(path.join(dir, relative)).sort();
        for (const name of names) {
          if (++count > 2000) admissionRefuse();
          const child = relative ? `${relative}/${name}` : name, file = path.join(dir, child), s = fs.lstatSync(file);
          if (!relative && name === "logs") { admissionPhysical(file, admissionIdentity(file)); continue; }
          if (String(s.dev) !== id.device || s.isSymbolicLink() || (!s.isFile() && !s.isDirectory())) admissionRefuse();
          meta.push([child, admissionIdentity(file), s.isDirectory() ? "directory" : admissionHash(admissionBytes(file, 1024 * 1024))]);
          if (s.isDirectory()) scan(child);
        }
      };
      scan(""); admins[name] = admissionHash(JSON.stringify(meta));
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { refs: current.refs, registrations: current.registrations, admins, checkouts: current.checkouts };
}
function snapshot(r: GitProjectResources, s: GitCleanupEvidence["target"]): void {
  if (admissionHash(JSON.stringify(admissionIdentity(path.join(r.commonDir, "config"))) + admissionGit(r, "config", "--list", "--null")) !== s.config) admissionRefuse();
  admissionSafeFiles(r);
  const index = path.join(r.gitDir, "index"), head = path.join(r.gitDir, "HEAD");
  if (admissionHash(JSON.stringify(admissionIdentity(index)) + admissionHash(admissionBytes(index))) !== s.index ||
    admissionHash(JSON.stringify(admissionIdentity(head)) + admissionHash(admissionBytes(head))) !== s.head ||
    admissionTracked(r, s.oid, false) !== s.tracked) admissionRefuse();
  admissionClean(r, s.oid, s.tree);
}
function sourceIgnored(e: GitCleanupEvidence): void {
  const r = e.integration.feature, files = new Set<string>(), dirs = new Set<string>([""]);
  for (const row of admissionGit(r, "ls-tree", "-r", "-z", e.source.tree).split("\0").filter(Boolean)) {
    const relative = row.slice(row.indexOf("\t") + 1); files.add(relative);
    let parent = path.dirname(relative);
    while (parent !== ".") { dirs.add(parent); parent = path.dirname(parent); }
  }
  const ignored: GitCleanupEvidence["source"]["ignored"] = []; let count = 0;
  const scan = (relative: string) => {
    for (const name of fs.readdirSync(path.join(r.cwd, relative)).sort()) {
      if (++count > 2000 || /[\x00-\x1f\x7f]/.test(name)) admissionRefuse();
      const child = relative ? `${relative}/${name}` : name;
      if (child === ".git") continue;
      if (name === ".git" || name === ".gitattributes") admissionRefuse();
      const s = fs.lstatSync(path.join(r.cwd, child), { bigint: true });
      if (s.isSymbolicLink() || (!s.isDirectory() && !s.isFile()) || s.isFile() && s.nlink !== BigInt(1) ||
        String(s.dev) !== r.identities.checkout.device) admissionRefuse();
      if (!files.has(child) && !dirs.has(child)) ignored.push({ path: child, kind: s.isDirectory() ? "directory" : "file",
        ...admissionIdentity(path.join(r.cwd, child)), size: String(s.size), mode: String(s.mode), changed: String(s.ctimeNs), modified: String(s.mtimeNs) });
      if (s.isDirectory()) scan(child);
    }
  };
  scan(""); if (!admissionEqual(ignored, e.source.ignored)) admissionRefuse();
}
function survivors(e: GitCleanupEvidence) {
  snapshot(e.integration.target, e.target); snapshot(e.main, e.mainSnapshot);
}
function removedInventory(e: GitCleanupEvidence): GitCleanupInventory {
  const source = e.integration.feature, rows = admissionRows(e.inventory.registrations);
  const own = rows.filter((row) => row.startsWith(`worktree ${source.cwd}\0`));
  if (own.length !== 1 || own[0] !== `worktree ${source.cwd}\0HEAD ${e.integration.featureOid}\0branch refs/heads/${source.branch}` ||
    rows.some((row) => row !== own[0] && row.split("\0").includes(`branch refs/heads/${source.branch}`)) ||
    path.dirname(source.gitDir) !== path.join(source.commonDir, "worktrees") || source.cwd === source.projectRoot ||
    !admissionEqual(e.inventory.checkouts[source.cwd], source.identities.checkout)) admissionRefuse();
  const admins = { ...e.inventory.admins }, checkouts = { ...e.inventory.checkouts }, admin = path.basename(source.gitDir);
  if (!Object.hasOwn(admins, admin)) admissionRefuse();
  delete admins[admin]; delete checkouts[source.cwd];
  return { refs: e.inventory.refs, registrations: rows.filter((row) => row !== own[0]).join("\0\0") + "\0\0", admins, checkouts };
}
function completedInventory(e: GitCleanupEvidence): GitCleanupInventory {
  const result = removedInventory(e);
  result.refs = result.refs.split("\n").filter((row) => !row.startsWith(`refs/heads/${e.integration.feature.branch}\0`)).join("\n");
  return result;
}
function verifyRemoval(e: GitCleanupEvidence, proof: GitCleanupRemovalProof): void {
  const s = e.integration.feature;
  if (!admissionKeys(proof, ["version", "actionId", "kind", "sourcePath", "sourceIdentity", "adminPath", "featureOid", "exit", "sourceAbsent", "adminAbsent", "before", "after"]) ||
    proof.version !== 1 || proof.actionId !== e.actionId || proof.kind !== "removed" || proof.sourcePath !== s.cwd ||
    !admissionEqual(proof.sourceIdentity, s.identities.checkout) || proof.adminPath !== s.gitDir || proof.featureOid !== e.integration.featureOid ||
    proof.exit !== 0 || proof.sourceAbsent !== true || proof.adminAbsent !== true || !admissionEqual(proof.before, e.inventory) ||
    !admissionEqual(proof.after, removedInventory(e))) admissionRefuse();
  admissionAbsent(s.cwd); admissionAbsent(s.gitDir); survivors(e);
  if (!admissionEqual(inventory(e.integration.target), removedInventory(e))) admissionRefuse();
}
function verifyCompleted(e: GitCleanupEvidence, removal: GitCleanupRemovalProof, proof: GitCleanupCompletedProof): void {
  if (!admissionKeys(proof, ["version", "actionId", "kind", "removal", "deletedRef", "deletedOid", "transactionExit", "finalInventory", "nativeHeadReflogMayHaveChanged"]) ||
    proof.version !== 1 || proof.actionId !== e.actionId || proof.kind !== "completed" || !admissionEqual(proof.removal, removal) ||
    proof.deletedRef !== `refs/heads/${e.integration.feature.branch}` || proof.deletedOid !== e.integration.featureOid ||
    proof.transactionExit !== 0 || proof.nativeHeadReflogMayHaveChanged !== true || !admissionEqual(proof.finalInventory, completedInventory(e))) admissionRefuse();
  admissionAbsent(e.integration.feature.cwd); admissionAbsent(e.integration.feature.gitDir); survivors(e);
  if (!admissionEqual(inventory(e.integration.target), completedInventory(e))) admissionRefuse();
}
export interface GitCleanupAdmissionOptions {
  agentDir: string;
  /** Actual native verifier's private WeakMap reader. Not an issuer built from
   * passed payloads/history/action IDs. Missing native support fails closed. */
  readNativeProof?(handle: unknown): Readonly<GitCleanupRemovalProof | GitCleanupCompletedProof> | undefined;
  /** Journal/anchor must correlate this one native-generated actionId; no second UUID. */
  onIntent(evidence: Readonly<GitCleanupEvidence>): Promise<void>;
  /** Durable non-release evidence. Useful for a usage-owner identity-issued ack. */
  onRemoval?(proof: Readonly<GitCleanupRemovalProof>): Promise<void>;
  /** Must succeed before admission release. Historical cleanup cards are optional/future. */
  onCompleted(proof: Readonly<GitCleanupCompletedProof>): Promise<void>;
  onFailure?(facts: Readonly<GitCleanupFailure>): Promise<void>;
}
/** These two callbacks compose with the native engine's authorization, issued-handle
 * readers, designated main and usage lease. They do NOT replace those contracts. */
export type GitCleanupAdmissionAdapter = Pick<GitCleanupAdapters, "assertAdmission" | "beginIntent"> & {
  /** Identity-issued durable acknowledgement for the usage-owner bridge. Not a grant.
   * A parsed/cloned proof, action ID or history record is never recognized. */
  readRecordedRemoval(issuedAck: unknown): Readonly<GitCleanupRemovalProof> | undefined;
};
export function createGitCleanupAdmission(options: GitCleanupAdmissionOptions): GitCleanupAdmissionAdapter {
  const recordedRemovals = new WeakMap<object, { recorded: GitCleanupRemovalProof; original: GitCleanupRemovalProof }>();
  return {
    readRecordedRemoval(issuedAck) {
      if (!issuedAck || typeof issuedAck !== "object") return undefined;
      const saved = recordedRemovals.get(issuedAck);
      if (!saved || !admissionEqual(saved.recorded, saved.original)) return undefined;
      return Object.freeze(structuredClone(saved.recorded));
    },
    async assertAdmission(e) {
      await assertGitOperationAdmission(e.integration.target, options.agentDir);
      if (typeof options.readNativeProof !== "function") throw new Error("Cleanup native proof issuer unavailable; no effect is admitted.");
    },
    async beginIntent(input) {
      const e = structuredClone(input), target = e.integration.target;
      survivors(e); snapshot(e.integration.feature, e.source); sourceIgnored(e);
      if (!admissionEqual(inventory(target), e.inventory)) admissionRefuse();
      removedInventory(e);
      const adminParent = path.join(target.commonDir, "worktrees"), adminParentIdentity = admissionIdentity(adminParent);
      admissionPhysical(adminParent, adminParentIdentity);
      const assertAdminParent = (removed: boolean) => {
        let present = true;
        try { fs.lstatSync(adminParent); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; present = false; }
        if (present) admissionPhysical(adminParent, adminParentIdentity);
        else if (!removed || Object.keys(e.inventory.admins).length !== 1 ||
          !Object.hasOwn(e.inventory.admins, path.basename(e.integration.feature.gitDir))) admissionRefuse();
        // ONLY verified removal of the sole own registration permits Git's
        // deletion of its now-empty worktrees parent. Existing parent reuse denies.
      };
      // The surviving target/common root is authority even AFTER the source disappears.
      const op = await beginSupervisedGitOperationIntent(target, e.actionId, "cleanup", options.agentDir);
      op.recordNativeEvidence("binding", e);
      // Direct begin callers cannot strand an UNRECORDED intent either. Normal
      // native capture/apply already refuses missing issuer support above.
      if (typeof options.readNativeProof !== "function") admissionRefuse();
      await options.onIntent(structuredClone(e));
      let removal: GitCleanupRemovalProof | undefined, completed: GitCleanupCompletedProof | undefined;
      let completedSeal: import("./git-operation-admission").GitNativeEvidenceSeal | undefined, settlementStarted = false;
      const transitionCompleted = (proof: GitCleanupCompletedProof) => {
        const native = options.readNativeProof?.(proof);
        if (!removal || !native || native.kind !== "completed" || !admissionEqual(native, proof)) admissionRefuse();
        if (completed) {
          if (!admissionEqual(completed, proof)) admissionRefuse();
          verifyCompleted(e, removal, completed); assertAdminParent(true); return;
        }
        verifyCompleted(e, removal, proof); assertAdminParent(true);
        completedSeal = op.recordNativeEvidence("completed", proof, options.readNativeProof);
        completed = structuredClone(proof); // facts only, NOT journal completion or release
      };
      const assertOwned = (expected: GitCleanupInventory, phase: "remove" | "delete" | "complete", proof?: GitCleanupCompletedProof) => {
        if (proof) { if (phase !== "complete") admissionRefuse(); transitionCompleted(proof); }
        op.assertOwned();
        const allowed = phase === "remove" && !removal ? e.inventory : phase === "delete" && removal && !completed ? removedInventory(e) :
          phase === "complete" && removal && completed ? completedInventory(e) : undefined;
        if (!allowed || !admissionEqual(expected, allowed) || !admissionEqual(inventory(target), allowed)) admissionRefuse();
        survivors(e); assertAdminParent(phase !== "remove");
        if (phase === "remove") { snapshot(e.integration.feature, e.source); sourceIgnored(e); }
        else { admissionAbsent(e.integration.feature.cwd); admissionAbsent(e.integration.feature.gitDir); }
      };
      return {
        assertOwned,
        async recordRemoval(proof) {
          if (removal || completed) admissionRefuse();
          const native = options.readNativeProof?.(proof);
          if (!native || native.kind !== "removed" || !admissionEqual(native, proof)) admissionRefuse();
          verifyRemoval(e, proof); assertAdminParent(true);
          op.recordNativeEvidence("removal", proof, options.readNativeProof);
          removal = structuredClone(proof); // only after successful durable publication
          await options.onRemoval?.(structuredClone(removal));
          assertOwned(removedInventory(e), "delete");
          const ack: GitCleanupDurableAck<GitCleanupRemovalProof> = Object.freeze({ durable: true, proof });
          recordedRemovals.set(ack, { recorded: structuredClone(removal), original: proof });
          return ack;
        },
        async completed(proof) {
          if (settlementStarted) admissionRefuse(); settlementStarted = true;
          transitionCompleted(proof);
          await options.onCompleted(structuredClone(completed!));
          verifyCompleted(e, removal!, completed!); assertAdminParent(true); op.assertOwned(); op.resolveNativeOutcome(completedSeal!);
          return { durable: true, proof };
        },
        async recordFailure(facts) {
          if (facts.version !== 1 || facts.actionId !== e.actionId || facts.recoveryRequired !== true) admissionRefuse();
          op.recordNativeEvidence("failure", structuredClone(facts));
          await options.onFailure?.(structuredClone(facts));
        },
      };
    },
  };
}
