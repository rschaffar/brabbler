// Real, unmodified Next adapter + HTTP compressor, not a replacement encoder.
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { NodeNextRequest, NodeNextResponse } from "next/dist/server/base-http/node.js";
import { sendResponse } from "next/dist/server/send-response.js";

const require = createRequire(import.meta.url);
const compression = require("next/dist/compiled/compression");

export async function createNextHTTPBridge(t, handler) {
  const middleware = compression();
  const forwarding = [], clientWork = [], failures = [];
  const clients = new Set(), sockets = new Set();
  let closing, baseURL;
  const server = createServer((request, response) => {
    const work = new Promise((resolve, reject) => middleware(request, response, error => {
      if (error) { reject(error); return; }
      const headers = new Headers();
      for (let i = 0; i < request.rawHeaders.length; i += 2) headers.append(request.rawHeaders[i], request.rawHeaders[i + 1]);
      Promise.resolve().then(() => handler(new Request(`${baseURL}${request.url}`, { method: request.method, headers })))
        .then(result => sendResponse(new NodeNextRequest(request), new NodeNextResponse(response), result))
        .then(resolve, reject);
    }));
    forwarding.push(work);
    void work.catch(error => { failures.push(error); response.destroy(); });
  });
  server.on("error", error => failures.push(error));
  server.on("connection", socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const close = () => closing ??= (async () => {
    const stopped = new Promise((resolve, reject) => server.close(error => {
      if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
      else resolve();
    }));
    for (const client of clients) client.destroy();
    for (const socket of sockets) socket.destroy();
    const settled = await Promise.allSettled([stopped, ...clientWork, ...forwarding]);
    const errors = [...failures, ...settled.filter(result => result.status === "rejected").map(result => result.reason)];
    if (errors.length) throw new AggregateError([...new Set(errors)], "Next HTTP compression bridge did not settle cleanly");
  })();
  t.after(close);
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("Missing private HTTP listener");
  baseURL = `http://127.0.0.1:${address.port}`;
  return { baseURL, close, request(path, { method = "GET", headers = {} } = {}) {
    if (closing) throw new Error("HTTP bridge admission is closed");
    const client = httpRequest(`${baseURL}${path}`, {
      method, headers: { ...headers, Connection: "close" }, agent: false,
      signal: AbortSignal.timeout(5000),
    });
    clients.add(client);
    const closed = new Promise(resolve => client.once("close", resolve));
    const body = new Promise((resolve, reject) => {
      client.once("error", reject);
      client.once("response", response => {
        const chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.once("error", reject);
        response.once("aborted", () => reject(new Error("HTTP response body aborted")));
        response.once("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      });
      client.end();
    });
    const work = (async () => {
      try { return await body; }
      finally { client.destroy(); await closed; clients.delete(client); }
    })();
    clientWork.push(work);
    return work;
  } };
}
