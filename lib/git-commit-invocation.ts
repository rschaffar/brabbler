import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createGitCheckAuthorityFence } from "./git-check-authority-fence";
import { captureGitScopedAuthorityRevision, readGitScopedAuthorityRevision, type GitAuthoritySelection } from "./git-scoped-authority";
import { getKnownAllowedFileRoots, isFilePathAllowed, isExistingFilePathAllowed } from "./file-access";
import { readHumanGitSessionManager, type HumanGitScope } from "./git-action-human";
import { getRpcSession } from "./rpc-manager";
import { captureGitInvocation } from "./git-invocation";
import { gitExactCommitInvocationBinding } from "./git-exact-commit-operation";
import type { GitCommitPreview } from "./git-commit";
import type { GitProjectResources } from "./git-project-resources";
import type { SelectedRuntimeManager } from "./git-selected-operation-runtime";

export interface GitCommitAuthority {
  assertCurrentSync(): void;
  /** Pin actual source BEFORE asynchronous candidate preparation. */
  selectSource(source: GitProjectResources): Promise<void>;
  bind(selection: GitProjectResources, preview: GitCommitPreview, message: string, assertApprovalSync: () => void): {
    handle: ReturnType<typeof captureGitInvocation>;
    owner: { sessionId: string; sessionFile: string; generation: string };
  };
}

function assertPhysical(source: Omit<GitProjectResources, "branch">) {
  for (const [path, expected, marker] of [
    [source.projectRoot, source.identities.project, false], [source.cwd, source.identities.checkout, false],
    [source.commonDir, source.identities.common, false], [source.gitDir, source.identities.git, false],
    [join(source.cwd, ".git"), source.identities.marker, true],
  ] as const) {
    const stat = lstatSync(path, { bigint: true });
    if (stat.isSymbolicLink() || realpathSync(path) !== path || (!stat.isDirectory() && !(marker && stat.isFile())) ||
      String(stat.dev) !== expected.device || String(stat.ino) !== expected.inode || String(stat.birthtimeNs) !== expected.birthtime ||
      marker && (source.identities.marker.changed !== undefined && String(stat.ctimeNs) !== source.identities.marker.changed ||
        source.identities.marker.size !== undefined && String(stat.size) !== source.identities.marker.size)) throw new Error("Commit physical source changed");
  }
}

/** Trusted bootstrap only. Capture BEFORE awaited permission/preview/approval
 * preparation. This is an original revocation fence, never permission itself.
 * One authority may bind only its own single exact approved candidate. */
export function captureGitCommitAuthority(options: {
  scope: HumanGitScope; agentDir?: string;
  manager?: SelectedRuntimeManager;
  effectiveTools?: () => readonly string[] | undefined;
  readSelectionRevisionSync?: () => string;
  assertCurrentSync?: () => void;
}): GitCommitAuthority {
  const scope = { ...options.scope }, agentDir = options.agentDir ?? getAgentDir();
  // The original full generation map can select relevant canonical keys AFTER
  // discovery, without rebasing even a change-and-restore during that await.
  const originalScopes = captureGitScopedAuthorityRevision(agentDir);
  const originalRoots = new Set(getKnownAllowedFileRoots());
  const callerDirectory = lstatSync(scope.cwd, { bigint: true });
  const owner = Object.freeze({ sessionId: scope.sessionId, sessionFile: scope.sessionFile, generation: randomUUID() });
  const readSelectionRevisionSync = options.effectiveTools ? () => {
    const revision = options.readSelectionRevisionSync?.() ?? getRpcSession(scope.sessionId)?.readGitCheckAuthorityRevisionSync?.();
    if (!revision) throw new Error("Live monotonic commit authority required");
    return revision;
  } : options.readSelectionRevisionSync;
  const readRevision = createGitCheckAuthorityFence({ scope, agentDir, projectRoots: [], checkouts: [scope.cwd],
    ...(options.effectiveTools ? { readSelectionStateSync: options.effectiveTools } : {}), readSelectionRevisionSync });
  const assertOwner = () => {
    const live = readHumanGitSessionManager(scope), manager = options.manager;
    const currentDirectory = lstatSync(scope.cwd, { bigint: true });
    if (!currentDirectory.isDirectory() || currentDirectory.isSymbolicLink() || realpathSync(scope.cwd) !== scope.cwd ||
      currentDirectory.dev !== callerDirectory.dev || currentDirectory.ino !== callerDirectory.ino ||
      currentDirectory.birthtimeNs !== callerDirectory.birthtimeNs) throw new Error("Commit caller directory changed");
    if (manager && (manager.getSessionId() !== scope.sessionId || manager.getSessionFile() !== scope.sessionFile ||
      manager.getCwd() !== scope.cwd || manager.isPersisted?.() === false || !isDeepStrictEqual(JSON.parse(JSON.stringify(manager.getHeader())), JSON.parse(JSON.stringify(live.getHeader()))) ||
      !isDeepStrictEqual(manager.getEntries().filter((e) => e.type === "custom" && e.customType !== "pi-web:git-action"),
        live.getEntries().filter((e) => e.type === "custom" && e.customType !== "pi-web:git-action")))) throw new Error("Commit session changed");
    const value: unknown = options.assertCurrentSync?.();
    if (value !== undefined) { void Promise.resolve(value).catch(() => {}); throw new Error("Synchronous commit owner guard required"); }
  };
  const original = readRevision();
  assertOwner();
  if (readRevision() !== original) throw new Error("Commit authority changed during capture");
  let selected: { source: GitProjectResources; caller?: Omit<GitProjectResources, "branch">; dependencies: GitAuthoritySelection } | undefined;
  const assertDependencies = () => {
    const dependencies = selected?.dependencies ?? { sessionId: scope.sessionId, projectRoots: [], trustPaths: [scope.cwd] };
    if (originalScopes(dependencies) !== readGitScopedAuthorityRevision(agentDir, dependencies)) throw new Error("Original scoped commit authority revoked");
    const paths = dependencies.trustPaths ?? [], roots = getKnownAllowedFileRoots();
    const relevantRoots = (all: ReadonlySet<string>) => [...all].filter((root) => paths.some((path) => isFilePathAllowed(path, new Set([root])))).sort();
    if (!isDeepStrictEqual(relevantRoots(originalRoots), relevantRoots(roots)) || paths.some((path) =>
      !isFilePathAllowed(path, roots) || !isExistingFilePathAllowed(path, roots))) throw new Error("Original commit roots changed");
    if (selected) { assertPhysical(selected.source); if (selected.caller) assertPhysical(selected.caller); }
  };
  const assertCurrentSync = () => {
    assertDependencies();
    if (readRevision() !== original) throw new Error("Original commit authority revoked");
    assertOwner();
    if (readRevision() !== original) throw new Error("Original commit authority revoked");
    assertDependencies();
  };
  let bound = false, selecting = false;
  return Object.freeze({ assertCurrentSync,
    async selectSource(source: GitProjectResources) {
      assertCurrentSync();
      if (selected) {
        if (!isDeepStrictEqual(source, selected.source)) throw new Error("Commit source already selected");
        return;
      }
      if (selecting) throw new Error("Commit selection already started");
      selecting = true;
      assertPhysical(source);
      const capturedSource = structuredClone(source);
      const { readSelectedRuntimeCurrent } = await import("./git-selected-operation-runtime");
      const current = await readSelectedRuntimeCurrent(scope.cwd);
      const caller = current.kind === "git" ? structuredClone(current.resources) : undefined;
      const dependencies = { sessionId: scope.sessionId,
        projectRoots: [...new Set([capturedSource.projectRoot, ...(caller ? [caller.projectRoot] : [])])],
        trustPaths: [...new Set([scope.cwd, capturedSource.cwd, capturedSource.projectRoot, ...(caller ? [caller.cwd, caller.projectRoot] : [])])] };
      selected = { source: capturedSource, caller, dependencies };
      assertCurrentSync();
    },
    bind(selection: GitProjectResources, preview: GitCommitPreview, message: string, assertApprovalSync: () => void) {
      if (bound) throw new Error("Commit authority already bound");
      if (!selected || !isDeepStrictEqual(selected.source, selection)) throw new Error("Original physical commit selection required");
      bound = true;
      const source = structuredClone(selection), candidate = structuredClone(preview);
      const binding = gitExactCommitInvocationBinding(source, candidate, message, owner);
      const dependencies = selected.dependencies;
      const handle = captureGitInvocation(binding, { readAuthorityRevisionSync: () => JSON.stringify([
        readRevision(), readGitScopedAuthorityRevision(agentDir, dependencies)]),
        assertCurrentSync(expected) {
          assertCurrentSync(); assertPhysical(source); assertApprovalSync();
          if (!isDeepStrictEqual(expected, gitExactCommitInvocationBinding(source, candidate, message, owner))) throw new Error("Commit candidate changed");
          assertCurrentSync();
        } });
      return Object.freeze({ handle, owner });
    },
  });
}
