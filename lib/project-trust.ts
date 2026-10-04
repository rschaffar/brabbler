import { hasTrustRequiringProjectResources, ProjectTrustStore, type ProjectTrustUpdate } from "@earendil-works/pi-coding-agent";
import { lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import lockfile from "proper-lockfile";
import { advanceGitScopedAuthority, writeGitScopedAuthorityFile, type GitAuthorityScope } from "./git-scoped-authority";
import { gitWorkflowPrivateParent } from "./git-workflow-write-epoch";
import { readBindingFile } from "./git-workflow-binding-io";
import type { ProjectTrustStatus } from "./api-types";

function trustTargetChanged(): never { throw new Error("Project trust target or staged delta changed"); }
function resolveTrustInput(input: string): string {
  // SDK 1.0.0 resolvePath defaults. The SDK still produces all persisted bytes;
  // the final staged-delta check refuses any normalization disagreement.
  let path = input;
  if (process.platform === "win32" && path.startsWith("/") && !path.startsWith("//") && !path.includes("\\")) {
    const drive = path.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
    if (drive) path = `${drive[1].toUpperCase()}:\\${(drive[2] ?? "").replaceAll("/", "\\")}`;
  }
  if (path === "~") path = homedir();
  else if (path.startsWith("~/") || process.platform === "win32" && path.startsWith("~\\")) path = join(homedir(), path.slice(2));
  if (path.startsWith("file://")) path = fileURLToPath(path);
  return resolve(path);
}
function pinTrustTarget(input: string) {
  const original = resolveTrustInput(input);
  let anchor = original;
  for (;;) {
    try {
      const physical = realpathSync(anchor), stat = lstatSync(physical, { bigint: true });
      return { original, path: anchor === original ? physical : original, anchor, physical,
        identity: [String(stat.dev), String(stat.ino), String(stat.birthtimeNs)], missing: anchor !== original };
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT" || dirname(anchor) === anchor) throw cause;
      anchor = dirname(anchor);
    }
  }
}
function trustRecords(bytes: string): Record<string, boolean | null> {
  const data: unknown = JSON.parse(bytes.replace(/^\uFEFF/, ""));
  if (!data || typeof data !== "object" || Array.isArray(data) ||
    Object.values(data).some((value) => value !== true && value !== false && value !== null)) return trustTargetChanged();
  return Object.assign(Object.create(null), data);
}
const trustRecordDigest = (records: Record<string, boolean | null>) => JSON.stringify(Object.keys(records).sort().map((key) => [key, records[key]]));

/** SDK 1.0.0 keeps nearest-ancestor precedence and path normalization. Stage
 * through its actual setMany implementation, then account the exact replacement
 * before publishing to the real shared trust file. This adapter does not alter
 * SDK prototypes, loaded SettingsManagers, or CLI/external writers. */
export function createGitProjectTrustStore(agentDir: string): ProjectTrustStore {
  const store = new ProjectTrustStore(agentDir);
  store.setMany = (updates: ProjectTrustUpdate[]) => {
    const captured = updates.map(({ path, decision }) => {
      if (typeof path !== "string" || decision !== true && decision !== false && decision !== null) return trustTargetChanged();
      return { target: pinTrustTarget(path), decision };
    });
    const scopes: GitAuthorityScope[] = captured.map(({ target }) => target.missing
      ? { kind: "global" } : { kind: "trust-path", path: target.path });
    const assertTargets = () => {
      for (const { target } of captured) {
        if (JSON.stringify(pinTrustTarget(target.original)) !== JSON.stringify(target)) trustTargetChanged();
      }
    };
    advanceGitScopedAuthority(agentDir, "trust", scopes);
    const parent = gitWorkflowPrivateParent(agentDir, true)!;
    const file = join(agentDir, "trust.json");
    // Same stable lock pathname as SDK ProjectTrustStore, not a Git-operation gate.
    const release = lockfile.lockSync(agentDir, { realpath: false, lockfilePath: `${file}.lock` });
    let stage: string | undefined;
    try {
      stage = mkdtempSync(join(parent, "trust-stage-"));
      assertTargets();
      const stagedFile = join(stage, "trust.json");
      let before = "{}";
      try { before = readBindingFile(file, 4 * 1024 * 1024).bytes.toString("utf8"); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
      writeFileSync(stagedFile, before, { mode: 0o600 });
      const expected = trustRecords(before), stagedStore = new ProjectTrustStore(stage);
      let bytes = before;
      const applyStaged = (path: string, decision: boolean | null) => {
        assertTargets();
        stagedStore.setMany([{ path, decision }]);
        if (decision === null) delete expected[path]; else expected[path] = decision;
        bytes = readBindingFile(stagedFile, 4 * 1024 * 1024).bytes.toString("utf8");
        if (trustRecordDigest(trustRecords(bytes)) !== trustRecordDigest(expected)) trustTargetChanged();
        assertTargets();
      };
      for (const { target, decision } of captured) {
        // Force the requested write to have a measurable staged delta, even for
        // equal-value saves. Canonical strings alone do not prevent an ancestor
        // swap during SDK normalization (including swap-and-restore).
        applyStaged(target.path, decision === true ? false : true);
        applyStaged(target.path, decision);
      }
      if (!captured.length) stagedStore.setMany([]);
      bytes = readBindingFile(stagedFile, 4 * 1024 * 1024).bytes.toString("utf8");
      if (trustRecordDigest(trustRecords(bytes)) !== trustRecordDigest(expected)) trustTargetChanged();
      assertTargets();
      writeGitScopedAuthorityFile(agentDir, file, bytes, "trust", scopes, assertTargets);
    } finally { if (stage) rmSync(stage, { recursive: true, force: true }); release(); }
  };
  return store;
}

export function getProjectTrustStatus(cwd: string, agentDir: string): ProjectTrustStatus {
  const requiresTrust = Boolean(cwd) && hasTrustRequiringProjectResources(cwd);
  if (!requiresTrust) return { requiresTrust: false, trusted: true };

  const trustStore = new ProjectTrustStore(agentDir);
  return {
    requiresTrust: true,
    trusted: trustStore.get(cwd) === true,
  };
}

export function trustProject(cwd: string, agentDir: string): ProjectTrustStatus {
  const status = getProjectTrustStatus(cwd, agentDir);
  if (!status.requiresTrust) return status;

  createGitProjectTrustStore(agentDir).set(cwd, true);
  return { requiresTrust: true, trusted: true };
}

/**
 * Reload options that gate project-local, trust-requiring resources — a
 * repository's `.pi/extensions`, project `.pi/settings.json` extension
 * entries, and `.agents/skills` — behind the SDK's project-trust store.
 *
 * Pi Web *executes* project extensions when it builds session services: their
 * factory runs on import and their `session_start` handlers run on startup.
 * Without a trust gate, merely opening an untrusted repository in Pi Web runs
 * repository-controlled code locally (issue #236). The SDK's resource loader
 * only imports project extensions once `resolveProjectTrust` resolves true, so
 * denying trust keeps them dormant.
 *
 * Pi Web and the `pi` CLI share the same trust store. Projects with gated
 * resources default to untrusted until either client records a trust decision.
 * Returns `undefined` when the project has no trust-requiring resources,
 * leaving ordinary projects on their existing load path.
 */
export function projectTrustReloadOptions(
  cwd: string,
  agentDir: string,
): { resolveProjectTrust: () => Promise<boolean> } | undefined {
  const status = getProjectTrustStatus(cwd, agentDir);
  if (!status.requiresTrust) return undefined;
  const trustStore = new ProjectTrustStore(agentDir);
  return { resolveProjectTrust: async () => trustStore.get(cwd) === true };
}
