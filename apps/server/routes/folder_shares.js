const express = require('express');
const { pool } = require('../db');
const { requirePermission } = require('../lib/permissions');
const { resolveWorkspace, positiveId, WorkspaceAccessError, sendWorkspaceError } = require('../lib/workspace_access');
const { expirationFor, requireSourceEditor, requireTarget } = require('../lib/internal_share_policy');
const { folderBranch, sourceGroups, syncFolderShares, listFolderShares } = require('../lib/folder_shares');
const { folderSharingStatuses } = require('../lib/card_sharing_status');
const { buildMediaUrl } = require('../lib/media_access');
const crypto = require('crypto');
const { createAlbumCopy, attachFolderCopy } = require('../lib/folder_share_copy');
const copyWorker = require('../lib/organization_copy_worker');
const router = express.Router();
router.use(requirePermission('photos.view'));
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
function fail(res, error) {
  if (sendWorkspaceError(res, error)) return;
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error('[folder-shares]', error);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
}
const validFolderId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);

router.get('/received', async (req, res) => {
  try { res.json(await listFolderShares(await resolveWorkspace(req), pool)); }
  catch (error) { fail(res, error); }
});
router.get('/sent', async (req, res) => {
  try { res.json(await listFolderShares(await resolveWorkspace(req), pool, 'sent')); }
  catch (error) { fail(res, error); }
});
router.get('/status/:folderId', async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    const groups = await sourceGroups(pool, workspace.orgId, workspace.unitId);
    if (!validFolderId(req.params.folderId) || !groups.some(g => g.id === req.params.folderId
      && (!g.restrictedToUserId || Number(g.restrictedToUserId) === workspace.userId || workspace.collegeAdmin))) throw new WorkspaceAccessError('FOLDER_NOT_FOUND', 404);
    const statuses = await folderSharingStatuses(workspace, groups, pool);
    res.json({ sharing: Object.hasOwn(statuses, req.params.folderId) ? statuses[req.params.folderId] : null });
  } catch (error) { fail(res, error); }
});

router.post('/', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const workspace = await resolveWorkspace(req, conn), body = req.body || {};
    await requireSourceEditor(workspace, workspace.unitId);
    if (!validFolderId(body.folderId) || !['read', 'collaborate', 'copy', 'public'].includes(body.mode)) throw new WorkspaceAccessError('INVALID_FOLDER_SHARE', 400);
    const publicShare = body.mode === 'public';
    const targetUnitId = positiveId(body.targetUnitId), targetUserId = body.targetUserId ? positiveId(body.targetUserId) : null;
    if (!publicShare && (!targetUnitId || (body.targetUserId && !targetUserId))) throw new WorkspaceAccessError('INVALID_TARGET', 400);
    if (!publicShare) await requireTarget(workspace, targetUnitId, targetUserId, conn);
    const syncMode = String(body.syncMode || 'approval');
    if (publicShare && !['approval', 'automatic'].includes(syncMode)) throw new WorkspaceAccessError('INVALID_SYNC_MODE', 400);
    if (publicShare && syncMode === 'automatic' && !workspace.collegeAdmin && workspace.role !== 'manager') throw new WorkspaceAccessError('UNIT_MANAGER_REQUIRED');
    const expiresAt = expirationFor(body.mode, publicShare ? { ...body, permanent: false } : body);
    await conn.beginTransaction();
    if (body.mode === 'copy') {
      for (const unitId of [workspace.unitId, targetUnitId].sort((a, b) => a - b)) {
        await conn.query(`INSERT IGNORE INTO album_desktop_workspaces (organization_id, unit_key, state) VALUES (?, ?, '{"groups":[]}')`, [workspace.orgId, unitId]);
        await sourceGroups(conn, workspace.orgId, unitId, true);
      }
    }
    const groups = await sourceGroups(conn, workspace.orgId, workspace.unitId, true);
    const folder = groups.find(group => group.id === body.folderId && group.kind !== 'smart');
    if (!folder) throw new WorkspaceAccessError('FOLDER_NOT_FOUND', 404);
    if (folder.restrictedToUserId) throw new WorkspaceAccessError('PRIVATE_FOLDER_SHARE_FORBIDDEN');
    let snapshot = null, projectIds = [];
    if (body.mode === 'copy') {
      const branch = folderBranch(groups, folder.id);
      const candidates = [...new Set(branch.flatMap(group => group.projectIds || []).map(Number))];
      const [projects] = candidates.length ? await conn.query(`SELECT id FROM projects WHERE organization_id = ? AND unit_id = ?
        AND restricted_to_user_id IS NULL AND id IN (?)`, [workspace.orgId, workspace.unitId, candidates]) : [[]];
      projectIds = projects.map(project => Number(project.id));
      const allowed = new Set(projectIds);
      snapshot = { groups: branch.map(group => ({ id: group.id, name: group.name,
        parentId: group.id === folder.id ? null : group.parentId, kind: 'manual', color: group.color,
        tint: group.tint, symbol: group.symbol, layout: group.layout, projectIds: (group.projectIds || []).map(Number).filter(id => allowed.has(id)) })) };
    }
    const [created] = await conn.query(
      `INSERT INTO folder_shares (organization_id, source_unit_id, source_folder_id, folder_name,
         target_unit_id, target_user_id, mode, created_by, expires_at, snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [workspace.orgId, workspace.unitId, folder.id, folder.name, publicShare ? null : targetUnitId,
        publicShare ? null : targetUserId, body.mode, workspace.userId, expiresAt, snapshot ? JSON.stringify(snapshot) : null]
    );
    let code = null;
    if (body.mode === 'copy') {
      const parent = { id: created.insertId, organization_id: workspace.orgId, source_unit_id: workspace.unitId,
        source_folder_id: folder.id, target_unit_id: targetUnitId, target_user_id: targetUserId,
        created_by: workspace.userId, expires_at: expiresAt, snapshot_json: snapshot };
      // Materialize the independent folder tree even when the source folder is empty.
      await attachFolderCopy(conn, parent);
      for (const projectId of projectIds) await createAlbumCopy(conn, parent, projectId);
    } else {
      await syncFolderShares(conn, workspace.orgId, workspace.unitId, groups);
    }
    if (publicShare) {
      code = crypto.randomBytes(18).toString('base64url');
      const [link] = await conn.query(`INSERT INTO share_links (code, share_type, title, created_by,
        organization_id, unit_id, sync_mode, expires_at, folder_share_id) VALUES (?, 'collection', ?, ?, ?, ?, ?, ?, ?)`,
      [code, folder.name, workspace.userId, workspace.orgId, workspace.unitId, syncMode, expiresAt, created.insertId]);
      await conn.query(`INSERT INTO share_link_items (share_id, photo_id, sort_order)
        SELECT ?, ph.id, ph.id FROM photos ph JOIN internal_shares s ON s.project_id = ph.project_id
        WHERE s.folder_share_id = ? AND ph.organization_id = ? AND ph.unit_id = ? AND s.revoked_at IS NULL`,
      [link.insertId, created.insertId, workspace.orgId, workspace.unitId]);
    }
    await conn.query(`INSERT INTO organization_access_audit (organization_id, unit_id, user_id, action, resource_type, resource_id, details)
      VALUES (?, ?, ?, 'folder_share.create', 'folder_share', ?, ?)`,
    [workspace.orgId, workspace.unitId, workspace.userId, created.insertId, JSON.stringify({ folderId: folder.id, mode: body.mode, targetUnitId, targetUserId })]);
    await conn.commit();
    if (body.mode === 'copy') copyWorker.wake();
    res.status(201).json({ id: created.insertId, code, shareType: 'folder', folderId: folder.id, mode: body.mode, expiresAt });
  } catch (error) { await conn?.rollback().catch(() => {}); fail(res, error); }
  finally { conn?.release(); }
});

router.get('/:id', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const workspace = await resolveWorkspace(req, conn), id = positiveId(req.params.id);
    if (!id) throw new WorkspaceAccessError('INVALID_SHARE', 400);
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.beginTransaction();
    const share = (await listFolderShares(workspace, conn)).find(row => row.id === id);
    if (!share) throw new WorkspaceAccessError('SHARE_NOT_FOUND', 404);
    if (share.mode === 'copy') {
      const copyFolderId = `copyfolder-${share.id}-${crypto.createHash('sha256').update(share.folderId).digest('hex').slice(0, 20)}`;
      await conn.commit(); return res.json({ share, copyFolderId });
    }
    const branch = folderBranch(await sourceGroups(conn, workspace.orgId, share.sourceUnitId), share.folderId);
    if (!branch.length) throw new WorkspaceAccessError('SHARE_NOT_FOUND', 404);
    const [rows] = await conn.query(
      `SELECT DISTINCT p.id, p.name, p.description, p.unit_id AS unitId,
              p.created_at AS createdAt, p.updated_at AS updatedAt,
              (SELECT COUNT(*) FROM photos c WHERE c.project_id = p.id AND c.organization_id = p.organization_id) AS count,
              ph.id AS photoId, ph.thumb_url AS coverThumb, ph.url AS coverUrl
       FROM internal_shares s JOIN projects p ON p.id = s.project_id
       LEFT JOIN photos ph ON ph.id = (SELECT i.id FROM photos i WHERE i.project_id = p.id
         AND i.organization_id = p.organization_id AND (i.type IS NULL OR i.type <> 'video') ORDER BY i.id DESC LIMIT 1)
       WHERE s.folder_share_id = ? AND s.organization_id = ? AND s.source_unit_id = ?
         AND s.target_unit_id = ? AND (s.target_user_id IS NULL OR s.target_user_id = ?)
         AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > NOW())
         AND p.organization_id = ? AND p.unit_id = ? AND p.restricted_to_user_id IS NULL`,
      [id, workspace.orgId, share.sourceUnitId, workspace.unitId, workspace.userId, workspace.orgId, share.sourceUnitId]
    );
    const ids = new Set(rows.map(row => Number(row.id)));
    const groups = branch.map(group => ({ id: group.id, name: group.name, parentId: group.id === share.folderId ? null : group.parentId,
      kind: 'manual', color: group.color, tint: group.tint, symbol: group.symbol, layout: group.layout,
      projectIds: (group.projectIds || []).map(Number).filter(id => ids.has(id)), canEdit: false }));
    const albums = rows.map(row => ({ id: Number(row.id), name: row.name, title: row.name, description: row.description,
      unitId: row.unitId, count: Number(row.count), createdAt: row.createdAt, updatedAt: row.updatedAt,
      isShared: true, originLabel: share.originLabel, shareMode: share.mode,
      groups: groups.filter(group => group.projectIds.includes(Number(row.id))).map(group => group.id),
      image: row.coverThumb || row.coverUrl ? buildMediaUrl(row.coverThumb || row.coverUrl, { userId: workspace.userId, photoId: row.photoId }) : null }));
    await conn.commit();
    res.json({ share, groups, albums });
  } catch (error) { await conn?.rollback().catch(() => {}); fail(res, error); }
  finally { conn?.release(); }
});

router.post('/:id/revoke', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const workspace = await resolveWorkspace(req, conn), id = positiveId(req.params.id);
    await requireSourceEditor(workspace, workspace.unitId);
    if (!id) throw new WorkspaceAccessError('INVALID_SHARE', 400);
    await conn.beginTransaction();
    await sourceGroups(conn, workspace.orgId, workspace.unitId, true);
    const [rows] = await conn.query('SELECT id FROM folder_shares WHERE id = ? AND organization_id = ? AND source_unit_id = ? FOR UPDATE',
      [id, workspace.orgId, workspace.unitId]);
    if (!rows.length) throw new WorkspaceAccessError('SHARE_NOT_FOUND', 404);
    await conn.query('UPDATE folder_shares SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL', [id]);
    await conn.query('UPDATE internal_shares SET revoked_at = NOW() WHERE folder_share_id = ? AND revoked_at IS NULL', [id]);
    await conn.query('UPDATE share_links SET revoked_at = NOW() WHERE folder_share_id = ? AND revoked_at IS NULL', [id]);
    await conn.query(`INSERT INTO organization_access_audit (organization_id, unit_id, user_id, action, resource_type, resource_id)
      VALUES (?, ?, ?, 'folder_share.revoke', 'folder_share', ?)`, [workspace.orgId, workspace.unitId, workspace.userId, id]);
    await conn.commit();
    res.json({ revoked: true });
  } catch (error) { await conn?.rollback().catch(() => {}); fail(res, error); }
  finally { conn?.release(); }
});

router.post('/:id/copy', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const workspace = await resolveWorkspace(req, conn), id = positiveId(req.params.id);
    if (!id) throw new WorkspaceAccessError('INVALID_SHARE', 400);
    await conn.beginTransaction();
    const [rows] = await conn.query(`SELECT * FROM folder_shares WHERE id = ? AND organization_id = ? AND mode = 'copy'
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) FOR UPDATE`, [id, workspace.orgId]);
    const share = rows[0];
    if (!share) throw new WorkspaceAccessError('SHARE_NOT_FOUND', 404);
    if (Number(share.source_unit_id) === workspace.unitId) await requireSourceEditor(workspace, workspace.unitId);
    else if (Number(share.target_unit_id) !== workspace.unitId || (share.target_user_id && Number(share.target_user_id) !== workspace.userId)) throw new WorkspaceAccessError('SHARE_NOT_FOUND', 404);
    const [jobs] = await conn.query(`UPDATE organization_copy_jobs j JOIN internal_shares s ON s.id = j.share_id
      SET j.status = 'queued', j.error_code = NULL, j.copied_bytes = 0
      WHERE s.folder_share_id = ? AND s.revoked_at IS NULL AND j.status = 'failed'`, [id]);
    await conn.commit();
    copyWorker.wake(); res.json({ queued: jobs.affectedRows });
  } catch (error) { await conn?.rollback().catch(() => {}); fail(res, error); }
  finally { conn?.release(); }
});

module.exports = router;
