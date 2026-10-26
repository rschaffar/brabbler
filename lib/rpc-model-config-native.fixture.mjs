// Test-local N owner for the two genuine model-config SDK cases. No product
// lifetime, cancellation policy, global RPC census, or replacement SDK objects.
import fs from "node:fs";
import fsp, { mkdtemp, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { backendCase } from "./backend-ownership.fixture.mjs";

export function rpcModelConfigNative(t, { prefix, directory = tmpdir(), label }) {
  const hooks = [], owner = backendCase({ after: hook => hooks.push(hook) });
  const failures = new Set(), jobs = [], joins = [], raw = new Set();
  const owned = new Set(), returned = new Set(), closings = new Map(), loaderJobs = [];
  let root, provisioning, closing, watching = false;
  const fail = error => { failures.add(error); };
  const track = promise => {
    jobs.push(promise);
    void promise.catch(() => {});
    return promise;
  };
  const collect = async promises => {
    const results = await Promise.allSettled(promises);
    for (const result of results) if (result.status === "rejected") fail(result.reason);
  };
  const unknown = (operation, error) => {
    fail(error);
    // The exact submitted startup promise failed without returning its owner.
    // Do not infer dispose/native closure from rejection, or sweep the registry.
    fail(new Error(`${operation}: no returned native owner; retained ${root}`, { cause: error }));
  };
  const admit = () => {
    if (closing) {
      const error = new Error("No late model-config native admission");
      fail(error); throw error;
    }
  };
  const close = wrapper => {
    if (closings.has(wrapper)) return closings.get(wrapper);
    const result = (async () => {
      const errors = [];
      try { await wrapper.waitUntilReady(); } catch (error) { errors.push(error); }
      try { await wrapper.inner.abort(); } catch (error) { errors.push(error); }
      // Actual public retirement includes extension shutdown and model refresh.
      // Both abort and shutdown are attempted, and neither may replace the other.
      try { await wrapper.shutdown(); } catch (error) { errors.push(error); }
      if (errors.length) {
        const error = new AggregateError(errors, "Model-config RPC closure failed");
        fail(error); throw error;
      }
    })();
    closings.set(wrapper, result);
    void result.catch(() => {});
    return result;
  };
  // Same early registration/conditional removal as backendCase's other native
  // fixtures. This exists BEFORE mkdtemp, mkdir, environment or fetch mutation.
  owner.remove(async () => { if (root) await rm(root, { recursive: true, force: true }); });
  owner.join(async () => {
    // Release hooks run before this join. Starts capture returned owners before
    // their promises settle; no baseline/global wrapper becomes ours by accident.
    await collect(jobs);
    await collect(joins.map(fn => Promise.resolve().then(fn)));
    const wrappers = new Set([...owned, ...returned, ...closings.keys()]);
    await collect([...wrappers].map(close));
    // Only untransferred raw SDK sessions use direct disposal. It is synchronous
    // SDK cleanup, NOT a native join: full starts/jobs and abort settle first.
    await collect([...raw].filter(inner => ![...wrappers].some(wrapper => wrapper.inner === inner)).map(async inner => {
      const errors = [];
      try { await inner.abort(); } catch (error) { errors.push(error); }
      try { await inner.dispose(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, "Model-config raw SDK closure failed");
    }));
    // Jiti finally starts unlink without awaiting it. Its exact local admissions
    // can grow while a startup/readiness/shutdown producer is still running.
    let cursor = 0;
    while (cursor < loaderJobs.length) {
      const batch = loaderJobs.slice(cursor); cursor = loaderJobs.length;
      await collect(batch);
    }
    if (failures.size) throw new AggregateError([...failures], `${label}; retained ${root}`);
  });
  const finish = () => {
    if (!closing) {
      closing = hooks[0]();
      void closing.catch(() => {});
    }
    return closing;
  };
  // Failed provisioning/setup before a caller's try is still owned. Explicit
  // finally normally reports finish's aggregate, so don't report it twice.
  t.after(() => { if (!closing) return finish(); });
  return {
    owned, fail, close, finish,
    release: fn => owner.release(fn),
    restore: fn => owner.final(fn),
    join: fn => { admit(); joins.push(fn); },
    provision() {
      admit();
      if (!provisioning) provisioning = track(mkdtemp(join(directory, prefix)).then(value => { root = value; return value; }));
      return provisioning;
    },
    start(rpc, ...args) {
      admit();
      const baseline = rpc.getRpcSession(args[0]);
      return track(Promise.resolve().then(() => rpc.startRpcSession(...args)).then(result => {
        if (result.session === baseline && !owned.has(baseline) && !returned.has(baseline)) {
          throw new Error(`Startup returned a pre-existing unowned wrapper: ${args[0]}`);
        }
        returned.add(result.session); owned.add(result.session);
        return result; // Original result and wrapper, not a proxy/fake lifetime.
      }).catch(error => { unknown(`RPC start ${args[0]}`, error); throw error; }));
    },
    servicesStart(invoke) {
      admit();
      // Services have no invented dispose API. Rejection is precise uncertainty.
      return track(Promise.resolve().then(invoke).catch(error => { unknown("SDK services start", error); throw error; }));
    },
    rawStart(invoke) {
      admit();
      return track(Promise.resolve().then(invoke).then(result => {
        raw.add(result.session); return result;
      }).catch(error => { unknown("SDK session start", error); throw error; }));
    },
    watchLoader() {
      admit();
      if (!root || watching) throw new Error("Local loader owner requires one provisioned root");
      watching = true;
      const loaderRoot = resolve(root, "jiti-esm");
      const selected = value => {
        const path = value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : value;
        if (typeof path !== "string") return false;
        const absolute = resolve(path);
        return absolute === loaderRoot || absolute.startsWith(`${loaderRoot}${sep}`);
      };
      const install = (target, name, observe) => {
        const descriptor = Object.getOwnPropertyDescriptor(target, name);
        const original = descriptor.value;
        function wrapped(...args) {
          if (!selected(args[0])) return Reflect.apply(original, this, args);
          try {
            const result = Reflect.apply(original, this, args);
            if (observe) { loaderJobs.push(result); void result.catch(() => {}); }
            return result;
          } catch (error) { fail(error); throw error; }
        }
        owner.final(() => {
          const errors = [];
          if (target[name] !== wrapped) errors.push(new Error(`Local Jiti ${name} observer drift`));
          try { Object.defineProperty(target, name, descriptor); } catch (error) { errors.push(error); }
          if (errors.length) throw new AggregateError(errors, `Local Jiti ${name} restoration failed`);
        });
        Object.defineProperty(target, name, { ...descriptor, value: wrapped });
      };
      // Exact pinned Jiti L3 ports, not arbitrary native-idle inference. Sync
      // mkdir/write finish at return; retain swallowed failures too. Promise
      // unlink remains owned through its actual completion and restoration.
      try {
        install(fs, "mkdirSync", false);
        install(fs, "writeFileSync", false);
        install(fsp, "unlink", true);
      } finally {
        owner.final(() => syncBuiltinESMExports());
        syncBuiltinESMExports();
      }
    },
  };
}
