const crypto = require('node:crypto');

function integer(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min ? Math.min(max, Math.floor(number)) : fallback;
}

function identifier(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 4294967295 ? number : null;
}

function redactSearchText(value, maxLength = 160) {
  if (typeof value !== 'string') return '';
  return value.slice(0, 2000)
    .replace(/https?:\/\/[^\s<>]+/gi, '[link]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{10,}/g, '[key]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token]')
    .replace(/((?:api[_-]?key|token|password|密码|密钥|验证码)\s*[:=：]\s*)[^\s,，;；]+/gi, '$1[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[phone]')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function sanitizePlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const plan = {};
  for (const key of ['mustTerms', 'shouldTerms', 'excludeTerms', 'people', 'excludePeople', 'photographers', 'projects', 'timelineSections']) {
    if (Array.isArray(input[key])) plan[key] = input[key].slice(0, 12).map(value => redactSearchText(value, 64)).filter(Boolean);
  }
  for (const key of ['peopleMode', 'mediaType', 'quality', 'sort', 'dateFrom', 'dateTo']) {
    if (typeof input[key] === 'string') plan[key] = redactSearchText(input[key], 32);
  }
  if (typeof input.peopleOnly === 'boolean') plan.peopleOnly = input.peopleOnly;
  if (Array.isArray(input.termGroups)) plan.termGroups = input.termGroups.slice(0, 8)
    .map(group => Array.isArray(group) ? group.slice(0, 8).map(value => redactSearchText(value, 64)).filter(Boolean) : []).filter(group => group.length);
  if (input.visual?.source === 'local-person-vision') {
    plan.visual = { source:'local-person-vision',coverageComplete:input.visual.coverageComplete===true,
      unavailable:input.visual.unavailable===true };
    for (const key of ['candidateCount','checked','pending','uncertain']) plan.visual[key] = integer(input.visual[key],0,0,1000);
  }
  return plan;
}

function searchRequestLogTarget(req) {
  const rootCallback = req.path === '/' && Object.keys(req.query || {}).some(key => ['code', 'state', 'error'].includes(key));
  return rootCallback || /^(?:\/api\/photos\/search\/?$|\/api\/auth\/)/i.test(req.path || '') ? req.path : req.url;
}

function buildSearchEvent(input, { now = Date.now(), retentionDays = 30 } = {}) {
  const orgId = identifier(input.orgId);
  const userId = identifier(input.userId);
  const page = integer(input.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const q = redactSearchText(input.q);
  if (!input.authorized || input.demo || !orgId || !userId || page !== 1 || !q) return null;
  const search = input.result?.search || {};
  const sqlDate = value => new Date(value).toISOString().slice(0, 23).replace('T', ' ');
  return {
    eventId: crypto.randomUUID(), organizationId: orgId,
    unitId: identifier(input.unitId),
    projectId: identifier(input.projectId),
    query: q, requestedAi: input.smart === true,
    mode: ['ai', 'enhanced', 'literal'].includes(search.mode) ? search.mode : null,
    aiUsed: search.aiUsed === true, cached: search.cached === true,
    degraded: search.degraded === true, relaxed: search.relaxed === true,
    resultCount: input.errorCode ? null : integer(input.result?.total, null, 0, 4294967295),
    durationMs: integer(input.durationMs, 0, 0, 86400000),
    plan: sanitizePlan(search.plan ? {...search.plan,visual:search.visual} : null), originalPlan: sanitizePlan(search.originalPlan),
    errorCode: ['SEARCH_TIMEOUT', 'SEARCH_FAILED'].includes(input.errorCode) ? input.errorCode : null,
    createdAt: sqlDate(now), expiresAt: sqlDate(now + retentionDays * 86400000),
  };
}

const INSERT_COLUMNS = ['event_id', 'organization_id', 'unit_id', 'project_id', 'query_text', 'requested_ai',
  'search_mode', 'ai_used', 'cache_hit', 'degraded', 'relaxed', 'result_count', 'duration_ms',
  'query_plan', 'original_plan', 'error_code', 'created_at', 'expires_at'];

function createSearchTelemetry({ pool, env = process.env, now = Date.now, logger = console, autoFlush = true } = {}) {
  const enabled = env.SEARCH_TELEMETRY_ENABLED !== '0';
  const retentionDays = integer(env.SEARCH_TELEMETRY_RETENTION_DAYS, 30, 1, 180);
  const maxQueue = integer(env.SEARCH_TELEMETRY_MAX_QUEUE, 200, 1, 2000);
  const batchSize = Math.min(maxQueue, 20);
  const queue = [];
  const stats = { accepted: 0, stored: 0, dropped: 0, writeFailures: 0 };
  let active = null;
  let timer = null;
  let cleanupTimer = null;
  let cleanupInterval = null;
  let cleanupActive = null;
  let suspendedUntil = 0;
  let closed = false;

  function warn(error) {
    // Never send query text, SQL parameters, or upstream error messages into process logs.
    const code = /^[A-Z0-9_]{1,40}$/.test(error?.code || '') ? error.code : 'WRITE_FAILED';
    logger.warn?.(`[search-telemetry] ${code}; search responses are unaffected`);
  }

  function schedule() {
    if (!autoFlush || closed || timer || active || !queue.length) return;
    timer = setTimeout(() => { timer = null; void flush(); }, 100);
    timer.unref?.();
  }

  function record(input) {
    if (!enabled || closed) return null;
    const event = buildSearchEvent(input, { now: now(), retentionDays });
    if (!event) return null;
    if (now() < suspendedUntil || queue.length >= maxQueue) { stats.dropped += 1; return null; }
    queue.push(event); stats.accepted += 1; schedule();
    return event.eventId;
  }

  function flush() {
    if (active) return active;
    if (!queue.length) return Promise.resolve();
    if (timer) { clearTimeout(timer); timer = null; }
    const batch = queue.splice(0, batchSize);
    const rows = batch.map(event => [event.eventId, event.organizationId, event.unitId, event.projectId, event.query,
      Number(event.requestedAi), event.mode, Number(event.aiUsed), Number(event.cached), Number(event.degraded),
      Number(event.relaxed), event.resultCount, event.durationMs,
      event.plan ? JSON.stringify(event.plan) : null, event.originalPlan ? JSON.stringify(event.originalPlan) : null,
      event.errorCode, event.createdAt, event.expiresAt]);
    const sql = `INSERT INTO photo_search_events (${INSERT_COLUMNS.join(', ')}) VALUES ${rows.map(() => '(' + INSERT_COLUMNS.map(() => '?').join(',') + ')').join(',')}`;
    active = Promise.resolve().then(() => pool.query({ sql, timeout: 2000 }, rows.flat()))
      .then(() => { stats.stored += batch.length; })
      .catch(error => {
        stats.writeFailures += 1;
        stats.dropped += batch.length + queue.length;
        queue.length = 0;
        suspendedUntil = now() + 60000;
        warn(error);
      }).finally(() => { active = null; schedule(); });
    return active;
  }

  function pruneExpired() {
    if (!enabled) return Promise.resolve({ deleted: 0, more: false });
    if (cleanupActive) return cleanupActive;
    cleanupActive = (async () => {
      let deleted = 0;
      for (let batch = 0; batch < 10; batch += 1) {
        const [result] = await pool.query({
          sql: 'DELETE FROM photo_search_events WHERE expires_at <= UTC_TIMESTAMP(3) ORDER BY expires_at LIMIT 1000', timeout: 2000,
        });
        const count = Number(result.affectedRows) || 0;
        deleted += count;
        if (count < 1000) return { deleted, more: false };
      }
      return { deleted, more: true };
    })().catch(error => { warn(error); return { deleted: 0, more: false }; })
      .finally(() => { cleanupActive = null; });
    return cleanupActive;
  }

  async function sweep() {
    const result = await pruneExpired();
    if (result.more && !closed && !cleanupTimer) {
      cleanupTimer = setTimeout(() => { cleanupTimer = null; void sweep(); }, 60000);
      cleanupTimer.unref?.();
    }
  }

  function start() {
    if (!enabled || closed || cleanupInterval) return;
    cleanupTimer = setTimeout(() => { cleanupTimer = null; void sweep(); }, 10000);
    cleanupTimer.unref?.();
    cleanupInterval = setInterval(() => void sweep(), 3600000);
    cleanupInterval.unref?.();
  }

  async function stop() {
    closed = true;
    clearTimeout(timer); clearTimeout(cleanupTimer); clearInterval(cleanupInterval);
    if (active) await active;
    while (queue.length) await flush();
    if (cleanupActive) await cleanupActive;
  }

  return { record, flush, start, stop, pruneExpired, getStats: () => ({ ...stats, queued: queue.length }) };
}

let singleton;
function instance() {
  if (!singleton) singleton = createSearchTelemetry({ pool: require('../db').pool });
  return singleton;
}

// This helper isolates telemetry failures from the request handler, including unexpected input errors.
function recordSearchTelemetry(input) {
  try { return instance().record(input); } catch { return null; }
}

module.exports = { buildSearchEvent, redactSearchText, createSearchTelemetry, recordSearchTelemetry, searchRequestLogTarget,
  startSearchTelemetry: () => instance().start(), stopSearchTelemetry: () => singleton?.stop() };
