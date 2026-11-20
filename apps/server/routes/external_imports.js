const express = require('express');
const { pool } = require('../db');
const { requirePermission, hasPermissionForUserId } = require('../lib/permissions');
const { requireProjectAccess, resolveWorkspace, sendWorkspaceError } = require('../lib/workspace_access');
const { buildMediaUrl } = require('../lib/media_access');
const { photoOwnerFilter } = require('../lib/access_policy');
const { createJob } = require('../lib/external_import_jobs');
const importDao = require('../lib/queries/external_imports');
const worker = require('../lib/external_import_worker');

const router = express.Router();

router.post('/scan', requirePermission('upload.photo'), (_req, res) => {
  res.status(410).json({ error: 'CLIENT_OUTDATED', message: '转存流程已升级，请刷新页面后重试' });
});

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function handleError(res, err) {
  if (sendWorkspaceError(res, err)) return;
  const status = Number(err?.status) || 500;
  if (status >= 500) console.error('[external-import]', err?.message || err);
  res.status(status).json({
    error: err?.code || (status >= 500 ? 'EXTERNAL_IMPORT_FAILED' : 'INVALID_REQUEST'),
    message: status >= 500 ? '操作失败，请稍后重试' : err.message,
  });
}

async function permissions(req, projectId) {
  await requireProjectAccess(req, projectId, 'read');
  let canSeeUrl = false;
  try {
    await requireProjectAccess(req, projectId, 'metadata');
    canSeeUrl = await hasPermissionForUserId(req.user.id, 'projects.update');
  } catch (_) { /* album readers only see the source domain */ }
  const workspace = await resolveWorkspace(req);
  let canManageProject = false;
  try { await requireProjectAccess(req, projectId, 'manage'); canManageProject = true; }
  catch (_) { /* shared readers cannot manage the source album */ }
  const canAdmin = workspace.collegeAdmin || (workspace.enabled && canManageProject)
    || (!workspace.enabled && ['admin', 'superadmin'].includes(String(req.user.role)));
  return { canSeeUrl, canAdmin };
}

function serializeJob(row, access) {
  let sourceDomain = '';
  try { sourceDomain = new URL(row.source_url).hostname; } catch (_) { /* malformed old record */ }
  return {
    id: Number(row.id), projectId: Number(row.project_id), sourceTitle: row.source_title,
    sourceDomain, ...(access.canSeeUrl ? { sourceUrl: row.source_url } : {}),
    status: row.status, scanStatus: row.scan_status, scanErrorCode: row.scan_error_code,
    discoveredCount: Number(row.discovered_count), reportedTotal: row.reported_total === null ? null : Number(row.reported_total),
    selectedCount: Number(row.selected_count), cancelRequested: Boolean(row.cancel_requested),
    canControl: access.canAdmin || Number(row.requested_by) === Number(access.userId),
    createdAt: row.created_at, updatedAt: row.updated_at, finishedAt: row.finished_at,
    retryAfter: row.retry_after,
  };
}

async function findJob(req, id) {
  const job = await importDao.findJob(pool, id);
  if (!job) throw Object.assign(new Error('转存任务不存在'), { status: 404 });
  const access = await permissions(req, job.project_id);
  if ((await resolveWorkspace(req)).ownPhotosOnly && Number(job.requested_by) !== Number(req.user.id)) {
    throw Object.assign(new Error('转存任务不存在'), { status: 404 });
  }
  access.userId = req.user.id;
  return { job, access };
}

router.post('/jobs', requirePermission('upload.photo'), async (req, res) => {
  const projectId = validId(req.body?.projectId);
  if (!projectId) return res.status(400).json({ error: 'INVALID_PROJECT', message: '请选择目标相册' });
  try {
    const result = await createJob(req, projectId, req.body?.url);
    worker.wake();
    return res.status(result.existing ? 200 : 201).json({ ...result, status: 'queued' });
  } catch (err) { return handleError(res, err); }
});

router.get('/jobs', requirePermission('photos.view'), async (req, res) => {
  const projectId = validId(req.query.projectId);
  if (!projectId) return res.status(400).json({ error: 'INVALID_PROJECT' });
  try {
    const access = await permissions(req, projectId);
    access.userId = req.user.id;
    const workspace = await resolveWorkspace(req);
    const jobOwner = workspace.ownPhotosOnly ? ' AND requested_by = ?' : '';
    const args = [projectId, ...(workspace.ownPhotosOnly ? [workspace.userId] : [])];
    const rows = await importDao.listProjectJobs(pool, { projectId, ownerSql: jobOwner, args });
    const sourceRows = await importDao.listAttributedSources(pool, {
      projectId, ownerSql: workspace.ownPhotosOnly ? ' AND j.requested_by = ?' : '', args });
    const sources = sourceRows.map((row) => {
      let domain = '';
      try { domain = new URL(row.source_url).hostname; } catch (_) { /* old record */ }
      return {
        id: Number(row.id), title: row.source_title, domain,
        ...(access.canSeeUrl ? { url: row.source_url } : {}),
        startedAt: row.started_at, photoCount: Number(row.photo_count),
      };
    });
    return res.json({ jobs: rows.map((row) => serializeJob(row, access)), sources });
  } catch (err) { return handleError(res, err); }
});

router.get('/jobs/:id', requirePermission('photos.view'), async (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: 'INVALID_JOB' });
  try {
    const { job, access } = await findJob(req, id);
    const counts = await importDao.countItemsByStatus(pool, id);
    const issues = await importDao.listIssues(pool, { jobId: id, limit: 20 });
    const activeFileName = await importDao.findActiveItemName(pool, id);
    return res.json({
      ...serializeJob(job, access),
      counts: Object.fromEntries(counts.map((row) => [row.status, Number(row.count)])),
      activeFileName,
      issues,
    });
  } catch (err) { return handleError(res, err); }
});

router.get('/jobs/:id/updates', requirePermission('photos.view'), async (req, res) => {
  const id = validId(req.params.id);
  const afterPhotoId = Number(req.query.afterPhotoId || 0);
  if (!id || !Number.isSafeInteger(afterPhotoId) || afterPhotoId < 0) return res.status(400).json({ error: 'INVALID_CURSOR' });
  try {
    const { job } = await findJob(req, id);
    const owner = photoOwnerFilter(await resolveWorkspace(req), 'ph');
    const rows = await importDao.listPhotosPage(pool, { projectId: job.project_id, jobId: id,
      afterPhotoId, owner, limit: 101 });
    const page = rows.slice(0, 100).map((row) => ({
      ...row,
      url: buildMediaUrl(row.url, { userId: req.user.id, photoId: row.id }),
      thumbUrl: buildMediaUrl(row.thumbUrl, { userId: req.user.id, photoId: row.id }),
    }));
    const sections = await importDao.listSections(pool, job.project_id);
    return res.json({ photos: page, hasMore: rows.length > 100, sections });
  } catch (err) { return handleError(res, err); }
});

router.get('/jobs/:id/issues', requirePermission('photos.view'), async (req, res) => {
  const id = validId(req.params.id);
  const afterItemId = Number(req.query.afterItemId || 0);
  if (!id || !Number.isSafeInteger(afterItemId) || afterItemId < 0) return res.status(400).json({ error: 'INVALID_CURSOR' });
  try {
    await findJob(req, id);
    const rows = await importDao.listIssuesPage(pool, { jobId: id, afterItemId, limit: 101 });
    return res.json({ issues: rows.slice(0, 100), hasMore: rows.length > 100 });
  } catch (err) { return handleError(res, err); }
});

router.post('/jobs/:id/cancel', requirePermission('photos.view'), async (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: 'INVALID_JOB' });
  try {
    const { job, access } = await findJob(req, id);
    if (!access.canAdmin && Number(job.requested_by) !== Number(req.user.id)) return res.status(403).json({ error: 'FORBIDDEN' });
    const cancelled = await importDao.requestCancel(pool, id);
    worker.wake();
    return res.json({ ok: true, cancelRequested: Boolean(cancelled) });
  } catch (err) { return handleError(res, err); }
});

router.post('/jobs/:id/resume', requirePermission('photos.view'), async (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: 'INVALID_JOB' });
  try {
    const { job, access } = await findJob(req, id);
    await requireProjectAccess(req, job.project_id, 'upload');
    if (!access.canAdmin && Number(job.requested_by) !== Number(req.user.id)) return res.status(403).json({ error: 'FORBIDDEN' });
    if (!['cancelled', 'paused', 'completed_with_errors'].includes(job.status)) {
      return res.status(409).json({ error: 'JOB_NOT_RESUMABLE', message: '当前任务无需继续' });
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await importDao.lockProject(conn, job.project_id);
      const others = await importDao.findConflictingJobs(conn, { projectId: job.project_id, jobId: id });
      if (others.length) throw Object.assign(new Error('当前相册已有其他转存任务'), { status: 409 });
      await importDao.resetFailedItems(conn, id);
      await importDao.requeueJob(conn, id);
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => null);
      throw err;
    } finally { conn.release(); }
    worker.wake();
    return res.json({ ok: true });
  } catch (err) { return handleError(res, err); }
});

router.post('/sources/:id/hide', requirePermission('projects.update'), async (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: 'INVALID_SOURCE' });
  try {
    const { job } = await findJob(req, id);
    await requireProjectAccess(req, job.project_id, 'metadata');
    await importDao.hideSource(pool, { projectId: job.project_id, sourceUrl: job.source_url });
    return res.json({ ok: true });
  } catch (err) { return handleError(res, err); }
});

module.exports = router;
