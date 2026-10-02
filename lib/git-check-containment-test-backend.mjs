import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";

/** Node-test-only protocol fake. It is NOT OS containment or proof against escaped descendants. */
export function createTestContainmentBackend() {
  if (!process.env.NODE_TEST_CONTEXT) throw new Error("This fake is only available inside node:test");
  const units = new Map(), stopped = new Set();
  return {
    async absent(name) { return !units.has(name); },
    start(options) {
      const state = { identity: randomUUID(), invocation: randomUUID().replaceAll("-", ""), done: false,
        code: null, child: null, output() {}, workingDirectory: options.workingDirectory,
        cwdInstance: options.cwdInstance };
      units.set(options.unit, state);
      return {
        started: Promise.resolve(),
        release(payload) {
          const { argv, env } = JSON.parse(payload);
          state.child = spawn(argv[0], argv.slice(1), { cwd: state.workingDirectory, env, shell: false, detached: true,
            stdio: ["ignore", "pipe", "pipe"] });
          state.child.stdout.on("data", (data) => state.output(data));
          state.child.stderr.on("data", (data) => state.output(data));
          state.child.on("error", () => { state.code = 125; state.done = true; });
          state.child.on("close", (code) => { state.code = code ?? 125; state.done = true; });
        },
        closeInput() {},
        dispose() {},
        output(callback) { state.output = callback; },
      };
    },
    async observe(name) {
      const state = units.get(name);
      if (!state) throw new Error("unit absent");
      const unit = { Id: name, LoadState: "loaded", ControlGroup: `/test/${name}`, MainPID: state.done ? "0" : "123",
        ActiveState: "active", SubState: state.done ? "exited" : "running", Result: "success", ExecMainCode: "1",
        ExecMainStatus: String(state.code ?? 0), Delegate: "no", KillMode: "control-group", RemainAfterExit: "yes",
        Restart: "no", InvocationID: state.invocation };
      return { identity: state.identity, populated: !state.done, launcherPlaced: !state.done,
        launcherIdentity: state.identity, unit };
    },
    assertLauncherCwd(name, observation, expected) {
      const state = units.get(name);
      if (!state || observation.launcherIdentity !== state.identity || observation.unit.InvocationID !== state.invocation)
        throw new Error("simulated original launcher changed");
      // Simulation only: release() will use this same pinned cwd. An adversarial
      // fake directed elsewhere still has to fail the actual directory check.
      const s = statSync(state.workingDirectory, { bigint: true });
      const actual = { device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) };
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("simulated launcher cwd changed");
    },
    async stop(name) {
      const state = units.get(name);
      if (!state) throw new Error("unit absent");
      if (state.child && !state.done) {
        try { process.kill(-state.child.pid, "SIGKILL"); } catch { state.child.kill("SIGKILL"); }
        await new Promise((resolve) => {
          if (state.done) return resolve();
          state.child.once("close", resolve);
        });
      }
      stopped.add(`${name}:${state.invocation}`);
      units.delete(name);
    },
    async terminal(name, invocation) { return stopped.has(`${name}:${invocation}`); },
    // This process/stdio simulator cannot account for detached descendants or
    // pin a real cgroup. It must never issue OS cleanup evidence.
    async originalEmpty() { return undefined; },
  };
}
