const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveCheckTimes, nextCheckAt, labelFor } = require('../lib/wechat_monitor_schedule');

const beijing = (iso) => Date.parse(iso + '+08:00');

test('默认每天 09:00 和 21:00 巡检；环境变量可覆盖、可关闭', () => {
  const def = resolveCheckTimes(undefined);
  assert.deepEqual(def.times, [540, 1260]);
  assert.equal(def.source, 'default');
  assert.equal(def.label, '每天 09:00 / 21:00');
  const custom = resolveCheckTimes('08:30, 12:00,21:15');
  assert.deepEqual(custom.times, [510, 720, 1275]);
  assert.equal(custom.source, 'env');
  assert.deepEqual(resolveCheckTimes('09:00,09:00,21:00').times, [540, 1260]);
  for (const off of ['', 'off', 'INTERVAL', 'none']) {
    const result = resolveCheckTimes(off);
    assert.equal(result.times, null); assert.equal(result.source, 'disabled'); assert.equal(result.label, null);
  }
});

test('非法时点配置回退默认值并标记 invalid，不会静默变成每半小时', () => {
  for (const bad of ['9点', '25:00', '09:60', '09:00,xx']) {
    const result = resolveCheckTimes(bad);
    assert.deepEqual(result.times, [540, 1260]);
    assert.equal(result.source, 'invalid');
  }
});

test('nextCheckAt 计算严格大于当前时间的下一窗口（Asia/Shanghai）', () => {
  const times = [540, 1260];
  assert.equal(nextCheckAt(beijing('2026-11-06T08:00:00'), times), beijing('2026-11-06T09:00:00'));
  assert.equal(nextCheckAt(beijing('2026-11-06T09:00:00'), times), beijing('2026-11-06T21:00:00'));
  assert.equal(nextCheckAt(beijing('2026-11-06T10:30:00'), times), beijing('2026-11-06T21:00:00'));
  assert.equal(nextCheckAt(beijing('2026-11-06T21:00:00'), times), beijing('2026-11-07T09:00:00'));
  assert.equal(nextCheckAt(beijing('2026-11-06T23:59:59'), times), beijing('2026-11-07T09:00:00'));
  assert.equal(nextCheckAt(beijing('2026-11-06T20:59:58'), times), beijing('2026-11-06T21:00:00'));
  assert.equal(nextCheckAt(beijing('2026-12-31T22:00:00'), times), beijing('2027-01-01T09:00:00'));
});

test('单窗口与 label 输出', () => {
  assert.equal(labelFor([540]), '每天 09:00');
  assert.equal(labelFor([]), null);
  assert.equal(nextCheckAt(beijing('2026-11-06T09:00:01'), [540]), beijing('2026-11-07T09:00:00'));
});
