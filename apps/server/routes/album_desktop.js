const express = require('express');
const { pool } = require('../db');
const { requirePermission } = require('../lib/permissions');
const { resolveWorkspace, projectListScope, unitRoleAllows, metadataEditScope, sendWorkspaceError } = require('../lib/workspace_access');
const { buildMediaUrl } = require('../lib/media_access');
const { photoOwnerFilter } = require('../lib/access_policy');
const { listSharedAlbums } = require('../lib/shared_albums');
const { syncFolderShares, listFolderShares } = require('../lib/folder_shares');
const { desktopSharingStatuses } = require('../lib/card_sharing_status');
const { invalid, json, validateGroups, validatePreferences, authorizeFolderChanges } = require('../lib/album_desktop');
const router = express.Router();

router.use(requirePermission('photos.view'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

async function context(req) {
  const workspace = await resolveWorkspace(req);
  if (!workspace.userId || !workspace.orgId) throw invalid('请登录后使用桌面', 401);
  return { ...workspace, unitKey: workspace.unitId || 0,
    canOrganize: workspace.enabled ? workspace.collegeAdmin || unitRoleAllows(workspace.role, 'edit')
      : ['admin', 'superadmin', 'editor'].includes(workspace.userRole),
    canDeleteFolders: workspace.enabled ? workspace.collegeAdmin || unitRoleAllows(workspace.role, 'manage')
      : ['admin', 'superadmin'].includes(workspace.userRole) };
}

async function catalog(workspace, db = pool, full = true) {
  const scope = projectListScope(workspace, 'p');
  const params = [workspace.orgId, ...scope.params];
  const where = `p.organization_id = ?${scope.sql ? ` AND ${scope.sql}` : ''}`;
  if (!full) {
    const [rows] = await db.query(`SELECT p.id FROM projects p WHERE ${where}`, params);
    return rows;
  }
  // 每本相册的封面/张数用一次聚合 + 窗口函数算出，避免逐行相关子查询（45 本相册时从 ~600ms 降到 ~2ms）。
  const owner = photoOwnerFilter(workspace);
  const [rows] = await db.query(`SELECT p.id, p.name, p.description, p.meta, p.admin_id AS adminId,
    p.created_at AS createdAt, p.updated_at AS updatedAt, p.event_date AS eventDate,
    COALESCE(cn.count, 0) AS count,
    ph.id AS photoId, ph.thumb_url AS coverThumb, ph.url AS coverUrl
    FROM projects p
    LEFT JOIN (SELECT project_id, COUNT(*) count FROM photos WHERE organization_id = ?${owner.sql} GROUP BY project_id) cn
      ON cn.project_id = p.id
    LEFT JOIN (
      SELECT id, project_id, thumb_url, url FROM (
        SELECT id, project_id, thumb_url, url,
          ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at DESC, id DESC) rn
        FROM photos WHERE organization_id = ?${owner.sql} AND (type IS NULL OR type <> 'video')
      ) ranked WHERE rn = 1
    ) ph ON ph.project_id = p.id
    WHERE ${where} ORDER BY COALESCE(p.updated_at, p.created_at) DESC, p.id DESC`,
    [workspace.orgId, ...owner.params, workspace.orgId, ...owner.params, ...params]);
  const editScope = metadataEditScope(workspace);
  return rows.map(row => ({ id: Number(row.id), name: row.name, title: row.name, adminId: row.adminId || null,
    canEdit: ['unit', 'organization'].includes(editScope) || (editScope === 'own' && Number(row.adminId) === workspace.userId),
    description: row.description || '', count: Number(row.count) || 0,
    originLabel: (() => { const lineage = json(row.meta, {}).shareLineage; const last = Array.isArray(lineage) ? lineage[lineage.length-1] : null; return [last?.organizationName,last?.unitName].filter(Boolean).join(' / '); })(),
    createdAt: row.createdAt, updatedAt: row.updatedAt, eventDate: row.eventDate,
    year: String(new Date(row.eventDate || row.createdAt).getFullYear()),
    image: row.coverThumb || row.coverUrl ? buildMediaUrl(row.coverThumb || row.coverUrl, { userId: workspace.userId, photoId: row.photoId }) : null }));
}

function fail(res, error) {
  if (sendWorkspaceError(res, error)) return;
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error('[album-desktop]', error);
  res.status(500).json({ message: '桌面暂时无法加载，请稍后重试' });
}

router.get('/', async (req, res) => {
  let conn;
  try {
    const workspace = await context(req);
    conn = await pool.getConnection();
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.beginTransaction();
    const ownedAlbums = await catalog(workspace, conn);
    const sharedAlbums = await listSharedAlbums(workspace, conn);
    const sharedFolderRows = await listFolderShares(workspace, conn);
    const sharedFolders = sharedFolderRows.map(folder => ({ ...folder,
      coverUrls: (folder.covers || []).map(cover => buildMediaUrl(cover.path, { userId: workspace.userId, photoId: cover.id })) }));
    const [shared] = await conn.query('SELECT state, revision FROM album_desktop_workspaces WHERE organization_id = ? AND unit_key = ?', [workspace.orgId, workspace.unitKey]);
    const [personal] = await conn.query('SELECT state, revision FROM album_desktop_users WHERE user_id = ? AND organization_id = ? AND unit_key = ?', [workspace.userId, workspace.orgId, workspace.unitKey]);
    const storedGroups = json(shared[0]?.state, {}).groups || [];
    const referencedIds = new Set(storedGroups.flatMap(g => g.kind === 'smart' ? [] : g.projectIds || []).map(Number));
    const ownedIds = new Set(ownedAlbums.map(a => a.id));
    const storedPreferences = json(personal[0]?.state, {});
    const sharedRootAlbumIds = new Set((Array.isArray(storedPreferences.sharedRootAlbums) ? storedPreferences.sharedRootAlbums : []).map(Number));
    const albums = [...ownedAlbums, ...sharedAlbums.filter(a => (referencedIds.has(a.id) || sharedRootAlbumIds.has(Number(a.id)))
      && !ownedIds.has(a.id))];
    const ids = new Set(albums.map(a => a.id));
    const groups = storedGroups.filter(g => !g.restrictedToUserId || Number(g.restrictedToUserId) === workspace.userId || workspace.collegeAdmin)
      .map(g => ({ ...g, canEdit: workspace.canOrganize && (workspace.canDeleteFolders || Number(g.createdBy) === workspace.userId),
      projectIds: (g.projectIds || []).filter(id => ids.has(Number(id))) }));
    const sharingStatuses = await desktopSharingStatuses(workspace, ownedAlbums, sharedAlbums, groups, conn);
    const pinnableAlbums = new Set([...ids, ...sharedAlbums.filter(album => !album.viaFolderOnly).map(album => Number(album.id))]);
    await conn.commit();
    res.json({ albums, sharedAlbums, sharedFolders, groups, sharingStatuses, preferences: validatePreferences(
      storedPreferences, groups, pinnableAlbums, new Set(sharedFolders.map(folder => Number(folder.id))),
      new Set(sharedAlbums.map(album => Number(album.id)))),
      scope: { userId: workspace.userId, organizationId: workspace.orgId, unitId: workspace.unitId },
      workspaceRevision: Number(shared[0]?.revision || 0), userRevision: Number(personal[0]?.revision || 0),
      canOrganize: workspace.canOrganize, canDeleteFolders: workspace.canDeleteFolders });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => null);
    fail(res, error);
  } finally { conn?.release(); }
});

router.put('/state', async (req, res) => {
  let conn;
  try {
    const workspace = await context(req);
    const body = req.body || {};
    if (body.scope && (Number(body.scope.userId) !== workspace.userId
      || Number(body.scope.organizationId) !== workspace.orgId || Number(body.scope.unitId || 0) !== workspace.unitKey)) {
      throw invalid('账号或工作空间已切换，请重新加载桌面', 409);
    }
    const changesGroups = Object.hasOwn(body, 'groups');
    if (changesGroups && !workspace.canOrganize) throw invalid('只有小组织编辑人员可以整理相册集', 403);
    if (Buffer.byteLength(JSON.stringify(body)) > 512 * 1024) throw invalid('桌面数据过大', 413);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query('INSERT IGNORE INTO album_desktop_workspaces (organization_id, unit_key, state) VALUES (?, ?, ?)', [workspace.orgId, workspace.unitKey, '{"groups":[]}']);
    await conn.query('INSERT IGNORE INTO album_desktop_users (user_id, organization_id, unit_key, state) VALUES (?, ?, ?, ?)', [workspace.userId, workspace.orgId, workspace.unitKey, '{}']);
    const [shared] = await conn.query('SELECT state, revision FROM album_desktop_workspaces WHERE organization_id = ? AND unit_key = ? FOR UPDATE', [workspace.orgId, workspace.unitKey]);
    const [personal] = await conn.query('SELECT state, revision FROM album_desktop_users WHERE user_id = ? AND organization_id = ? AND unit_key = ? FOR UPDATE', [workspace.userId, workspace.orgId, workspace.unitKey]);
    if ((changesGroups && Number(body.workspaceRevision) !== Number(shared[0].revision))
      || (body.preferences && Number(body.userRevision) !== Number(personal[0].revision))) throw invalid('桌面已在其他页面更新，请重新加载后再操作', 409);
    const albums = await catalog(workspace, conn, false);
    const sharedAlbums = await listSharedAlbums(workspace, conn);
    const sharedIds = new Set(sharedAlbums.map(a => Number(a.id)));
    const ids = new Set([...albums.map(a => Number(a.id)), ...sharedIds]);
    const storedGroups = json(shared[0].state, {}).groups || [];
    const hiddenGroups = storedGroups.filter(group => group.restrictedToUserId
      && Number(group.restrictedToUserId) !== workspace.userId && !workspace.collegeAdmin);
    const hiddenIds = new Set(hiddenGroups.map(group => group.id));
    if (changesGroups && Array.isArray(body.groups) && body.groups.some(group => hiddenIds.has(group?.id))) throw invalid('没有修改这个文件夹的权限', 403);
    // Older clients do not know parentId; never flatten a hierarchy on their saves.
    const submittedGroups = Array.isArray(body.groups) ? body.groups.map(group => group && !Object.hasOwn(group, 'parentId')
      ? { ...group, parentId: storedGroups.find(old => old.id === group.id)?.parentId || null } : group) : body.groups;
    const validatedGroups = changesGroups ? validateGroups(submittedGroups, ids).map(group => ({...group,
      projectIds: group.kind === 'smart' ? [] : [...new Set([...group.projectIds,
        ...(storedGroups.find(old=>old.id===group.id)?.projectIds || []).filter(id=>!ids.has(Number(id))
          || (body.sharedReferencesVersion !== 1 && sharedIds.has(Number(id))))])] })) : storedGroups;
    let groups = changesGroups ? authorizeFolderChanges(storedGroups.filter(group => !hiddenIds.has(group.id)), validatedGroups, {
      userId: workspace.userId, canManage: workspace.canDeleteFolders, canDelete: workspace.canDeleteFolders,
    }) : storedGroups;
    if (changesGroups && hiddenGroups.length) {
      const visible = [...groups];
      groups = storedGroups.flatMap(group => hiddenIds.has(group.id) ? [group] : visible.length ? [visible.shift()] : []).concat(visible);
      validateGroups(groups, new Set(groups.flatMap(group => group.projectIds || []).map(Number)));
    }
    if (changesGroups) await conn.query('UPDATE album_desktop_workspaces SET state = ?, revision = revision + 1 WHERE organization_id = ? AND unit_key = ?', [JSON.stringify({ groups }), workspace.orgId, workspace.unitKey]);
    if (changesGroups) await syncFolderShares(conn, workspace.orgId, workspace.unitKey, groups);
    if (body.preferences) {
      const previous = json(personal[0].state, {});
      const input = body.preferences;
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('个人桌面设置不正确');
      // Older clients omit placement keys; an explicit empty map or list clears them.
      const submitted = { sharedFolderLocations: previous.sharedFolderLocations, sharedRootAlbums: previous.sharedRootAlbums,
        sharedRootFolders: previous.sharedRootFolders, ...input };
      const needsFolderShares = (Array.isArray(submitted.pins) && submitted.pins.some(key => typeof key === 'string' && key.startsWith('shared-folder:')))
        || Object.keys(submitted.sharedFolderLocations || {}).length > 0
        || (Array.isArray(submitted.sharedRootFolders) && submitted.sharedRootFolders.length > 0);
      const folderIds = new Set(needsFolderShares ? (await listFolderShares(workspace, conn)).map(folder => Number(folder.id)) : []);
      const needsSharedAlbums = Array.isArray(submitted.sharedRootAlbums) && submitted.sharedRootAlbums.length > 0;
      const sharedAlbumIds = new Set(needsSharedAlbums
        ? (await listSharedAlbums(workspace, conn)).map(album => Number(album.id)) : []);
      const visibleGroups = groups.filter(group => !group.restrictedToUserId || Number(group.restrictedToUserId) === workspace.userId || workspace.collegeAdmin);
      const preferences = validatePreferences(submitted, visibleGroups, ids, folderIds, sharedAlbumIds);
      await conn.query('UPDATE album_desktop_users SET state = ?, revision = revision + 1 WHERE user_id = ? AND organization_id = ? AND unit_key = ?', [JSON.stringify(preferences), workspace.userId, workspace.orgId, workspace.unitKey]);
    }
    await conn.commit();
    res.json({ workspaceRevision: Number(shared[0].revision) + (changesGroups ? 1 : 0),
      userRevision: Number(personal[0].revision) + (body.preferences ? 1 : 0) });
  } catch (error) {
    if (conn) await conn.rollback();
    fail(res, error);
  } finally { conn?.release(); }
});

module.exports = router;
