const { pool } = require('../db');
const { json } = require('./album_desktop');
const { WorkspaceAccessError, projectListScope } = require('./workspace_access');
const { listSharedAlbums } = require('./shared_albums');

function folderProjectIds(groups, folderId) {
  if (!Array.isArray(groups) || !groups.some(group => group.id === folderId && group.kind !== 'smart')) {
    throw new WorkspaceAccessError('FOLDER_NOT_FOUND', 404);
  }
  const selected = new Set([folderId]);
  // Iterate over the persisted tree, with cycle protection for legacy data.
  for (let size = -1; size !== selected.size;) {
    size = selected.size;
    for (const group of groups) {
      if (group.kind !== 'smart' && selected.has(group.parentId)) selected.add(group.id);
    }
  }
  return [...new Set(groups.filter(group => selected.has(group.id))
    .flatMap(group => Array.isArray(group.projectIds) ? group.projectIds : [])
    .map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
}

async function resolveWorkspaceSearchScope(workspace, db = pool) {
  if (!workspace.enabled || !workspace.userId || !workspace.orgId || !workspace.unitId) return {};
  const [rows] = await db.query(
    'SELECT state FROM album_desktop_workspaces WHERE organization_id = ? AND unit_key = ?',
    [workspace.orgId, workspace.unitId]
  );
  const storedGroups = json(rows[0]?.state, {}).groups;
  const groups = (Array.isArray(storedGroups) ? storedGroups : []).filter(group => group && (!group.restrictedToUserId
    || Number(group.restrictedToUserId) === workspace.userId || workspace.collegeAdmin));
  const storedIds = new Set((Array.isArray(groups) ? groups : []).filter(group => group.kind !== 'smart')
    .flatMap(group => Array.isArray(group.projectIds) ? group.projectIds : [])
    .map(Number).filter(id => Number.isSafeInteger(id) && id > 0));
  if (!storedIds.size) return {};
  const sharedProjectIds = (await listSharedAlbums(workspace, db)).map(album => album.id).filter(id => storedIds.has(id));
  return sharedProjectIds.length ? { sharedProjectIds, scope: { type: 'workspace' } } : {};
}

async function resolveFolderSearchScope(workspace, folderId, db = pool) {
  if (typeof folderId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(folderId)) {
    throw new WorkspaceAccessError('INVALID_FOLDER_ID', 400);
  }
  if (!workspace.userId || !workspace.orgId) throw new WorkspaceAccessError('FOLDER_NOT_FOUND', 404);
  const [rows] = await db.query(
    'SELECT state FROM album_desktop_workspaces WHERE organization_id = ? AND unit_key = ?',
    [workspace.orgId, workspace.unitId || 0]
  );
  const storedGroups = json(rows[0]?.state, {}).groups;
  const groups = (Array.isArray(storedGroups) ? storedGroups : []).filter(group => group && (!group.restrictedToUserId
    || Number(group.restrictedToUserId) === workspace.userId || workspace.collegeAdmin));
  const ids = folderProjectIds(groups, folderId);
  let projectIds = [];
  let sharedProjectIds = [];
  if (ids.length) {
    const scope = projectListScope(workspace, 'pr');
    const [projects] = await db.query(`SELECT pr.id FROM projects pr
      WHERE pr.organization_id = ? AND pr.id IN (?)${scope.sql ? ` AND ${scope.sql}` : ''}`,
    [workspace.orgId, ids, ...scope.params]);
    projectIds = projects.map(project => Number(project.id));
    const shared = await listSharedAlbums(workspace, db);
    sharedProjectIds = shared.map(project => project.id).filter(id => ids.includes(id));
    projectIds = [...new Set([...projectIds, ...sharedProjectIds])];
  }
  return { projectIds, ...(sharedProjectIds.length ? { sharedProjectIds } : {}), scope: { type: 'folder', id: folderId,
    name: groups.find(group => group.id === folderId).name, includeDescendants: true } };
}

module.exports = { folderProjectIds, resolveFolderSearchScope, resolveWorkspaceSearchScope };
