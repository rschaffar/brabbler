"use strict";
/* Unbundled launcher boundary; shared by installed and maintained npm entry points. */
/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require("node:child_process");
const os = require("node:os");
const { createSshAgentRouter } = require("./ssh-agent-router");
const { wireChildProcessLifecycle } = require("./process-lifecycle");
const { getNextNodeArgs } = require("./pi-web-node-args");

async function launchManagedNext(options, services = {}) {
  const parent = services.parentProcess || process;
  const environment = options.environment || process.env;
  const createRouter = services.createRouter || createSshAgentRouter;
  const spawnNext = services.spawn || spawn;
  let aborted = null, router;
  const handlers = ["SIGINT", "SIGTERM"].map(signal => {
    const handler = () => { aborted = signal; };
    parent.on(signal, handler); return [signal, handler];
  });
  const unwire = () => { for (const [signal, handler] of handlers) parent.removeListener(signal, handler); };
  try {
    router = await createRouter({ environment: { ...environment }, instance: `${options.hostname}:${options.port}` });
    if (aborted) {
      const error = new Error("Startup cancelled"); error.exitCode = 128 + os.constants.signals[aborted]; throw error;
    }
    const childEnvironment = { ...environment, PI_WEB_HOSTNAME: options.hostname };
    delete childEnvironment.PI_DESK_SSH_RUNTIME;
    if (router) {
      childEnvironment.SSH_AUTH_SOCK = router.socketPath; childEnvironment.PI_DESK_SSH_RUNTIME = router.root;
      if (environment === process.env) { process.env.SSH_AUTH_SOCK = router.socketPath; process.env.PI_DESK_SSH_RUNTIME = router.root; }
    }
    const child = spawnNext(process.execPath, getNextNodeArgs(options.nextBin, options.args), {
      cwd: options.cwd, stdio: options.stdio || "inherit", env: childEnvironment,
    });
    unwire();
    wireChildProcessLifecycle(child, parent, undefined, services.log || console.error, {
      stopAdmission: () => router?.stopAdmission(), settle: () => router?.close(),
    });
    return child;
  } catch (error) {
    try { await router?.close(); } finally { unwire(); }
    throw error;
  }
}
module.exports = { launchManagedNext };
