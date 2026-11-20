const express = require('express');
const sharesDao = require('../lib/queries/internal_shares');
const { pool } = require('../db');
const { buildMediaUrl } = require('../lib/media_access');
const { requirePermission } = require('../lib/permissions');
const { photoOwnerFilter } = require('../lib/access_policy');
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
      if (shareType === 'album') {
        const [projects] = await conn.query(
          'SELECT name, description, event_date, meta, tags, type FROM projects WHERE id = ? AND organization_id = ? AND unit_id = ? LIMIT 1',
          [projectId, workspace.orgId, workspace.unitId]
        );
        if (!projects.length) throw new WorkspaceAccessError('SOURCE_ALBUM_NOT_FOUND', 404);
        const [sections] = await conn.query(
          'SELECT id, name, section_time, sort_order FROM project_timeline_sections WHERE project_id = ? ORDER BY sort_order, id',
          [projectId]
        );
        snapshot = { project: projects[0], sections };
      }
      const [photos] = await conn.query(
        shareType === 'album'
          ? 'SELECT ph.*, p.name AS source_album_name FROM photos ph JOIN projects p ON p.id = ph.project_id WHERE ph.project_id = ? AND ph.organization_id = ? AND ph.unit_id = ? ORDER BY ph.id FOR SHARE'
          : 'SELECT ph.*, p.name AS source_album_name FROM photos ph LEFT JOIN projects p ON p.id = ph.project_id WHERE ph.id IN (?) AND ph.organization_id = ? AND ph.unit_id = ? ORDER BY ph.id FOR SHARE',
        [shareType === 'album' ? projectId : photoIds, workspace.orgId, workspace.unitId]
      );
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

    const created = await sharesDao.insertShare(conn, { orgId: workspace.orgId, sourceUnitId: workspace.unitId,
      targetUnitId, targetUserId, shareType, mode, projectId, createdBy: workspace.userId, expiresAt, snapshot });
    for (let offset = 0; offset < photoIds.length; offset += 400) {
      const rows = photoIds.slice(offset, offset + 400).map((id) =>
        [created.insertId, id, photoSnapshots.has(id) ? JSON.stringify(photoSnapshots.get(id)) : null]);
      await sharesDao.insertShareItems(conn, rows);
    }
    let copyJobId = null;
    if (mode === 'copy') {
      const job = await sharesDao.insertCopyJob(conn, { shareId: created.insertId, orgId: workspace.orgId,
        targetUnitId, requestedBy: workspace.userId });
      copyJobId = job.insertId;
    }
    await sharesDao.insertAccessAudit(conn, { orgId: workspace.orgId, unitId: workspace.unitId, userId: workspace.userId,
      action: 'internal_share.create', resourceType: 'internal_share', resourceId: created.insertId,
      details: { mode, shareType, targetUnitId, targetUserId, photoCount: photoIds.length } });
    await conn.commit();
    if (copyJobId) copyWorker.wake();
    res.status(201).json({ id: created.insertId, mode, shareType, projectId,
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
    const owner = photoOwnerFilter(workspace, 'ph');
    const rows = await sharesDao.queryRows(pool, { sql:
      `SELECT s.id, s.share_type AS shareType, s.mode, s.project_id AS projectId,
              s.expires_at AS expiresAt, s.created_at AS createdAt,
              source.name AS sourceUnitName, org.name AS sourceOrganizationName,
              sharer.name AS sharedByName, p.name AS albumName,
              (SELECT COUNT(*) FROM internal_share_items si JOIN photos ph ON ph.id = si.photo_id
                WHERE si.share_id = s.id${owner.sql}) AS snapshotCount,
              (SELECT j.status FROM organization_copy_jobs j
               WHERE j.share_id = s.id AND j.system_initiated = 1 ORDER BY j.id DESC LIMIT 1) AS copyStatus,
              ${workspace.ownPhotosOnly ? 'NULL' : `(SELECT j.result_json FROM organization_copy_jobs j
               WHERE j.share_id = s.id AND j.system_initiated = 1 ORDER BY j.id DESC LIMIT 1)`} AS copyResult
       FROM internal_shares s
       JOIN organization_units source ON source.id = s.source_unit_id
       JOIN organizations org ON org.id = s.organization_id
       LEFT JOIN users sharer ON sharer.id = s.created_by
       LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.organization_id = ? AND s.target_unit_id = ?
         AND s.folder_share_id IS NULL
         AND (s.target_user_id IS NULL OR s.target_user_id = ?)
         AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > NOW())
       ORDER BY s.created_at DESC LIMIT 200`,
      params: [...owner.params, workspace.orgId, workspace.unitId, workspace.userId] });
    const withCover = rows.map(row => ({ ...row,
      coverUrl: row.coverThumb ? buildMediaUrl(row.coverThumb, { userId: workspace.userId, photoId: row.coverPhotoId }) : null }));
    res.json(withCover);
  } catch (err) { sendError(res, err); }
});

router.get('/sent', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    if (!workspace.enabled || !workspace.unitId) return res.json([]);
    const owner = photoOwnerFilter(workspace, 'ph');
    const rows = await sharesDao.queryRows(pool, { sql:
      `SELECT s.id, s.share_type AS shareType, s.mode, s.project_id AS projectId,
              s.expires_at AS expiresAt, s.revoked_at AS revokedAt,
              s.created_at AS createdAt, target.name AS targetUnitName,
              recipient.name AS targetUserName, p.name AS albumName,
              (SELECT ph.thumb_url FROM photos ph WHERE ph.project_id = p.id AND ph.organization_id = p.organization_id${owner.sql}
                ORDER BY ph.created_at DESC, ph.id DESC LIMIT 1) AS coverThumb,
              (SELECT ph.id FROM photos ph WHERE ph.project_id = p.id AND ph.organization_id = p.organization_id${owner.sql}
                ORDER BY ph.created_at DESC, ph.id DESC LIMIT 1) AS coverPhotoId,
              (SELECT COUNT(*) FROM photos ph WHERE ph.project_id = p.id AND ph.organization_id = s.organization_id${owner.sql}) AS photoCount,
              (SELECT j.status FROM organization_copy_jobs j
               WHERE j.share_id = s.id AND j.system_initiated = 1 ORDER BY j.id DESC LIMIT 1) AS copyStatus
       FROM internal_shares s
       JOIN organization_units target ON target.id = s.target_unit_id
       LEFT JOIN users recipient ON recipient.id = s.target_user_id
       LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.organization_id = ? AND s.source_unit_id = ?
         AND s.folder_share_id IS NULL
       ORDER BY s.created_at DESC LIMIT 200`,
      params: [...owner.params, ...owner.params, ...owner.params, workspace.orgId, workspace.unitId] });
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
    const result = await sharesDao.insertCopyJob(pool, { shareId, orgId: workspace.orgId,
      unitId: workspace.unitId, requestedBy: workspace.userId, targetProjectId });
    copyWorker.wake();
    res.status(202).json({ id: result.insertId, status: 'queued', estimatedBytes: 0, copiedBytes: 0 });
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
    const share = await sharesDao.findShareDetail(pool, { shareId: id, orgId: workspace.orgId });
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
    let sourceParams = [];
    let order = '';
    if (share.mode === 'copy') {
      if (copiedProjectId && canViewCopiedPhotos) {
        source = 'FROM photos ph WHERE ph.project_id = ? AND ph.organization_id = ? AND ph.unit_id = ?';
        sourceParams = [copiedProjectId, workspace.orgId, workspace.unitId];
        order = 'ORDER BY ph.created_at DESC, ph.id DESC';
      }
    } else if (share.share_type === 'album') {
      source = 'FROM photos ph WHERE ph.project_id = ? AND ph.organization_id = ?';
      sourceParams = [share.project_id, workspace.orgId];
      order = 'ORDER BY ph.created_at DESC, ph.id DESC';
    } else {
      source = `FROM internal_share_items si JOIN photos ph ON ph.id = si.photo_id
        WHERE si.share_id = ? AND ph.organization_id = ?`;
      sourceParams = [id, workspace.orgId];
      order = 'ORDER BY si.created_at, si.id';
    }
    let total = 0;
    let photos = [];
    if (source) {
      const ownerFilter = photoOwnerFilter(workspace, 'ph');
      source += ownerFilter.sql;
      sourceParams.push(...ownerFilter.params);
      total = await sharesDao.countPhotosInSource(pool, { source, params: sourceParams });
      photos = await sharesDao.listSharePhotos(pool, { source, order, params: sourceParams, limit, offset });
    }
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
