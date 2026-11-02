const { createHash } = require('node:crypto');

function fail(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}
const id = value => (typeof value === 'number' || (typeof value === 'string' && /^[1-9]\d*$/.test(value)))
  && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const revision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const displayStudentNo = value => /^(iam_|auto)/.test(value || '') ? null : value || null;

async function accessAdministrator(db, userId, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const [[user]] = await db.query('SELECT id, role, organization_id FROM users WHERE id = ?' + suffix, [userId]);
  if (!user) return { allowed: false, global: false, organizationId: null };
  const [admins] = await db.query('SELECT organization_id FROM organization_admin_grants WHERE user_id = ?' + suffix, [userId]);
  const orgId = Number(user.organization_id);
  const global = user.role === 'superadmin' && admins.some(g => Number(g.organization_id) === orgId);
  return { allowed: global, global, organizationId: orgId };
}

async function accountAccess(db, userId, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const [[user]] = await db.query('SELECT id, role, organization_id, active_unit_id FROM users WHERE id = ?' + suffix, [userId]);
  if (!user) throw fail('USER_NOT_FOUND', '用户不存在', 404);
  const [memberships] = await db.query(`SELECT unit_id AS unitId, role FROM organization_unit_memberships
    WHERE user_id = ? AND removed_at IS NULL ORDER BY unit_id` + suffix, [userId]);
  const [admins] = await db.query('SELECT organization_id FROM organization_admin_grants WHERE user_id = ? ORDER BY organization_id' + suffix, [userId]);
  const [faces] = await db.query('SELECT organization_id, college_wide, can_manage FROM face_search_grants WHERE user_id = ? ORDER BY organization_id' + suffix, [userId]);
  const snapshot = { user, memberships, admins, faces };
  const face = faces.find(row => Number(row.organization_id) === Number(user.organization_id));
  return { snapshot, revision: revision(snapshot), memberships,
    collegeAdmin: admins.some(row => Number(row.organization_id) === Number(user.organization_id)),
    facePermissions: { search: Number(face?.college_wide) === 1, manage: Number(face?.college_wide) === 1 && Number(face?.can_manage) === 1 } };
}

function validateAssignment(body) {
  if (!body || !Array.isArray(body.memberships) || body.memberships.length > 100
    || typeof body.collegeAdmin !== 'boolean' || typeof body.facePermissions?.search !== 'boolean'
    || typeof body.facePermissions?.manage !== 'boolean' || !/^[a-f0-9]{64}$/.test(body.revision || '')) {
    throw fail('INVALID_ACCESS', '权限配置不完整，请重新加载');
  }
  const memberships = body.memberships.map(item => ({ unitId: id(item?.unitId), role: item?.role }));
  if (memberships.some(item => !item.unitId || !['viewer', 'editor', 'manager'].includes(item.role))
    || new Set(memberships.map(item => item.unitId)).size !== memberships.length) throw fail('INVALID_MEMBERSHIPS', '小组配置无效');
  if (body.facePermissions.manage && !body.facePermissions.search) throw fail('FACE_SEARCH_REQUIRED', '人物维护需要同时开启人物检索');
  return { ...body, memberships };
}

async function saveAccountAccess(db, actorId, targetId, input) {
  const body = validateAssignment(input);
  if (!id(targetId)) throw fail('INVALID_USER_ID', '用户编号无效');
  if (Number(actorId) === Number(targetId)) throw fail('SELF_ACCESS_CHANGE', '不能修改自己的权限');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const actor = await accessAdministrator(conn, actorId, true);
    if (!actor.allowed) throw fail('ACCESS_ADMIN_REQUIRED', '仅超级管理员可分配权限', 403);
    const before = await accountAccess(conn, Number(targetId), true);
    if (before.snapshot.user.role === 'superadmin') throw fail('PROTECTED_SUPERADMIN', '超级管理员账号不在此处调整', 403);
    if (before.revision !== body.revision) throw fail('ACCESS_CHANGED', '权限已被其他操作更新，请重新加载后再保存', 409);
    const orgId = Number(before.snapshot.user.organization_id);
    const [units] = await conn.query('SELECT id FROM organization_units WHERE organization_id = ? AND archived_at IS NULL FOR UPDATE', [orgId]);
    const unitIds = new Set(units.map(u => Number(u.id)));
    if (body.memberships.some(m => !unitIds.has(m.unitId))) throw fail('UNIT_OUTSIDE_ORGANIZATION', '不能分配其他学院或已归档的小组', 403);
    // Replace only this account's memberships; media ownership and IAM identity are never modified.
    await conn.query('UPDATE organization_unit_memberships SET removed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND removed_at IS NULL', [targetId]);
    for (const member of body.memberships) {
      const [[existing]] = await conn.query('SELECT role FROM organization_unit_memberships WHERE user_id = ? AND unit_id = ?', [targetId, member.unitId]);
      if (existing) await conn.query('UPDATE organization_unit_memberships SET role = ?, removed_at = NULL WHERE user_id = ? AND unit_id = ?', [member.role, targetId, member.unitId]);
      else await conn.query('INSERT INTO organization_unit_memberships (unit_id, user_id, role) VALUES (?, ?, ?)', [member.unitId, targetId, member.role]);
    }
    await conn.query('DELETE FROM organization_admin_grants WHERE organization_id = ? AND user_id = ?', [orgId, targetId]);
    if (body.collegeAdmin) await conn.query('INSERT INTO organization_admin_grants (organization_id, user_id, granted_by) VALUES (?, ?, ?)', [orgId, targetId, actorId]);
    await conn.query('DELETE FROM face_search_grants WHERE organization_id = ? AND user_id = ?', [orgId, targetId]);
    if (body.facePermissions.search) await conn.query('INSERT INTO face_search_grants (organization_id, user_id, college_wide, can_manage, granted_by) VALUES (?, ?, 1, ?, ?)',
      [orgId, targetId, body.facePermissions.manage ? 1 : 0, actorId]);
    const activeUnit = body.memberships.some(m => m.unitId === Number(before.snapshot.user.active_unit_id))
      ? before.snapshot.user.active_unit_id : body.memberships[0]?.unitId || null;
    const role = body.collegeAdmin || body.memberships.some(m => m.role === 'manager') ? 'admin'
      : body.memberships.some(m => m.role === 'editor') ? 'photographer' : 'visitor';
    await conn.query('UPDATE users SET role = ?, active_unit_id = ? WHERE id = ?', [role, activeUnit, targetId]);
    const after = await accountAccess(conn, Number(targetId));
    await conn.query(`INSERT INTO organization_access_audit (organization_id, unit_id, user_id, action, resource_type, resource_id, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [orgId, activeUnit, actorId, 'user.access.configure', 'user', targetId,
      JSON.stringify({ before: before.snapshot, after: after.snapshot })]);
    await conn.commit();
    return { ok: true, revision: after.revision };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

async function saveLegacyAccountRole(db, actorId, targetId, role) {
  targetId = id(targetId);
  if (!targetId) throw fail('INVALID_USER_ID', '用户编号无效');
  if (Number(actorId) === targetId) throw fail('CANNOT_CHANGE_OWN_ROLE', '不能修改自己的角色');
  if (role === 'superadmin') throw fail('PROTECTED_SUPERADMIN', '不能通过兼容角色设置授予超级管理员', 403);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const actor = await accessAdministrator(conn, actorId, true);
    if (!actor.allowed) throw fail('ACCESS_ADMIN_REQUIRED', '仅超级管理员可分配权限', 403);
    const before = await accountAccess(conn, targetId, true);
    if (before.snapshot.user.role === 'superadmin') throw fail('PROTECTED_SUPERADMIN', '超级管理员账号不在此处调整', 403);
    const [roles] = await conn.query('SELECT DISTINCT role FROM role_permissions');
    if (!roles.some(row => row.role === role)) throw fail('INVALID_ROLE', '角色无效');
    await conn.query('UPDATE users SET role = ? WHERE id = ?', [role, targetId]);
    const after = await accountAccess(conn, targetId);
    await conn.query(`INSERT INTO organization_access_audit (organization_id, unit_id, user_id, action, resource_type, resource_id, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [before.snapshot.user.organization_id, before.snapshot.user.active_unit_id, actorId,
      'user.role.configure', 'user', targetId, JSON.stringify({ before: before.snapshot, after: after.snapshot })]);
    await conn.commit();
    return { ok: true, id: targetId, role };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

function registerUserAccessAdmin(router, { db, auth }) {
  const respondError = (res, error) => {
    if (!error.status) console.error('[user-access-admin]', error.code || error.name);
    return res.status(error.status || 500).json({ error: error.status ? error.code : 'INTERNAL_ERROR', message: error.status ? error.message : '操作失败，请稍后重试' });
  };
  const guard = [auth, async (req, res, next) => {
    try {
      req.accessAdministrator = await accessAdministrator(db, req.user.id);
      if (!req.accessAdministrator.allowed) throw fail('ACCESS_ADMIN_REQUIRED', '仅超级管理员可管理用户与权限', 403);
      next();
    } catch (error) { respondError(res, error); }
  }];
  router.get('/access', ...guard, async (req, res) => {
    try {
      const orgId = id(req.query.organizationId || req.user.organization_id);
      if (!orgId) throw fail('INVALID_ORGANIZATION_ID', '学院编号无效');
      const q = String(req.query.q || '').trim().slice(0, 80);
      const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
      const pending = req.query.status === 'pending';
      const [organizations] = await db.query('SELECT id, name FROM organizations ORDER BY id');
      const [units] = await db.query('SELECT id, name FROM organization_units WHERE organization_id = ? AND archived_at IS NULL ORDER BY id', [orgId]);
      const where = `u.organization_id = ? AND (u.name LIKE ? OR u.email LIKE ? OR u.student_no LIKE ?)
        ${pending ? `AND u.role <> 'superadmin' AND NOT EXISTS (SELECT 1 FROM organization_unit_memberships m WHERE m.user_id = u.id AND m.removed_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM organization_admin_grants a WHERE a.user_id = u.id AND a.organization_id = u.organization_id)` : ''}`;
      const params = [orgId, ...Array(3).fill(`%${q}%`)];
      const [[total]] = await db.query(`SELECT COUNT(*) AS count FROM users u WHERE ${where}`, params);
      const [rows] = await db.query(`SELECT u.id, u.name, u.email, u.student_no, u.department, u.role, u.created_at AS createdAt,
        EXISTS (SELECT 1 FROM iam_login_identities i WHERE i.user_id = u.id) AS iamLinked
        FROM users u WHERE ${where} ORDER BY u.id DESC LIMIT 50 OFFSET ?`, [...params, (page - 1) * 50]);
      const users = [];
      for (const row of rows) {
        const { snapshot, ...access } = await accountAccess(db, row.id);
        users.push({ ...row, student_no: displayStudentNo(row.student_no), iamLinked: Boolean(row.iamLinked), ...access });
      }
      res.set('Cache-Control', 'no-store').json({ organizations, organizationId: orgId, units, users, total: Number(total.count), page, pageSize: 50 });
    } catch (error) { respondError(res, error); }
  });
  router.put('/:id/access', ...guard, async (req, res) => {
    try { res.json(await saveAccountAccess(db, req.user.id, req.params.id, req.body)); }
    catch (error) { respondError(res, error); }
  });
}

module.exports = { registerUserAccessAdmin, saveAccountAccess, saveLegacyAccountRole, accountAccess, accessAdministrator, validateAssignment, displayStudentNo };
