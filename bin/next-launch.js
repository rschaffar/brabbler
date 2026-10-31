"use strict";
/* Shared installed/npm authentication and child-process supervision boundary. */
/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require("node:child_process");
const { wireChildProcessLifecycle } = require("./process-lifecycle");
const { getNextNodeArgs } = require("./brabbler-node-args");
const { checkSdkCommandEnvironment } = require("./patch-sdk-command-env");
const { getWebAuthPolicy } = require("./web-auth-policy");
const { checkSdkRuntimePolicy } = require("./sdk-runtime-policy");

async function launchManagedNext(options, services = {}) {
  // Read-only installed-root verification. Never repair dependencies at startup
  // or filter the trusted Next worker's login environment.
  (services.checkSdkEnvironment || (() => {
    checkSdkCommandEnvironment();
    checkSdkRuntimePolicy();
  }))();
  const environment = options.environment || process.env;
  const authPolicy = getWebAuthPolicy(environment);
  if (authPolicy === "invalid") throw new Error("Invalid web authentication configuration: no-auth cannot override required authentication.");
  if (authPolicy === "disabled") (services.warn || console.warn)(
    `WARNING: Brabbler web authentication is DISABLED on ${options.hostname}. Anyone who can reach this listener can access this coding workspace.`,
  );
  // Native SSH agents/forwarding are ordinary inherited environment. Do not
  // allocate an agent, replace SSH_AUTH_SOCK, or persist an agent selection.
  const child = (services.spawn || spawn)(process.execPath, getNextNodeArgs(options.nextBin, options.args), {
    cwd: options.cwd, stdio: options.stdio || "inherit",
    env: { ...environment, BRABBLER_HOSTNAME: options.hostname },
  });
  wireChildProcessLifecycle(child, services.parentProcess || process, undefined, services.log || console.error);
  return child;
}
module.exports = { launchManagedNext };
