// Read-only admission estimates, never reservations or cgroup management.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function availableResources({ read = file => fs.readFileSync(file, 'utf8'),
  cpus = os.availableParallelism(), memory = os.freemem() } = {}) {
  // Linux free pages exclude reclaimable cache. Using freemem made an idle,
  // cache-warm host refuse workers despite tens of GiB of MemAvailable.
  try {
    const available = read('/proc/meminfo').match(/^MemAvailable:\s+(\d+) kB$/m)?.[1];
    if (available) memory = Number(available) * 1024;
  } catch { /* Non-Linux hosts retain the conservative OS free-page estimate. */ }
  const base = '/sys/fs/cgroup';
  try {
    const membership = read('/proc/self/cgroup').match(/^0::(.*)$/m)?.[1];
    let directory = membership ? path.resolve(base, `.${membership}`) : base;
    if (directory !== base && !directory.startsWith(base + '/')) directory = base;
    for (;;) {
      try {
        const [quota, period] = read(path.join(directory, 'cpu.max')).trim().split(/\s+/);
        if (quota !== 'max' && Number(quota) > 0 && Number(period) > 0) {
          cpus = Math.min(cpus, Math.max(1, Math.floor(Number(quota) / Number(period))));
        }
      } catch { /* Affinity remains binding if this level has no v2 quota. */ }
      try {
        const maximum = read(path.join(directory, 'memory.max')).trim();
        const current = Number(read(path.join(directory, 'memory.current')).trim());
        if (/^\d+$/.test(maximum) && Number.isFinite(current) && current >= 0) {
          // Do not assume cache within a hard cgroup limit is reclaimable.
          memory = Math.min(memory, Math.max(0, Number(maximum) - current));
        }
      } catch { /* Host MemAvailable remains the estimate without a v2 cap. */ }
      if (directory === base) break;
      directory = path.dirname(directory);
    }
  } catch { /* Non-v2 hosts retain affinity and OS memory admission. */ }
  return { cpus, memory, scope: 'Read-only available CPU/memory estimate, not a machine-wide reservation' };
}
