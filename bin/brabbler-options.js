"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const CLI_OPTIONS = {
  port: { type: "string", short: "p" },
  hostname: { type: "string", short: "H" },
  "no-open": { type: "boolean" },
  "no-auth": { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}

function normalizePort(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("Port must be a non-negative integer.");
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error("Port must be between 0 and 65535.");
  }

  return String(port);
}

function getHelpText() {
  return `Usage: brabbler [options]

Start the Brabbler UI server.
Local password setup: brabbler auth setup [--replace]
  Reads a hidden, confirmed passphrase from the controlling TTY, never argv.
  --replace explicitly rotates existing secure credentials and revokes sessions.

Options:
  -p, --port <port>          Server port (default: 30141, or PORT)
  -H, --hostname <host>      Bind hostname (default: 127.0.0.1, or BRABBLER_HOSTNAME)
      --no-open              Do not open a browser automatically
      --no-auth              Disable web login (dangerous on any reachable bind)
  -h, --help                 Show this help message and exit

Environment:
  PORT                       Default port when --port is omitted
  BRABBLER_HOSTNAME            Default hostname when --hostname is omitted
  BRABBLER_NO_OPEN             Set to 1/true/yes/on to disable browser open
  BRABBLER_APP_NAME            PWA manifest name (trimmed; default Brabbler)
  BRABBLER_PASSWORD            Explicit env password (conflicts with local credentials)
  BRABBLER_REQUIRE_AUTH        Set to 1 to prohibit an authentication bypass
  BRABBLER_NO_AUTH             Set to 1 for explicit no-auth mode; default is protected
  PI_CODING_AGENT_DIR          Agent state root (default ~/.pi/agent)
  BRABBLER_ALLOWED_HOSTS       Extra exact proxy/custom hostnames, comma-separated
  BRABBLER_SKIP_VERSION_CHECK  Set to 1 to disable running-version reload prompts
  BRABBLER_PUSH_SUBJECT        Operator contact URL required for Web Push
  BRABBLER_IDLE_TIMEOUT_MS     Session idle timeout in ms (0 disables; default 600000)
`;
}

function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: CLI_OPTIONS,
      strict: true,
      allowPositionals: true,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const err = new Error(`${message}\nUse --help to see available options.`);
    err.code = "ERR_PARSE_ARGS_UNKNOWN_OPTION";
    throw err;
  }

  if (values.help) {
    return { help: true };
  }

  if (positionals.length > 0) {
    throw new Error(
      `Unexpected argument(s): ${positionals.join(" ")}\nUse --help to see available options.`,
    );
  }

  return {
    help: false,
    port: normalizePort(values.port ?? env.PORT ?? "30141"),
    hostname: values.hostname ?? env.BRABBLER_HOSTNAME ?? "127.0.0.1",
    openBrowser: !values["no-open"] && !isEnabled(env.BRABBLER_NO_OPEN),
    noAuth: values["no-auth"] === true,
  };
}

module.exports = { parseLaunchOptions, getHelpText };
