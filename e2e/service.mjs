// Acceptance controls only the real Home Manager unit in the disposable guest.
// A successful systemctl child is NOT evidence that the service stayed alive.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";

const exec = promisify(execFile);

export function environmentFile(env) {
  return Object.entries(env).map(([key, value]) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value)) {
      throw new Error("Invalid service fixture environment");
    }
    return `${key}=${JSON.stringify(value)}`;
  }).join("\n") + "\n";
}

export function unitState(text) {
  const state = Object.fromEntries(text.trim().split("\n").map(line => {
    const equal = line.indexOf("=");
    if (equal < 1) throw new Error("Invalid systemd unit observation");
    return [line.slice(0, equal), line.slice(equal + 1)];
  }));
  if (!state.ActiveState || !state.SubState || !/^\d+$/.test(state.MainPID ?? "") ||
      !/^\d+$/.test(state.NRestarts ?? "")) throw new Error("Incomplete systemd unit observation");
  return state;
}

export function observeCgroup(group) {
  if (!/^\/user\.slice\/[A-Za-z0-9_.@/:-]+$/.test(group) || group.split("/").includes("..")) {
    throw new Error("Unexpected service cgroup identity");
  }
  try {
    // cgroup.events populated includes descendants, unlike a direct-PID scan.
    const events = readFileSync(`/sys/fs/cgroup${group}/cgroup.events`, "utf8");
    const populated = events.match(/^populated ([01])$/m)?.[1];
    if (populated === undefined) throw new Error("Unobservable service cgroup");
    return populated === "0" ? "empty" : "populated";
  } catch (error) {
    if (error.code === "ENOENT") return "absent";
    throw error;
  }
}

export function serviceOwner({ command, envFile, env, logPath, event = () => {},
  execute = exec, observe = observeCgroup, write = writeFileSync }) {
  if (!command?.startsWith("/nix/store/") || !envFile?.startsWith("/home/tester/")) {
    throw new Error("Nix guest service controller and environment file required");
  }
  let generation, starting, stopping, failure;
  let stopRequested = false;
  const run = async action => {
    event(`service-${action}-requested`);
    const { stdout } = await execute(command, [action], { env, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  };
  const status = async () => unitState(await run("status"));
  async function check() {
    const current = await status();
    if (!generation || current.ActiveState !== "active" || current.SubState !== "running" ||
        current.InvocationID !== generation.InvocationID || current.MainPID !== generation.MainPID ||
        current.NRestarts !== generation.NRestarts) {
      failure = "Installed service exited or changed generation unexpectedly";
      throw new Error(failure);
    }
    return current;
  }
  return {
    start() {
      if (starting || stopRequested) throw new Error("Service acquisition already started or stopping");
      starting = (async () => {
        const before = await status();
        if (stopRequested) throw new Error("Service stopped during acquisition");
        if (before.ActiveState !== "inactive" || before.MainPID !== "0") throw new Error("Acceptance unit must start stopped");
        write(envFile, environmentFile(env), { mode: 0o600 });
        await run("start");
        generation = await status();
        if (!/^[a-f0-9]{32}$/.test(generation.InvocationID ?? "") || !generation.ControlGroup ||
            generation.MainPID === "0" || generation.NRestarts !== "0") {
          throw new Error("Missing installed service generation/cgroup");
        }
        await check();
        if (stopRequested) throw new Error("Service stopped during acquisition");
        event("service-started", generation);
      })();
      return starting;
    },
    check,
    stop() {
      stopRequested = true;
      stopping ??= (async () => {
        // A pending start must settle before the final stop; otherwise its
        // late systemctl acquisition could outlive a memoized shutdown.
        try { await starting; } catch (error) { failure = error.message; }
        const result = { scope: "systemd-user-service", generation, settled: false, cgroup: "unknown" };
        try { if (generation) await check(); } catch (error) { failure = error.message; }
        try {
          await run("stop");
          const after = await status();
          if (generation) result.cgroup = observe(generation.ControlGroup);
          result.settled = !!generation && after.ActiveState === "inactive" && after.MainPID === "0" &&
            ["empty", "absent"].includes(result.cgroup);
          if (!result.settled) result.error = "Service shutdown/descendant settlement not established";
        } catch (error) { result.error = error.message; }
        try { write(logPath, await run("logs"), { mode: 0o600 }); }
        catch (error) { result.logError = error.message; }
        if (failure) result.unexpectedExit = failure;
        event("service-settled", result);
        return result;
      })();
      return stopping;
    },
  };
}
