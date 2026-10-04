// Test-only leftover data from the retired application gate/placement registries.
// This does not acquire, inspect or enforce any lock/lease. It proves stale
// application bookkeeping is inert, NOT native transaction concurrency.
export function seedRetiredGitBookkeeping(cwds, host = globalThis) {
  const gateKey = Symbol.for("pi-web:git-checkout-gate");
  const usageKey = Symbol.for("pi-web.git-workspace-usage.v1");
  const previous = [gateKey, usageKey].map((key) => Object.getOwnPropertyDescriptor(host, key));
  host[gateKey] = { paths: new Set(cwds) };
  host[usageKey] = {
    placements: new Map(cwds.map((cwd) => [{}, { named: cwd, physical: cwd }])),
    leases: new Map(cwds.map((cwd) => [{}, { named: cwd, physical: cwd,
      identity: { device: "retired", inode: "retired", birthtime: "retired" } }])),
  };
  return () => {
    for (const [index, key] of [gateKey, usageKey].entries()) {
      if (previous[index]) Object.defineProperty(host, key, previous[index]);
      else delete host[key];
    }
  };
}
