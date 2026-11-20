const aiJobsDao = require('../lib/queries/ai_news');
const { createSharedStore } = require('../lib/shared_runtime_state');
const { availableStyles, buildLayoutRequest } = require('../lib/wechat_layout');
const { buildRevisionRequest } = require('../lib/news_revision');
const { buildTemplateRequest } = require('../lib/wechat_content_template');
const { loadObservedStyleLibrary } = require('../lib/wechat_observed_styles');
const { hydrateNewsPhotoContext } = require('../lib/news_photo_context');

function registerWechatLayoutRoutes(router, { pool, requirePermission, resolveWorkspace, enqueueJob, checkAndReserveQuota, sendWorkspaceError,
  hydratePhotoContext = hydrateNewsPhotoContext }) {
  const lock = createSharedStore('wechat-layout', { db: pool });
  for (const task of ['layout', 'revision', 'content-template']) {
    const purpose = `wechat-${task}`;
    const taskName = task === 'layout' ? '排版' : task === 'revision' ? '改稿' : '内容结构';
    router.get(`/${task}/:clientRequestId`, requirePermission('ai.generate'), async (req, res) => {
      const id = String(req.params.clientRequestId || '');
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return res.status(400).json({ error: 'INVALID_REQUEST_ID' });
      try {
        const workspace = await resolveWorkspace(req);
        const row = await aiJobsDao.findLayoutJob(pool, { userId: req.user.id, clientRequestId: id,
          unitId: workspace.enabled ? workspace.unitId : null, purpose,
          orgScope: String(req.user.organization_id ?? 'none') });
        if (!row) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
        const extra = typeof row.extra === 'string' ? JSON.parse(row.extra) : row.extra;
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
          const rows = await aiJobsDao.listStyleBlocksForLayout(pool, { orgId: org,
            unitScopeSql: workspace.enabled ? (workspace.unitId ? 'AND unit_id = ?' : 'AND unit_id IS NULL') : '',
            params: workspace.enabled && workspace.unitId ? [workspace.unitId] : [] });
          let observed = [];
          try { observed = (await loadObservedStyleLibrary(pool, workspace)).blocks; }
          catch (error) { console.warn('[wechat.layout.observed]', error.code || 'OBSERVED_STYLES_UNAVAILABLE'); }
          input = buildLayoutRequest(body, availableStyles([...rows, ...observed]));
        } else if (task === 'revision') {
          const { photoContext } = await hydratePhotoContext(req, body, { db: pool });
          input = buildRevisionRequest(body, { photoContext });
        }
        else input = buildTemplateRequest(body);
        const unitId = workspace.enabled ? workspace.unitId : null;
        const result = await lock.withLock(`${req.user.id}:${id}`, async () => {
          const previous = await aiJobsDao.findJobByClientRequestId(pool, { userId: req.user.id, clientRequestId: id });
          if (previous) {
            const options = typeof previous.options === 'string' ? JSON.parse(previous.options) : previous.options;
            if (options?.purpose !== purpose || options.inputFingerprint !== input.fingerprint || String(previous.unit_id ?? '') !== String(unitId ?? '')
              || options.organizationScope !== String(org ?? 'none')) return null;
            return { jobId: previous.id, status: 'pending' };
          }
          await checkAndReserveQuota(org, 1);
          const options = { purpose, inputFingerprint: input.fingerprint, organizationScope: String(org ?? 'none'), [task]: input };
          const inserted = await aiJobsDao.insertLayoutJob(pool, { userId: req.user.id, unitId,
            prompt: input.prompt, options, clientRequestId: id });
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
