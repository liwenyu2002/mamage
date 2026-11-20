// 工作空间（组织单位 / 成员 / 人脸授权 / 审计）dao。
// 权限判定与错误码留在 routes/workspaces.js。
async function listUnitsForUser(db, { userId, orgId, collegeAdmin }) {
  const [rows] = await db.query(
    `SELECT ou.id, ou.name, ou.slug, ou.archived_at AS archivedAt, m.role,
            (SELECT COUNT(*) FROM projects p WHERE p.unit_id = ou.id) AS albumCount
       FROM organization_units ou
       LEFT JOIN organization_unit_memberships m
         ON m.unit_id = ou.id AND m.user_id = ? AND m.removed_at IS NULL
      WHERE ou.organization_id = ? AND ou.archived_at IS NULL
        AND (? = 1 OR m.user_id IS NOT NULL)
      ORDER BY ou.id ASC`,
    [userId, orgId, collegeAdmin ? 1 : 0]);
  return rows || [];
}

async function listUnitNames(db, orgId) {
  const [rows] = await db.query(
    'SELECT id, name FROM organization_units WHERE organization_id = ? AND archived_at IS NULL ORDER BY id ASC',
    [orgId]);
  return rows || [];
}

async function setActiveUnit(db, { unitId, userId, orgId }) {
  await db.query('UPDATE users SET active_unit_id = ? WHERE id = ? AND organization_id = ?', [unitId, userId, orgId]);
}

async function insertAudit(conn, { orgId, unitId, userId, action, resourceType, resourceId, details }) {
  await conn.query(
    `INSERT INTO organization_access_audit
       (organization_id, unit_id, user_id, action, resource_type, resource_id, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [orgId, unitId || null, userId, action, resourceType || null, resourceId || null,
      details ? JSON.stringify(details) : null]);
}

async function lockUserRole(conn, { userId, orgId }) {
  const [rows] = await conn.query(
    'SELECT id, role FROM users WHERE id = ? AND organization_id = ? LIMIT 1 FOR UPDATE', [userId, orgId]);
  return rows && rows.length ? rows[0] : null;
}

async function lockMembershipRole(conn, { unitId, userId }) {
  const [[row]] = await conn.query(
    'SELECT role FROM organization_unit_memberships WHERE unit_id = ? AND user_id = ? AND removed_at IS NULL LIMIT 1 FOR UPDATE',
    [unitId, userId]);
  return row || null;
}

async function updateMembershipRole(conn, { unitId, userId, role }) {
  await conn.query(
    'UPDATE organization_unit_memberships SET role = ? WHERE unit_id = ? AND user_id = ? AND removed_at IS NULL',
    [role, unitId, userId]);
}

async function upsertMembership(conn, { unitId, userId, role }) {
  await conn.query(
    `INSERT INTO organization_unit_memberships (unit_id, user_id, role)
     VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role), removed_at = NULL`,
    [unitId, userId, role]);
}

async function findMembershipRole(conn, { unitId, userId }) {
  const [rows] = await conn.query(
    'SELECT role FROM organization_unit_memberships WHERE unit_id = ? AND user_id = ? AND removed_at IS NULL LIMIT 1',
    [unitId, userId]);
  return rows && rows.length ? rows[0] : null;
}

async function removeMembership(conn, { unitId, userId }) {
  await conn.query('UPDATE organization_unit_memberships SET removed_at = NOW() WHERE unit_id = ? AND user_id = ?',
    [unitId, userId]);
  await conn.query('UPDATE users SET active_unit_id = NULL WHERE id = ? AND active_unit_id = ?', [userId, unitId]);
}

async function findUserInOrg(db, { userId, orgId }) {
  const [rows] = await db.query('SELECT id FROM users WHERE id = ? AND organization_id = ? LIMIT 1', [userId, orgId]);
  return rows && rows.length ? rows[0] : null;
}

async function grantFaceSearch(db, { orgId, userId, canManage, grantedBy }) {
  await db.query(
    `INSERT INTO face_search_grants (organization_id, user_id, college_wide, can_manage, granted_by)
     VALUES (?, ?, 1, ?, ?) ON DUPLICATE KEY UPDATE college_wide = 1, can_manage = VALUES(can_manage), granted_by = VALUES(granted_by)`,
    [orgId, userId, canManage ? 1 : 0, grantedBy]);
}

async function revokeFaceSearch(db, { orgId, userId }) {
  await db.query('DELETE FROM face_search_grants WHERE organization_id = ? AND user_id = ?', [orgId, userId]);
}

module.exports = {
  listUnitsForUser, listUnitNames, setActiveUnit, insertAudit,
  lockUserRole, lockMembershipRole, updateMembershipRole, upsertMembership, findMembershipRole, removeMembership,
  findUserInOrg, grantFaceSearch, revokeFaceSearch,
};

async function findUnitRoleRow(db, { workspace, unitId, lock }) {
  const [rows] = await db.query(
    `SELECT m.role FROM organization_units ou
      LEFT JOIN organization_unit_memberships m
        ON m.unit_id = ou.id AND m.user_id = ? AND m.removed_at IS NULL
      WHERE ou.id = ? AND ou.organization_id = ? AND ou.archived_at IS NULL LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [workspace.userId, unitId, workspace.orgId]);
  return rows && rows.length ? rows[0] : null;
}

async function aiUsageStats(db, { orgId, days, unitId }) {
  const [rows] = await db.query(
    `SELECT j.unit_id AS unitId, ou.name AS unitName, COUNT(*) AS jobCount,
            SUM(j.status = 'succeeded') AS succeededCount,
            COALESCE(SUM(j.tokens_used), 0) AS tokensUsed,
            COALESCE(SUM(j.cost_estimate), 0) AS estimatedCost
       FROM ai_jobs j JOIN users u ON u.id = j.user_id
       LEFT JOIN organization_units ou ON ou.id = j.unit_id
      WHERE u.organization_id = ? AND j.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        ${unitId === null ? '' : 'AND j.unit_id = ?'}
      GROUP BY j.unit_id, ou.name ORDER BY jobCount DESC`,
    [orgId, days, ...(unitId === null ? [] : [unitId])]);
  return rows || [];
}

async function listUnitAlbums(db, { orgId, unitId, userId }) {
  const [rows] = await db.query(
    `SELECT id, name FROM projects
      WHERE organization_id = ? AND unit_id = ?
        ${userId === null ? '' : 'AND (restricted_to_user_id IS NULL OR restricted_to_user_id = ?)'}
      ORDER BY created_at DESC, id DESC LIMIT 5000`,
    [orgId, unitId, ...(userId === null ? [] : [userId])]);
  return rows || [];
}

async function listUnitMembers(db, { unitId, orgId }) {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email, u.role AS accountRole, m.role, m.created_at AS joinedAt
       FROM organization_unit_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.unit_id = ? AND m.removed_at IS NULL AND u.organization_id = ?
      ORDER BY FIELD(m.role, 'manager', 'editor', 'member', 'viewer'), u.name ASC`, [unitId, orgId]);
  return rows || [];
}

async function searchCandidates(db, { orgId, like }) {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email FROM users u
      WHERE u.organization_id = ? AND (u.name LIKE ? OR u.email LIKE ?)
      ORDER BY u.name LIMIT 30`, [orgId, like, like]);
  return rows || [];
}

async function findArchivedUnit(db, { unitId, orgId }) {
  const [rows] = await db.query(
    'SELECT id FROM organization_units WHERE id = ? AND organization_id = ? AND archived_at IS NULL LIMIT 1',
    [unitId, orgId]);
  return rows || [];
}

async function listUnitRecipients(db, { unitId, orgId }) {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email FROM organization_unit_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.unit_id = ? AND m.removed_at IS NULL AND u.organization_id = ?
      ORDER BY u.name LIMIT 200`, [unitId, orgId]);
  return rows || [];
}

module.exports.findUnitRoleRow = findUnitRoleRow;
module.exports.aiUsageStats = aiUsageStats;
module.exports.listUnitAlbums = listUnitAlbums;
module.exports.listUnitMembers = listUnitMembers;
module.exports.searchCandidates = searchCandidates;
module.exports.findArchivedUnit = findArchivedUnit;
module.exports.listUnitRecipients = listUnitRecipients;

async function listFaceSearchGrants(db, orgId) {
  const [rows] = await db.query(
    `SELECT g.user_id AS userId, u.name, u.email, g.college_wide AS collegeWide, g.can_manage AS canManage
       FROM face_search_grants g JOIN users u ON u.id = g.user_id
      WHERE g.organization_id = ? ORDER BY u.name`, [orgId]);
  return rows || [];
}

module.exports.listFaceSearchGrants = listFaceSearchGrants;
