import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, closeSync, openSync, unlinkSync, rmdirSync, fsyncSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { performance } from "node:perf_hooks";
import { MAX_SSH_FRAME, SshReader, describeSshPayload, payloadFingerprint, sshIdentity, sshString, verifyBrowserAssertion, type BrowserSshAssertion, type BrowserSshCredential, type SshIdentity } from "./browser-ssh-protocol";

export type BrowserSignAdmission = { userVerification: "required" | "discouraged"; unlock: boolean; epoch: number; grantId: string | null };
export type BrowserSshPolicy = {
  admit(token: string): BrowserSignAdmission;
  verify(token: string, identity: SshIdentity, data: Buffer, assertion: BrowserSshAssertion, admission: BrowserSignAdmission): Buffer;
  available(token: string): boolean;
  onClose(token: string): void;
  onTick(): void;
};
export type BrowserSshRequest = { id: string; challenge: string; description: string; fingerprint: string; expiresAt: number; userVerification?: "required" | "discouraged"; unlock?: boolean };
type Pending = { view: BrowserSshRequest; data: Buffer; deadline: number; admission: BrowserSignAdmission; settle: (signature: Buffer | null) => void };
type Bridge = {
  token: string; owner: string; identity: SshIdentity; proof: Buffer | null; expiresAt: number;
  directory?: string; socketPath?: string; server?: Server; clients: Set<Socket>; pending: Map<string, Pending>;
};
const FAILURE = Buffer.from([5]);

export function waitForAgentDrain(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    const settle = () => { socket.removeListener("drain", settle); socket.removeListener("close", settle); resolve(); };
    socket.once("drain", settle); socket.once("close", settle);
    if (socket.destroyed) settle();
  });
}

export class BrowserSshAgent {
  private stopped = false;
  private bridges = new Map<string, Bridge>();
  private bindings = new Map<string, { token: string; socketPath: string }>();
  private timer: ReturnType<typeof setInterval>;
  private now() { return (this.options.now ?? (() => performance.now()))(); }
  constructor(private readonly options: { leaseMs?: number; signMs?: number; markerRoot?: string; now?: () => number; policy?: BrowserSshPolicy } = {}) {
    this.timer = setInterval(() => { this.expire(); options.policy?.onTick(); }, Math.min(1000, options.leaseMs ?? 10_000));
    this.timer.unref();
  }
  private marker(sessionId: string): string {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(sessionId)) throw new Error("Invalid session id");
    return join(this.options.markerRoot ?? join(getAgentDir(), "browser-ssh-sessions"), sessionId);
  }
  create(owner: string, credential: BrowserSshCredential, origin: string) {
    if (this.stopped) throw new Error("Browser SSH agent is shutting down");
    if (process.platform === "win32") throw new Error("Browser SSH requires Unix sockets");
    this.expire();
    if (this.bridges.size >= 8) throw new Error("Too many browser SSH agents");
    const identity = sshIdentity(credential, origin);
    const token = randomBytes(32).toString("hex");
    const proof = randomBytes(32);
    this.bridges.set(token, { token, owner, identity, proof, expiresAt: this.now() + 65_000, clients: new Set(), pending: new Map() });
    return { token, challenge: proof.toString("base64url"), rpId: identity.rpId, publicKey: identity.publicKey };
  }
  private bridge(token: string, owner: string, origin: string): Bridge {
    const bridge = this.bridges.get(token);
    if (!bridge || bridge.owner !== owner || bridge.identity.origin !== origin || bridge.expiresAt <= this.now()) {
      if (bridge?.expiresAt && bridge.expiresAt <= this.now()) this.close(bridge);
      throw new Error("Browser SSH agent unavailable");
    }
    return bridge;
  }
  async activate(token: string, owner: string, origin: string, assertion: BrowserSshAssertion) {
    const bridge = this.bridge(token, owner, origin);
    if (!bridge.proof) throw new Error("Browser SSH agent already activated");
    const proof = bridge.proof;
    bridge.proof = null; // One attempt, including invalid assertions.
    try {
      verifyBrowserAssertion(bridge.identity, proof, assertion);
      bridge.directory = mkdtempSync(join(tmpdir(), "pws-"));
      chmodSync(bridge.directory, 0o700);
      bridge.socketPath = join(bridge.directory, "agent");
      if (Buffer.byteLength(bridge.socketPath) > 100) throw new Error("Temporary directory is too long for a Unix socket");
      const server = createServer((socket) => this.accept(bridge, socket));
      bridge.server = server;
      server.on("error", () => this.close(bridge));
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(bridge.socketPath!, () => { server.removeListener("error", reject); resolve(); });
      });
      if (this.bridges.get(token) !== bridge) throw new Error("Browser SSH agent closed during activation");
      chmodSync(bridge.socketPath, 0o600);
      bridge.expiresAt = this.now() + (this.options.leaseMs ?? 10_000);
      return this.snapshot(bridge);
    } catch (error) { this.close(bridge); throw error; }
  }
  poll(token: string, owner: string, origin: string) {
    const bridge = this.bridge(token, owner, origin);
    if (!bridge.socketPath || !bridge.server?.listening) throw new Error("Browser SSH agent is not active");
    bridge.expiresAt = this.now() + (this.options.leaseMs ?? 10_000);
    return this.snapshot(bridge);
  }
  peek(token: string, owner: string, origin: string) { return this.snapshot(this.bridge(token, owner, origin)); }
  request(token: string, owner: string, origin: string, id: string) {
    const pending = this.bridge(token, owner, origin).pending.get(id);
    if (!pending || pending.deadline <= this.now()) throw new Error("Signing request expired or already settled");
    return { ...pending.view, remainingMs: Math.max(0, pending.deadline - this.now()) };
  }
  authorizePending(token: string, owner: string, origin: string, admission: BrowserSignAdmission) {
    if (!this.options.policy || admission.userVerification !== "discouraged" || admission.unlock || !admission.grantId) throw new Error("Verified server grant required");
    const bridge = this.bridge(token, owner, origin);
    for (const pending of bridge.pending.values()) {
      if (pending.deadline <= this.now()) { pending.settle(null); continue; }
      if (pending.admission.unlock && pending.admission.epoch === admission.epoch) {
        pending.admission = Object.freeze({ ...admission });
        pending.view.userVerification = "discouraged"; pending.view.unlock = false;
      }
    }
  }
  cancelPending(token: string, owner: string, origin: string, predicate: (admission: BrowserSignAdmission) => boolean = () => true) {
    const bridge = this.bridge(token, owner, origin);
    for (const pending of bridge.pending.values()) if (predicate(pending.admission)) pending.settle(null);
  }
  private snapshot(bridge: Bridge) {
    return { socketPath: bridge.socketPath!, publicKey: bridge.identity.publicKey, requests: [...bridge.pending.values()].map((pending) => ({ ...pending.view, remainingMs: Math.max(0, pending.deadline - this.now()) })), sessions: [...this.bindings].filter(([, binding]) => binding.token === bridge.token).map(([id]) => id) };
  }
  respond(token: string, owner: string, origin: string, requestId: string, assertion?: BrowserSshAssertion) {
    const bridge = this.bridge(token, owner, origin);
    const pending = bridge.pending.get(requestId);
    if (!pending || pending.deadline <= this.now()) throw new Error("Signing request expired or already settled");
    try {
      const signature = assertion ? this.options.policy
        ? this.options.policy.verify(token, bridge.identity, pending.data, assertion, pending.admission)
        : verifyBrowserAssertion(bridge.identity, pending.data, assertion) : null;
      pending.settle(signature);
    } catch (error) { pending.settle(null); throw error; }
  }
  bind(token: string, owner: string, origin: string, sessionId: string) {
    const bridge = this.bridge(token, owner, origin);
    if (!bridge.socketPath || !bridge.server?.listening) throw new Error("Browser SSH agent is not active");
    const existing = this.bindings.get(sessionId);
    if (existing && existing.token !== token) throw new Error("Session already belongs to another browser SSH agent");
    if (!existing && this.bindings.size >= 128) throw new Error("Too many browser SSH session bindings");
    const marker = this.marker(sessionId);
    mkdirSync(join(marker, ".."), { recursive: true, mode: 0o700 });
    try {
      const fd = openSync(marker, "wx", 0o600);
      try { fsyncSync(fd); } finally { closeSync(fd); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    if (!this.isBound(sessionId)) throw new Error("Session binding marker unavailable");
    this.bindings.set(sessionId, { token, socketPath: bridge.socketPath });
  }
  unbind(sessionId: string, owner?: string, token?: string) {
    const binding = this.bindings.get(sessionId);
    const bridge = binding && this.bridges.get(binding.token);
    if (bridge && (bridge.owner !== owner || binding!.token !== token)) throw new Error("Session binding belongs to another browser SSH agent");
    const marker = this.marker(sessionId);
    // Explicitly clearing a binding is the only operation that restores fallback.
    try { unlinkSync(marker); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.bindings.delete(sessionId);
  }
  isBound(sessionId: string): boolean {
    try {
      if (!lstatSync(this.marker(sessionId)).isFile()) throw new Error("Unsafe browser SSH binding marker");
      return true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }
  environment(sessionId: string): Record<string, string> {
    // In-memory ownership also prevents an externally removed marker from
    // silently falling back while this process still knows about the binding.
    if (!this.bindings.has(sessionId) && !this.isBound(sessionId)) return {};
    const binding = this.bindings.get(sessionId);
    const bridge = binding && this.bridges.get(binding.token);
    if (!bridge || bridge.expiresAt <= this.now() || !bridge.server?.listening) throw new Error("Browser SSH agent disconnected. Reconnect and bind this session, or explicitly clear its browser SSH binding.");
    return { SSH_AUTH_SOCK: bridge.socketPath! };
  }
  disconnect(token: string, owner: string, origin: string) { this.close(this.bridge(token, owner, origin)); }
  private expire() { for (const bridge of this.bridges.values()) if (bridge.expiresAt <= this.now()) this.close(bridge); }
  private close(bridge: Bridge) {
    if (this.bridges.get(bridge.token) !== bridge) return;
    this.bridges.delete(bridge.token);
    for (const pending of bridge.pending.values()) pending.settle(null);
    for (const socket of bridge.clients) socket.destroy();
    // Node's server owns the socket unlink. Remove only our empty mkdtemp directory.
    const remove = () => { if (bridge.directory) { try { rmdirSync(bridge.directory); } catch { /* No recursive cleanup of unexpected contents. */ } } };
    if (bridge.server?.listening) bridge.server.close(remove); else remove();
    // Retain durable binding markers so losing a browser never falls back to a host key.
    for (const [id, binding] of this.bindings) if (binding.token === bridge.token) this.bindings.delete(id);
    this.options.policy?.onClose(bridge.token);
  }
  dispose() { this.stopped = true; clearInterval(this.timer); for (const bridge of this.bridges.values()) this.close(bridge); }
  private accept(bridge: Bridge, socket: Socket) {
    if (!bridge.server?.listening || bridge.clients.size >= 8) { socket.destroy(); return; }
    bridge.clients.add(socket);
    socket.setTimeout((this.options.signMs ?? 60_000) + 5000, () => socket.destroy());
    socket.on("error", () => socket.destroy());
    let buffer = Buffer.alloc(0), busy = false;
    const owned = new Set<() => void>();
    socket.on("close", () => { bridge.clients.delete(socket); for (const cancel of owned) cancel(); });
    const pump = async () => {
      if (busy) return;
      busy = true;
      try {
        while (!socket.destroyed && buffer.length >= 4) {
          const length = buffer.readUInt32BE();
          if (!length || length > MAX_SSH_FRAME) { socket.destroy(); break; }
          if (buffer.length < length + 4) break;
          const frame = buffer.subarray(4, 4 + length); buffer = buffer.subarray(4 + length);
          const response = await this.message(bridge, frame, owned);
          if (!socket.destroyed && !socket.write(sshString(response))) await waitForAgentDrain(socket);
        }
      } finally { busy = false; }
    };
    socket.on("data", (chunk) => {
      if (buffer.length + chunk.length > MAX_SSH_FRAME + 4) { socket.destroy(); return; }
      buffer = Buffer.concat([buffer, chunk]); void pump();
    });
  }
  private async message(bridge: Bridge, frame: Buffer, owned: Set<() => void>): Promise<Buffer> {
    try {
      const reader = new SshReader(frame);
      const type = reader.byte();
      if (type === 11) {
        reader.end();
        if (this.options.policy && !this.options.policy.available(bridge.token)) return Buffer.from([12, 0, 0, 0, 0]);
        return Buffer.concat([Buffer.from([12, 0, 0, 0, 1]), sshString(bridge.identity.blob), sshString("brabbler browser FIDO")]);
      }
      if (type !== 13) return FAILURE; // Never acknowledge session-bind/forwarding constraints.
      if (!reader.string().equals(bridge.identity.blob)) return FAILURE;
      const data = reader.string();
      if (reader.uint32() !== 0) return FAILURE;
      reader.end();
      const description = describeSshPayload(data, bridge.identity);
      if (bridge.pending.size >= 4 || this.bridges.get(bridge.token) !== bridge) return FAILURE;
      const admission = Object.freeze(this.options.policy?.admit(bridge.token) ?? { userVerification: "required" as const, unlock: false, epoch: 0, grantId: null });
      const signature = await new Promise<Buffer | null>((resolve) => {
        const id = randomUUID();
        const cancel = () => settle(null);
        const settle = (result: Buffer | null) => {
          clearTimeout(timer); bridge.pending.delete(id); owned.delete(cancel); resolve(result);
        };
        const timer = setTimeout(cancel, this.options.signMs ?? 60_000); timer.unref();
        owned.add(cancel);
        bridge.pending.set(id, { data, settle, admission, deadline: this.now() + (this.options.signMs ?? 60_000), view: { id, challenge: data.toString("base64url"), description, fingerprint: payloadFingerprint(data), expiresAt: Date.now() + (this.options.signMs ?? 60_000), userVerification: admission.userVerification, unlock: admission.unlock } });
      });
      return signature ? Buffer.concat([Buffer.from([14]), sshString(signature)]) : FAILURE;
    } catch { return FAILURE; }
  }
}

const globalKey = Symbol.for("brabbler:browser-ssh-agent");
export function browserSshAgent(): BrowserSshAgent {
  const registry = globalThis as typeof globalThis & { [globalKey]?: BrowserSshAgent };
  if (!registry[globalKey]) {
    const agent = new BrowserSshAgent();
    registry[globalKey] = agent;
    const shutdown = () => agent.dispose();
    process.once("exit", shutdown);
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    // Add cleanup only; never replace launcher/RPC/PTY signal handling.
  }
  return registry[globalKey];
}
