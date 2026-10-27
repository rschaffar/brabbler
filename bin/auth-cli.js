"use strict";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tty = require("node:tty");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setupCredentials } = require("./web-auth-store");

async function runAuthSetup(args) {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--replace")) {
    throw new Error("Usage: brabbler auth setup [--replace] (no password arguments)");
  }
  // Never read redirected stdin or an environment password. Open the controlling TTY.
  let fd;
  try { fd = fs.openSync("/dev/tty", "r+"); }
  catch { throw new Error("Auth setup requires a local interactive TTY."); }
  const input = new tty.ReadStream(fd);
  const wasRaw = input.isRaw;
  input.setEncoding("utf8");
  function prompt(label) {
    return new Promise((resolve, reject) => {
      let value = "";
      fs.writeSync(fd, label);
      function finish(error) {
        input.off("data", onData); input.off("error", onError); input.off("end", onEnd);
        input.pause(); fs.writeSync(fd, "\n");
        if (error) reject(error); else resolve(value);
        value = "";
      }
      function onError() { finish(new Error("Unable to read passphrase from TTY.")); }
      function onEnd() { finish(new Error("Passphrase entry cancelled.")); }
      function onData(chunk) {
        for (const ch of chunk) {
          if (ch === "\u0003" || ch === "\u0004") { finish(new Error("Passphrase entry cancelled.")); return; }
          if (ch === "\r" || ch === "\n") { finish(); return; }
          if (ch === "\u007f" || ch === "\b") value = Array.from(value).slice(0, -1).join("");
          else if (ch >= " " && ch !== "\u007f") value += ch;
          if (Buffer.byteLength(value, "utf8") > 1024) { finish(new Error("Passphrase is too long.")); return; }
        }
      }
      input.on("data", onData); input.once("error", onError); input.once("end", onEnd); input.resume();
    });
  }
  const onSignal = () => {
    input.setRawMode(Boolean(wasRaw)); input.destroy(); process.exit(130);
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.on(signal, onSignal);
  try {
    input.setRawMode(true);
    const password = await prompt("New passphrase (hidden): ");
    const confirmation = await prompt("Confirm passphrase (hidden): ");
    if (password !== confirmation) throw new Error("Passphrases do not match; nothing changed.");
    await setupCredentials(password, { replace: args[0] === "--replace" });
    fs.writeSync(fd, "Web authentication configured. Existing sessions were revoked.\n");
  } finally {
    for (const signal of signals) process.off(signal, onSignal);
    input.setRawMode(Boolean(wasRaw)); input.destroy();
  }
}
module.exports = { runAuthSetup };
