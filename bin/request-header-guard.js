"use strict";

// Next can skip proxy.ts for build-ID revalidation requests. Reject that unused
// protocol before any framework listener, without reading or rewriting .next.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require("node:http");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const https = require("node:https");

const installed = Symbol.for("brabbler:request-header-guard/v1");
const requestEvents = new Set(["request", "checkContinue", "checkExpectation", "upgrade", "connect"]);
const forbidden = new Set(["x-prerender-revalidate", "x-prerender-revalidate-if-generated"]);

function hasForbiddenHeaders(request) {
  if (Object.keys(request.headers ?? {}).some((name) => forbidden.has(name.toLowerCase()))) return true;
  // Inspect original names too: duplicate, mixed-case and empty headers count.
  const raw = request.rawHeaders ?? [];
  for (let i = 0; i < raw.length; i += 2) {
    if (typeof raw[i] === "string" && forbidden.has(raw[i].toLowerCase())) return true;
  }
  return false;
}

function reject(response, socketEvent) {
  if (socketEvent) {
    // Upgraded sockets are outside ordinary HTTP connection cleanup. Flush the
    // denial, then close both halves even if the peer never sends its own EOF.
    response.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n", () => response.destroy());
    return;
  }
  response.writeHead(400, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Connection": "close",
  });
  response.end("Invalid request headers");
}

function installRequestHeaderGuard() {
  for (const Server of [http.Server, https.Server]) {
    const prototype = Server.prototype;
    if (Object.hasOwn(prototype, installed)) continue;
    const emit = prototype.emit;
    // A prepended listener cannot stop later listeners. Intercept only server
    // request dispatch, not EventEmitter globally, retaining normal semantics.
    Object.defineProperty(prototype, "emit", {
      configurable: true,
      writable: true,
      value(event, ...args) {
        if (requestEvents.has(event) && hasForbiddenHeaders(args[0])) {
          reject(args[1], event === "upgrade" || event === "connect");
          return true;
        }
        return Reflect.apply(emit, this, [event, ...args]);
      },
    });
    Object.defineProperty(prototype, installed, { value: true });
  }
}

installRequestHeaderGuard();
module.exports = { hasForbiddenHeaders, installRequestHeaderGuard };
