import type { BrowserSshCredential, BrowserSshAssertion } from "./browser-ssh-protocol";
import type { BrowserSshRegistration } from "./browser-ssh-enrollment";

export type SshBackend = { type: "none" | "browser" | "inherited" } | { type: "socket"; path: string; label: string };
export type SshKeyPolicy = "strict" | "session";
export type SshKeyView = { id: string; name: string; origin: string; credential: BrowserSshCredential; policy: SshKeyPolicy; publicKey: string; fingerprint: string; protection: 1 | 2 | 3 | null; discoverability: "resident" | "non-resident" | "unknown"; applicationOnly: boolean };
export type SshConnectionView = { id: string; keyId: string; device: string; origin: string; role: "active" | "standby"; state: "proving" | "strict" | "locked" | "unlocked"; remainingMs: number; pendingCount: number };
export type SshRuntimeView = { runtimeId: string; socketPath: string; inheritedSocket: string | null; revision: string; setupNeeded: boolean; selected: SshBackend; custom: { path: string; label: string }[]; settingsError: string | null; endpointPresent: boolean };
export type SshAgentStatus = { supported: boolean; runtime: SshRuntimeView; registry: { revision: string | null; keys: SshKeyView[]; error?: string }; connections: SshConnectionView[]; activeId: string | null; pendingCount: number; error?: string };
export type SshCandidate = { label: string; path: string; source: "inherited" | "known" | "custom"; dynamic?: boolean; available: boolean; fingerprints: string[]; identityCount?: number; error?: string };
export type SshConnectionProof = { token: string; id: string; challenge: string; rpId: string; credential: BrowserSshCredential };
export type SshSigningRequest = { id: string; challenge: string; description: string; fingerprint: string; expiresAt: number; remainingMs: number; userVerification: "required" | "discouraged"; unlock: boolean; previousSigner: boolean };
export type SshPoll = { status: SshAgentStatus; connection: SshConnectionView; requests: SshSigningRequest[] };
export type SshEnrollmentProof = { token: string; challenge: string; rpId: string; credential: BrowserSshCredential };
export type SshEnrollmentBegin = { token: string; challenge: string; rpId: string; policy: SshKeyPolicy };
export type SshWireRegistration = BrowserSshRegistration;
export type SshWireAssertion = BrowserSshAssertion;
