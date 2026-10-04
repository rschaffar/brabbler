// Trusted SDK bootstrap for the legacy paired integration caller. Never a payload API.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createGitCheckAuthorityFence } from "./git-check-authority-fence";
import { captureGitScopedAuthorityRevision, readGitScopedAuthorityRevision, type GitAuthoritySelection } from "./git-scoped-authority";
import { readHumanGitSessionManager } from "./git-action-human";
import { getRpcSession } from "./rpc-manager";
import { getKnownAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "./file-access";
import { assertGitCheckSelectionSync } from "./git-check-runner";
import { ManagedGitAccessError } from "./git-workflow-access";
import type { GitProjectResources } from "./git-project-resources";
import type { GitMutationInvocationAuthority } from "./git-mutation-invocation";
import type { GitInvocationBinding } from "./git-invocation";
import type { SessionEntry } from "./types";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const customs = (entries: readonly unknown[]) => (entries as SessionEntry[]).filter(e => e.type === "custom" && e.customType !== "pi-web:git-action");
// SDK in-memory optional undefined fields are absent from its persisted JSONL.
const persistedValue = (value: unknown) => JSON.parse(JSON.stringify(value));
function denied(): never { throw new ManagedGitAccessError("Original integration authority or persisted SDK owner changed; obtain new verification and exact approval."); }
/** Synchronous at tool entry, BEFORE policy/root/native/UI awaits. Only the
 * genuine SDK manager and a trusted monotonic selection writer may supply state. */
export function captureLegacyIntegrationAuthority(options: {
  sessionCwd: string; agentDir: string; ctx: ExtensionContext;
  effectiveTools(): readonly string[] | undefined;
  readSelectionRevisionSync?: () => string;
  readWritableEntries?: () => readonly unknown[];
  signal?: AbortSignal;
}) {
  const manager = options.ctx.sessionManager, file = manager.getSessionFile();
  if (!file) denied();
  const scope = Object.freeze({ sessionId: manager.getSessionId(), sessionFile: file, cwd: options.sessionCwd });
  const originalScopes = captureGitScopedAuthorityRevision(options.agentDir);
  const originalRoots = new Set(getKnownAllowedFileRoots());
  const assertOwner = () => {
    const actual = readHumanGitSessionManager(scope);
    if (options.signal?.aborted || options.ctx.cwd !== scope.cwd || options.ctx.sessionManager !== manager ||
      manager.getSessionId() !== scope.sessionId || manager.getSessionFile() !== scope.sessionFile || manager.getCwd() !== scope.cwd ||
      !isDeepStrictEqual(persistedValue(manager.getHeader()), persistedValue(actual.getHeader())) || !isDeepStrictEqual(persistedValue(customs(manager.getEntries())), persistedValue(customs(actual.getEntries()))) ||
      options.readWritableEntries && !isDeepStrictEqual(customs(options.readWritableEntries()), customs(manager.getEntries()))) denied();
  };
  const selectionRevision = () => {
    if (options.readSelectionRevisionSync) return options.readSelectionRevisionSync();
    const live = getRpcSession(scope.sessionId);
    if (!live?.isAlive() || typeof live.readGitCheckAuthorityRevisionSync !== "function") denied();
    return live.readGitCheckAuthorityRevisionSync();
  };
  const ownFence = createGitCheckAuthorityFence({ scope, agentDir: options.agentDir, projectRoots: [], checkouts: [scope.cwd],
    readSelectionRevisionSync: selectionRevision,
    readSelectionStateSync: () => {
      assertOwner(); const tools: unknown = options.effectiveTools();
      if (!Array.isArray(tools) || tools.some(tool => typeof tool !== "string")) { void Promise.resolve(tools).catch(() => {}); denied(); }
      return { tools, entries: customs(manager.getEntries()), cwd: options.ctx.cwd };
    } });
  assertOwner(); const ownRevision = ownFence(); assertOwner();
  const owner = Object.freeze({ sessionId: scope.sessionId, sessionFile: scope.sessionFile, generation: ownRevision });
  let selected: { caller: GitProjectResources; source: GitProjectResources; target: GitProjectResources; dependencies: GitAuthoritySelection } | undefined;
  const assertCurrentSync = () => {
    const dependencies = selected?.dependencies ?? { sessionId: scope.sessionId, projectRoots: [], trustPaths: [scope.cwd] };
    assertOwner();
    if (ownFence() !== ownRevision || originalScopes(dependencies) !== readGitScopedAuthorityRevision(options.agentDir, dependencies)) denied();
    const roots = getKnownAllowedFileRoots(), paths = dependencies.trustPaths!;
    const relevant = (all: ReadonlySet<string>) => [...all].filter(root => paths.some(path => isFilePathAllowed(path, new Set([root])))).sort();
    if (!isDeepStrictEqual(relevant(originalRoots), relevant(roots)) || paths.some(path => !isFilePathAllowed(path, roots) || !isExistingFilePathAllowed(path, roots))) denied();
    if (selected) for (const resource of [selected.caller, selected.source, selected.target]) assertGitCheckSelectionSync(resource);
    assertOwner();
    if (ownFence() !== ownRevision || originalScopes(dependencies) !== readGitScopedAuthorityRevision(options.agentDir, dependencies)) denied();
  };
  const readAuthorityRevisionSync = () => {
    assertCurrentSync(); if (!selected) denied();
    return hash([ownRevision, originalScopes(selected.dependencies)]);
  };
  return Object.freeze({ scope, assertCurrentSync, readAuthorityRevisionSync,
    select(caller: GitProjectResources, source: GitProjectResources, target: GitProjectResources) {
      assertCurrentSync();
      if (selected || caller.cwd !== scope.cwd || source.commonDir !== target.commonDir || source.projectRoot !== target.projectRoot || source.cwd === target.cwd) denied();
      selected = { caller: structuredClone(caller), source: structuredClone(source), target: structuredClone(target), dependencies: {
        sessionId: scope.sessionId, projectRoots: [...new Set([caller.projectRoot, source.projectRoot, target.projectRoot])],
        trustPaths: [...new Set([scope.cwd, caller.projectRoot, source.cwd, source.projectRoot, target.cwd, target.projectRoot])] } };
      // These keys are selected from the ORIGINAL pre-await map, never rebased.
      assertCurrentSync();
    },
    nativeAuthority(assertApprovalSync: (binding: Readonly<GitInvocationBinding>) => void): GitMutationInvocationAuthority {
      if (!selected) denied(); const resources = selected;
      return Object.freeze({ owner, readAuthorityRevisionSync,
        assertCurrentSync(binding: Readonly<GitInvocationBinding>) {
          assertCurrentSync();
          if (binding.kind !== "integrate" || !isDeepStrictEqual(binding.owner, owner) || !isDeepStrictEqual(binding.source, resources.source) || !isDeepStrictEqual(binding.target, resources.target)) denied();
          const value: unknown = assertApprovalSync(binding);
          if (value !== undefined) { void Promise.resolve(value).catch(() => {}); denied(); }
          assertCurrentSync();
        } });
    },
  });
}
