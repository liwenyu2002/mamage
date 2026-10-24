const crypto = require('node:crypto');
const { distributed } = require('./shared_runtime_state');
const { acquireJobLock } = require('./job_lock');
const { bounded, waitForIdle } = require('./runtime_lifecycle');
const { planFailure, recordFailure, errorDetails } = require('./background_task_failure');

function createCoordinator({ db, onLeader = async () => {}, onLost = () => process.exit(1), intervalMs = 1000,
  laneConcurrency = {}, maxActive = 6, canDispatch = () => true, now = Date.now, random = Math.random } = {}) {
  const handlers = new Map();
  const activeLanes = new Map();
  const activeJobs = new Map();
  const concurrency = bounded(maxActive, 6, 1, 16);
  const owner = crypto.randomUUID();
  const pool = () => db || require('../db').pool;
  let lock; let timer; let immediate; let stopping = false; let pumping = false; let leaderStarted = false;
  let laneCursor = 0; let nextCleanup = 0;
  function requestTick() {
    if (!timer || stopping || immediate) return;
    immediate = setImmediate(() => { immediate = null; void runtime.tick(); });
    immediate.unref?.();
  }
  const runtime = {
    register(kind, lane, handler) { handlers.set(kind, { lane, handler }); },
    async enqueue(kind, key, payload, { priority = 0, connection } = {}) {
      if (!distributed()) throw new Error('DISTRIBUTED_RUNTIME_DISABLED');
      const entry = handlers.get(kind);
      if (!entry) throw new Error(`UNKNOWN_RUNTIME_TASK:${kind}`);
      await (connection || pool()).query(`INSERT INTO runtime_tasks (kind, dedupe_key, lane, priority, payload, available_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [kind, String(key), entry.lane, priority, JSON.stringify(payload), now()]);
      requestTick();
      return true;
    },
    async ready() {
      await pool().query('SELECT namespace FROM runtime_state LIMIT 0');
      await pool().query('SELECT kind FROM runtime_tasks LIMIT 0');
      await pool().query('SELECT task_id FROM runtime_task_failures LIMIT 0');
    },
    async tick() {
      if (stopping || pumping) return;
      pumping = true;
      try {
        if (!lock) {
          lock = await acquireJobLock(pool(), `mamage-runtime-leader:${process.env.DB_NAME || ''}`);
          if (!lock) return;
          lock.connection.on?.('error', error => { if (!stopping) onLost(error); });
          await pool().query("UPDATE runtime_tasks SET status = 'queued', owner = NULL, available_at = ? WHERE status = 'running'", [now()]);
          leaderStarted = true;
          await onLeader();
        }
        await lock.assertOwned();
        const lanes = [...new Set([...handlers.values()].map(entry => entry.lane))];
        // Round-robin lanes so a full AI backlog cannot consume every global slot.
        let skipped = 0;
        let checkedFace = false;
        while (lanes.length && activeJobs.size < concurrency && !stopping && skipped < lanes.length) {
          if (pool().pool?._connectionQueue?.length) break;
          // Short face jobs reuse the next free slot before long encodes refill it.
          // Keep their serial lane, global limit and foreground pressure checks intact.
          const preferFace = !checkedFace && lanes.includes('face') && !activeLanes.get('face')?.size;
          if (preferFace) checkedFace = true;
          const lane = preferFace ? 'face' : lanes[laneCursor++ % lanes.length];
          const jobs = activeLanes.get(lane) || new Set();
          if (jobs.size >= bounded(laneConcurrency[lane], 1, 1, 8)
            || !await canDispatch({ lane, active: activeJobs.size })) { if (!preferFace) skipped++; continue; }
          const [rows] = await pool().query(`SELECT * FROM runtime_tasks WHERE status = 'queued' AND lane = ?
            AND available_at <= ? ORDER BY priority ASC, id ASC LIMIT 1`, [lane, now()]);
          const job = rows[0];
          if (!job) { if (!preferFace) skipped++; continue; }
          const entry = handlers.get(job.kind);
          if (!entry) throw new Error(`UNKNOWN_PERSISTED_RUNTIME_TASK:${job.kind}`);
          await lock.assertOwned();
          const [claimed] = await pool().query("UPDATE runtime_tasks SET status = 'running', owner = ?, attempts = attempts + 1 WHERE id = ? AND status = 'queued'", [owner, job.id]);
          if (!claimed.affectedRows) { if (!preferFace) skipped++; continue; }
          skipped = 0;
          const promise = Promise.resolve().then(() => entry.handler(typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload,
            { attempt: Number(job.attempts) + 1 }))
            .then(async () => {
              await lock.assertOwned();
              await pool().query("UPDATE runtime_tasks SET status = 'done', last_error = NULL WHERE id = ? AND owner = ? AND status = 'running'", [job.id, owner]);
            }).catch(async error => {
              if (error.code === 'JOB_LOCK_LOST' && !stopping) { onLost(error); return; }
              await lock.assertOwned();
              const plan = planFailure(error, { kind: job.kind, attempt: Number(job.attempts) + 1, now: now(), random });
              await recordFailure(pool(), job, owner, plan);
              console.error('[runtime-task]', job.kind, job.id, JSON.stringify(plan.diagnostic));
            }).catch(error => {
              console.error('[runtime-task-recording]', job.id, JSON.stringify(errorDetails(error)));
              if (!stopping) onLost(error);
            }).finally(() => {
              jobs.delete(promise); activeJobs.delete(job.id);
              requestTick();
            });
          jobs.add(promise); activeLanes.set(lane, jobs); activeJobs.set(job.id, promise);
        }
        // Completed payloads may contain personal data and are not an audit log.
        if (now() >= nextCleanup) {
          nextCleanup = now() + 60000;
          await pool().query("DELETE FROM runtime_tasks WHERE status IN ('done','failed') AND updated_at < NOW() - INTERVAL 7 DAY LIMIT 100");
          await pool().query("DELETE FROM runtime_state WHERE (namespace LIKE 'rate-%' OR namespace = 'zip-ticket') AND expires_at < ? LIMIT 100", [now()]);
          await pool().query('DELETE FROM runtime_task_failures WHERE created_at < NOW() - INTERVAL 30 DAY LIMIT 100');
        }
      } catch (error) {
        if (lock && !stopping) onLost(error);
        else console.warn('[runtime-coordinator]', error.code || error.message);
      } finally { pumping = false; }
    },
    start(options = {}) {
      if (timer || stopping) return;
      if (options.onLeader) onLeader = options.onLeader;
      if (options.onLost) onLost = options.onLost;
      timer = setInterval(() => { void runtime.tick(); }, intervalMs);
      timer.unref();
      void runtime.tick();
    },
    async stopDispatch() { stopping = true; clearInterval(timer); clearImmediate(immediate); await waitForIdle(() => !pumping); },
    async stop() {
      await runtime.stopDispatch();
      await Promise.allSettled([...activeJobs.values()]);
      await lock?.release(); lock = null;
    },
    isLeader: () => Boolean(lock && leaderStarted),
    isIdle: () => activeJobs.size === 0,
  };
  return runtime;
}

const { createDispatchGuard } = require('./background_capacity');
const capacity = createDispatchGuard();
const coordinator = createCoordinator({
  laneConcurrency: {
    vision: bounded(process.env.RUNTIME_VISION_CONCURRENCY, 1, 1, 8),
    derivative: bounded(process.env.PUBLIC_DOWNLOAD_CONCURRENCY, 1, 1, 2),
  },
  maxActive: bounded(process.env.RUNTIME_MAX_ACTIVE, 6, 1, 16),
  intervalMs: bounded(process.env.RUNTIME_POLL_INTERVAL_MS, 1000, 100, 10000),
  canDispatch: capacity.canDispatch,
});
module.exports = { createCoordinator, coordinator, distributed, capacity };
