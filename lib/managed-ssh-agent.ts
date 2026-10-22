import { createHash, randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { BrowserSshAgent, type BrowserSignAdmission } from "./browser-ssh-agent";
import { sshIdentity, verifyBrowserAssertion, webAuthnOrigin, type BrowserSshAssertion, type BrowserSshCredential, type SshIdentity } from "./browser-ssh-protocol";
import { verifyBrowserRegistration, type BrowserSshRegistration } from "./browser-ssh-enrollment";
import { SshKeyRegistry, type SshKeyRecord } from "./ssh-key-registry";
import { sshRuntimeRequest } from "../bin/ssh-agent-client";
import type { SshAgentStatus, SshConnectionView, SshKeyPolicy, SshRuntimeView } from "./ssh-agent-types";

export const SSH_UNLOCK_MS = 30 * 60 * 1000;
type Runtime = SshRuntimeView & { browserSocket: string | null; browserEpoch: string | null };
type Grant = { id: string; deadline: number };
type Connection = { id: string; token: string; owner: string; origin: string; key: SshKeyRecord; device: string; connected: boolean; makeActive: boolean; wantUnlock: boolean; epoch: number; grant: Grant | null; socketPath?: string; unlockProof?: { challenge: Buffer; epoch: number; deadline: number; requestId?: string } };
type Candidate = Omit<SshKeyRecord, "id" | "createdAt">;
type Enrollment = { owner: string; origin: string; name: string; policy: SshKeyPolicy; applicationOnly: boolean; revision: string; deadline: number; challenge: Buffer; candidate?: Candidate; stage: "registration" | "proof" };
type Rpc = (body: Record<string, unknown>) => Promise<unknown>;
function text(value: unknown, what: string): string {
  if (typeof value !== "string" || !/^[^\x00-\x1f\x7f]{1,80}$/.test(value)) throw new Error(`Invalid ${what}`);
  return value;
}
function capability(value: unknown): string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Connection capability required"); return value; }

/** Server-only authority. Public registry metadata never restores connections/grants. */
export class ManagedSshAgent {
  private readonly registry: SshKeyRegistry;
  private readonly engine: BrowserSshAgent;
  private readonly now: () => number;
  private readonly rpc: Rpc;
  private readonly ready: Promise<void>;
  private publisher = "";
  private publisherEpoch = "";
  private lostPublisher = false;
  private changingRole = false;
  private roleGeneration = 0;
  private connections = new Map<string, Connection>();
  private enrollments = new Map<string, Enrollment>();
  private activeId: string | null = null;
  private stopped = false;
  private mutation: Promise<unknown> = Promise.resolve();
  private publication: Promise<unknown> = Promise.resolve();
  private warning?: string;
  private selectedType: SshRuntimeView["selected"]["type"] = "none";

  constructor(options: { registry?: SshKeyRegistry; rpc?: Rpc; now?: () => number; leaseMs?: number; signMs?: number } = {}) {
    this.registry = options.registry ?? new SshKeyRegistry();
    this.now = options.now ?? (() => performance.now());
    this.rpc = options.rpc ?? (body => sshRuntimeRequest(body));
    this.engine = new BrowserSshAgent({ now: this.now, leaseMs: options.leaseMs, signMs: options.signMs, policy: {
      admit: token => this.admit(token), verify: (token, identity, data, assertion, admission) => this.verify(token, identity, data, assertion, admission),
      available: token => { try { const c = this.live(token); return c.connected && c.id === this.activeId; } catch { return false; } },
      onClose: token => this.closed(token), onTick: () => this.sweep(),
    } });
    this.ready = this.rpc({ action: "claim-browser" }).then(value => {
      const claim = value as { publisher: string; epoch: string };
      if (!claim.publisher || !claim.epoch) throw new Error("SSH broker protocol changed; restart the supported launcher");
      this.publisher = claim.publisher; this.publisherEpoch = claim.epoch;
    });
    void this.ready.catch(() => {});
  }
  private live(token: string): Connection {
    const c = this.connections.get(token);
    if (!c || this.stopped) throw new Error("Browser connection unavailable");
    const key = this.registry.get(c.key.id);
    if (!key || key.origin !== c.origin || key.credential.id !== c.key.credential.id || key.credential.spki !== c.key.credential.spki || key.policy !== c.key.policy) throw new Error("Registered key changed or was removed");
    return c;
  }
  private owned(token: unknown, owner: string, origin: string): Connection {
    const c = this.live(capability(token));
    if (c.owner !== owner || c.origin !== origin) throw new Error("Connection belongs to another browser");
    return c;
  }
  private byId(id: unknown, origin: string): Connection {
    const c = [...this.connections.values()].find(item => item.id === id && item.origin === origin);
    if (!c) throw new Error("Browser connection unavailable"); return this.live(c.token);
  }
  private key(id: unknown, origin: string): SshKeyRecord {
    if (typeof id !== "string") throw new Error("Registered key required");
    const key = this.registry.get(id);
    if (!key || key.origin !== origin) throw new Error("Key is unavailable for this exact origin"); return key;
  }
  private grant(c: Connection): boolean {
    const created = !c.grant || c.grant.deadline <= this.now();
    if (created) c.grant = { id: randomUUID(), deadline: this.now() + SSH_UNLOCK_MS };
    this.engine.authorizePending(c.token, c.owner, c.origin, { userVerification: "discouraged", unlock: false, epoch: c.epoch, grantId: c.grant!.id });
    return created;
  }
  private publisherLost() {
    if (this.lostPublisher) return;
    this.lostPublisher = true; this.roleGeneration++; this.activeId = null; this.enrollments.clear();
    this.warning = "Browser controller replaced; reload and reconnect explicitly";
    for (const c of [...this.connections.values()]) { try { this.revoke(c); } catch { /* Already expired. */ } }
  }
  private async ensurePublisher() {
    const runtime = await this.rpc({ action: "status" }) as Runtime; this.selectedType = runtime.selected.type;
    if (runtime.browserEpoch !== this.publisherEpoch) this.publisherLost();
    if (this.lostPublisher) throw new Error("Browser controller replaced; reload and reconnect explicitly");
  }
  private request(c: Connection, id: unknown) {
    if (typeof id !== "string") throw new Error("Signing request required");
    const request = this.engine.request(c.token, c.owner, c.origin, id);
    return { ...request, userVerification: request.userVerification ?? "required", unlock: request.unlock ?? false, previousSigner: c.id !== this.activeId || this.selectedType !== "browser" };
  }
  private sweep() {
    for (const [token, enrollment] of this.enrollments) if (enrollment.deadline <= this.now()) this.enrollments.delete(token);
    for (const c of [...this.connections.values()]) {
      try { this.live(c.token); } catch { try { this.revoke(c); } catch { /* Expiry already removed it. */ } continue; }
      if (c.grant && c.grant.deadline <= this.now()) {
        const old = c.grant.id; c.grant = null;
        try { this.engine.cancelPending(c.token, c.owner, c.origin, admission => admission.grantId === old); } catch { /* Connection expiry owns teardown. */ }
      }
    }
  }
  private admit(token: string): BrowserSignAdmission {
    this.sweep(); const c = this.live(token);
    if (!c.connected || c.id !== this.activeId) throw new Error("This browser is standby");
    const unlocked = c.key.policy === "session" && c.grant && c.grant.deadline > this.now();
    return { userVerification: unlocked ? "discouraged" : "required", unlock: c.key.policy === "session" && !unlocked, epoch: c.epoch, grantId: unlocked ? c.grant!.id : null };
  }
  private verify(token: string, identity: SshIdentity, data: Buffer, assertion: BrowserSshAssertion, admission: BrowserSignAdmission): Buffer {
    const c = this.live(token);
    if (c.epoch !== admission.epoch) throw new Error("Signing authorization revoked");
    if (admission.unlock) throw new Error("Unlock with a fresh server challenge before approving this request");
    if (admission.userVerification === "discouraged" && (!c.grant || c.grant.id !== admission.grantId || c.grant.deadline <= this.now())) throw new Error("Signing unlock expired");
    const signature = verifyBrowserAssertion(identity, data, assertion, { requireUV: admission.userVerification !== "discouraged" });
    return signature;
  }
  private closed(token: string) {
    const c = this.connections.get(token); if (!c) return;
    c.epoch++; c.grant = null; c.unlockProof = undefined; this.connections.delete(token);
    if (this.activeId === c.id) {
      this.activeId = null; this.roleGeneration++;
      if (!this.stopped && !this.lostPublisher) void this.publish(null).catch(() => { this.warning = "Browser publication unavailable; no fallback agent selected"; });
    }
  }
  private publish(path: string | null): Promise<unknown> {
    const work = async () => { await this.ready; return this.rpc({ action: "publish-browser", publisher: this.publisher, path }); };
    const next = this.publication.catch(() => {}).then(work); this.publication = next; return next;
  }
  private async select(c: Connection) {
    if (!c.connected || !c.socketPath) throw new Error("Prove possession before activating this browser");
    const previous = this.activeId; this.activeId = c.id; this.roleGeneration++; this.changingRole = true;
    try { await this.publish(c.socketPath); this.live(c.token); this.activeId = c.id; this.warning = undefined; }
    catch (error) {
      // Reconcile a possibly applied control write, never replay the mutation.
      try {
        const runtime = await this.rpc({ action: "status" }) as Runtime;
        const actual = [...this.connections.values()].find(item => item.socketPath === runtime.browserSocket && item.connected);
        this.activeId = actual?.id ?? null;
      } catch { this.activeId = null; }
      this.warning = "Activation acknowledgement uncertain; refresh before another change";
      if (previous !== this.activeId) this.sweep();
      throw error;
    } finally { this.changingRole = false; }
  }
  private view(c: Connection): SshConnectionView {
    const remainingMs = c.grant ? Math.max(0, c.grant.deadline - this.now()) : 0;
    let pendingCount = 0;
    try { pendingCount = this.engine.peek(c.token, c.owner, c.origin).requests.length; } catch { /* Missing lease is disconnected, never renewed by observers. */ }
    return { id: c.id, keyId: c.key.id, device: c.device, origin: c.origin, role: c.id === this.activeId ? "active" : "standby", state: !c.connected ? "proving" : c.key.policy === "strict" ? "strict" : remainingMs ? "unlocked" : "locked", remainingMs, pendingCount };
  }
  async status(): Promise<SshAgentStatus> {
    await this.ready; this.sweep();
    const generation = this.roleGeneration, reconcile = !this.changingRole;
    const runtime = await this.rpc({ action: "status" }) as Runtime;
    const { browserSocket: _privateSocket, browserEpoch: _privateEpoch, ...publicRuntime } = runtime;
    void _privateSocket; void _privateEpoch;
    this.selectedType = runtime.selected.type;
    if (runtime.browserEpoch !== this.publisherEpoch) {
      this.publisherLost();
    } else if (reconcile && !this.changingRole && generation === this.roleGeneration) {
      const active = [...this.connections.values()].find(c => c.socketPath === runtime.browserSocket && c.connected);
      this.activeId = active?.id ?? null;
    }
    let registry: SshAgentStatus["registry"];
    try {
      const snapshot = this.registry.snapshot();
      registry = { revision: snapshot.revision, keys: snapshot.keys.map(key => {
        const identity = sshIdentity(key.credential, key.origin);
        return { id: key.id, name: key.name, origin: key.origin, credential: key.credential, policy: key.policy, publicKey: identity.publicKey, fingerprint: "SHA256:" + createHash("sha256").update(identity.blob).digest("base64").replace(/=+$/, ""), protection: key.protection, discoverability: key.discoverability, applicationOnly: key.applicationOnly };
      }) };
    } catch { registry = { revision: null, keys: [], error: "SSH public registry unavailable; existing records were not replaced" }; }
    const connections = [...this.connections.values()].map(c => this.view(c)).filter(c => [...this.connections.values()].some(live => live.id === c.id));
    return { supported: true, runtime: publicRuntime, registry, connections, activeId: this.activeId, pendingCount: connections.reduce((n, c) => n + c.pendingCount, 0), ...(this.warning ? { error: this.warning } : {}) };
  }
  private enrollment(token: unknown, owner: string, origin: string, stage: Enrollment["stage"]): [string, Enrollment] {
    const id = capability(token), pending = this.enrollments.get(id);
    if (!pending || pending.owner !== owner || pending.origin !== origin || pending.stage !== stage || pending.deadline <= this.now()) throw new Error("Enrollment expired or belongs to another browser");
    return [id, pending];
  }
  private beginEnrollment(body: Record<string, unknown>, owner: string, origin: string, importing: boolean) {
    this.sweep(); if (this.enrollments.size >= 8) throw new Error("Too many pending enrollments");
    const snapshot = this.registry.snapshot();
    if (body.revision !== undefined && body.revision !== snapshot.revision) throw new Error("SSH registry changed; refresh before enrollment");
    const policy = importing ? "strict" : body.policy ?? "strict";
    if (policy !== "strict" && policy !== "session") throw new Error("Choose a verification policy");
    const token = randomBytes(32).toString("hex"), challenge = randomBytes(32);
    const pending: Enrollment = { owner, origin, name: text(body.name, "key name"), policy, applicationOnly: body.applicationOnly === true, revision: snapshot.revision, deadline: this.now() + 65_000, challenge, stage: importing ? "proof" : "registration" };
    if (importing) {
      if (!pending.applicationOnly) throw new Error("Legacy protection is unknown; explicitly acknowledge application-only enforcement");
      const identity = sshIdentity(body.credential as BrowserSshCredential, origin);
      const existing = snapshot.keys.find(key => key.origin === origin && key.credential.id === identity.credential.id);
      if (body.existingKeyId !== undefined && existing?.id !== body.existingKeyId) throw new Error("Registered recovery key changed or was removed");
      if (existing && existing.credential.spki !== identity.credential.spki) throw new Error("Credential is registered with a different public key");
      // An uncertain acknowledgement may leave an already-registered session key
      // staged locally. Fresh proof can acknowledge that immutable server record;
      // local metadata must neither restore its policy nor downgrade/duplicate it.
      pending.policy = existing?.policy ?? "strict";
      pending.candidate = existing ? { name: existing.name, origin, credential: existing.credential, policy: existing.policy, protection: existing.protection, discoverability: existing.discoverability, applicationOnly: existing.applicationOnly } : { name: pending.name, origin, credential: identity.credential, policy: "strict", protection: null, discoverability: "unknown", applicationOnly: true };
    }
    this.enrollments.set(token, pending);
    return { token, challenge: challenge.toString("base64url"), rpId: webAuthnOrigin(origin).rpId, policy: pending.policy, ...(pending.candidate ? { credential: pending.candidate.credential } : {}) };
  }
  private prepareEnrollment(body: Record<string, unknown>, owner: string, origin: string) {
    const [token, pending] = this.enrollment(body.token, owner, origin, "registration");
    this.enrollments.delete(token); // Invalid/unsupported creation results consume this attempt.
    const result = verifyBrowserRegistration(body.registration as BrowserSshRegistration, { challenge: pending.challenge, origin });
    if (pending.policy === "session" && result.protection === 3) throw new Error("Credential reports verification required; enroll a touch-compatible credential or choose strict mode");
    const expected = pending.policy === "strict" ? result.protection === 3 : result.protection === 1 || result.protection === 2;
    if (!expected && !pending.applicationOnly) throw new Error("Requested credential protection was not reported; explicitly choose application-only enforcement or use a supported combination");
    pending.candidate = { name: pending.name, origin, credential: result.credential, policy: pending.policy, protection: result.protection, discoverability: result.discoverability, applicationOnly: !expected || pending.applicationOnly };
    pending.stage = "proof"; pending.challenge = randomBytes(32); pending.deadline = this.now() + 65_000;
    this.enrollments.set(token, pending);
    return { token, challenge: pending.challenge.toString("base64url"), credential: result.credential, rpId: webAuthnOrigin(origin).rpId };
  }
  private finishEnrollment(body: Record<string, unknown>, owner: string, origin: string) {
    const [token, pending] = this.enrollment(body.token, owner, origin, "proof"); this.enrollments.delete(token);
    const candidate = pending.candidate!;
    verifyBrowserAssertion(sshIdentity(candidate.credential, origin), pending.challenge, body.assertion as BrowserSshAssertion);
    return this.registry.add(candidate, pending.revision);
  }
  private beginConnect(body: Record<string, unknown>, owner: string, origin: string) {
    const key = this.key(body.keyId, origin), device = text(body.device, "device name");
    const created = this.engine.create(owner, key.credential, origin);
    const c: Connection = { id: randomUUID(), token: created.token, owner, origin, key, device, connected: false, makeActive: body.makeActive === true, wantUnlock: body.unlock === true, epoch: 0, grant: null };
    this.connections.set(c.token, c);
    return { id: c.id, token: c.token, challenge: created.challenge, rpId: created.rpId, credential: key.credential };
  }
  private lock(c: Connection) {
    c.epoch++; c.grant = null; c.unlockProof = undefined;
    this.engine.cancelPending(c.token, c.owner, c.origin);
  }
  private revoke(c: Connection) { this.engine.disconnect(c.token, c.owner, c.origin); }
  async dispatch(body: Record<string, unknown>, owner: string, origin: string): Promise<unknown> {
    if (this.stopped) throw new Error("SSH controller is shutting down");
    await this.ready;
    const action = body.action;
    if (!["status", "discover", "use", "custom", "rename", "remove", "probe"].includes(String(action))) await this.ensurePublisher();
    if (this.lostPublisher && !["status", "discover", "use", "custom", "rename", "remove", "probe"].includes(String(action))) throw new Error("Browser controller replaced; reload and reconnect explicitly");
    if (action === "status") return this.status();
    if (action === "discover") return this.rpc({ action: "discover" });
    if (action === "probe") return this.rpc({ action: "probe" });
    if (action === "poll") {
      const c = this.owned(body.token, owner, origin); this.engine.poll(c.token, owner, origin); this.sweep();
      const state = await this.status();
      const current = this.owned(body.token, owner, origin);
      const snapshot = this.engine.peek(c.token, owner, origin);
      return { status: state, connection: this.view(current), requests: snapshot.requests.map(request => ({ ...request, userVerification: request.userVerification ?? "required", unlock: request.unlock ?? false, previousSigner: c.id !== this.activeId || state.runtime.selected.type !== "browser" })) };
    }
    if (action === "respond") {
      const c = this.owned(body.token, owner, origin);
      if (typeof body.requestId !== "string") throw new Error("Signing request required");
      this.engine.respond(c.token, owner, origin, body.requestId, body.assertion as BrowserSshAssertion | undefined); return { success: true };
    }
    const work = () => this.mutate(body, owner, origin);
    const result = this.mutation.catch(() => {}).then(work); this.mutation = result; return result;
  }
  private async mutate(body: Record<string, unknown>, owner: string, origin: string): Promise<unknown> {
    if (this.stopped) throw new Error("SSH controller is shutting down");
    if (!["use", "custom", "rename", "remove"].includes(String(body.action))) await this.ensurePublisher();
    switch (body.action) {
      case "use": case "custom":
        await this.rpc({ action: body.action, revision: body.revision, backend: body.backend, path: body.path, label: body.label }); return this.status();
      case "begin-enroll": return this.beginEnrollment(body, owner, origin, false);
      case "begin-import": return this.beginEnrollment(body, owner, origin, true);
      case "prepare-enroll": return this.prepareEnrollment(body, owner, origin);
      case "finish-enroll": return this.finishEnrollment(body, owner, origin);
      case "cancel-enroll": { const token = capability(body.token); const pending = this.enrollments.get(token); if (pending && pending.owner === owner && pending.origin === origin) this.enrollments.delete(token); return { success: true }; }
      case "connect": return this.beginConnect(body, owner, origin);
      case "activate": {
        const c = this.owned(body.token, owner, origin);
        const active = await this.engine.activate(c.token, owner, origin, body.assertion as BrowserSshAssertion);
        this.live(c.token); c.connected = true; c.socketPath = active.socketPath;
        if (c.wantUnlock && c.key.policy === "session") this.grant(c);
        if (c.makeActive) await this.select(c);
        return { status: await this.status(), connection: this.view(c) };
      }
      case "select": { const c = this.owned(body.token, owner, origin); await this.select(c); return this.status(); }
      case "disconnect": { const c = this.owned(body.token, owner, origin); this.revoke(c); await this.publication.catch(() => {}); return this.status(); }
      case "revoke": { this.revoke(this.byId(body.connectionId, origin)); await this.publication.catch(() => {}); return this.status(); }
      case "lock": { this.lock(this.byId(body.connectionId, origin)); return this.status(); }
      case "begin-request-unlock": {
        const c = this.owned(body.token, owner, origin);
        if (!c.connected || c.key.policy !== "session") throw new Error("Session-unlock connection required");
        const request = this.request(c, body.requestId);
        if (c.grant && c.grant.deadline > this.now()) {
          this.grant(c); return { alreadyUnlocked: true, status: await this.status(), request: this.request(c, request.id) };
        }
        c.unlockProof = { challenge: randomBytes(32), epoch: c.epoch, deadline: this.now() + Math.min(65_000, request.remainingMs), requestId: request.id };
        return { alreadyUnlocked: false, requestId: request.id, challenge: c.unlockProof.challenge.toString("base64url"), rpId: webAuthnOrigin(origin).rpId, credential: c.key.credential };
      }
      case "finish-request-unlock": {
        const c = this.owned(body.token, owner, origin), proof = c.unlockProof; c.unlockProof = undefined;
        if (!proof || proof.requestId !== body.requestId || proof.deadline <= this.now() || proof.epoch !== c.epoch) throw new Error("Request unlock expired or revoked");
        this.request(c, body.requestId);
        verifyBrowserAssertion(sshIdentity(c.key.credential, origin), proof.challenge, body.assertion as BrowserSshAssertion);
        this.live(c.token); this.request(c, body.requestId);
        if (proof.deadline <= this.now() || proof.epoch !== c.epoch) throw new Error("Request unlock expired or revoked");
        const newGrant = this.grant(c);
        return { status: await this.status(), request: this.request(c, body.requestId), newGrant };
      }
      case "begin-unlock": {
        const c = this.owned(body.token, owner, origin); if (!c.connected || c.key.policy !== "session") throw new Error("Session-unlock connection required");
        c.unlockProof = { challenge: randomBytes(32), epoch: c.epoch, deadline: this.now() + 65_000 };
        return { challenge: c.unlockProof.challenge.toString("base64url"), rpId: webAuthnOrigin(origin).rpId, credential: c.key.credential };
      }
      case "finish-unlock": {
        const c = this.owned(body.token, owner, origin), proof = c.unlockProof; c.unlockProof = undefined;
        if (!proof || proof.requestId !== undefined || proof.deadline <= this.now() || proof.epoch !== c.epoch) throw new Error("Unlock expired or revoked");
        verifyBrowserAssertion(sshIdentity(c.key.credential, origin), proof.challenge, body.assertion as BrowserSshAssertion);
        this.live(c.token); if (proof.deadline <= this.now() || proof.epoch !== c.epoch) throw new Error("Unlock expired or revoked");
        this.grant(c); return this.status();
      }
      case "rename": { const key = this.key(body.keyId, origin); this.registry.rename(key.id, text(body.name, "key name"), body.revision as string); return this.status(); }
      case "remove": {
        const key = this.key(body.keyId, origin); this.registry.remove(key.id, body.revision as string);
        for (const c of [...this.connections.values()]) if (c.key.id === key.id) this.revoke(c);
        await this.publication.catch(() => {}); return this.status();
      }
      default: throw new Error("Unknown SSH management action");
    }
  }
  async dispose() {
    if (this.stopped) return; this.stopped = true; this.enrollments.clear();
    this.engine.dispose(); this.connections.clear(); this.activeId = null;
    try { await this.publish(null); } catch { /* A newer worker must not be cleared. */ }
  }
}
const globalKey = Symbol.for("pi-desk:managed-ssh-agent");
export function managedSshAgent(): ManagedSshAgent {
  const global = globalThis as typeof globalThis & { [globalKey]?: ManagedSshAgent };
  if (!global[globalKey]) {
    const agent = new ManagedSshAgent(); global[globalKey] = agent;
    const stop = () => { void agent.dispose(); };
    process.once("exit", stop); process.once("SIGINT", stop); process.once("SIGTERM", stop);
  }
  return global[globalKey];
}
