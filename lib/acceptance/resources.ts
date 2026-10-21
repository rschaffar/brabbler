import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Admission estimates for this server's cooperative scheduler, not OS reservations. */
export function acceptanceResources() {
  let cpus = os.availableParallelism(), memory = os.freemem();
  const available = fs.readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+) kB$/m)?.[1];
  if (available) memory = Number(available) * 1024;
  const base = "/sys/fs/cgroup";
  let dir = path.resolve(base, "." + (fs.readFileSync("/proc/self/cgroup", "utf8").match(/^0::(.*)$/m)?.[1] ?? "/"));
  if (dir !== base && !dir.startsWith(base + "/")) throw new Error("Invalid resource cgroup");
  for (;;) {
    try {
      const [quota, period] = fs.readFileSync(path.join(dir, "cpu.max"), "utf8").trim().split(/\s+/);
      if (quota !== "max") cpus = Math.min(cpus, Math.max(1, Math.floor(Number(quota) / Number(period))));
      const maximum = fs.readFileSync(path.join(dir, "memory.max"), "utf8").trim();
      if (/^\d+$/.test(maximum)) memory = Math.min(memory, Math.max(0, Number(maximum) - Number(fs.readFileSync(path.join(dir, "memory.current"), "utf8"))));
    } catch { /* Host/affinity bounds remain when cgroup controllers are unavailable. */ }
    if (dir === base) break;
    dir = path.dirname(dir);
  }
  return { cpus, memoryMiB: Math.floor(memory / 1024 ** 2) };
}
