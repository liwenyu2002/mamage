const { monitorEventLoopDelay } = require('node:perf_hooks');

// 事件循环卡顿诊断：单实例 API 同时跑图片/AI 重活时，长同步任务会把事件循环占满，
// 表现为 /api/health/live 超时（2026-11-03 被 liveness 误杀，exit 137）。
// 这里只做观测：每 intervalMs 采样一次，超过阈值就记一条 warn，并把最近一次卡顿
// 暴露给运维状态页/告警，便于下次定位是哪种任务造成的，不改变请求行为。
function createEventLoopMonitor({ monitor, logger = console, thresholdMs = 1000, intervalMs = 10000, now = Date.now } = {}) {
  const histogram = monitor || monitorEventLoopDelay({ resolution: 20 });
  let timer = null;
  let last = null;
  let samples = 0;
  function sample() {
    const maxDelayMs = Math.round((histogram.max || 0) / 1e6);
    const meanDelayMs = Math.round((histogram.mean || 0) / 1e6);
    samples += 1;
    histogram.reset();
    if (maxDelayMs < thresholdMs) return null;
    last = { at: new Date(now()).toISOString(), maxDelayMs, meanDelayMs };
    logger.warn?.('[event-loop]', 'stalled', last);
    return last;
  }
  function start() {
    if (timer) return;
    histogram.enable();
    timer = setInterval(sample, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    histogram.disable?.();
  }
  return { start, stop, sample, lastStall: () => (last ? { ...last } : null), stats: () => ({ samples, thresholdMs }) };
}

let shared = null;
// app 启动时用环境变量初始化单例；operations_status 只读它（未启动时返回 null，不创建副作用）。
function eventLoopMonitor(options = {}) {
  if (!options.__readOnly && !shared) {
    const thresholdMs = Number(options.thresholdMs ?? process.env.EVENT_LOOP_STALL_MS) || 1000;
    shared = createEventLoopMonitor({ ...options, thresholdMs });
  }
  return shared;
}
function lastStall() {
  const value = shared?.lastStall?.();
  return value ? { ...value, thresholdMs: shared.stats().thresholdMs } : null;
}
module.exports = { createEventLoopMonitor, eventLoopMonitor, lastStall };
