const { randomUUID } = require('node:crypto');
const { coordinator, distributed } = require('./distributed_runtime');
const { createSharedStore } = require('./shared_runtime_state');
const { WindowError, ORIGINAL_MODE } = require('./college_window_policy');

const KIND = 'college-window-publish';
const PLAN_TTL = 15 * 60_000;
const JOB_TTL = 7 * 86400_000;
const active = job => ['queued', 'running'].includes(job?.status);
const batchScope = ws => [ws.orgId, ws.unitId, ws.userId].join(':');

function publicJob(job) {
  if (!job) return null;
  const { id, status, total, processed, published, skipped, failed, error } = job;
  return { id, status, total, processed, published, skipped, failed, error };
}

function createCollegeWindowBatches({ db, publishPhoto, runner = coordinator }) {
  const plans = createSharedStore('college-window-plans', { db });
  const jobs = createSharedStore('college-window-jobs', { db });
  let localQueue = Promise.resolve();

  async function mark(key, id, status, code) {
    return jobs.withLock(key, async () => {
      const job = await jobs.get(key);
      if (!active(job) || job.id !== id) return job;
      const next = { ...job, status, error: code };
      await jobs.set(key, next);
      return next;
    });
  }

  async function advance(payload, index, outcome, insert) {
    return jobs.withLock(payload.key, async sharedConnection => {
      const job = await jobs.get(payload.key);
      if (!active(job) || job.id !== payload.id || job.processed !== index) return false;
      const next = { ...job, processed: index + 1, [outcome]: job[outcome] + 1 };
      if (next.processed === next.total) next.status = 'done';
      if (!insert) {
        await jobs.set(payload.key, next);
        return true;
      }
      const connection = sharedConnection || await db.getConnection();
      let committing = false;
      try {
        await connection.beginTransaction();
        await insert(connection);
        // Resume at the next photo only if its publication actually committed.
        if (sharedConnection) await jobs.set(payload.key, next, { connection });
        committing = true;
        await connection.commit();
        if (!sharedConnection) await jobs.set(payload.key, next);
        return true;
      } catch (err) {
        await connection.rollback().catch(() => {});
        if (committing) err.collegeWindowCommitUnknown = true;
        throw err;
      } finally { if (!sharedConnection) connection.release(); }
    });
  }

  async function run(payload) {
    const { key, id, ids } = payload;
    try {
      await mark(key, id, 'running');
      for (;;) {
        const job = await jobs.get(key);
        if (!active(job) || job.id !== id) return;
        const index = job.processed;
        try {
          const advanced = await publishPhoto(payload, ids[index], insert => advance(payload, index, 'published', insert));
          if (!advanced) return;
        } catch (err) {
          if (err.collegeWindowCommitUnknown) throw err;
          if (err.status === 404 || err.status === 409 || err.code === 'ER_DUP_ENTRY') {
            if (!await advance(payload, index, 'skipped')) return;
          } else if (err.status === 422) {
            if (!await advance(payload, index, 'failed')) return;
          } else throw err;
        }
      }
    } catch (err) {
      console.warn('[college-window-publish]', err.code || err.name);
      const code = err.status === 403 ? 'COLLEGE_WINDOW_BATCH_ACCESS_CHANGED'
        : err.code === 'COLLEGE_WINDOW_BATCH_MODE_CHANGED' ? err.code : 'COLLEGE_WINDOW_BATCH_FAILED';
      await mark(key, id, 'failed', code);
    }
  }

  runner.register(KIND, KIND, run);
  return {
    async prepare(ws, { ids, mode, contentFilter, requiresFaceSearch }) {
      const key = batchScope(ws);
      if (active(await jobs.get(key))) throw new WindowError(409, 'COLLEGE_WINDOW_BATCH_ACTIVE');
      await plans.pruneExpired(30);
      const plan = { id: randomUUID(), key, ids, mode, contentFilter, requiresFaceSearch,
        publicationMode: ORIGINAL_MODE, expiresAt: Date.now() + PLAN_TTL };
      await plans.set(plan.id, plan);
      return { id: plan.id, count: ids.length, mode, contentFilter };
    },
    async start(ws, id) {
      const key = batchScope(ws);
      return jobs.withLock(key, async connection => {
        const current = await jobs.get(key);
        if (current?.id === id) return publicJob(current);
        if (active(current)) throw new WindowError(409, 'COLLEGE_WINDOW_BATCH_ACTIVE');
        const plan = await plans.get(id);
        if (!plan || plan.key !== key || plan.consumed || plan.expiresAt <= Date.now() || plan.publicationMode !== ORIGINAL_MODE) {
          throw new WindowError(409, 'COLLEGE_WINDOW_BATCH_PLAN_EXPIRED');
        }
        const job = { id, status: 'queued', total: plan.ids.length, processed: 0, published: 0, skipped: 0, failed: 0,
          expiresAt: Date.now() + JOB_TTL };
        const payload = { ...plan, userId: ws.userId };
        if (connection) {
          try {
            await connection.beginTransaction();
            await jobs.set(key, job, { connection });
            await plans.set(id, { ...plan, ids: [], consumed: true }, { connection });
            await runner.enqueue(KIND, id, payload, { connection });
            await connection.commit();
          } catch (err) { await connection.rollback().catch(() => {}); throw err; }
        } else {
          await jobs.set(key, job);
          await plans.set(id, { ...plan, ids: [], consumed: true });
          localQueue = localQueue.then(() => run(payload)).catch(err => console.warn('[college-window-publish]', err.code || err.name));
        }
        return publicJob(job);
      });
    },
    async status(ws) {
      const key = batchScope(ws);
      let job = await jobs.get(key);
      if (active(job) && distributed()) {
        const [[task]] = await db.query('SELECT status FROM runtime_tasks WHERE kind = ? AND dedupe_key = ?', [KIND, job.id]);
        if (!task || ['failed', 'done'].includes(task.status)) job = await mark(key, job.id, 'failed', 'COLLEGE_WINDOW_BATCH_FAILED');
      }
      return publicJob(job);
    },
    async cancel(ws, id) {
      return publicJob(await mark(batchScope(ws), id, 'cancelled'));
    },
  };
}

module.exports = { createCollegeWindowBatches, batchScope };
