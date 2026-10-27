"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("node:os");

const forwardedSignals = ["SIGINT", "SIGTERM"];
const shutdownTimeoutMs = 5_000;

function getSignalExitCode(signal) {
  const signalNumber = signal ? os.constants.signals[signal] : undefined;
  return typeof signalNumber === "number" ? 128 + signalNumber : 1;
}

function wireChildProcessLifecycle(
  child,
  parentProcess = process,
  timeoutMs = shutdownTimeoutMs,
  log = console.error,
  owner = {},
) {
  const signalHandlers = new Map();
  let shutdownTimer;
  // Set once we forward a signal, so an exit we asked for stays quiet and one
  // we did not gets reported.
  let shuttingDown = false;
  let finished = false;

  function finish(code) {
    if (finished) return;
    finished = true;
    unwire();
    if (!owner.settle) { parentProcess.exit(code); return; }
    let settled;
    try { settled = owner.settle(); }
    catch (error) { log(`[brabbler] owner cleanup failed: ${error.message}`); parentProcess.exit(code || 1); return; }
    if (!settled || typeof settled.then !== "function") { parentProcess.exit(code); return; }
    let timer, finalCode = code;
    Promise.race([
      settled,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("owner cleanup timed out")), owner.timeoutMs ?? 1000); }),
    ]).catch(error => { finalCode = code || 1; log(`[brabbler] owner cleanup failed: ${error.message}`); })
      .finally(() => { clearTimeout(timer); parentProcess.exit(finalCode); });
  }

  const forceKill = () => child.kill("SIGKILL");

  function unwire() {
    if (shutdownTimer) clearTimeout(shutdownTimer);
    for (const [forwardedSignal, handler] of signalHandlers) {
      parentProcess.removeListener(forwardedSignal, handler);
    }
    child.removeListener("error", handleError);
  }

  function handleError(error) {
    const failedToSpawn = child.pid === undefined;
    log(
      `[brabbler] ${failedToSpawn ? "could not run the Next.js process" : "Next.js process error"}: ${error.message}`,
    );

    if (failedToSpawn) {
      finish(1);
    }
  }

  for (const signal of forwardedSignals) {
    const handler = () => {
      if (shutdownTimer) {
        forceKill();
        return;
      }

      shuttingDown = true;
      try { owner.stopAdmission?.(); } catch (error) { log(`[brabbler] owner admission shutdown failed: ${error.message}`); }
      shutdownTimer = setTimeout(forceKill, timeoutMs);
      shutdownTimer.unref();
      child.kill(signal);
    };
    signalHandlers.set(signal, handler);
    parentProcess.on(signal, handler);
  }

  child.on("error", handleError);

  child.once("exit", (code, signal) => {
    if (finished) return;

    // A shutdown the user asked for needs no explanation; anything else left
    // the window closing with no stated reason.
    if (!shuttingDown) {
      log(
        `[brabbler] Next.js exited unexpectedly (${signal ? `signal ${signal}` : `code ${code}`})`,
      );
    }

    finish(code ?? getSignalExitCode(signal));
  });
}

module.exports = { wireChildProcessLifecycle };
