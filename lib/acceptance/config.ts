import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "../atomic-file";
import { trustedGitRepository } from "../project-trust-repository";
import type { AcceptanceProfile, AcceptanceProject } from "./types";

export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const acceptanceRoot = () => path.join(getAgentDir(), "pi-web", "acceptance");
export const excludedInput = (name: string) => (name.startsWith(".") && ![".github", ".gitignore"].includes(name))
  || ["node_modules", "result", "test-results", "coverage", "dist", "build", "out", "__pycache__", "private", "credentials", "secrets", "auth.json", "credentials.json", "settings.json", "models.json", "config.json", "next-env.d.ts"].includes(name.toLowerCase())
  || /\.(pem|key|p12|pfx|log|tsbuildinfo)$/i.test(name);
export function inputPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length < 1024 && !path.isAbsolute(value)
    && !/[\\\x00-\x1f:]/.test(value) && (value === ".agents/skills/writing-plans"
      || value.split("/").every((part) => part !== ".." && part !== "" && !excludedInput(part)));
}
export function validateProfiles(raw: unknown): AcceptanceProfile[] {
  if (!Array.isArray(raw) || raw.length > 16 || Buffer.byteLength(JSON.stringify(raw)) > 65536) throw new Error("Expected at most 16 acceptance profiles");
  const names = new Set<string>();
  return raw.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "argv,coverage,cpus,inputs,label,memoryMiB,name,permission") throw new Error("Invalid acceptance profile fields");
    const p = value as AcceptanceProfile;
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(p.name) || names.has(p.name)) throw new Error("Acceptance profile names must be unique lowercase identifiers");
    names.add(p.name);
    if (typeof p.label !== "string" || !p.label.trim() || p.label.length > 160 || /[\x00-\x1f]/.test(p.label)
      || !["full", "focused"].includes(p.coverage) || !["ask", "allow", "deny"].includes(p.permission)
      || !Array.isArray(p.argv) || !p.argv.length || p.argv.length > 64 || p.argv.some((arg) => typeof arg !== "string" || arg.includes("\0") || arg.length > 4096)
      || !p.argv[0] || !Array.isArray(p.inputs) || !p.inputs.length || p.inputs.length > 64 || !p.inputs.every(inputPath)
      || new Set(p.inputs).size !== p.inputs.length
      || !Number.isSafeInteger(p.cpus) || p.cpus < 1 || p.cpus > 256
      || !Number.isSafeInteger(p.memoryMiB) || p.memoryMiB < 128 || p.memoryMiB > 1048576) throw new Error("Invalid acceptance profile");
    const inputs = [...p.inputs].sort();
    if (inputs.some((item, index) => inputs.slice(0, index).some((parent) => item.startsWith(parent + "/")))) throw new Error("Snapshot input roots must not overlap");
    return { name: p.name, label: p.label, coverage: p.coverage, argv: [...p.argv], inputs, cpus: p.cpus, memoryMiB: p.memoryMiB, permission: p.permission };
  });
}
/** Physical identity is checked afresh, not taken from browser grouping or a tool argument. */
export function acceptanceProject(cwd: string): AcceptanceProject {
  if (!path.isAbsolute(cwd)) throw new Error("Select an absolute existing project directory");
  const physical = realpathSync(cwd), stat = lstatSync(physical);
  if (!stat.isDirectory()) throw new Error("Project is not a directory");
  const repository = trustedGitRepository(physical);
  const anchor = repository?.common ?? physical;
  const identity = lstatSync(anchor);
  return { cwd: physical, identity: digest([repository ? "git" : "directory", anchor, identity.dev, identity.ino, repository?.key ?? null]) };
}
interface Settings { version: 1; projects: Record<string, AcceptanceProfile[]> }
function readSettings(): Settings {
  const file = path.join(acceptanceRoot(), "settings.json");
  if (!existsSync(file)) return { version: 1, projects: {} };
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink() || lstatSync(file).size > 1024 * 1024) throw new Error("Invalid acceptance settings file");
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (data.version !== 1 || !data.projects || typeof data.projects !== "object" || Array.isArray(data.projects)) throw new Error("Invalid acceptance settings");
  for (const [key, profiles] of Object.entries(data.projects)) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid acceptance project key");
    data.projects[key] = validateProfiles(profiles);
  }
  return data;
}
export function readProfiles(project: AcceptanceProject): AcceptanceProfile[] {
  return readSettings().projects[project.identity] ?? [];
}
/** Browser configuration only; never exposed by a model tool. */
export function saveProfiles(project: AcceptanceProject, raw: unknown): AcceptanceProfile[] {
  const profiles = validateProfiles(raw), root = acceptanceRoot();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, "settings.json");
  const release = lockfile.lockSync(file, { realpath: false, stale: 30000 });
  try {
    const settings = readSettings();
    settings.projects[project.identity] = profiles;
    const encoded = JSON.stringify(settings, null, 2);
    if (Buffer.byteLength(encoded) > 1024 * 1024) throw new Error("Acceptance settings byte budget reached; existing configuration retained");
    writePrivateFileAtomicSync(file, encoded);
  } finally { release(); }
  return profiles;
}
