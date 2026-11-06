const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createEventLoopMonitor, lastStall } = require('../lib/event_loop_monitor');

function fakeMonitor(maxNanoseconds) {
  const calls = [];
  return { calls, enable: () => calls.push('enable'), disable: () => calls.push('disable'),
    reset: () => calls.push('reset'), max: maxNanoseconds, mean: maxNanoseconds / 5,
    originalMax: maxNanoseconds };
}

test('事件循环卡顿超过阈值时记录一次 warn，并暴露最近一次卡顿', () => {
  const warnings = [];
  const monitor = fakeMonitor(4_500_000_000); // 4.5s
  const guard = createEventLoopMonitor({ monitor, logger: { warn: (...args) => warnings.push(args) }, thresholdMs: 1000, now: () => 1000 });
  const result = guard.sample();
  assert.deepEqual(result, { at: new Date(1000).toISOString(), maxDelayMs: 4500, meanDelayMs: 900 });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], '[event-loop]');
  assert.equal(warnings[0][1], 'stalled');
  assert.equal(warnings[0][2].maxDelayMs, 4500);
  assert.deepEqual(guard.lastStall(), result);
});

test('未超过阈值或未采样时不报警，lastStall 为空', () => {
  const warnings = [];
  const guard = createEventLoopMonitor({ monitor: fakeMonitor(200_000_000), logger: { warn: (...args) => warnings.push(args) }, thresholdMs: 1000 });
  assert.equal(guard.sample(), null);
  assert.equal(warnings.length, 0);
  assert.equal(guard.lastStall(), null);
  assert.equal(guard.stats().samples, 1);
});

test('共享单例只读访问在未启动时返回 null，不产生副作用', () => {
  assert.equal(lastStall(), null);
});
