const EXTENDED_KINDS = new Set(['semantic', 'photo-description', 'person-visual', 'face', 'public-download', 'image-similarity']);
const DELAYS = [15000, 60000, 300000, 900000, 3600000, 21600000];
const STAGES = new Set(['source', 'prepare', 'generate', 'review', 'detect', 'cluster', 'persist', 'process']);
const NETWORK = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'ABORT_ERR', 'SERVER_DRAINING', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'PROTOCOL_CONNECTION_LOST']);

function safeCode(value) {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{0,95}$/.test(value)) return null;
  return NETWORK.has(value) || /^(HUB_|DESCRIPTION_|PERSON_VISUAL_|VISUAL_|FACE_|PUBLIC_DOWNLOAD_|IMAGE_|AI_|ER_)/.test(value) ? value : null;
}

function errorDetails(error) {
  const details = { code: 'BACKGROUND_TASK_FAILED' };
  const seen = new Set();
  let node = error;
  for (let depth = 0; node && !seen.has(node) && depth < 5; depth++, node = node.cause) {
    seen.add(node);
    const code = safeCode(node.code) || safeCode(typeof node.message === 'string' ? node.message.split(':')[0] : null)
      || (node.name === 'TimeoutError' ? 'AI_REQUEST_TIMEOUT' : node.name === 'AbortError' ? 'AI_REQUEST_ABORTED' : null);
    if (code) {
      if (details.code === 'BACKGROUND_TASK_FAILED') details.code = code;
      else details.causeCode = code;
    }
    const causeCode = safeCode(node.causeCode);
    if (causeCode) details.causeCode = causeCode;
    if (!details.stage && STAGES.has(node.stage)) details.stage = node.stage;
    const status = Number(node.httpStatus || node.statusCode || node.status || node.$metadata?.httpStatusCode
      || /HUB_HTTP_(\d{3})/.exec(code || '')?.[1]);
    if (Number.isInteger(status) && status >= 100 && status <= 599) details.httpStatus = status;
    if (['zgcai', 's3', 'mysql', 'local'].includes(node.provider)) details.provider = node.provider;
    if (['empty', 'truncated', 'invalid-json', 'schema', 'oversize', 'content', 'network', 'http'].includes(node.reason)) details.reason = node.reason;
    if (['stop', 'length', 'content_filter', 'error'].includes(node.finishReason)) details.finishReason = node.finishReason;
    if (Number.isFinite(node.retryAfterMs) && node.retryAfterMs > 0) details.retryAfterMs = Math.min(21600000, Math.ceil(node.retryAfterMs));
  }
  if (!details.provider && [details.code, details.causeCode].some(code => code?.startsWith('HUB_'))) details.provider = 'zgcai';
  return details;
}

function taskError(code, { stage, cause, ...metadata } = {}) {
  const details = errorDetails(cause);
  return Object.assign(new Error(code), details, metadata, { code, ...(STAGES.has(stage) ? { stage } : {}),
    ...(details.causeCode || details.code !== 'BACKGROUND_TASK_FAILED' ? { causeCode: details.causeCode || details.code } : {}) });
}

function planFailure(error, { kind, attempt = 1, now = Date.now(), random = Math.random } = {}) {
  const details = errorDetails(error);
  const root = details.causeCode || details.code;
  const permanent = [400, 401, 403, 404, 410, 413, 415, 422].includes(details.httpStatus)
    || /CONFIG|COMPATIBILITY_NOT_APPROVED|INPUT_INVALID|CONDITIONS_INVALID|IMAGE_(INVALID|TOO_LARGE|NOT_FOUND)|SOURCE_(MISSING|INVALID|TOO_LARGE)|EMPTY_SOURCE|PROVIDER_UNAVAILABLE|^ER_(BAD_FIELD_ERROR|NO_SUCH_TABLE|ACCESS_DENIED_ERROR|DBACCESS_DENIED_ERROR)$/.test(root);
  const transient = !permanent && (NETWORK.has(root) || /TIMEOUT|ABORTED|REQUEST_FAILED|OUTPUT_INVALID|REVIEW_(UNAVAILABLE|EMPTY)|GENERATION_EMPTY|SOURCE_UNAVAILABLE/.test(root)
    || details.httpStatus === 408 || details.httpStatus === 429 || details.httpStatus >= 500);
  const limit = permanent ? 1 : transient && EXTENDED_KINDS.has(kind) ? 7 : 3;
  const retry = attempt < limit;
  const base = DELAYS[attempt - 1] || DELAYS.at(-1);
  const jitter = Math.max(0, Math.min(1, Number(random()) || 0));
  const retryAt = retry ? now + Math.max(Math.ceil(base * (1 + jitter * 0.2)), details.retryAfterMs || 0) : null;
  const diagnostic = { ...details, stage: details.stage || 'process', attempt, retryable: !permanent,
    disposition: retry ? 'retry' : permanent ? 'permanent' : 'exhausted', nextRetryAt: retryAt };
  return { status: retry ? 'queued' : 'failed', availableAt: retryAt || now, diagnostic };
}

async function recordFailure(pool, job, owner, plan) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [updated] = await conn.query("UPDATE runtime_tasks SET status = ?, available_at = ?, last_error = ? WHERE id = ? AND owner = ? AND status = 'running'",
      [plan.status, plan.availableAt, JSON.stringify(plan.diagnostic), job.id, owner]);
    if (updated.affectedRows) {
      let payload = job.payload;
      try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch { payload = null; }
      const photoId = EXTENDED_KINDS.has(job.kind) ? Number(payload?.photoId || payload?.insertedId || payload?.id) : 0;
      const d = plan.diagnostic;
      await conn.query(`INSERT INTO runtime_task_failures
        (task_id, kind, photo_id, attempt, stage, error_code, cause_code, http_status, retry_at, diagnostic)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [job.id, job.kind, Number.isSafeInteger(photoId) && photoId > 0 ? photoId : null, d.attempt, d.stage,
        d.code, d.causeCode || null, d.httpStatus || null, d.nextRetryAt, JSON.stringify(d)]);
    }
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

module.exports = { errorDetails, taskError, planFailure, recordFailure };
