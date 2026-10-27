"use strict";

/** Child-command hygiene, not a sandbox for trusted in-process extensions.
 * Preserve account bindings, explicit isolation and the public SSH_AUTH_SOCK.
 * The supervised Next worker is a trusted server, not a command consumer.
 */
function commandEnvironment(inherited = process.env, platform = process.platform) {
  const env = { ...inherited };
  for (const key of Object.keys(env)) {
    const name = platform === "win32" ? key.toUpperCase() : key;
    if (name === "BRABBLER_PASSWORD" || name === "BRABBLER_SSH_RUNTIME") delete env[key];
  }
  return env;
}

module.exports = { commandEnvironment };
