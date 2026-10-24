function organizationId(user) {
  const id = Number(user?.organization_id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function inviteBelongsToOrganization(db, createdBy, orgId) {
  if (!orgId || !createdBy) return false;
  const [rows] = await db.query('SELECT id FROM users WHERE id = ? AND organization_id = ? LIMIT 1', [createdBy, orgId]);
  return rows.length === 1;
}

function registerInvitationManagement(router, { pool, authMiddleware, requirePermission }) {
  const allowed = requirePermission('users.invitations.create');
  router.get('/invitations', authMiddleware, allowed, async (req, res) => {
    const orgId = organizationId(req.user);
    if (!orgId) return res.status(403).json({ error: 'ORGANIZATION_REQUIRED' });
    const before = req.query.before === undefined ? null : Number(req.query.before);
    if (before !== null && (!Number.isSafeInteger(before) || before < 1)) {
      return res.status(400).json({ error: 'INVALID_CURSOR' });
    }
    try {
      const [rows] = await pool.query(`SELECT i.id, i.code, i.role, i.uses, i.max_uses,
        i.revoked, i.note, i.created_at, i.expires_at AS expiresAt
        FROM invitations i INNER JOIN users creator ON creator.id = i.created_by
        WHERE creator.organization_id = ? ${before === null ? '' : 'AND i.id < ?'}
        ORDER BY i.id DESC LIMIT 101`, before === null ? [orgId] : [orgId, before]);
      const list = rows.slice(0, 100);
      return res.json({ list, nextCursor: rows.length > 100 ? list.at(-1).id : null });
    } catch (error) {
      console.error('[invitations.list]', error.code || 'QUERY_FAILED');
      return res.status(500).json({ error: 'INVITATION_LIST_FAILED', message: '邀请码列表暂时不可用' });
    }
  });

  router.delete('/invitations/:id', authMiddleware, allowed, async (req, res) => {
    const orgId = organizationId(req.user);
    if (!orgId) return res.status(403).json({ error: 'ORGANIZATION_REQUIRED' });
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'INVALID_INVITATION_ID' });
    try {
      const [result] = await pool.query(`UPDATE invitations i INNER JOIN users creator ON creator.id = i.created_by
        SET i.revoked = 1 WHERE i.id = ? AND creator.organization_id = ?`, [id, orgId]);
      if (!result.affectedRows) {
        const [rows] = await pool.query(`SELECT i.id FROM invitations i INNER JOIN users creator ON creator.id = i.created_by
          WHERE i.id = ? AND creator.organization_id = ? AND i.revoked = 1`, [id, orgId]);
        if (!rows.length) return res.status(404).json({ error: 'INVITATION_NOT_FOUND' });
      }
      return res.json({ id, revoked: true });
    } catch (error) {
      console.error('[invitations.revoke]', error.code || 'QUERY_FAILED');
      return res.status(500).json({ error: 'INVITATION_REVOKE_FAILED', message: '撤销失败，请稍后重试' });
    }
  });
}

module.exports = { registerInvitationManagement, inviteBelongsToOrganization, organizationId };
