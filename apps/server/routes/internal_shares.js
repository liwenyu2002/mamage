const express = require('express');
const sharesDao = require('../lib/queries/internal_shares');
const { pool } = require('../db');
const { buildMediaUrl } = require('../lib/media_access');
const { requirePermission } = require('../lib/permissions');
const {
  positiveId, resolveWorkspace, requireProjectAccess, requirePhotosAccess,
  sendWorkspaceError, WorkspaceAccessError,
} = require('../lib/workspace_access');

const router = express.Router();
const copyWorker = require('../lib/organization_copy_worker');
const { expirationFor, requireSourceEditor, requireTarget } = require('../lib/internal_share_policy');

function sendError(res, err) {
  if (sendWorkspaceError(res, err)) return;
  console.error('[internal-shares]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
}

router.post('/', requirePermission('photos.view'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const workspace = await resolveWorkspace(req, conn);
    await requireSourceEditor(workspace, workspace.unitId, conn);
    const body = req.body || {};
    const mode = String(body.mode || '').trim();
    const shareType = String(body.shareType || '').trim();
    if (!['read', 'copy', 'collaborate'].includes(mode) || !['album', 'collection'].includes(shareType)) {
      throw new WorkspaceAccessError('INVALID_SHARE_MODE', 400);
    }
    const targetUnitId = positiveId(body.targetUnitId);
    const targetUserId = body.targetUserId ? positiveId(body.targetUserId) : null;
    if (!targetUnitId || (body.targetUserId && !targetUserId)) {
      throw new WorkspaceAccessError('INVALID_TARGET', 400);
    }
    await requireTarget(workspace, targetUnitId, targetUserId, conn);
    const expiresAt = expirationFor(mode, body);

    let projectId = null;
    let photoIds = [];
    if (shareType === 'album') {
      if (workspace.ownPhotosOnly) throw new WorkspaceAccessError('ORGANIZATION_PHOTO_ACCESS_REQUIRED');
      projectId = positiveId(body.projectId);
      if (!projectId) throw new WorkspaceAccessError('INVALID_PROJECT', 400);
      const project = await requireProjectAccess(req, projectId, 'read', conn);
      if (Number(project.unit_id) !== workspace.unitId) throw new WorkspaceAccessError('SOURCE_UNIT_REQUIRED');
    } else {
      photoIds = Array.from(new Set((body.photoIds || []).map(positiveId).filter(Boolean)));
      if (!photoIds.length || photoIds.length > 2000) throw new WorkspaceAccessError('INVALID_PHOTO_IDS', 400);
      const rows = await requirePhotosAccess(req, photoIds, 'read', conn);
      if (rows.some((row) => Number(row.unit_id) !== workspace.unitId)) {
        throw new WorkspaceAccessError('SOURCE_UNIT_REQUIRED');
      }
    }

    await conn.beginTransaction();
    let snapshot = null;
    let photoSnapshots = new Map();
    if (mode === 'copy') {
      const loaded = await sharesDao.loadCopySnapshot(conn, { shareType, projectId, photoIds,
        orgId: workspace.orgId, unitId: workspace.unitId });
      if (!loaded) throw new WorkspaceAccessError('SOURCE_ALBUM_NOT_FOUND', 404);
      const { photos } = loaded;
      if (shareType === 'album') snapshot = { project: loaded.project, sections: loaded.sections };
      if (shareType === 'collection' && photos.length !== photoIds.length) {
        throw new WorkspaceAccessError('PHOTO_NOT_FOUND', 404);
      }
      photoIds = photos.map((photo) => Number(photo.id));
      photoSnapshots = new Map(photos.map((photo) => [Number(photo.id), photo]));
    }
    // 同一相册（或同一批照片）发给同一目标、同一模式时保持幂等：已有有效分享就直接复用，
    // 避免用户重复点击或多端提交产生多条重复分享记录。
    if (shareType === 'album' && projectId) {
      const existing = await sharesDao.findReusableAlbumShare(conn, { orgId: workspace.orgId, sourceUnitId: workspace.unitId,
        targetUnitId, targetUserId, projectId, mode });
      if (existing) {
        await conn.commit();
        return res.json({ ...existing, reused: true });
      }
    }

    const shareId = await sharesDao.insertShare(conn, { orgId: workspace.orgId, sourceUnitId: workspace.unitId,
      targetUnitId, targetUserId, shareType, mode, projectId, createdBy: workspace.userId, expiresAt, snapshot });
    for (let offset = 0; offset < photoIds.length; offset += 400) {
      const rows = photoIds.slice(offset, offset + 400).map((id) =>
        [shareId, id, photoSnapshots.has(id) ? JSON.stringify(photoSnapshots.get(id)) : null]);
      await sharesDao.insertShareItems(conn, rows);
    }
    let copyJobId = null;
    if (mode === 'copy') {
      copyJobId = await sharesDao.insertSystemCopyJob(conn, { shareId, orgId: workspace.orgId,
        targetUnitId, requestedBy: workspace.userId });
    }
    await sharesDao.insertAccessAudit(conn, { orgId: workspace.orgId, unitId: workspace.unitId, userId: workspace.userId,
      action: 'internal_share.create', resourceType: 'internal_share', resourceId: shareId,
      details: { mode, shareType, targetUnitId, targetUserId, photoCount: photoIds.length } });
    await conn.commit();
    if (copyJobId) copyWorker.wake();
    res.status(201).json({ id: shareId, mode, shareType, projectId,
      targetUnitId, targetUserId, expiresAt, photoCount: photoIds.length, copyJobId });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    sendError(res, err);
  } finally { conn.release(); }
});

router.get('/received', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    if (!workspace.enabled || !workspace.unitId) return res.json([]);
    const rows = await sharesDao.listReceivedShares(pool, workspace);
    const withCover = rows.map(row => ({ ...row,
      coverUrl: row.coverThumb ? buildMediaUrl(row.coverThumb, { userId: workspace.userId, photoId: row.coverPhotoId }) : null }));
    res.json(withCover);
  } catch (err) { sendError(res, err); }
});

router.get('/sent', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    if (!workspace.enabled || !workspace.unitId) return res.json([]);
    const rows = await sharesDao.listSentShares(pool, workspace);
    res.json(rows.map(row => ({ ...row,
      coverUrl: row.coverThumb ? buildMediaUrl(row.coverThumb, { userId: workspace.userId, photoId: row.coverPhotoId }) : null })));
  } catch (err) { sendError(res, err); }
});

router.post('/:id/copy', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    if (workspace.ownPhotosOnly) throw new WorkspaceAccessError('ORGANIZATION_PHOTO_ACCESS_REQUIRED');
    const shareId = positiveId(req.params.id);
    if (!workspace.enabled || !workspace.unitId || !shareId) {
      throw new WorkspaceAccessError('SHARE_NOT_FOUND', 404);
    }
    const share = await sharesDao.findCopyShare(pool, {
      shareId, orgId: workspace.orgId, unitId: workspace.unitId, userId: workspace.userId });
    if (!share) throw new WorkspaceAccessError('SHARE_NOT_FOUND', 404);
    const automatic = await sharesDao.findAutomaticCopyJob(pool, shareId);
    if (automatic) {
      if (automatic.status !== 'failed') return res.json(automatic);
      await sharesDao.requeueCopyJob(pool, automatic.id);
      copyWorker.wake();
      return res.status(202).json({ ...automatic, status: 'queued', errorCode: null });
    }
    let targetProjectId = null;
    if (share.share_type === 'collection') {
      targetProjectId = positiveId(req.body?.targetProjectId);
      if (!targetProjectId) throw new WorkspaceAccessError('TARGET_ALBUM_REQUIRED', 400);
      const target = await sharesDao.findTargetProject(pool, { projectId: targetProjectId,
        orgId: workspace.orgId, unitId: workspace.unitId });
      if (!target) throw new WorkspaceAccessError('TARGET_ALBUM_NOT_FOUND', 404);
    }
    const existing = await sharesDao.findActiveCopyJob(pool, { shareId, userId: workspace.userId,
      targetProjectId });
    if (existing) return res.json(existing);
    const jobId = await sharesDao.insertCopyJob(pool, { shareId, orgId: workspace.orgId,
      unitId: workspace.unitId, requestedBy: workspace.userId, targetProjectId });
    copyWorker.wake();
    res.status(202).json({ id: jobId, status: 'queued', estimatedBytes: 0, copiedBytes: 0 });
  } catch (err) { sendError(res, err); }
});

router.get('/copy-jobs/:id', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    const jobId = positiveId(req.params.id);
    if (!workspace.enabled || !workspace.unitId || !jobId) {
      throw new WorkspaceAccessError('COPY_JOB_NOT_FOUND', 404);
    }
    const job = await sharesDao.findCopyJob(pool, { jobId, orgId: workspace.orgId,
      unitId: workspace.unitId, userId: workspace.userId });
    if (!job) throw new WorkspaceAccessError('COPY_JOB_NOT_FOUND', 404);
    res.json(job);
  } catch (err) { sendError(res, err); }
});

router.get('/:id', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    const id = positiveId(req.params.id);
    if (!id) throw new WorkspaceAccessError('INVALID_SHARE', 400);
    const share = await sharesDao.findShareInOrganization(pool, { shareId: id, orgId: workspace.orgId });
    if (!share || share.revoked_at || (share.expires_at && new Date(share.expires_at) <= new Date())) {
      throw new WorkspaceAccessError('SHARE_NOT_FOUND', 404);
    }
    const recipient = Number(share.target_unit_id) === workspace.unitId
      && (!share.target_user_id || Number(share.target_user_id) === workspace.userId);
    const owner = Number(share.source_unit_id) === workspace.unitId
      && (workspace.collegeAdmin || ['editor', 'manager'].includes(workspace.role));
    if (!recipient && !owner && !workspace.collegeAdmin) throw new WorkspaceAccessError('SHARE_NOT_FOUND', 404);
    let copyResult = null;
    let copyStatus = null;
    if (share.mode === 'copy') {
      const job = await sharesDao.findLatestCopyJob(pool, id);
      copyStatus = job?.status || null;
      copyResult = workspace.ownPhotosOnly ? null : job?.result_json || null;
      if (typeof copyResult === 'string') copyResult = JSON.parse(copyResult);
    }
    const copiedProjectId = copyStatus === 'ready' ? positiveId(copyResult?.projectId) : null;
    const canViewCopiedPhotos = recipient || workspace.collegeAdmin;
    const limit = Math.max(1, Math.min(120, Math.floor(Number(req.query.limit) || 60)));
    const offset = Math.max(0, Math.min(1000000, Math.floor(Number(req.query.offset) || 0)));
    let source = null;
    if (share.mode === 'copy') {
      if (copiedProjectId && canViewCopiedPhotos) {
        source = { kind: 'copy', projectId: copiedProjectId };
      }
    } else if (share.share_type === 'album') {
      source = { kind: 'album', projectId: share.project_id };
    } else {
      source = { kind: 'collection', shareId: id };
    }
    const { total, photos } = source
      ? await sharesDao.listSharePhotoPage(pool, workspace, { source, limit, offset })
      : { total: 0, photos: [] };
    res.json({ id: share.id, shareType: share.share_type, mode: share.mode,
      projectId: share.mode === 'copy' ? copiedProjectId : share.project_id,
      albumName: share.albumName, copyStatus,
      sourceUnitName: share.sourceUnitName, sourceOrganizationName: share.sourceOrganizationName,
      sharedByName: share.sharedByName, createdAt: share.created_at, expiresAt: share.expires_at,
      total, offset, hasMore: offset + photos.length < total,
      photos: photos.map((photo) => ({ ...photo,
        url: buildMediaUrl(photo.url, { userId: workspace.userId, photoId: photo.id }),
        thumbUrl: buildMediaUrl(photo.thumbUrl, { userId: workspace.userId, photoId: photo.id }),
        playbackUrl: buildMediaUrl(photo.playbackUrl, { userId: workspace.userId, photoId: photo.id }) })) });
  } catch (err) { sendError(res, err); }
});

router.post('/:id/revoke', requirePermission('photos.view'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const workspace = await resolveWorkspace(req, conn);
    const id = positiveId(req.params.id);
    if (!id) throw new WorkspaceAccessError('INVALID_SHARE', 400);
    const share = await sharesDao.findShareForRevoke(conn, { id, orgId: workspace.orgId });
    if (!share) throw new WorkspaceAccessError('SHARE_NOT_FOUND', 404);
    if (share.folder_share_id) throw new WorkspaceAccessError('REVOKE_FOLDER_SHARE_REQUIRED', 409);
    await requireSourceEditor(workspace, Number(share.source_unit_id), conn);
    await conn.beginTransaction();
    await sharesDao.revokeShare(conn, id);
    await sharesDao.insertAccessAudit(conn, { orgId: workspace.orgId, unitId: workspace.unitId,
      userId: workspace.userId, action: 'internal_share.revoke', resourceType: 'internal_share', resourceId: id });
    await conn.commit();
    res.json({ revoked: true });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    sendError(res, err);
  } finally { conn.release(); }
});

module.exports = router;
