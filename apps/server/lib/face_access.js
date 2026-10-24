const { pool } = require('../db');
const { resolveWorkspace, WorkspaceAccessError } = require('./workspace_access');

async function getFacePermissions(workspace, db = pool) {
  if (!workspace.userId || !workspace.orgId) return { search: false, manage: false };
  const [rows] = await db.query(
    `SELECT college_wide, can_manage FROM face_search_grants
     WHERE organization_id = ? AND user_id = ? LIMIT 1`, [workspace.orgId, workspace.userId]
  );
  const search = Number(rows[0]?.college_wide) === 1;
  return { search, manage: search && Number(rows[0]?.can_manage) === 1 };
}

async function requireFaceAccess(req, action = 'search', db = pool) {
  const workspace = await resolveWorkspace(req, db);
  const permissions = await getFacePermissions(workspace, db);
  if (!(action === 'manage' ? permissions.manage : permissions.search)) {
    throw new WorkspaceAccessError(action === 'manage' ? 'FACE_MANAGEMENT_GRANT_REQUIRED' : 'FACE_SEARCH_GRANT_REQUIRED');
  }
  req.facePermissions = permissions;
  return { workspace, permissions };
}

module.exports = { getFacePermissions, requireFaceAccess };
