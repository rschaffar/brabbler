import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "../file-access";
import { acceptanceProject, digest, readProfiles } from "./config";
import { acceptanceCoordinator } from "./coordinator";
import type { AcceptanceProject, AcceptanceView } from "./types";
import { acceptanceEnabled } from "../../plugins/acceptance/policy";

export async function allowedAcceptanceProject(cwd: unknown): Promise<AcceptanceProject> {
  if (typeof cwd !== "string") throw new Error("Select an existing project directory");
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots) || !isExistingFilePathAllowed(cwd, roots)) throw new Error("Acceptance project is outside allowed roots");
  return acceptanceProject(cwd);
}
export function acceptanceView(project: AcceptanceProject): AcceptanceView {
  const profiles = readProfiles(project);
  return { project, enabled: acceptanceEnabled(), profiles, profileDigests: Object.fromEntries(profiles.map((p) => [p.name, digest(p)])), ...acceptanceCoordinator().view(project) };
}
export function acceptanceLog(project: AcceptanceProject, id: string) {
  const run = acceptanceCoordinator().view(project).runs.find((item) => item.id === id);
  if (!run) throw new Error("Acceptance run not found in this project");
  let fd: number;
  try { fd = openSync(run.logPath, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("Invalid acceptance log");
    const length = Math.min(stat.size, 32768), buffer = Buffer.alloc(length);
    const count = readSync(fd, buffer, 0, length, stat.size - length);
    return (stat.size > length ? "[Earlier output omitted; full log retained on server]\n" : "") + buffer.subarray(0, count).toString("utf8");
  } finally { closeSync(fd); }
}
