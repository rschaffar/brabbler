export interface AcceptanceProfile {
  name: string;
  label: string;
  coverage: "full" | "focused";
  argv: string[];
  inputs: string[];
  cpus: number;
  memoryMiB: number;
  permission: "ask" | "allow" | "deny";
}
export interface AcceptanceProject {
  identity: string;
  cwd: string;
}
export interface AcceptanceSnapshot {
  digest: string;
  files: number;
  bytes: number;
  directory: string;
}
export type AcceptanceState = "queued" | "running" | "cancelling" | "passed" | "failed" | "cancelled" | "outcome-unknown" | "reconciled";
export interface AcceptanceRun {
  version: 1;
  id: string;
  project: string;
  cwd: string;
  owner: string;
  observers: string[];
  requests: Array<{ caller: string; key: string; profile: string; cwd: string }>;
  profile: AcceptanceProfile;
  profileDigest: string;
  environment: { version: 1; PATH: string; LANG: string; NODE_ENV: "test" };
  key: string;
  snapshot: AcceptanceSnapshot;
  state: AcceptanceState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  queueMs?: number;
  executionMs?: number;
  captureMs: number;
  settled: boolean;
  exitCode?: number | null;
  error?: string;
  logPath: string;
  runtimeDirectory: string;
}
export interface AcceptanceView {
  project: AcceptanceProject;
  enabled: boolean;
  profiles: AcceptanceProfile[];
  profileDigests: Record<string, string>;
  runs: AcceptanceRun[];
  blocked?: string;
  activeRunId?: string;
}
export const acceptanceTerminal = (state: AcceptanceState) => !["queued", "running", "cancelling"].includes(state);
export const nixAcceptanceProfile: AcceptanceProfile = {
  name: "full", label: "Complete Nix acceptance", coverage: "full",
  argv: ["nix", "run", "--no-write-lock-file", ".#test", "--", "all", "--workers", "4", "--jobs", "4"],
  inputs: ["package.json", "package-lock.json", "flake.nix", "flake.lock", "tsconfig.json", "next.config.ts", "tailwind.config.ts", "eslint.config.mjs", "postcss.config.mjs", "instrumentation.ts", "instrumentation-node.ts", "proxy.ts", "LICENSE", "AGENTS.md", "CONTEXT.md", "README.md", ".gitignore", ".github", ".agents/skills/writing-plans", "app", "components", "hooks", "lib", "plugins", "public", "bin", "e2e", "nix", "docs"],
  cpus: 16, memoryMiB: 27648, permission: "ask",
};
