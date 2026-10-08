import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { validHiddenProjectKey, validHiddenProjectsData, type HiddenProjectsData } from "./hidden-projects";

export function hiddenProjectsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web", "hidden-projects.json");
}

/** Only a missing file means no hidden projects. Corruption and IO failures fail closed. */
export function readHiddenProjects(path = hiddenProjectsPath()): HiddenProjectsData {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { keys: [] };
    throw error;
  }
  const data: unknown = JSON.parse(text);
  if (!validHiddenProjectsData(data) || (data as { version?: unknown }).version !== 1) {
    throw new Error("Invalid hidden projects file");
  }
  return { keys: [...new Set(data.keys)].sort() };
}

/** Per-project changes merge under a stable-path lock; never replace another client's list. */
export async function setHiddenProject(key: string, hidden: boolean, path = hiddenProjectsPath()): Promise<HiddenProjectsData> {
  if (!validHiddenProjectKey(key) || typeof hidden !== "boolean") throw new Error("Invalid project visibility");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(path, {
    realpath: false, stale: 30_000,
    retries: { retries: 10, minTimeout: 100, maxTimeout: 1_000 },
  });
  try {
    const keys = new Set(readHiddenProjects(path).keys);
    if (hidden) keys.add(key);
    else keys.delete(key);
    const data = { keys: [...keys].sort() };
    if (!validHiddenProjectsData(data)) throw new Error("Too many hidden projects");
    writePrivateFileAtomicSync(path, `${JSON.stringify({ version: 1, ...data }, null, 2)}\n`);
    return data;
  } finally {
    await release();
  }
}
