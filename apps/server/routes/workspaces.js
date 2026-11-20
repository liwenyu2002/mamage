const express = require('express');
const wsDao = require('../lib/queries/workspaces');
const { pool } = require('../db');
const { requirePermission } = require('../lib/permissions');
const { workspacePolicy, ROLE_LABELS } = require('../lib/access_policy');
const { accessAdministrator } = require('../lib/user_access_admin');
const {
  positiveId, resolveWorkspace, sendWorkspaceError, WorkspaceAccessError,
} = require('../lib/workspace_access');

const router = express.Router();

function fail(res, err) {
  if (sendWorkspaceError(res, err)) return;
  console.error('[workspaces]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
}

async function getUnitRole(workspace, unitId, db = pool, lock = false) {
  const [rows] = await db.query(
    `SELECT m.role FROM organization_units ou
     LEFT JOIN organization_unit_memberships m
       ON m.unit_id = ou.id AND m.user_id = ? AND m.removed_at IS NULL
     WHERE ou.id = ? AND ou.organization_id = ? AND ou.archived_at IS NULL LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [workspace.userId, unitId, workspace.orgId]
  );
  if (!rows.length) return null;
  if (workspace.collegeAdmin) return 'collegeAdmin';
  return rows[0]?.role || null;
}

async function writeAudit(conn, workspace, action, unitId, resourceType, resourceId, details = null) {
  await wsDao.insertAudit(conn, { orgId: workspace.orgId, unitId, userId: workspace.userId, action,
    resourceType, resourceId, details });
}

router.get('/', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    if (!workspace.enabled) return res.json({ enabled: false, units: [], activeUnitId: null, access: workspacePolicy(workspace) });
    const rows = await wsDao.listUnitsForUser(pool, { userId: workspace.userId, orgId: workspace.orgId,
      collegeAdmin: workspace.collegeAdmin });
    const shareTargets = await wsDao.listUnitNames(pool, workspace.orgId);
    res.json({ enabled: true, units: rows.map(unit => ({ ...unit,
      access: workspacePolicy({ ...workspace, unitId: unit.id, role: unit.role }) })), activeUnitId: workspace.unitId,
      access: workspacePolicy(workspace), shareTargets, collegeAdmin: workspace.collegeAdmin, legacyAvailable: true });
  } catch (err) { fail(res, err); }
});

router.post('/active', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    if (!workspace.enabled) throw new WorkspaceAccessError('WORKSPACES_NOT_ENABLED', 404);
    const unitId = req.body?.unitId === null || req.body?.unitId === 'legacy'
      ? null : positiveId(req.body?.unitId);
    if (req.body?.unitId !== null && req.body?.unitId !== 'legacy' && !unitId) {
      throw new WorkspaceAccessError('INVALID_UNIT', 400);
    }
    if (unitId && !await getUnitRole(workspace, unitId)) {
      throw new WorkspaceAccessError('UNIT_FORBIDDEN');
    }
    await wsDao.setActiveUnit(pool, { unitId, userId: workspace.userId, orgId: workspace.orgId });
    res.json({ activeUnitId: unitId });
  } catch (err) { fail(res, err); }
});

router.get('/stats/ai', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    if (!workspace.enabled || (!workspace.collegeAdmin && workspace.role !== 'manager')) {
      throw new WorkspaceAccessError('UNIT_MANAGER_REQUIRED');
    }
    const days = Math.max(1, Math.min(365, Math.floor(Number(req.query.days) || 30)));
    const [rows] = await pool.query(
      `SELECT j.unit_id AS unitId, ou.name AS unitName, COUNT(*) AS jobCount,
              SUM(j.status = 'succeeded') AS succeededCount,
              COALESCE(SUM(j.tokens_used), 0) AS tokensUsed,
              COALESCE(SUM(j.cost_estimate), 0) AS estimatedCost
       FROM ai_jobs j JOIN users u ON u.id = j.user_id
       LEFT JOIN organization_units ou ON ou.id = j.unit_id
       WHERE u.organization_id = ? AND j.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         ${workspace.collegeAdmin ? '' : 'AND j.unit_id = ?'}
       GROUP BY j.unit_id, ou.name ORDER BY jobCount DESC`,
      [workspace.orgId, days, ...(workspace.collegeAdmin ? [] : [workspace.unitId])]
    );
    res.json({ days, rows });
  } catch (err) { fail(res, err); }
});

router.get('/albums', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    if (!workspace.enabled || !workspace.unitId) return res.json([]);
    const [rows] = await pool.query(
      `SELECT id, name FROM projects
       WHERE organization_id = ? AND unit_id = ?
         ${workspace.collegeAdmin ? '' : 'AND (restricted_to_user_id IS NULL OR restricted_to_user_id = ?)'}
       ORDER BY created_at DESC, id DESC LIMIT 5000`,
      [workspace.orgId, workspace.unitId, ...(workspace.collegeAdmin ? [] : [workspace.userId])]
    );
    res.json(rows);
  } catch (err) { fail(res, err); }
});

router.get('/:unitId/members', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    const unitId = positiveId(req.params.unitId);
    const role = unitId && await getUnitRole(workspace, unitId);
    if (role !== 'manager' && role !== 'collegeAdmin') throw new WorkspaceAccessError('UNIT_FORBIDDEN');
    const admin = await accessAdministrator(pool, workspace.userId);
    const managesGroup = role === 'manager' || (!admin.allowed && role === 'collegeAdmin'
      && await getUnitRole({ ...workspace, collegeAdmin: false }, unitId) === 'manager');
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.role AS accountRole, m.role, m.created_at AS joinedAt
       FROM organization_unit_memberships m JOIN users u ON u.id = m.user_id
       WHERE m.unit_id = ? AND m.removed_at IS NULL AND u.organization_id = ?
       ORDER BY FIELD(m.role, 'manager', 'editor', 'member', 'viewer'), u.name ASC`,
      [unitId, workspace.orgId]
    );
    res.json(rows.map(({ accountRole, ...member }) => ({
      ...member, accessRoleLabel: ROLE_LABELS[member.role === 'manager' ? 'manager' : member.role === 'viewer' ? 'viewer' : 'contributor'],
      canChangeRole: Number(member.id) !== workspace.userId && accountRole !== 'superadmin'
        && (admin.allowed || (managesGroup && member.role !== 'manager')),
      canRemove: admin.allowed && Number(member.id) !== workspace.userId && accountRole !== 'superadmin',
    })));
  } catch (err) { fail(res, err); }
});

router.get('/:unitId/candidates', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    const unitId = positiveId(req.params.unitId);
    const role = unitId && await getUnitRole(workspace, unitId);
    if (role !== 'manager' && role !== 'collegeAdmin') throw new WorkspaceAccessError('UNIT_FORBIDDEN');
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q.length < 2) return res.json([]);
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email
       FROM users u WHERE u.organization_id = ? AND (u.name LIKE ? OR u.email LIKE ?)
       ORDER BY u.name LIMIT 30`,
      [workspace.orgId, `%${q}%`, `%${q}%`]
    );
    res.json(rows);
  } catch (err) { fail(res, err); }
});

router.get('/:unitId/recipients', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    const unitId = positiveId(req.params.unitId);
    if (!workspace.enabled || !workspace.unitId
      || (!workspace.collegeAdmin && !['editor', 'manager'].includes(workspace.role))) {
      throw new WorkspaceAccessError('UNIT_EDITOR_REQUIRED');
    }
    const [units] = await pool.query(
      'SELECT id FROM organization_units WHERE id = ? AND organization_id = ? AND archived_at IS NULL LIMIT 1',
      [unitId, workspace.orgId]
    );
    if (!units.length || unitId === workspace.unitId) throw new WorkspaceAccessError('INVALID_TARGET_UNIT', 400);
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email
       FROM organization_unit_memberships m JOIN users u ON u.id = m.user_id
       WHERE m.unit_id = ? AND m.removed_at IS NULL AND u.organization_id = ?
       ORDER BY u.name LIMIT 200`,
      [unitId, workspace.orgId]
    );
    res.json(rows);
  } catch (err) { fail(res, err); }
});

router.put('/:unitId/members/:userId', requirePermission('photos.view'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const workspace = await resolveWorkspace(req, conn);
    const unitId = positiveId(req.params.unitId);
    const userId = positiveId(req.params.userId);
    const rawRole = String(req.body?.role || '').trim();
    const role = ['member', 'contributor'].includes(rawRole) ? 'editor' : rawRole;
    if (!unitId || !userId || !['viewer', 'editor', 'manager'].includes(role)) {
      throw new WorkspaceAccessError('INVALID_MEMBERSHIP', 400);
    }
    if (userId === workspace.userId) throw new WorkspaceAccessError('SELF_ACCESS_CHANGE');
    const admin = await accessAdministrator(conn, workspace.userId, true);
    const actorRole = await getUnitRole({ ...workspace, collegeAdmin: admin.allowed }, unitId, conn, true);
    if (actorRole !== 'manager' && actorRole !== 'collegeAdmin') throw new WorkspaceAccessError('UNIT_FORBIDDEN');
    if (!admin.allowed && role === 'manager') throw new WorkspaceAccessError('COLLEGE_ADMIN_REQUIRED');
    const userRow = await wsDao.lockUserRole(conn, { userId, orgId: workspace.orgId });
    if (!userRow) throw new WorkspaceAccessError('USER_NOT_FOUND', 404);
    if (userRow.role === 'superadmin') throw new WorkspaceAccessError('PROTECTED_SUPERADMIN');
    const previous = await wsDao.lockMembershipRole(conn, { unitId, userId });
    if (!admin.allowed && (!previous || previous.role === 'manager')) throw new WorkspaceAccessError('COLLEGE_ADMIN_REQUIRED');
    if (previous) {
      if (previous.role !== role) {
        await wsDao.updateMembershipRole(conn, { unitId, userId, role });
        await writeAudit(conn, workspace, 'membership.role.configure', unitId, 'user', userId, { before: previous.role, role });
      }
    } else {
      await wsDao.upsertMembership(conn, { unitId, userId, role });
      await writeAudit(conn, workspace, 'membership.grant', unitId, 'user', userId, { role });
    }
    await conn.commit();
    res.json({ unitId, userId, role });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    fail(res, err);
  } finally { conn.release(); }
});

router.delete('/:unitId/members/:userId', requirePermission('photos.view'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const workspace = await resolveWorkspace(req, conn);
    const unitId = positiveId(req.params.unitId);
    const userId = positiveId(req.params.userId);
    if (!unitId || !userId) throw new WorkspaceAccessError('INVALID_MEMBERSHIP', 400);
    const actorRole = await getUnitRole(workspace, unitId);
    if (actorRole !== 'manager' && actorRole !== 'collegeAdmin') throw new WorkspaceAccessError('UNIT_FORBIDDEN');
    // 分配/变更成员角色属于权限管理，统一收口到超级管理员（历史实现允许小组 manager 越权分配）。
    const admin = await accessAdministrator(conn, workspace.userId);
    if (!admin.allowed) throw new WorkspaceAccessError('ACCESS_ADMIN_REQUIRED', 403);
    const target = await wsDao.findMembershipRole(conn, { unitId, userId });
    if (!target) throw new WorkspaceAccessError('MEMBERSHIP_NOT_FOUND', 404);
    if (target.role === 'manager' && !workspace.collegeAdmin) throw new WorkspaceAccessError('COLLEGE_ADMIN_REQUIRED');
    await conn.beginTransaction();
    await wsDao.removeMembership(conn, { unitId, userId });
    await writeAudit(conn, workspace, 'membership.remove', unitId, 'user', userId);
    await conn.commit();
    res.json({ removed: true });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    fail(res, err);
  } finally { conn.release(); }
});

router.get('/face-search/grants', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    if (!workspacePolicy(workspace).canGrantFaces) throw new WorkspaceAccessError('COLLEGE_ADMIN_REQUIRED');
    const [rows] = await pool.query(
      `SELECT g.user_id AS userId, u.name, u.email, g.college_wide AS collegeWide, g.can_manage AS canManage
       FROM face_search_grants g JOIN users u ON u.id = g.user_id
       WHERE g.organization_id = ? ORDER BY u.name`, [workspace.orgId]
    );
    res.json(rows);
  } catch (err) { fail(res, err); }
});

router.put('/face-search/:userId', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    if (!workspacePolicy(workspace).canGrantFaces) throw new WorkspaceAccessError('COLLEGE_ADMIN_REQUIRED');
    if (req.body?.collegeWide === false) throw new WorkspaceAccessError('UNIT_FACE_SCOPE_NOT_AVAILABLE', 400);
    const canManage = req.body?.canManage === true;
    if (req.body?.canManage !== undefined && typeof req.body.canManage !== 'boolean') throw new WorkspaceAccessError('INVALID_FACE_PERMISSION', 400);
    const userId = positiveId(req.params.userId);
    if (!userId) throw new WorkspaceAccessError('INVALID_USER', 400);
    if (!await wsDao.findUserInOrg(pool, { userId, orgId: workspace.orgId })) {
      throw new WorkspaceAccessError('USER_NOT_FOUND', 404);
    }
    await wsDao.grantFaceSearch(pool, { orgId: workspace.orgId, userId, canManage, grantedBy: workspace.userId });
    res.json({ granted: true, search: true, canManage });
  } catch (err) { fail(res, err); }
});

router.delete('/face-search/:userId', requirePermission('photos.view'), async (req, res) => {
  try {
    const workspace = await resolveWorkspace(req);
    if (!workspacePolicy(workspace).canGrantFaces) throw new WorkspaceAccessError('COLLEGE_ADMIN_REQUIRED');
    const userId = positiveId(req.params.userId);
    if (!userId) throw new WorkspaceAccessError('INVALID_USER', 400);
    await wsDao.revokeFaceSearch(pool, { orgId: workspace.orgId, userId });
    res.json({ granted: false });
  } catch (err) { fail(res, err); }
});

module.exports = router;
