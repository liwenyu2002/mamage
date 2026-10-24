const { pool } = require('../db');
const { WorkspaceAccessError } = require('./workspace_access');
const DAY = 24 * 60 * 60 * 1000;

function expirationFor(mode, body) {
  if (mode !== 'collaborate' && body.permanent === true) return null;
  const days = body.expiresInDays === undefined ? 30 : Number(body.expiresInDays);
  const maxDays = mode === 'collaborate' ? 90 : 365;
  if (!Number.isInteger(days) || days < 1 || days > maxDays) throw new WorkspaceAccessError('INVALID_EXPIRATION', 400);
  return new Date(Date.now() + days * DAY);
}

async function requireSourceEditor(workspace, unitId) {
  if (!workspace.enabled || !unitId || workspace.unitId !== unitId) throw new WorkspaceAccessError('UNIT_FORBIDDEN');
  if (workspace.collegeAdmin || ['editor', 'manager'].includes(workspace.role)) return;
  throw new WorkspaceAccessError('UNIT_EDITOR_REQUIRED');
}

async function requireTarget(workspace, targetUnitId, targetUserId, db = pool) {
  const [units] = await db.query(
    'SELECT id FROM organization_units WHERE id = ? AND organization_id = ? AND archived_at IS NULL LIMIT 1',
    [targetUnitId, workspace.orgId]
  );
  if (!units.length || targetUnitId === workspace.unitId) throw new WorkspaceAccessError('INVALID_TARGET_UNIT', 400);
  if (targetUserId) {
    const [members] = await db.query(
      `SELECT 1 FROM organization_unit_memberships m JOIN users u ON u.id = m.user_id
       WHERE m.unit_id = ? AND m.user_id = ? AND m.removed_at IS NULL
         AND u.organization_id = ? LIMIT 1`, [targetUnitId, targetUserId, workspace.orgId]
    );
    if (!members.length) throw new WorkspaceAccessError('TARGET_USER_NOT_IN_UNIT', 400);
  }
}

module.exports = { expirationFor, requireSourceEditor, requireTarget };
