import { createServer, request } from "node:http";
import { once } from "node:events";

/** Forward one actual SSE connection, then end only that connection to provoke native retry. */
export async function terminalDisconnectFixture(base, id) {
  const path = `/api/terminal/${encodeURIComponent(id)}/events`;
  let downstream, upstream, incoming, deliberateEnd = false, error, closing;
  const sockets = new Set();
  let release;
  const reconnect = new Promise((resolve) => { release = resolve; });
  const server = createServer((req, res) => {
    const target = new URL(req.url, base);
    if (req.method !== "GET" || target.origin !== base || target.pathname !== path || downstream) { res.writeHead(404).end(); return; }
    downstream = res;
    upstream = request(target, { headers: { ...req.headers, host: target.host } }, (response) => {
      incoming = response;
      if (response.statusCode !== 200) error = new Error(`Terminal stream returned ${response.statusCode}`);
      res.writeHead(response.statusCode ?? 502, { ...response.headers, "access-control-allow-origin": base });
      res.flushHeaders();
      response.pipe(res);
      response.on("error", (cause) => { if (!deliberateEnd) { error = cause; res.destroy(cause); } });
    });
    upstream.on("error", (cause) => { if (!deliberateEnd) { error = cause; res.destroy(cause); } });
    req.on("aborted", () => { if (!deliberateEnd) error ??= new Error("Forwarded stream aborted before controlled EOF"); upstream.destroy(); });
    upstream.end();
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const matches = (url) => url.origin === base && url.pathname === path;
  let first = true;
  const route = async (r) => {
    if (r.request().method() !== "GET") return r.continue();
    if (first) { first = false; const original = new URL(r.request().url()); return r.continue({ url: `${origin}${original.pathname}${original.search}` }); }
    await reconnect;
    return r.continue();
  };
  return {
    matches, route,
    endStream() {
      if (error) throw error;
      if (!incoming || !downstream) throw new Error("Actual forwarded terminal stream was not established");
      deliberateEnd = true;
      incoming.unpipe(downstream); downstream.end(); incoming.destroy(); upstream.destroy();
    },
    releaseReconnect: () => release(),
    close() {
      closing ??= (async () => {
        release(); deliberateEnd = true; incoming?.destroy(); upstream?.destroy(); downstream?.end();
        const closed = new Promise((resolve, reject) => server.close((cause) => cause ? reject(cause) : resolve()));
        for (const socket of sockets) socket.destroy();
        await closed;
        if (error) throw error;
      })();
      return closing;
    },
  };
}

export async function closeTerminalDisconnect(page, fixture) {
  fixture.releaseReconnect();
  try { await page.unroute(fixture.matches, fixture.route); }
  finally { await fixture.close(); }
}
