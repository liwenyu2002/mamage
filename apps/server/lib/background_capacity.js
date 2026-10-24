const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const { bounded } = require('./runtime_lifecycle');

function createDispatchGuard({ env = process.env, now = Date.now, readFile = file => fs.readFileSync(file, 'utf8'),
  memoryUsage = () => process.memoryUsage().rss, utilization = previous => performance.eventLoopUtilization(previous), logger = console } = {}) {
  const maxBytes = bounded(env.RUNTIME_MEMORY_HIGH_MB, 3072, 128, 65536) * 1024 * 1024;
  const reserveBytes = bounded(env.RUNTIME_HOST_RESERVE_MB, 1024, 128, 65536) * 1024 * 1024;
  let previousUtilization = utilization(); let sampledAt = -Infinity; let paused = false; let snapshot = {};
  const read = file => { try { return readFile(file); } catch { return null; } };
  function canDispatch() {
    if (now() - sampledAt < 1000) return !paused;
    sampledAt = now();
    const current = utilization(previousUtilization); previousUtilization = utilization();
    const cgroupLimit = Number(read('/sys/fs/cgroup/memory.max'));
    const cgroupMemory = Number(read('/sys/fs/cgroup/memory.current'));
    const used = cgroupMemory > 0 ? cgroupMemory : memoryUsage();
    const high = cgroupLimit > 0 ? Math.min(maxBytes, cgroupLimit * 0.75) : maxBytes;
    const meminfo = read('/proc/meminfo') || '';
    // macOS free RAM excludes reclaimable/compressed memory; do not treat it as pressure.
    const availableKiB = meminfo.match(/^MemAvailable:\s+(\d+)/m)?.[1];
    const available = availableKiB === undefined ? Infinity : Number(availableKiB) * 1024;
    const busy = current.utilization || 0;
    const wasPaused = paused;
    if (used >= high || available < reserveBytes || busy > 0.85) paused = true;
    else if (used < high * 0.85 && available > reserveBytes * 1.25 && busy < 0.7) paused = false;
    snapshot = { paused, memoryBytes: used, memoryHighBytes: high, hostAvailableBytes: available, eventLoopUtilization: busy };
    if (paused !== wasPaused) logger.info?.('[runtime-capacity]', paused ? 'paused' : 'resumed', snapshot);
    return !paused;
  }
  return { canDispatch, snapshot: () => ({ ...snapshot }) };
}

module.exports = { createDispatchGuard };
