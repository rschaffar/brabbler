#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getUnsupportedNodeVersionMessage, isNodeVersionSupported } = require("./node-version");

if (!isNodeVersionSupported(process.versions.node)) {
  console.error(getUnsupportedNodeVersionMessage(process.versions.node));
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getHelpText, parseLaunchOptions } = require("./brabbler-options");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { launchManagedNext } = require("./ssh-agent-launch");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { commandEnvironment } = require("./command-env");

if (process.argv[2] === "auth") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runAuthSetup } = require("./auth-cli");
  const task = process.argv[3] === "setup"
    ? runAuthSetup(process.argv.slice(4))
    : Promise.reject(new Error("Usage: brabbler auth setup [--replace]"));
  task.catch((error) => {
    // Known CLI/store messages contain no user input or credential bytes.
    console.error(error.code ? "Auth setup failed; inspect private state locally." : error.message);
    process.exitCode = 1;
  });
} else {
let launchOptions;
try {
  launchOptions = parseLaunchOptions();
} catch (error) {
  fs.writeSync(
    process.stderr.fd,
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

if (launchOptions.help) {
  fs.writeSync(process.stdout.fd, getHelpText());
  process.exit(0);
}

const { port, hostname, openBrowser } = launchOptions;

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const loopbackHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCredentials } = require("./web-auth-store");
const required = process.env.BRABBLER_REQUIRE_AUTH;
let authLocked = required !== undefined && !["", "0", "1"].includes(required);
let passwordEnabled = Boolean(process.env.BRABBLER_PASSWORD);
try {
  const credentials = readCredentials();
  if (credentials && passwordEnabled) authLocked = true;
  passwordEnabled ||= Boolean(credentials);
} catch { authLocked = true; }
authLocked ||= required === "1" && !passwordEnabled;

if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

if (!loopbackHostnames.has(hostname)) {
  if (authLocked) {
    console.warn(
      `Warning: brabbler is listening on ${hostname} with authentication required and access locked until valid authentication is configured. Use HTTPS or a trusted VPN before signing in.`,
    );
  } else if (passwordEnabled) {
    console.warn(
      `Warning: brabbler is listening on ${hostname} with password authentication over HTTP. Use HTTPS or a trusted VPN to protect the password in transit.`,
    );
  } else {
    console.warn(
      `Warning: brabbler is listening on ${hostname} without authentication. Only use this on a trusted network.`,
    );
  }
}

const nextArgs = ["start", "-p", port];
nextArgs.push("-H", hostname);

// Always run next's JS entry with node directly — avoids .bin symlink issues
// and path-with-spaces problems on Windows when shell: true is used.
launchManagedNext({ nextBin, args: nextArgs, cwd: pkgDir, hostname, port,
  stdio: ["inherit", "pipe", "inherit"],
}).then((child) => {
let browserOpened = false;
const url = `http://${hostname}:${port}`;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (openBrowser && !browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";
    // Avoid `shell: true` to suppress Node.js DEP0190 deprecation
    // ("Passing args to a child process with shell option true can lead to
    // security vulnerabilities, as the arguments are not escaped").
    // Pass a structured argv so Node.js handles escaping instead of
    // concatenating the args into a shell command string.
    let opener;
    if (isWindows) {
      // `start` is a cmd.exe built-in, so invoke cmd directly. The empty
      // title argument is required by `start` before the target URL.
      opener = spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", url], {
        env: commandEnvironment(), stdio: "ignore",
        detached: true,
      });
    } else if (isMac) {
      opener = spawn("open", [url], {
        env: commandEnvironment(), stdio: "ignore",
        detached: true,
      });
    } else {
      opener = spawn("xdg-open", [url], {
        env: commandEnvironment(), stdio: "ignore",
        detached: true,
      });
    }

    opener.on("error", (error) => {
      console.warn(`Could not open browser automatically: ${error.message}`);
    });

    opener.unref();
  }
});
}).catch((error) => {
  console.error(`[brabbler] startup failed: ${error.message}`);
  process.exit(error.exitCode || 1);
});
}
