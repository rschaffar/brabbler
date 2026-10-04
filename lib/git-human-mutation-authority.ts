// Narrow trusted browser bootstrap. No request-provided owner, guard or revision.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createGitCheckAuthorityFence } from "./git-check-authority-fence";
import { captureGitScopedAuthorityRevision, readGitScopedAuthorityRevision, type GitAuthoritySelection } from "./git-scoped-authority";
import { getKnownAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "./file-access";
import { readHumanGitSessionManager, type HumanGitScope } from "./git-action-human";
import { assertGitCheckSelectionSync } from "./git-check-runner";
import type { GitProjectResources } from "./git-project-resources";
import type { GitInvocationBinding } from "./git-invocation";
import type { GitMutationInvocationAuthority } from "./git-mutation-invocation";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Capture immediately after identifying the actual saved owner, BEFORE roots,
 * trust, policy, native discovery/candidate or human-approval awaits. */
export function captureHumanGitMutationAuthority(scope: HumanGitScope, agentDir = getAgentDir()) {
  const bound = Object.freeze({ ...scope });
  readHumanGitSessionManager(bound);
  const originalScopes = captureGitScopedAuthorityRevision(agentDir);
  const originalRoots = new Set(getKnownAllowedFileRoots());
  const ownFence = createGitCheckAuthorityFence({ scope: bound, agentDir, projectRoots: [], checkouts: [bound.cwd] });
  const ownRevision = ownFence();
  // The generation comes from the actual private owner/SDK/live observation,
  // not a random fabricated owner, action ID, display session ID or restored JSON.
  const owner = Object.freeze({ sessionId: bound.sessionId, sessionFile: bound.sessionFile, generation: ownRevision });
  let selected: { source: GitProjectResources; target: GitProjectResources; dependencies: GitAuthoritySelection } | undefined;
  const assertCurrentSync = () => {
    const dependencies = selected?.dependencies ?? { projectRoots: [], sessionId: bound.sessionId, trustPaths: [bound.cwd] };
    if (ownFence() !== ownRevision || originalScopes(dependencies) !== readGitScopedAuthorityRevision(agentDir, dependencies)) throw new Error("Original human authority revoked");
    readHumanGitSessionManager(bound);
    const paths = dependencies.trustPaths!, roots = getKnownAllowedFileRoots();
    const relevant = (all: ReadonlySet<string>) => [...all].filter(root => paths.some(path => isFilePathAllowed(path, new Set([root])))).sort();
    if (JSON.stringify(relevant(originalRoots)) !== JSON.stringify(relevant(roots)) || paths.some(path =>
      !isFilePathAllowed(path, roots) || !isExistingFilePathAllowed(path, roots))) throw new Error("Original human roots changed");
    if (selected) { assertGitCheckSelectionSync(selected.source); assertGitCheckSelectionSync(selected.target); }
    if (ownFence() !== ownRevision || originalScopes(dependencies) !== readGitScopedAuthorityRevision(agentDir, dependencies)) throw new Error("Original human authority revoked");
  };
  return Object.freeze({ assertCurrentSync,
    select(source: GitProjectResources, target: GitProjectResources) {
      assertCurrentSync();
      if (selected || source.cwd !== bound.cwd || source.projectRoot !== target.projectRoot || source.commonDir !== target.commonDir) throw new Error("Exact original human resources required");
      selected = { source: structuredClone(source), target: structuredClone(target), dependencies: {
        sessionId: bound.sessionId, projectRoots: [...new Set([source.projectRoot, target.projectRoot])],
        trustPaths: [...new Set([bound.cwd, source.cwd, source.projectRoot, target.cwd, target.projectRoot])] } };
      // Derive from ORIGINAL opaque snapshot, never capture after discovery.
      assertCurrentSync();
    },
    readAuthorityRevisionSync() {
      assertCurrentSync();
      if (!selected) throw new Error("Original physical selection required");
      return hash([ownRevision, originalScopes(selected.dependencies)]);
    },
    nativeAuthority(assertApprovalSync: (binding: Readonly<GitInvocationBinding>) => void): GitMutationInvocationAuthority {
      if (!selected) throw new Error("Original physical selection required");
      const resources = selected;
      return Object.freeze({ owner,
        readAuthorityRevisionSync: () => { assertCurrentSync(); return hash([ownRevision, originalScopes(resources.dependencies)]); },
        assertCurrentSync(binding: Readonly<GitInvocationBinding>) {
          assertCurrentSync();
          if (binding.kind !== "integrate" || !isDeepStrictEqual(binding.owner, owner) ||
            !isDeepStrictEqual(binding.source, resources.source) || !isDeepStrictEqual(binding.target, resources.target)) throw new Error("Exact human invocation required");
          const value: unknown = assertApprovalSync(binding);
          if (value !== undefined) { void Promise.resolve(value).catch(() => {}); throw new Error("Synchronous human approval required"); }
          assertCurrentSync();
        } });
    },
  });
}
