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
