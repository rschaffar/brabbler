import { createHash } from "node:crypto";
import { realpathSync, statSync, type BigIntStats } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { getAgentDir, readSessionHeader, resolveSessionPath } from "../session-reader";
import { getKnownAllowedFileRoots, isExistingFilePathAllowed } from "../file-access";
import { isPathWithinRoots } from "../path-security";
import { samePath, toNativePath } from "../paths";
import { registeredGitRepository } from "../project-trust-repository";
import { isPluginSessionId } from "../plugins/settings";
import type { SelectionContext } from "./selection";

/** Detached context admission only. No HTTP/catalog authorization, content-read
 * grant, SDK session open/migration, root registration or live first-use import.
 * Native settings always come from the server's getAgentDir, never an account or
 * request path. Cold/expired unknown file roots fail closed: refresh that shared
 * owner outside this read-only resolver if needed; do not scan a catalogue here. */
export interface ResourceContext {
  readonly selection: SelectionContext;
  readonly cwd: string | null;
  /** Synchronous fresh fence for a trusted caller to compose with its current
   * catalog/membership guard. Not an atomic snapshot against external writers. */
  readonly assertAdmissionCurrent: () => void;
}
export class ResourceContextError extends Error {
  constructor(readonly code: "invalid" | "forbidden" | "unavailable" | "session" | "generation") {
    super(`Resource context refused: ${code}`); this.name = "ResourceContextError";
  }
}
function need(condition: unknown, code: ResourceContextError["code"]): asserts condition {
  if (!condition) throw new ResourceContextError(code);
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function nativePath(value: unknown): string {
  need(typeof value === "string" && value.length > 0 && value.length <= 16_384 && !value.includes("\0"), "invalid");
  const path = toNativePath(value);
  need(isAbsolute(path), "invalid"); return resolve(path);
}
// Never use directory size/mtime/link count or JSONL size/mtime/ctime as
// ownership facts: child/lock/stage creation and message appends remain valid.
function physicalId(stat: BigIntStats): string {
  need(stat.ino > BigInt(0) && stat.birthtimeNs > BigInt(0), "unavailable");
  return [stat.dev, stat.ino, stat.birthtimeNs].join(":");
}
function ownership(stat: BigIntStats): string {
  return [physicalId(stat), stat.mode, stat.uid, stat.gid, stat.isDirectory() ? null : stat.nlink].join(":");
}
function directory(path: string): { physical: string; identity: string } {
  const physical = realpathSync(path), stat = statSync(physical, { bigint: true });
  need(stat.isDirectory(), "unavailable");
  return { physical, identity: ownership(stat) };
}
function admittedDirectory(path: string) {
  need(isExistingFilePathAllowed(path, getKnownAllowedFileRoots()), "forbidden");
  const result = directory(path);
  need(isExistingFilePathAllowed(result.physical, getKnownAllowedFileRoots()), "forbidden");
  return result;
}
function projectBinding(cwd: string): string | null {
  const repository = registeredGitRepository(cwd);
  if (!repository) return null;
  try {
    const common = directory(repository.common);
    // Like native-defaults' repositoryInstance, but no trust/native marker reuse
    // or creation, path-only fallback, subdirectory identity or registry.
    return hash(["resource-project-v1", common.physical, physicalId(statSync(common.physical, { bigint: true }))]);
  } catch { return null; } // Global/own Session still available without reliable Project identity.
}
function savedSession(path: string, id: string, agent: ReturnType<typeof directory>, cwd: ReturnType<typeof directory>) {
  const sessions = directory(join(agent.physical, "sessions"));
  need(!samePath(sessions.physical, agent.physical)
    && isPathWithinRoots(sessions.physical, new Set([agent.physical])), "session");
  const physical = realpathSync(path);
  need(!samePath(physical, sessions.physical) && isPathWithinRoots(physical, new Set([sessions.physical])), "session");
  const before = statSync(physical, { bigint: true });
  need(before.isFile() && before.nlink === BigInt(1) && typeof process.getuid === "function"
    && before.uid === BigInt(process.getuid()), "session");
  const header = readSessionHeader(physical);
  need(header?.id === id && typeof header.cwd === "string" && header.cwd.length > 0
    && typeof header.timestamp === "string" && header.timestamp.length > 0, "session");
  const savedCwd = admittedDirectory(nativePath(header.cwd));
  need(samePath(savedCwd.physical, cwd.physical) && savedCwd.identity === cwd.identity, "session");
  need(ownership(before) === ownership(statSync(physical, { bigint: true }))
    && samePath(realpathSync(path), physical), "generation");
  // The file generation fences this captured authority, not durable Session
  // identity: SDK rewrites may replace JSONL, whereas an append changes no owner.
  return { physical, file: ownership(before), sessions,
    header: [header.id, header.cwd, header.timestamp] };
}

export async function resolveResourceContext(input: Readonly<{ cwd?: unknown; sessionId?: unknown }> = {}): Promise<ResourceContext> {
  need(input !== null && typeof input === "object" && !Array.isArray(input)
    && Object.keys(input).every(key => key === "cwd" || key === "sessionId"), "invalid");
  const cwdPath = input.cwd === undefined ? null : nativePath(input.cwd);
  const sessionId = input.sessionId;
  need(sessionId === undefined || isPluginSessionId(sessionId), "invalid");
  need(sessionId === undefined || cwdPath !== null, "invalid");
  try {
    const agentDir = nativePath(getAgentDir()), agent = directory(agentDir);
    const cwd = cwdPath === null ? null : admittedDirectory(cwdPath);
    const project = cwd ? projectBinding(cwd.physical) : null;
    const sessionPath = sessionId === undefined ? null : await resolveSessionPath(sessionId, { allowCatalogueScan: false });
    need(sessionId === undefined || sessionPath !== null, "session");
    const session = sessionPath && sessionId && cwd ? savedSession(sessionPath, sessionId, agent, cwd) : null;
    const selection: SelectionContext = Object.freeze({ agentDir, projectBinding: project,
      sessionBinding: session ? hash(["resource-session-v1", sessionId, session.header[2],
        project ?? [cwd!.physical, cwd!.identity]]) : null });
    const assertAdmissionCurrent = () => {
      try {
        need(samePath(nativePath(getAgentDir()), agentDir)
          && JSON.stringify(directory(agentDir)) === JSON.stringify(agent), "generation");
        if (cwdPath && cwd) {
          const current = admittedDirectory(cwdPath);
          need(JSON.stringify(current) === JSON.stringify(cwd) && projectBinding(current.physical) === project, "generation");
        }
        if (session && sessionPath && sessionId && cwd) {
          need(JSON.stringify(savedSession(sessionPath, sessionId, agent, cwd)) === JSON.stringify(session), "generation");
        }
      } catch { throw new ResourceContextError("generation"); }
    };
    assertAdmissionCurrent(); // Also fence the asynchronous targeted session lookup.
    return Object.freeze({ selection, cwd: cwd?.physical ?? null, assertAdmissionCurrent });
  } catch (error) {
    if (error instanceof ResourceContextError) throw error;
    throw new ResourceContextError("unavailable");
  }
}
