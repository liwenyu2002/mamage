const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { schoolIntegrationReadiness } = require('./school_integrations');

function alertsFor(status, now = Date.now()) {
  const alerts = [];
  if (status.system.disk?.availableBytes < 10 * 1024 ** 3) alerts.push({ code: 'DISK_LOW', severity: 'critical', title: '服务器磁盘空间不足' });
  if (status.analysis.failed > 0) alerts.push({ code: 'ANALYSIS_FAILED', severity: 'warning', title: `${status.analysis.failed} 条媒体分析失败` });
  if (status.tasks.some(task => ['queued', 'running'].includes(task.status) && Number(task.oldestAgeSeconds) > 3600)) {
    alerts.push({ code: 'QUEUE_STALLED', severity: 'warning', title: '后台任务等待超过一小时' });
  }
  const age = status.backup?.verified ? now - Date.parse(status.backup.createdAt) : Infinity;
  if (!Number.isFinite(age) || age > 36 * 3600000) alerts.push({ code: 'BACKUP_OVERDUE', severity: 'critical', title: '完整备份超过预定时间' });
  return alerts;
}

async function systemStatus(dataPath = process.env.UPLOAD_ABS_DIR || '/data') {
  let disk = null;
  try { const stat = await fsp.statfs(dataPath); disk = { availableBytes: stat.bavail * stat.bsize, totalBytes: stat.blocks * stat.bsize }; } catch {}
  let processLimitBytes = null;
  try { const value = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(); if (/^\d+$/.test(value)) processLimitBytes = Number(value); } catch {}
  return { rssBytes: process.memoryUsage().rss, hostMemoryBytes: os.totalmem(), processLimitBytes,
    uptimeSeconds: Math.floor(process.uptime()), cpus: os.availableParallelism(), disk };
}

function createOperationsStatus({ pool, now = Date.now, system = systemStatus, environment = process.env } = {}) {
  let cached = null;
  let active = null;
  async function collect({ force = false } = {}) {
    if (!force && cached && now() - cached.at < 10000) return cached.value;
    if (active) return active;
    active = (async () => {
      const query = async (sql, params = []) => (await pool.query({ sql, timeout: 3000 }, params))[0];
      const [analysisRows, tasks, failures, recentFailures, searchRows, state, sys] = await Promise.all([
        query('SELECT ai_status AS status,COUNT(*) AS count FROM photos GROUP BY ai_status'),
        query("SELECT kind,status,COUNT(*) AS count,MAX(TIMESTAMPDIFF(SECOND,updated_at,NOW())) AS oldestAgeSeconds FROM runtime_tasks GROUP BY kind,status"),
        query("SELECT id,project_id AS projectId,type,original_filename AS filename,ai_error FROM photos WHERE ai_status='failed' ORDER BY id DESC LIMIT 50"),
        query('SELECT kind,stage,error_code AS errorCode,COUNT(*) AS count,MAX(created_at) AS latest FROM runtime_task_failures WHERE created_at>=NOW()-INTERVAL 7 DAY GROUP BY kind,stage,error_code ORDER BY latest DESC LIMIT 20'),
        query('SELECT duration_ms AS durationMs,result_count AS resultCount,error_code AS errorCode FROM photo_search_events WHERE created_at>=NOW()-INTERVAL 7 DAY ORDER BY created_at DESC LIMIT 5000'),
        query("SELECT state_key AS stateKey,payload FROM runtime_state WHERE namespace='operations' AND expires_at>?", [now()]),
        system(),
      ]);
      const stored = Object.fromEntries(state.map(row => {
        let payload = row.payload;
        try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch { payload = null; }
        return [row.stateKey, payload];
      }));
      const analysis = { done: 0, pending: 0, running: 0, failed: 0, skipped: 0 };
      for (const row of analysisRows) if (Object.hasOwn(analysis, row.status)) analysis[row.status] = Number(row.count);
      const durations = searchRows.map(row => Number(row.durationMs)).sort((a, b) => a - b);
      const percentile = q => durations.length ? durations[Math.max(0, Math.ceil(durations.length * q) - 1)] : null;
      const value = { checkedAt: new Date(now()).toISOString(), system: sys, analysis, tasks,
        failures: failures.map(row => ({ id: row.id, projectId: row.projectId, type: row.type,
          filename: row.filename, errorCode: /model.*not found/i.test(row.ai_error || '') ? 'LEGACY_MODEL_NOT_FOUND' : 'ANALYSIS_FAILED' })),
        recentFailures, backup: stored['backup:latest'] || null, evaluation: stored['evaluation:latest'] || null,
        regression: stored['regression:latest'] || null,
        search: { count: searchRows.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95),
          empty: searchRows.filter(row => row.resultCount === 0).length, errors: searchRows.filter(row => row.errorCode).length },
        integrations: { https: schoolIntegrationReadiness(environment).https.configured,
          dingtalk: schoolIntegrationReadiness(environment).dingtalk.configured,
          transcription: environment.VIDEO_TRANSCRIPT_ENABLED === '1' },
      };
      value.alerts = alertsFor(value, now());
      cached = { at: now(), value };
      return value;
    })().finally(() => { active = null; });
    return active;
  }
  return { collect };
}

function startOperationsMonitor({ status, pool, isLeader = () => true, intervalMs = 60000, logger = console }) {
  let busy = null;
  let previous = '';
  let stopped = false;
  const tick = () => {
    if (stopped || busy || !isLeader() || pool.pool?._connectionQueue?.length) return;
    busy = (async () => {
      const snapshot = await status.collect({ force: true });
      const fingerprint = JSON.stringify(snapshot.alerts.map(alert => alert.code).sort());
      if (fingerprint !== previous) {
        logger.warn('[operations]', snapshot.alerts.length ? snapshot.alerts.map(alert => alert.code).join(',') : 'RECOVERED');
        previous = fingerprint;
      }
      await pool.query({ sql: `INSERT INTO runtime_state (namespace,state_key,payload,expires_at) VALUES ('operations','alerts:latest',?,?)
        ON DUPLICATE KEY UPDATE payload=VALUES(payload),expires_at=VALUES(expires_at)`, timeout: 3000 },
      [JSON.stringify({ alerts: snapshot.alerts, checkedAt: snapshot.checkedAt }), Date.now() + 86400000]);
    })().catch(error => logger.warn('[operations]', error.code || 'MONITOR_FAILED')).finally(() => { busy = null; });
  };
  const timer = setInterval(tick, intervalMs); timer.unref?.();
  return { tick, async stop() { stopped = true; clearInterval(timer); if (busy) await busy; } };
}

module.exports = { createOperationsStatus, alertsFor, startOperationsMonitor };
