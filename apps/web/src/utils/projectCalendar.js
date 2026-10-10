export function calendarDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localDate(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day || 1, 12);
}

export function shiftCalendarDay(key, amount) {
  const date = localDate(key);
  date.setDate(date.getDate() + amount);
  return calendarDateKey(date);
}

export function shiftCalendarMonth(month, amount) {
  const date = localDate(`${month}-01`);
  date.setMonth(date.getMonth() + amount);
  return calendarDateKey(date).slice(0, 7);
}

export function calendarMonthDays(month) {
  const first = localDate(`${month}-01`);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => shiftCalendarDay(`${month}-01`, index - offset));
}

export function selectCalendarRange(filter, endpoint, value) {
  if (endpoint === 'from' || !filter.from) return { from: value, to: '' };
  return value < filter.from ? { from: value, to: filter.from } : { from: filter.from, to: value };
}
