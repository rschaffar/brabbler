import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { SCRATCHPAD_MAX_LENGTH, validScratchpadScope, type ScratchpadNote } from "./scratchpad";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export function scratchpadPath(sessionId: string | null, agentDir = getAgentDir()): string {
  if (!validScratchpadScope(sessionId)) throw new Error("Invalid scratchpad scope");
  return join(agentDir, "pi-web", "scratchpads", `${digest(JSON.stringify(sessionId))}.json`);
}
function snapshot(text: string): ScratchpadNote { return { text, revision: digest(text) }; }
export function readScratchpad(path: string): ScratchpadNote {
  let raw: string;
  try { raw = readFileSync(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return snapshot("");
    throw error;
  }
  const value = JSON.parse(raw) as { version?: unknown; text?: unknown };
  if (!value || value.version !== 1 || typeof value.text !== "string" || value.text.length > SCRATCHPAD_MAX_LENGTH) {
    throw new Error("Invalid scratchpad file");
  }
  return snapshot(value.text);
}
export class ScratchpadConflict extends Error {
  constructor(public current: ScratchpadNote) { super("Scratchpad changed in another client"); }
}
/** Re-read under a stable pathname lock; content equality recovers lost acknowledgements. */
export async function saveScratchpad(path: string, text: string, revision: string): Promise<ScratchpadNote> {
  if (typeof text !== "string" || text.length > SCRATCHPAD_MAX_LENGTH || !/^[a-f0-9]{64}$/.test(revision)) {
    throw new Error("Invalid scratchpad update");
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(path, {
    realpath: false, stale: 30_000,
    retries: { retries: 10, minTimeout: 50, maxTimeout: 500 },
  });
  try {
    const current = readScratchpad(path);
    if (current.text === text) return current;
    if (current.revision !== revision) throw new ScratchpadConflict(current);
    writePrivateFileAtomicSync(path, JSON.stringify({ version: 1, text }));
    return snapshot(text);
  } finally { await release(); }
}
