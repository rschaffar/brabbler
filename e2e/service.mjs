// Acceptance controls only the real Home Manager unit in the disposable guest.
// A successful systemctl child is NOT evidence that the service stayed alive.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { closeSync, constants, fstatSync, ftruncateSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { validateRegistry } from "../nix/vm-plan.mjs";

const exec = promisify(execFile);

export function laneFromRegistry(registry, env, uid) {
  validateRegistry(registry);
  const lane = registry.lanes.find(candidate => candidate.uid === uid);
  if (!lane || env.E2E_SERVICE_CONTROL !== lane.controller || env.E2E_SERVICE_ENV !== lane.envFile ||
      env.E2E_PACKAGE_ROOT !== registry.package || env.E2E_BASE_URL !== `http://127.0.0.1:${lane.port}`) {
    throw new Error("Acceptance inputs do not match this guest user's immutable lane");
  }
  return Object.freeze({ ...lane });
}

export function guestLane(env = process.env) {
  if (readFileSync("/etc/pi-web-acceptance-guest", "utf8").trim() !== "pi-web-nixos-acceptance-v1") throw new Error("Disposable acceptance guest required");
  const file = realpathSync("/etc/pi-web-acceptance-lanes.json");
  const stat = statSync(file);
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/.test(file) || !stat.isFile() || stat.uid !== 0 || (stat.mode & 0o222)) {
    throw new Error("Immutable root-owned guest lane registry required");
  }
  return laneFromRegistry(JSON.parse(readFileSync(file, "utf8")), env, process.getuid());
}

export function serviceCgroup(group, lane) {
  const prefix = `/user.slice/user-${lane.uid}.slice/user@${lane.uid}.service/`;
  if (typeof group !== "string" || !group.startsWith(prefix) || !group.endsWith("/pi-web.service") ||
      !/^\/user\.slice\/[A-Za-z0-9_.@/:-]+$/.test(group) || group.split("/").slice(1).some(part => !part || part === "." || part === "..")) {
    throw new Error("Unexpected lane service cgroup identity");
  }
  return group;
}

export function writeServiceEnvironment(file, contents) {
  const fd = openSync(file, constants.O_WRONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1) {
      throw new Error("Service environment must be an owned private physical file");
    }
    ftruncateSync(fd, 0);
    writeFileSync(fd, contents);
  } finally { closeSync(fd); }
}

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

export function observeCgroup(group, lane) {
  serviceCgroup(group, lane);
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

export function serviceOwner({ lane, command, envFile, env, logPath, event = () => {},
  execute = exec, observe = observeCgroup, write = writeFileSync, writeEnv = writeServiceEnvironment }) {
  if (!lane || !command?.startsWith("/nix/store/") || command !== lane.controller || envFile !== lane.envFile) {
    throw new Error("Nix guest service controller and environment file required");
  }
  let generation, starting, stopping, failure;
  let stopRequested = false;
  const run = async (action, extra = []) => {
    event(`service-${action}-requested`);
    const { stdout } = await execute(command, [action, ...extra], { env, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  };
  const status = async () => unitState(await run("status"));
  async function check() {
    const current = await status();
    if (!generation || current.ActiveState !== "active" || current.SubState !== "running" ||
        current.InvocationID !== generation.InvocationID || current.MainPID !== generation.MainPID ||
        current.NRestarts !== generation.NRestarts || current.ControlGroup !== generation.ControlGroup) {
      failure = "Installed service exited or changed generation unexpectedly";
      throw new Error(failure);
    }
    serviceCgroup(current.ControlGroup, lane);
    return current;
  }
  return {
    start() {
      if (starting || stopRequested) throw new Error("Service acquisition already started or stopping");
      starting = (async () => {
        const before = await status();
        if (stopRequested) throw new Error("Service stopped during acquisition");
        if (before.ActiveState !== "inactive" || before.MainPID !== "0") throw new Error("Acceptance unit must start stopped");
        writeEnv(envFile, environmentFile(env));
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
        const result = { scope: "systemd-user-service", lane: lane.id, generation, settled: false, cgroup: "unknown" };
        try { if (generation) await check(); } catch (error) { failure = error.message; }
        try {
          await run("stop");
          const after = await status();
          if (generation) result.cgroup = observe(generation.ControlGroup, lane);
          result.settled = !!generation && after.ActiveState === "inactive" && after.MainPID === "0" &&
            ["empty", "absent"].includes(result.cgroup);
          if (!result.settled) result.error = "Service shutdown/descendant settlement not established";
        } catch (error) { result.error = error.message; }
        try { write(logPath, await run("logs", generation?.InvocationID ? [generation.InvocationID] : []), { mode: 0o600 }); }
        catch (error) { result.logError = error.message; }
        if (failure) result.unexpectedExit = failure;
        event("service-settled", result);
        return result;
      })();
      return stopping;
    },
  };
}
