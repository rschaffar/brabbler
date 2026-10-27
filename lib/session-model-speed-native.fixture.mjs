// Test-local composition of the actual backendCase, following the current G2
// returned-owner recipe. No product lifetime or native admission policy.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backendCase } from "./backend-ownership.fixture.mjs";

export function speedLifecycleNative(t, { directory = tmpdir() } = {}) {
  const hooks = [], owner = backendCase({ after: hook => hooks.push(hook) });
  const failures = new Set(), jobs = [], owned = new Set(), closings = new Map();
  let root, provisioning, closing;
  const fail = error => { failures.add(error); };
  const track = promise => { jobs.push(promise); void promise.catch(() => {}); return promise; };
  const collect = async promises => {
    const results = await Promise.allSettled(promises);
    for (const result of results) if (result.status === "rejected") fail(result.reason);
  };
  const unknown = (label, error) => {
    fail(error);
    fail(new Error(`${label}: no certified returned native owner; retained ${root}`, { cause: error }));
  };
  const retain = wrapper => {
    if (!wrapper) throw new Error("Speed lifecycle expected a returned wrapper");
    owned.add(wrapper); return wrapper;
  };
  const close = wrapper => {
    if (closings.has(wrapper)) return closings.get(wrapper);
    const result = (async () => {
      const errors = [];
      try { await wrapper.waitUntilReady(); } catch (error) { errors.push(error); }
      let alive = true;
      try { alive = wrapper.isAlive(); } catch (error) { errors.push(error); }
      if (alive) {
        try { await wrapper.inner.abort(); } catch (error) { errors.push(error); }
        try { await wrapper.inner.waitForIdle(); } catch (error) { errors.push(error); }
      }
      // Always attempt the SAME wrapper's original public retirement, even
      // after readiness, alive-query, abort or idle failure. Retired peers count.
      try { await wrapper.shutdown(); } catch (error) { errors.push(error); }
      if (errors.length) {
        const error = new AggregateError(errors, "Speed lifecycle wrapper closure failed");
        fail(error); throw error;
      }
    })();
    closings.set(wrapper, result); void result.catch(() => {}); return result;
  };
  // Both contracts are registered BEFORE provisioning or caller setup.
  owner.remove(async () => { if (root) await rm(root, { recursive: true, force: true }); });
  owner.join(async () => {
    // Admitted child construction can append its full completion before the
    // original start job settles. No registry census or future-work certificate.
    let cursor = 0;
    while (cursor < jobs.length) {
      const batch = jobs.slice(cursor); cursor = jobs.length;
      await collect(batch);
    }
    await collect([...owned].map(close));
    if (failures.size) throw new AggregateError([...failures], `Speed lifecycle uncertain; retained ${root}`);
  });
  const finish = () => {
    if (!closing) { closing = hooks[0](); void closing.catch(() => {}); }
    return closing;
  };
  t.after(() => { if (!closing) return finish(); });
  return {
    fail, retain, close, finish,
    release: fn => owner.release(fn),
    restore: fn => owner.final(fn),
    work: promise => track(promise),
    provision() {
      if (closing) throw new Error("No late speed lifecycle provisioning");
      if (!provisioning) provisioning = track(mkdtemp(join(directory, "brabbler-speed-lifecycle-")).then(value => { root = value; return value; }));
      return provisioning;
    },
    operation(label, invoke, capture) {
      if (closing) throw new Error("No late speed lifecycle root operation");
      return track(Promise.resolve().then(invoke).then(value => {
        capture(value); return value; // Capture before the tracked start resolves.
      }).catch(error => { unknown(label, error); throw error; }));
    },
    construct(inner, createWrapper) {
      try { return retain(createWrapper(inner)); }
      catch (error) {
        // The caller/controller still owns its unregistered inner. Do not
        // invent successful disposal of an unreturned/partial constructor.
        unknown("SDK wrapper construction", error); throw error;
      }
    },
  };
}
