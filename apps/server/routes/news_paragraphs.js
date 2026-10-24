const crypto = require('node:crypto');
const { createSharedStore } = require('../lib/shared_runtime_state');
const { compareParagraphSources, buildParagraphRewrite } = require('../lib/news_paragraphs');

function registerNewsParagraphRoutes(router, { pool, requirePermission, validateNewsSources, checkAndReserveQuota, enqueueJob }) {
  const lock = createSharedStore('news-paragraph', { db: pool });
  router.get('/rewrites/:clientRequestId', requirePermission('ai.generate'), async (req, res) => {
    const id = String(req.params.clientRequestId || '');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return res.status(400).json({ error: 'INVALID_REQUEST_ID' });
    try {
      const [rows] = await pool.query(`SELECT j.id,j.status,j.error,r.markdown FROM ai_jobs j
        LEFT JOIN ai_results r ON r.job_id=j.id
        WHERE j.user_id=? AND j.client_request_id=? AND JSON_UNQUOTE(JSON_EXTRACT(j.options,'$.purpose'))='paragraph-rewrite'
        ORDER BY r.id DESC LIMIT 1`, [req.user.id, id]);
      if (!rows.length) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
      const job = rows[0];
      res.set('Cache-Control', 'no-store').json({ jobId: job.id, status: job.status,
        error: job.status === 'failed' ? '局部改写未完成，原文已保留' : null,
        result: job.markdown ? { markdown: job.markdown } : null });
    } catch (error) {
      console.error('[news.rewriteLookup]', error.code || 'LOOKUP_FAILED');
      res.status(503).json({ error: 'JOB_LOOKUP_FAILED' });
    }
  });
  router.post('/sources', requirePermission('ai.generate'), (req, res) => {
    try {
      res.json(compareParagraphSources(req.body?.markdown, req.body || {}));
    } catch { res.status(400).json({ error: 'INVALID_NEWS_SOURCES', message: '请检查正文和现场材料，单份内容不能超过 50000 字' }); }
  });

  router.post('/rewrite', requirePermission('ai.generate'), async (req, res) => {
    try {
      const body = req.body || {};
      const clientId = String(body.clientRequestId || '');
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(clientId)) return res.status(400).json({ error: 'INVALID_REQUEST_ID' });
      let rewrite;
      try { rewrite = buildParagraphRewrite(body); }
      catch { return res.status(400).json({ error: 'INVALID_NEWS_SELECTION', message: '请提供现场材料并选择一个不超过 4000 字的正文段落' }); }
      const workspace = await validateNewsSources(req, body.projectId || null, []);
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify([rewrite.documentHash,
        rewrite.selection.start, rewrite.selection.end, rewrite.mode, rewrite.sourceText])).digest('hex');
      const result = await lock.withLock(`${req.user.id}:${clientId}`, async () => {
        const [existing] = await pool.query('SELECT id,options FROM ai_jobs WHERE user_id=? AND client_request_id=? LIMIT 1', [req.user.id, clientId]);
        if (existing.length) {
          const options = typeof existing[0].options === 'string' ? JSON.parse(existing[0].options) : existing[0].options;
          if (options?.inputFingerprint !== fingerprint) return null;
          return { jobId: existing[0].id, status: 'pending' };
        }
        await checkAndReserveQuota(req.user.organization_id, 1);
        const options = { purpose: 'paragraph-rewrite', maxTokens: 2200, inputFingerprint: fingerprint,
          channelTemplate: { prompt_fragments: { systemRules: ['仅改写选中的正文段落，不生成标题、图片或其他段落。'] } },
          rewrite: { sourceText: rewrite.sourceText, original: rewrite.selection.text, documentHash: rewrite.documentHash } };
        const [inserted] = await pool.query(`INSERT INTO ai_jobs
          (user_id,project_id,unit_id,status,model,prompt_text,options,client_request_id,created_at)
          VALUES (?,?,?,'pending','default',?,?,?,NOW())`, [req.user.id, body.projectId || null,
          workspace.enabled ? workspace.unitId : null, rewrite.prompt, JSON.stringify(options), clientId]);
        await enqueueJob(inserted.insertId);
        return { jobId: inserted.insertId, status: 'pending' };
      });
      if (!result) return res.status(409).json({ error: 'REQUEST_CONTENT_CHANGED', message: '这次修改的材料已变化，请重新提交' });
      return res.status(202).json(result);
    } catch (error) {
      if (error.status || error.statusCode) return res.status(error.status || error.statusCode).json({ error: 'NEWS_REWRITE_REJECTED', message: error.message });
      console.error('[news.rewrite]', error.code || 'NEWS_REWRITE_FAILED');
      return res.status(503).json({ error: 'NEWS_REWRITE_FAILED', message: '局部改写暂不可用，原文已保留' });
    }
  });
}

module.exports = { registerNewsParagraphRoutes };
