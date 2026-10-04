// Internal physical transition for the original authority fence, never a grant.
import { lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { getKnownAllowedFileRoots, isFilePathAllowed } from "./file-access";
import { getProjectTrustStatus } from "./project-trust";
import { captureGitScopedAuthorityRevision, readGitScopedAuthorityRevision } from "./git-scoped-authority";
import { readGitCleanupCandidateAuthority, readGitCleanupRemovalAuthority, readGitCleanupNativeProof } from "./git-cleanup-operation";
import type { GitInvocationBinding } from "./git-invocation";
import type { GitProjectResources } from "./git-project-resources";
import type { HumanGitScope } from "./git-action-human";

type Identity = GitProjectResources["identities"]["marker"];
type Facts = NonNullable<ReturnType<typeof readGitCleanupCandidateAuthority>>;
function refuse(): never { throw new Error("Original cleanup authority or physical transition changed"); }
function absent(file: string): boolean {
  try { lstatSync(file); return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
}
function physical(file: string): { identity: Identity; directory: boolean } {
  const s = lstatSync(file, { bigint: true });
  if (s.isSymbolicLink() || !s.isDirectory() && !s.isFile() || realpathSync(file) !== file) refuse();
  return { directory: s.isDirectory(), identity: { device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs),
    ...(s.isFile() ? { changed: String(s.ctimeNs), size: String(s.size) } : {}) } };
}
// Permission only: resolve missing suffixes through their existing physical
// ancestor. This NEVER proves presence or authorizes removal. Dangling links,
// ENOTDIR and unreadable ancestors fail closed. Presence is fenced separately.
function permissionPath(file: string): string {
  let anchor = resolve(file); const suffix: string[] = [];
  while (absent(anchor)) {
    if (dirname(anchor) === anchor) refuse();
    suffix.unshift(basename(anchor)); anchor = dirname(anchor);
  }
  return join(realpathSync(anchor), ...suffix);
}
export function gitFenceLogicalPermission(cwd: string, roots: Set<string>): boolean {
  if (!isFilePathAllowed(cwd, roots)) return false;
  try {
    const physicalRoots = new Set<string>();
    for (const root of roots) { try { physicalRoots.add(permissionPath(root)); } catch { /* Unknown root grants nothing. */ } }
    return isFilePathAllowed(permissionPath(cwd), physicalRoots);
  } catch { return false; }
}

/** Construct synchronously BEFORE discovery. All methods are internal to the
 * fence: no public supplied proof reader, mutable flag or replacement caller. */
export function createGitCheckCleanupTransition(scope: HumanGitScope, checkouts: readonly string[], agentDir: string,
  rawOwner: GitInvocationBinding["owner"]) {
  const owner = structuredClone(rawOwner);
  if (!checkouts.includes(scope.cwd) || owner.sessionId !== scope.sessionId || owner.sessionFile !== scope.sessionFile || !owner.generation ||
    typeof owner.generation !== "string" || owner.generation.length > 4096 || /[\x00-\x1f\x7f]/.test(owner.generation)) refuse();
  const originalScoped = captureGitScopedAuthorityRevision(agentDir);
  const originalRoots = getKnownAllowedFileRoots(), originalPhysicalRoots = new Set<string>();
  for (const root of originalRoots) { try { originalPhysicalRoots.add(permissionPath(root)); } catch { /* Unknown roots grant nothing. */ } }
  const originalTrust = new Map(checkouts.map((cwd) => [cwd, getProjectTrustStatus(cwd, agentDir)]));
  const pins = new Map<string, ReturnType<typeof physical>>();
  let facts: Facts | undefined, candidate: object | undefined, removal: object | undefined, revoked = false;
  const pin = (file: string, expected?: Identity) => {
    const current = physical(file), previous = pins.get(file);
    if (expected && Object.entries(expected).some(([key, value]) => current.identity[key as keyof Identity] !== value) ||
      previous && !isDeepStrictEqual(previous, current)) refuse();
    pins.set(file, current);
  };
  const parents = (file: string) => { for (let p = dirname(file);; p = dirname(p)) { pin(p); if (dirname(p) === p) break; } };
  for (const cwd of new Set([scope.cwd, ...checkouts])) { pin(cwd); parents(cwd); }
  const selection = () => {
    const resources = facts ? [facts.binding.source, facts.binding.target!, facts.evidence.main] : [];
    return { sessionId: scope.sessionId, projectRoots: [...new Set(resources.map((r) => r.projectRoot))],
      trustPaths: [...new Set([scope.cwd, ...checkouts, ...resources.flatMap((r) => [r.cwd, r.projectRoot])])] };
  };
  const readTrust = (cwd: string) => {
    if (!removal || cwd !== facts?.binding.source.cwd) return getProjectTrustStatus(cwd, agentDir);
    const original = originalTrust.get(cwd); if (!original) refuse();
    // Only disappeared resource discovery is normalized, never the live SDK decision.
    return { requiresTrust: original.requiresTrust, trusted: !original.requiresTrust || new ProjectTrustStore(agentDir).get(cwd) === true };
  };
  const assertCurrent = () => {
    if (revoked) refuse();
    const source = facts?.binding.source;
    if (removal) {
      if (!candidate || !readGitCleanupRemovalAuthority(candidate, removal) || !source || !absent(source.cwd) || !absent(source.gitDir)) refuse();
    }
    for (const [file, expected] of pins) {
      if (removal && source) {
        if (file === source.cwd || file === source.gitDir || file === join(source.cwd, ".git")) continue;
        // Git can remove its now-empty worktrees directory as part of removing
        // the last linked checkout. Its common directory remains pinned.
        if (file === dirname(source.gitDir) && file === join(source.commonDir, "worktrees") && absent(file)) continue;
      }
      if (!isDeepStrictEqual(physical(file), expected)) refuse();
    }
    if (facts) {
      const selected = selection(), roots = getKnownAllowedFileRoots();
      if (originalScoped(selected) !== readGitScopedAuthorityRevision(agentDir, selected)) refuse();
      for (const cwd of selected.trustPaths) {
        if (!isFilePathAllowed(cwd, originalRoots) || !isFilePathAllowed(cwd, originalPhysicalRoots) ||
          !gitFenceLogicalPermission(cwd, roots) || !readTrust(cwd).trusted) refuse();
      }
    }
  };
  return {
    selection,
    revoke() { revoked = true; },
    assertCurrent,
    removed(cwd: string) { return !!removal && cwd === facts?.binding.source.cwd; },
    trust: readTrust,
    bind(originalCandidate: object) {
      assertCurrent();
      if (facts || candidate || removal) refuse();
      const captured = readGitCleanupCandidateAuthority(originalCandidate);
      if (!captured || captured.binding.kind !== "cleanup" || !isDeepStrictEqual(captured.binding.owner, owner) || !captured.binding.target ||
        !isDeepStrictEqual(captured.binding.source, captured.evidence.integration.feature) ||
        !isDeepStrictEqual(captured.binding.target, captured.evidence.integration.target)) refuse();
      const source = captured.binding.source;
      if (source.cwd === source.projectRoot || source.gitDir === source.commonDir || dirname(source.gitDir) !== join(source.commonDir, "worktrees")) refuse();
      for (const r of [source, captured.binding.target, captured.evidence.main]) {
        for (const [file, expected] of [[r.cwd, r.identities.checkout], [r.projectRoot, r.identities.project],
          [r.commonDir, r.identities.common], [r.gitDir, r.identities.git], [join(r.cwd, ".git"), r.identities.marker]] as const) {
          pin(file, expected); parents(file);
        }
      }
      if (!originalTrust.has(source.cwd)) originalTrust.set(source.cwd, getProjectTrustStatus(source.cwd, agentDir));
      facts = captured; candidate = originalCandidate;
      assertCurrent();
    },
    accept(originalCandidate: object, originalRemoval: object) {
      if (revoked || !facts || candidate !== originalCandidate || removal && removal !== originalRemoval) refuse();
      const linked = readGitCleanupRemovalAuthority(originalCandidate, originalRemoval), proof = readGitCleanupNativeProof(originalRemoval);
      if (!linked || !isDeepStrictEqual(linked, facts) || !proof || proof.kind !== "removed" ||
        !isDeepStrictEqual(proof.invocationOwner, owner) || proof.sourcePath !== facts.binding.source.cwd ||
        proof.adminPath !== facts.binding.source.gitDir || !isDeepStrictEqual(proof.sourceIdentity, facts.binding.source.identities.checkout) ||
        proof.featureOid !== facts.evidence.integration.featureOid || !isDeepStrictEqual(proof.before, facts.evidence.inventory)) refuse();
      removal = originalRemoval;
      assertCurrent();
    },
  };
}
