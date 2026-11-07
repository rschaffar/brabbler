"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash } = require("node:crypto");
const { readFileSync, realpathSync } = require("node:fs");
const { dirname, join } = require("node:path");

// Reassess/remove on EVERY Next upgrade; docs/dependencies.md owns this exception.
const NEXT_VERSION = "16.4.5";
const COMPRESSION_SHA256 = "8e7c2ec6982978c754c00388e0d1d3ff46d7aae99945d060f6f1052954c24e29";
const installed = Symbol.for("brabbler:next-compression-compat/v1");
const reminder = "Reassess/remove bin/next-compression-compat.js when updating Next.";

function refusal(reason) {
  const error = new Error(`Next compression compatibility refused: ${reason}. ${reminder}`);
  error.code = "ERR_BRABBLER_NEXT_COMPRESSION_COMPAT";
  return error;
}

function verifyNextCompressionProfile(packageRoot = dirname(require.resolve("next/package.json"))) {
  const root = realpathSync(packageRoot);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (manifest.name !== "next" || manifest.version !== NEXT_VERSION) {
    throw refusal(`expected next@${NEXT_VERSION}`);
  }
  const entry = require.resolve(join(root, "dist/compiled/compression/index.js"));
  const sha256 = createHash("sha256").update(readFileSync(entry)).digest("hex");
  if (sha256 !== COMPRESSION_SHA256) throw refusal("the compressor source changed");
  return Object.freeze({ entry, version: NEXT_VERSION, sha256 });
}

function createCompatibleCompression(compression) {
  if (typeof compression !== "function" || typeof compression.filter !== "function") {
    throw refusal("unexpected compressor exports");
  }
  const defaultFilter = compression.filter;
  function compatibleCompression(options) {
    if (options?.filter) return compression(options);
    // Preserve inherited options too; only replace the default predicate.
    const adapted = Object.create(options ?? null);
    Object.defineProperty(adapted, "filter", { enumerable: true, value(request, response) {
      const pathname = typeof request.url === "string" ? request.url.split("?")[0] : "";
      const type = response.getHeader("Content-Type");
      const vary = response.getHeader("Vary");
      const selected = (request.method === "GET" || request.method === "HEAD")
        && /^\/api\/sessions(?:\/[^/]+)?$/.test(pathname)
        && Array.isArray(type) && type.length === 1 && typeof type[0] === "string"
        && type[0].split(";")[0].trim().toLowerCase() === "application/json"
        && String(vary ?? "").split(",").some(value => value.trim().toLowerCase() === "accept-encoding");
      if (!selected) return defaultFilter(request, response);
      // This fingerprinted predicate only reads getHeader. Never pass the view
      // into the middleware or change the real response/header representation.
      const headerView = { getHeader(name) {
        return typeof name === "string" && name.toLowerCase() === "content-type"
          ? type[0] : response.getHeader(name);
      } };
      return defaultFilter(request, headerView);
    } });
    return compression(adapted);
  }
  return Object.assign(compatibleCompression, compression);
}

function installNextCompressionCompat(packageRoot) {
  const profile = verifyNextCompressionProfile(packageRoot);
  const cached = require.cache[profile.entry];
  if (cached?.exports?.[installed]?.entry === profile.entry) return cached.exports;
  if (cached) throw refusal("the compressor was loaded before the managed preload");
  const compatible = createCompatibleCompression(require(profile.entry));
  Object.defineProperty(compatible, installed, { value: profile });
  require.cache[profile.entry].exports = compatible;
  return compatible;
}

module.exports = { verifyNextCompressionProfile, createCompatibleCompression, installNextCompressionCompat };
