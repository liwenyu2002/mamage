// 推文观察的定时巡检窗口：默认每天 09:00、21:00（Asia/Shanghai）。
// 固定时点比“每 30 分钟”更省请求、也更容易向运营解释；需要时可改环境变量，
// 或设为 off 退回旧的按 interval_seconds 调度。
const DEFAULT_TIMES = '09:00,21:00';
const LOCAL_OFFSET_MS = 8 * 3600000; // 北京时间无夏令时，固定 +08:00
const MAX_TIMES = 12;

function parseTimes(value) {
  return String(value || '').split(',').map(part => part.trim()).filter(Boolean).map(part => {
    const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(part);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  });
}

// 返回 { times: number[]|null, source: 'env'|'default'|'disabled'|'invalid', label }
function resolveCheckTimes(raw = process.env.WECHAT_MONITOR_CHECK_TIMES) {
  if (raw === undefined) return finish(parseTimes(DEFAULT_TIMES), 'default');
  const text = String(raw).trim();
  if (['', 'off', 'interval', 'none'].includes(text.toLowerCase())) return { times: null, source: 'disabled', label: null };
  const times = parseTimes(text);
  if (!times.length || times.some(value => value === null) || times.length > MAX_TIMES) {
    // 配置写错时不能悄悄退化成“每 30 分钟”：回退默认时点并标记 invalid，便于日志/界面提示。
    return finish(parseTimes(DEFAULT_TIMES), 'invalid');
  }
  return finish(times, 'env');
}
function finish(times, source) {
  const sorted = [...new Set(times)].sort((a, b) => a - b);
  return { times: sorted, source, label: labelFor(sorted) };
}
function labelFor(times) {
  if (!times || !times.length) return null;
  return '每天 ' + times.map(minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`).join(' / ');
}
// 计算严格大于 now 的下一个巡检时点；按时点=分钟数（本地零点起），返回毫秒时间戳。
function nextCheckAt(nowMs, times) {
  if (!Array.isArray(times) || !times.length) return null;
  const local = Number(nowMs) + LOCAL_OFFSET_MS;
  const localMidnight = Math.floor(local / 86400000) * 86400000;
  for (const minute of times) {
    const at = localMidnight + minute * 60000 - LOCAL_OFFSET_MS;
    if (at > Number(nowMs)) return at;
  }
  return localMidnight + 86400000 + times[0] * 60000 - LOCAL_OFFSET_MS;
}

module.exports = { DEFAULT_TIMES, resolveCheckTimes, nextCheckAt, labelFor, LOCAL_OFFSET_MS };
