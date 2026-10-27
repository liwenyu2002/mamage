const { createSharedStore } = require('../lib/shared_runtime_state');
const { availableStyles, buildLayoutRequest } = require('../lib/wechat_layout');
const { buildRevisionRequest } = require('../lib/news_revision');
const { buildTemplateRequest } = require('../lib/wechat_content_template');
const { loadObservedStyleLibrary } = require('../lib/wechat_observed_styles');

function registerWechatLayoutRoutes(router, { pool, requirePermission, resolveWorkspace, enqueueJob, checkAndReserveQuota, sendWorkspaceError }) {
  const lock = createSharedStore('wechat-layout', { db: pool });
  for (const task of ['layout', 'revision', 'content-template']) {
    const purpose = `wechat-${task}`;
    const taskName = task === 'layout' ? '排版' : task === 'revision' ? '改稿' : '内容结构';
    router.get(`/${task}/:clientRequestId`, requirePermission('ai.generate'), async (req, res) => {
      const id = String(req.params.clientRequestId || '');
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return res.status(400).json({ error: 'INVALID_REQUEST_ID' });
      try {
        const workspace = await resolveWorkspace(req);
        const [rows] = await pool.query(`SELECT j.id,j.status,j.error,r.extra FROM ai_jobs j LEFT JOIN ai_results r ON r.job_id=j.id
          WHERE j.user_id=? AND j.client_request_id=? AND j.unit_id <=> ?
          AND JSON_UNQUOTE(JSON_EXTRACT(j.options,'$.purpose'))=?
          AND JSON_UNQUOTE(JSON_EXTRACT(j.options,'$.organizationScope'))=? ORDER BY r.id DESC LIMIT 1`,
        [req.user.id, id, workspace.enabled ? workspace.unitId : null, purpose, String(req.user.organization_id ?? 'none')]);
        if (!rows.length) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
        const row = rows[0], extra = typeof row.extra === 'string' ? JSON.parse(row.extra) : row.extra;
        res.set('Cache-Control', 'private, no-store').json({ jobId: row.id, status: row.status, result: row.status === 'succeeded' ? extra : null,
          error: row.status === 'failed' ? `AI ${taskName}未完成，原稿已保留，请重试` : null });
      } catch (error) {
        if (sendWorkspaceError(res, error)) return;
        console.error(`[wechat.${task}.lookup]`, error.code || 'AI_TASK_LOOKUP_FAILED');
        res.status(503).json({ error: 'AI_TASK_LOOKUP_FAILED', message: `暂时无法读取${taskName}任务` });
      }
    });
    router.post(`/${task}`, requirePermission('ai.generate'), async (req, res) => {
      try {
        const body = req.body || {}, id = String(body.clientRequestId || '');
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return res.status(400).json({ error: 'INVALID_REQUEST_ID' });
        const workspace = await resolveWorkspace(req), org = req.user.organization_id ?? null;
        let input;
        if (task === 'layout') {
          const [rows] = await pool.query(`SELECT id,type,name FROM wechat_style_blocks WHERE org_id <=> ?
            ${workspace.enabled ? (workspace.unitId ? 'AND unit_id = ?' : 'AND unit_id IS NULL') : ''} ORDER BY id LIMIT 500`,
          workspace.enabled && workspace.unitId ? [org, workspace.unitId] : [org]);
          let observed = [];
          try { observed = (await loadObservedStyleLibrary(pool, workspace)).blocks; }
          catch (error) { console.warn('[wechat.layout.observed]', error.code || 'OBSERVED_STYLES_UNAVAILABLE'); }
          input = buildLayoutRequest(body, availableStyles([...rows, ...observed]));
        } else if (task === 'revision') input = buildRevisionRequest(body);
        else input = buildTemplateRequest(body);
        const unitId = workspace.enabled ? workspace.unitId : null;
        const result = await lock.withLock(`${req.user.id}:${id}`, async () => {
          const [previous] = await pool.query('SELECT id,options,unit_id FROM ai_jobs WHERE user_id=? AND client_request_id=? LIMIT 1', [req.user.id, id]);
          if (previous.length) {
            const options = typeof previous[0].options === 'string' ? JSON.parse(previous[0].options) : previous[0].options;
            if (options?.purpose !== purpose || options.inputFingerprint !== input.fingerprint || String(previous[0].unit_id ?? '') !== String(unitId ?? '')
              || options.organizationScope !== String(org ?? 'none')) return null;
            return { jobId: previous[0].id, status: 'pending' };
          }
          await checkAndReserveQuota(org, 1);
          const options = { purpose, inputFingerprint: input.fingerprint, organizationScope: String(org ?? 'none'), [task]: input };
          const [inserted] = await pool.query(`INSERT INTO ai_jobs
            (user_id,unit_id,status,model,prompt_text,options,client_request_id,created_at) VALUES (?,?,'pending','default',?,?,?,NOW())`,
          [req.user.id, unitId, input.prompt, JSON.stringify(options), id]);
          await enqueueJob(inserted.insertId);
          return { jobId: inserted.insertId, status: 'pending' };
        });
        if (!result) return res.status(409).json({ error: 'LAYOUT_SOURCE_CHANGED', message: '材料或要求已变化，请重新提交' });
        res.status(202).json(result);
      } catch (error) {
        if (sendWorkspaceError(res, error)) return;
        const status = error.status || error.statusCode || 503;
        if (status >= 500) console.error(`[wechat.${task}.submit]`, error.code || 'AI_TASK_FAILED');
        res.status(status).json({ error: 'LAYOUT_FAILED', message: status < 500 ? error.message : `AI ${taskName}暂不可用，原稿已保留` });
      }
    });
  }
}
module.exports = { registerWechatLayoutRoutes };
