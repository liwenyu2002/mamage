const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createDispatchGuard } = require('../lib/background_capacity');

function fixture() {
  let at = 0; let memory = 512 * 1024 ** 2; let available = 4 * 1024 ** 3; let busy = 0.1;
  const guard = createDispatchGuard({ env: {}, now: () => at,
    readFile(file) {
      if (file.endsWith('memory.max')) return String(4 * 1024 ** 3);
      if (file.endsWith('memory.current')) return String(memory);
      if (file === '/proc/meminfo') return `MemAvailable: ${available / 1024} kB\n`;
      throw Error('missing');
    }, utilization: () => ({ utilization: busy }) });
  return { guard, sample(values = {}) {
    at += 1001; if (values.memory !== undefined) memory = values.memory;
    if (values.available !== undefined) available = values.available;
    if (values.busy !== undefined) busy = values.busy;
    return guard.canDispatch();
  } };
}

test('healthy server permits work and repeated samples are cached', () => {
  const f = fixture(); assert.equal(f.sample(), true); assert.equal(f.guard.canDispatch(), true);
});
test('container pressure pauses until memory recovers below low watermark', () => {
  const f = fixture(); assert.equal(f.sample({ memory: 3.1 * 1024 ** 3 }), false);
  assert.equal(f.sample({ memory: 2.8 * 1024 ** 3 }), false);
  assert.equal(f.sample({ memory: 2 * 1024 ** 3 }), true);
});
test('host memory is reserved for database and foreground requests', () => {
  const f = fixture(); assert.equal(f.sample({ available: 512 * 1024 ** 2 }), false);
  assert.equal(f.sample({ available: 2 * 1024 ** 3 }), true);
});
test('busy event loop pauses background dispatch without stopping existing jobs', () => {
  const f = fixture(); assert.equal(f.sample({ busy: 0.95 }), false);
  assert.equal(f.sample({ busy: 0.8 }), false); assert.equal(f.sample({ busy: 0.2 }), true);
});
test('non-Linux runtime falls back to process RSS rather than failing', () => {
  const guard = createDispatchGuard({ env: {}, readFile: () => { throw Error('unavailable'); },
    memoryUsage: () => 128 * 1024 ** 2, utilization: () => ({ utilization: 0.1 }) });
  assert.equal(guard.canDispatch(), true);
});
