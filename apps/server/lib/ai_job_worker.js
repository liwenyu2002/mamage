const { pool } = require('../db');
const { generateFromPrompt } = require('../ai_function/ai_for_news/ai_for_news');
const { getTemplateByKey } = require('./channel_templates');
const { acquire, release, recordTokens } = require('./ai_quota');
const { acquireJobLock } = require('./job_lock');
const running = new Set();
let started = false;
let pumping = false;
let ticker;
let stopping = false;

// job.user_id 不带组织信息；配额记账按组织维度，这里按需查一次 users 表。
// 查不到（用户已删除/无 organization_id 列）时按 null 处理，recordTokens 会归到 org_id=0。
async function getOrgIdForUser(userId) {
  if (!userId) return null;
  try {
    const [rows] = await pool.query('SELECT organization_id FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!rows || !rows[0] || rows[0].organization_id === null || rows[0].organization_id === undefined) return null;
    const org = Number(rows[0].organization_id);
    return Number.isFinite(org) ? org : null;
  } catch (e) {
    return null;
  }
}

async function processJob(jobId, heldLock = null) {
  const lock = heldLock || await acquireJobLock(pool, `ai-news:${jobId}`);
  if (!lock) return null;
  const db = lock.connection;
  try {
    const [rows] = await db.query('SELECT * FROM ai_jobs WHERE id = ?', [jobId]);
    if (!rows || rows.length === 0) return;
    const job = rows[0];
    if (!['pending', 'running'].includes(job.status)) return null;
    const [saved] = await db.query('SELECT * FROM ai_results WHERE job_id = ? ORDER BY id DESC LIMIT 1', [jobId]);
    if (saved.length) {
      await db.query('UPDATE ai_jobs SET status = ?, error = NULL, finished_at = NOW() WHERE id = ?', ['succeeded', jobId]);
      return { ...saved[0], placeholders: typeof saved[0].placeholders === 'string'
        ? JSON.parse(saved[0].placeholders || '[]') : (saved[0].placeholders || []) };
    }

    await db.query('UPDATE ai_jobs SET status = ?, error = NULL, started_at = NOW() WHERE id = ?', ['running', jobId]);

    // call AI — accept options stored as JSON string or already-parsed object
    let options = {};
    try {
      if (!job.options) options = {};
      else if (typeof job.options === 'string') options = JSON.parse(job.options);
      else options = job.options; // already parsed object
    } catch (e) {
      // fallback to empty options
      options = {};
    }

    // 按渠道矩阵生成的 job 会带 channel_key；旧的单渠道路径（POST /generate 默认路径）没有这一列，
    // options 里也就不带 channelTemplate，generateFromPrompt 内部自动回退到 LEGACY_SYSTEM_PROMPT。
    if (job.channel_key) {
      const template = await getTemplateByKey(job.channel_key);
      if (template) options = { ...options, channelTemplate: template };
    }

    // 全局并发池只包裹真正打第三方模型 API 的这一段：DB 读写不占外部速率限制，没必要占着槽位排队。
    await acquire();
    let result;
    try {
      result = await generateFromPrompt({ prompt: job.prompt_text, options });
      if (options.purpose === 'paragraph-rewrite') {
        result.markdown = require('./news_paragraphs').validateParagraphRewrite(result.markdown, options.rewrite || {});
        result.title = ''; result.subtitle = ''; result.placeholders = [];
      }
    } finally {
      release();
    }

    await lock.assertOwned();
    await db.beginTransaction();
    await db.query(
      `INSERT INTO ai_results (job_id, title, subtitle, markdown, html, placeholders, extra, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        jobId,
        result.title,
        result.subtitle,
        result.markdown,
        result.html,
        JSON.stringify(result.placeholders || []),
        result.extra ? JSON.stringify(result.extra) : null,
      ]
    );

    await db.query('UPDATE ai_jobs SET status = ?, finished_at = NOW(), tokens_used = ?, cost_estimate = ? WHERE id = ?', ['succeeded', result.tokens || 0, result.cost || 0, jobId]);
    await db.commit();

    if (result.tokens) {
      const orgId = await getOrgIdForUser(job.user_id);
      recordTokens(orgId, result.tokens).catch((e) => {
        // 配额记账失败不影响已经成功的 job，只记日志
        console.error('[ai_job_worker] recordTokens failed', jobId, e && e.stack ? e.stack : e);
      });
    }

    console.log('[ai_job_worker] job succeeded', jobId);
    return result;
  } catch (e) {
    await db.rollback().catch(() => null);
    console.error('[ai_job_worker] job failed', jobId, e && e.stack ? e.stack : e);
    try {
      await lock.assertOwned();
      await db.query('UPDATE ai_jobs SET status = ?, error = ?, finished_at = NOW() WHERE id = ?', ['failed', String(e && e.message || e), jobId]);
    } catch (ee) {}
    throw e;
  } finally { await lock.release(); }
}

async function pump() {
  if (pumping || stopping) return;
  pumping = true;
  try {
    const limit = Math.max(1, Math.min(8, Number(process.env.AI_TEXT_CONCURRENCY) || 2));
    const [jobs] = await pool.query("SELECT id FROM ai_jobs WHERE status IN ('pending', 'running') ORDER BY id LIMIT 100");
    for (const job of jobs) {
      if (stopping) break;
      if (running.size >= limit) break;
      if (running.has(job.id)) continue;
      const lock = await acquireJobLock(pool, `ai-news:${job.id}`);
      if (!lock) continue;
      running.add(job.id);
      processJob(job.id, lock).catch(error => console.error('[ai_job_worker] process failed', job.id, error.message))
        .finally(() => { running.delete(job.id); wake(); });
    }
  } finally { pumping = false; }
}

function wake() {
  if (require('./distributed_runtime').distributed() && !require('./distributed_runtime').coordinator.isLeader()) return;
  setImmediate(() => pump().catch(error => console.error('[ai_job_worker] recovery failed', error.message)));
}

function start() {
  if (require('./distributed_runtime').distributed() && !require('./distributed_runtime').coordinator.isLeader()) return;
  if (started || stopping) return;
  started = true;
  ticker = setInterval(wake, 5000);
  ticker.unref?.();
  wake();
}

async function enqueueJob() {
  start();
  wake();
}

// run job synchronously (for sync=true)
async function runJobNow(jobId) {
  return processJob(jobId);
}

// getOrgIdForUser 同时供 routes/ai_news.js 复用（GET /batches/:batchId 按 batch 创建者的组织取企业预设做禁用词校验），
// 避免在两个文件里各写一份同样的 users 表查询。
async function stop() {
  stopping = true;
  clearInterval(ticker);
  await require('./runtime_lifecycle').waitForIdle(() => !pumping && running.size === 0);
}

module.exports = { enqueueJob, runJobNow, processJob, getOrgIdForUser, start, pump, stop };
