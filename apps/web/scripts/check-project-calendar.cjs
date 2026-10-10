const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const babel = require('@babel/core');
const source = fs.readFileSync(path.resolve(__dirname, '../src/utils/projectCalendar.js'), 'utf8');
const exportsObject = {};
vm.runInNewContext(babel.transformSync(source, { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }).code,
  { exports: exportsObject, Date });
const { calendarDateKey, shiftCalendarDay, shiftCalendarMonth, calendarMonthDays, selectCalendarRange } = exportsObject;
assert.equal(calendarDateKey(new Date(2026, 9, 10)), '2026-10-10');
assert.equal(shiftCalendarDay('2024-02-28', 1), '2024-02-29');
assert.equal(shiftCalendarDay('2026-02-28', 1), '2026-03-01');
assert.equal(shiftCalendarDay('2026-01-01', -1), '2025-12-31');
assert.equal(shiftCalendarMonth('2026-12', 1), '2027-01');
assert.equal(shiftCalendarMonth('2026-01', -1), '2025-12');
for (const month of ['2024-02', '2026-02', '2026-03', '2026-10', '2026-12']) {
  const days = calendarMonthDays(month);
  assert.equal(days.length, 42);
  assert.equal(new Set(days).size, 42);
  assert.equal(new Date(`${days[0]}T12:00:00`).getDay(), 1, 'week starts on Monday');
  assert(days.includes(`${month}-01`));
  for (let index = 1; index < days.length; index++) assert.equal(days[index], shiftCalendarDay(days[index - 1], 1));
}
const same = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(same(selectCalendarRange({ from: '2026-10-01', to: '2026-10-10' }, 'from', '2026-10-20')), { from: '2026-10-20', to: '' });
assert.deepEqual(same(selectCalendarRange({ from: '2026-10-20', to: '' }, 'to', '2026-10-10')), { from: '2026-10-10', to: '2026-10-20' });
assert.deepEqual(same(selectCalendarRange({ from: '2026-10-20', to: '' }, 'to', '2026-10-20')), { from: '2026-10-20', to: '2026-10-20' });
assert.deepEqual(same(selectCalendarRange({}, 'to', '2026-10-20')), { from: '2026-10-20', to: '' });
console.log('Calendar dates, leap years, month boundaries and reverse range selection passed.');
