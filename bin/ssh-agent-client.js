"use strict";
/* Shared Node/CommonJS control client; no browser bundle or import-time effects. */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

// Only server-side code reads the newly generated runtime control capability.
// It is never returned by HTTP routes or placed in process environments.
function runtimeControl(environment = process.env) {
  const root = environment.BRABBLER_SSH_RUNTIME;
  if (!root) throw new Error("Managed SSH runtime unavailable; use the supported Brabbler launcher");
  const directory = fs.lstatSync(root);
  const file = path.join(root, "control.json"); const stat = fs.lstatSync(file);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid() || (directory.mode & 0o077)
    || !stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.size > 2048 || (stat.mode & 0o077)) throw new Error("Unsafe SSH control metadata");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!/^[a-f0-9]{64}$/.test(data.token) || data.controlPath !== path.join(root, "control") || typeof data.runtimeId !== "string") throw new Error("Invalid SSH control metadata");
  return data;
}
function sshRuntimeRequest(body, environment = process.env) {
  return new Promise((resolve, reject) => {
    let control;
    try { control = runtimeControl(environment); } catch (error) { reject(error); return; }
    const req = http.request({ socketPath: control.controlPath, path: "/", method: "POST", headers: { Authorization: control.token, "Content-Type": "application/json" } }, (res) => {
      const chunks = []; let size = 0;
      res.on("data", chunk => { size += chunk.length; if (size > 65536) req.destroy(new Error("SSH control response too large")); else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => { try { const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (res.statusCode !== 200) throw new Error(parsed.error || "SSH control request failed"); resolve(parsed.data); } catch (error) { reject(error); } });
    });
    req.setTimeout(7000, () => req.destroy(new Error("SSH control request timed out")));
    req.on("error", reject); req.end(JSON.stringify(body));
  });
}
module.exports = { runtimeControl, sshRuntimeRequest };
