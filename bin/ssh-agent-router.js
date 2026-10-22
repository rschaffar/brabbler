"use strict";
/* CommonJS is required by the unbundled launcher and shared with Next. */
/* eslint-disable @typescript-eslint/no-require-imports */

// Launcher-owned runtime. No import-time side effects, SDK, private keys or PINs.
const net = require("node:net");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomBytes, randomUUID, createHash, timingSafeEqual } = require("node:crypto");
const { execFile } = require("node:child_process");
const { claimSshSettingsLease } = require("./ssh-agent-lease");

const MAX_FRAME = 256 * 1024;
const MARKER = "pi-desk-runtime@pi-desk";
const failure = Buffer.from([5]);
const empty = Buffer.from([12, 0, 0, 0, 0]);
function frame(data) { const header = Buffer.alloc(4); header.writeUInt32BE(data.length); return Buffer.concat([header, data]); }
function markerRequest() { return Buffer.concat([Buffer.from([27]), frame(Buffer.from(MARKER))]); }
function label(value) { if (typeof value !== "string" || !/^[^\x00-\x1f\x7f]{1,80}$/.test(value)) throw new Error("Invalid agent label"); return value; }
function socketPath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value) || Buffer.byteLength(value) > 100) throw new Error("Invalid Unix socket path");
  return value;
}
function ownedSocket(value, ownRoot) {
  socketPath(value);
  const real = fs.realpathSync(value);
  if (real === ownRoot || real.startsWith(ownRoot + path.sep)) throw new Error("Cannot route to the managed runtime");
  const stat = fs.statSync(real);
  if (!stat.isSocket() || stat.uid !== process.getuid()) throw new Error("Agent socket must belong to the current user");
  return real;
}
function backend(value) {
  if (!value || typeof value !== "object") throw new Error("Agent choice required");
  if (["none", "browser", "inherited"].includes(value.type)) return { type: value.type };
  if (value.type === "socket") return { type: "socket", path: socketPath(value.path), label: label(value.label) };
  throw new Error("Invalid agent choice");
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const channels = new WeakMap();
function exchange(socket, request, timeoutMs = 1500) {
  let state = channels.get(socket);
  if (!state) {
    state = { bytes: Buffer.alloc(0), waiter: null, failed: false };
    channels.set(socket, state);
    const fail = error => { state.failed = true; state.waiter?.(error); socket.destroy(); };
    socket.on("error", () => fail(new Error("Agent unavailable")));
    socket.on("close", () => fail(new Error("Agent unavailable")));
    socket.on("data", chunk => {
      if (!state.waiter) return fail(new Error("Unsolicited agent response"));
      if (state.bytes.length + chunk.length > MAX_FRAME + 4) return fail(new Error("Agent response is too large"));
      state.bytes = Buffer.concat([state.bytes, chunk]);
      if (state.bytes.length < 4) return;
      const length = state.bytes.readUInt32BE();
      if (!length || length > MAX_FRAME) return fail(new Error("Invalid agent frame"));
      if (state.bytes.length > length + 4) return fail(new Error("Surplus agent response data"));
      if (state.bytes.length === length + 4) { const response = state.bytes.subarray(4); state.bytes = Buffer.alloc(0); state.waiter(null, response); }
    });
  }
  return new Promise((resolve, reject) => {
    if (state.failed || socket.destroyed || state.waiter) { reject(new Error("Agent channel unavailable")); return; }
    const timer = setTimeout(() => { state.failed = true; state.waiter?.(new Error("Agent response timed out")); socket.destroy(); }, timeoutMs);
    state.waiter = (error, response) => { clearTimeout(timer); state.waiter = null; if (error) reject(error); else resolve(response); };
    socket.write(frame(request));
  });
}
async function probe(value, ownRoot, options = {}) {
  let socket;
  const cancel = () => socket?.destroy();
  try {
    const real = ownedSocket(value, ownRoot);
    if (options.signal?.aborted) throw new Error("Agent discovery cancelled");
    socket = net.connect(real); socket.on("error", () => {});
    options.sockets?.add(socket); options.signal?.addEventListener("abort", cancel, { once: true });
    const marked = await exchange(socket, markerRequest());
    if (marked[0] === 6) throw new Error("Another Pi Desk router is not a system backend");
    const identities = await exchange(socket, Buffer.from([11]));
    if (identities[0] !== 12 || identities.length < 5) throw new Error("Invalid agent identities response");
    const count = identities.readUInt32BE(1);
    if (count > 256) throw new Error("Too many agent identities");
    let offset = 5; const fingerprints = [];
    const string = () => {
      if (offset + 4 > identities.length) throw new Error("Malformed identities");
      const n = identities.readUInt32BE(offset); offset += 4;
      if (n > identities.length - offset) throw new Error("Malformed identity");
      const result = identities.subarray(offset, offset + n); offset += n; return result;
    };
    for (let i = 0; i < count; i++) {
      const key = string(); if (i < 16) fingerprints.push("SHA256:" + createHash("sha256").update(key).digest("base64").replace(/=+$/, "")); string();
    }
    if (offset !== identities.length) throw new Error("Unexpected identities data");
    return { available: true, fingerprints, identityCount: count }; // Bounded display, not filtered relay identities.
  } catch (error) { return { available: false, fingerprints: [], error: error.message }; }
  finally { options.signal?.removeEventListener("abort", cancel); options.sockets?.delete(socket); socket?.destroy(); }
}

async function createSshAgentRouter(options = {}) {
  const env = options.environment || process.env;
  if (process.platform === "win32") return null;
  const inherited = env.SSH_AUTH_SOCK || null; // Capture before any environment publication.
  const agentDir = path.resolve(env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"));
  if (typeof options.instance !== "string" || !options.instance || options.instance.length > 1024) throw new Error("A stable SSH runtime instance name is required");
  const namespace = createHash("sha256").update(options.instance).digest("hex").slice(0, 16);
  const settingsDir = path.join(agentDir, "ssh-routing");
  const settingsPath = path.join(settingsDir, namespace + ".json");
  let settings = { version: 1, revision: randomUUID(), setup: false, selected: { type: "none" }, custom: [] };
  let settingsError = null;
  const loadSettings = () => { try {
    const stat = fs.lstatSync(settingsPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o022) || stat.size > 32768) throw new Error("Unsafe SSH settings");
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    if (parsed.version !== 1 || typeof parsed.revision !== "string" || !parsed.revision.length || parsed.revision.length > 128 || typeof parsed.setup !== "boolean" || !Array.isArray(parsed.custom) || parsed.custom.length > 32) throw new Error("Invalid SSH settings");
    settings = { version: 1, revision: parsed.revision, setup: parsed.setup, selected: backend(parsed.selected), custom: parsed.custom.map((item) => ({ path: socketPath(item.path), label: label(item.label) })) };
    if (!settings.setup) settings.selected = { type: "none" };
  } catch (error) { if (error.code !== "ENOENT") settingsError = "SSH settings are unavailable or invalid; explicitly choose an agent to recover"; } };
  const root = fs.mkdtempSync(path.join(options.tempDir || os.tmpdir(), "pds-"));
  try { fs.chmodSync(root, 0o700); } catch (error) { fs.rmdirSync(root); throw error; }
  const publicPath = path.join(root, "agent"), controlPath = path.join(root, "control");
  if (Buffer.byteLength(controlPath) > 100) { fs.rmdirSync(root); throw new Error("SSH runtime socket path is too long"); }
  const token = randomBytes(32).toString("hex");
  const runtimeId = randomUUID();
  let closed = false, accepting = true, generation = 0, browser = null, publisher = null, browserEpoch = null;
  let closing, lease, discovering = null;
  const clients = new Set(), controls = new Set(), probes = new Set(), lookups = new Set();
  const abort = new AbortController();
  const checkLease = () => {
    try { lease.assertOwned(); }
    catch { void close().catch(() => {}); throw new Error("SSH settings ownership lost; restart this runtime"); }
  };
  const checkProbe = value => probe(value, root, { signal: abort.signal, sockets: probes });
  const status = () => {
    let endpointPresent = settings.selected.type === "none";
    if (!endpointPresent) { try { const value = target(); if (value) { ownedSocket(value, root); endpointPresent = true; } } catch { /* Passive endpoint observation, not a discovery probe. */ } }
    return { runtimeId, socketPath: publicPath, inheritedSocket: inherited, revision: settings.revision, setupNeeded: !settings.setup, selected: settings.selected, custom: settings.custom, settingsError, browserSocket: browser, browserEpoch, endpointPresent };
  };
  const persist = (next) => {
    fs.mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
    const directory = fs.lstatSync(settingsDir);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid() || (directory.mode & 0o022)) throw new Error("Unsafe SSH settings directory");
    const temp = path.join(settingsDir, "." + randomUUID());
    try {
      const fd = fs.openSync(temp, "wx", 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(next) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, settingsPath);
      try {
        const directoryFd = fs.openSync(settingsDir, "r");
        try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
      } catch (error) { error.committed = true; throw error; }
    } finally { try { fs.unlinkSync(temp); } catch { /* Only our exact staging file. */ } }
  };
  const retire = () => {
    generation++;
    for (const record of clients) { record.retired = true; if (!record.pending) { record.socket.end(); record.socket.setTimeout(1000, () => record.socket.destroy()); } }
  };
  const stopAdmission = () => { if (accepting) { accepting = false; retire(); } };
  const revokeBrowserRequests = () => {
    for (const record of clients) if (record.backendType === "browser") {
      record.retired = true;
      if (record.writing || !record.pending) record.socket.destroy();
      else record.upstream?.destroy();
    }
  };
  function target() {
    if (settings.selected.type === "inherited") return inherited;
    if (settings.selected.type === "socket") return settings.selected.path;
    if (settings.selected.type === "browser") return browser;
    return null;
  }
  const server = net.createServer((socket) => {
    if (closed || !accepting || clients.size >= 64) { socket.destroy(); return; }
    const record = { socket, upstream: null, pending: false, retired: false, generation, backendType: null, browserEpoch: null, writing: false };
    clients.add(record); let bytes = Buffer.alloc(0), busy = false;
    socket.on("error", () => socket.destroy());
    socket.on("close", () => { clients.delete(record); record.upstream?.destroy(); });
    socket.setTimeout(65000, () => socket.destroy());
    const write = data => new Promise(resolve => {
      const done = () => { socket.removeListener("close", done); resolve(); };
      socket.once("close", done);
      if (socket.destroyed) done(); else socket.write(frame(data), done);
    });
    const pump = async () => {
      if (busy) return; busy = true;
      try {
        while (!socket.destroyed && bytes.length >= 4) {
          const length = bytes.readUInt32BE();
          if (!length || length > MAX_FRAME) return socket.destroy();
          if (bytes.length < length + 4) return;
          const request = bytes.subarray(4, length + 4); bytes = bytes.subarray(length + 4);
          checkLease();
          if (!accepting || record.retired || record.generation !== generation) { socket.end(); return; }
          record.pending = true; record.backendType = settings.selected.type; record.browserEpoch = browserEpoch;
          let response;
          try {
            if (request.equals(markerRequest())) response = Buffer.concat([Buffer.from([6]), frame(Buffer.from(runtimeId))]);
            else if (settings.selected.type === "none") response = request.length === 1 && request[0] === 11 ? empty : failure;
            else {
              if (!record.upstream) {
                const selected = target(); if (!selected) throw new Error("Selected agent is unavailable");
                const real = ownedSocket(selected, root);
                record.upstream = net.connect(real); record.upstream.on("error", () => {});
                const marked = await exchange(record.upstream, markerRequest());
                if (marked[0] === 6) throw new Error("Recursive Pi Desk agent route");
              }
              response = await exchange(record.upstream, request, 60000);
            }
            checkLease();
            if (record.backendType === "browser" && record.browserEpoch !== browserEpoch) throw new Error("Browser publisher revoked");
          } catch { response = failure; record.retired = true; }
          record.writing = true;
          await write(response); // Admission remains pinned until bytes have flushed.
          record.writing = false; record.pending = false;
          if (record.retired && !socket.destroyed) {
            socket.end(); socket.setTimeout(1000, () => socket.destroy()); record.upstream?.destroy(); return;
          }
        }
      } catch { socket.destroy(); }
      finally { busy = false; }
    };
    socket.on("data", (chunk) => { if (bytes.length + chunk.length > MAX_FRAME + 4) return socket.destroy(); bytes = Buffer.concat([bytes, chunk]); void pump(); });
  });
  const dispatch = async (body) => {
    if (closed) throw new Error("SSH runtime is shutting down");
    checkLease();
    if (body.action === "status") return status();
    if (!accepting && !(body.action === "publish-browser" && body.path === null)) throw new Error("SSH runtime is shutting down");
    if (body.action === "claim-browser") {
      publisher = randomUUID(); browserEpoch = randomUUID(); browser = null;
      revokeBrowserRequests();
      if (settings.selected.type === "browser") retire();
      return { publisher, epoch: browserEpoch };
    }
    if (body.action === "publish-browser") {
      if (!publisher || body.publisher !== publisher) throw new Error("Stale browser publisher; reconnect explicitly");
      const next = body.path === null ? null : socketPath(body.path);
      if (next) ownedSocket(next, root);
      if (browser !== next) { browser = next; if (settings.selected.type === "browser") retire(); }
      return status();
    }
    if (body.action === "use" || body.action === "custom") {
      if (body.revision !== settings.revision) throw new Error("SSH settings changed; refresh before applying");
      const next = { ...settings, revision: randomUUID() };
      if (body.action === "use") { next.selected = backend(body.backend); next.setup = true; }
      else {
        const entry = { path: socketPath(body.path), label: label(body.label) };
        if (!next.custom.some(item => item.path === entry.path) && next.custom.length >= 32) throw new Error("Too many custom agents");
        next.custom = [...next.custom.filter(item => item.path !== entry.path), entry];
      }
      if (next.selected.type === "socket") {
        try {
          ownedSocket(next.selected.path, root);
          const checked = await checkProbe(next.selected.path);
          if (checked.error?.includes("Pi Desk router")) throw new Error(checked.error);
        } catch (error) { if (error.code !== "ENOENT" && error.code !== "ECONNREFUSED") throw error; }
      }
      if (closed) throw new Error("SSH runtime is shutting down");
      checkLease();
      const changed = !same(settings.selected, next.selected);
      try { persist(next); }
      catch (error) {
        if (error.committed) { settings = next; if (changed) retire(); settingsError = "Save acknowledgement uncertain; refresh to reconcile the effective agent"; }
        throw new Error(error.committed ? settingsError : "SSH settings could not be saved; effective agent unchanged");
      }
      settings = next; settingsError = null;
      if (changed) retire();
      return status();
    }
    if (body.action === "discover") {
      if (discovering) return discovering;
      discovering = (async () => {
      const runtime = env.XDG_RUNTIME_DIR;
      const candidates = [];
      if (inherited) candidates.push({ label: "Startup system agent (follows its selector)", path: inherited, source: "inherited", dynamic: true });
      if (runtime) for (const [name, relative] of [["Askpass agent", "askpass-agent/agent.sock"], ["GCR", "gcr/ssh"], ["System selector (dynamic)", "ssh-agent/selected.sock"]]) candidates.push({ label: name, path: path.join(runtime, relative), source: "known", dynamic: relative === "ssh-agent/selected.sock" });
      const gpg = await new Promise(resolve => {
        const child = execFile("gpgconf", ["--list-dirs", "agent-ssh-socket"], { env, timeout: 1500, maxBuffer: 4096 }, (error, output) => { lookups.delete(child); resolve(error ? null : output.trim()); });
        lookups.add(child);
      });
      if (closed || !accepting) throw new Error("Agent discovery cancelled");
      if (typeof gpg === "string" && path.isAbsolute(gpg)) candidates.push({ label: "GPG", path: gpg, source: "known" });
      candidates.push(...settings.custom.map(item => ({ ...item, source: "custom" })));
      const seen = new Set();
      const unique = candidates.filter(item => {
        let identity = item.path;
        try {
          const stat = fs.lstatSync(item.path);
          if (!item.dynamic && !stat.isSymbolicLink()) identity = `${stat.dev}:${stat.ino}`;
          if (stat.isSymbolicLink()) item.dynamic = true;
        } catch { /* Keep unavailable explicit descriptors visible. */ }
        if (item.source === "inherited") identity = "inherited:" + identity;
        if (seen.has(identity)) return false; seen.add(identity); return true;
      });
      const result = new Array(unique.length); let index = 0;
      await Promise.all(Array.from({ length: Math.min(37, unique.length) }, async () => {
        while (!closed && accepting && index < unique.length) { const i = index++; result[i] = { ...unique[i], ...await checkProbe(unique[i].path) }; }
      }));
      if (closed || !accepting) throw new Error("Agent discovery cancelled");
      return result;
      })().finally(() => { discovering = null; });
      return discovering;
    }
    if (body.action === "probe") { const value = target(); return value ? await checkProbe(value) : { available: settings.selected.type === "none", fingerprints: [] }; }
    throw new Error("Unknown SSH runtime action");
  };
  let mutation = Promise.resolve();
  const rpc = body => {
    if (["use", "custom", "publish-browser", "claim-browser"].includes(body?.action)) {
      const result = mutation.catch(() => {}).then(() => dispatch(body)); mutation = result; return result;
    }
    return dispatch(body);
  };
  const control = http.createServer(async (req, res) => {
    res.on("error", () => {});
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
    const supplied = req.headers.authorization;
    if (typeof supplied !== "string" || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { res.writeHead(403); res.end('{}'); return; }
    const timeout = setTimeout(() => req.destroy(), 5000);
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new Error("Control request too large"); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      res.end(JSON.stringify({ data: await rpc(body) }));
    } catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: error.message })); }
    finally { clearTimeout(timeout); }
  });
  control.requestTimeout = 5000; control.headersTimeout = 5000;
  control.on("connection", socket => { if (closed || controls.size >= 32) { socket.destroy(); return; } controls.add(socket); socket.on("close", () => controls.delete(socket)); socket.on("error", () => {}); });
  const listen = (s, name) => new Promise((resolve, reject) => {
    s.once("error", reject); s.listen(name, () => {
      try { fs.chmodSync(name, 0o600); s.unref(); resolve(); } catch (error) { reject(error); }
    });
  });
  const close = () => {
    if (closing) return closing;
    closed = true; accepting = false;
    const settled = [...probes].map(socket => new Promise(resolve => socket.once("close", resolve)));
    for (const child of lookups) {
      settled.push(new Promise(resolve => child.once("close", resolve))); child.kill("SIGKILL");
    }
    abort.abort();
    for (const record of clients) { record.socket.destroy(); record.upstream?.destroy(); }
    for (const socket of controls) socket.destroy();
    for (const listener of [server, control]) settled.push(new Promise(resolve => { if (listener.listening) listener.close(resolve); else resolve(); }));
    closing = (async () => {
      try { await Promise.all(settled); }
      finally {
        try {
          try { fs.unlinkSync(path.join(root, "control.json")); } catch (error) { if (error.code !== "ENOENT") throw error; }
          try { fs.rmdirSync(root); } catch (error) { if (error.code !== "ENOENT") throw error; }
        } finally { lease?.release(); }
      }
    })();
    return closing;
  };
  try {
    fs.mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
    const directory = fs.lstatSync(settingsDir);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid() || (directory.mode & 0o022)) throw new Error("Unsafe SSH settings directory");
    lease = claimSshSettingsLease(settingsPath);
    loadSettings();
    await listen(server, publicPath); await listen(control, controlPath);
    if (closed) throw new Error("SSH settings ownership lost during startup");
    fs.writeFileSync(path.join(root, "control.json"), JSON.stringify({ token, controlPath, runtimeId }), { mode: 0o600, flag: "wx" });
    return { socketPath: publicPath, root, rpc, close, stopAdmission, status };
  } catch (error) { await close(); throw error; }
}
module.exports = { createSshAgentRouter, probe, frame, MARKER, MAX_FRAME };
