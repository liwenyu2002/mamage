const { workspacePolicy } = require('../lib/access_policy');

function registerContentTemplateRoutes(router, { pool, requirePermission, resolveWorkspace, sendWorkspaceError }) {
  const permission = requirePermission('ai.generate');
  const scope = workspace => [workspace.orgId, workspace.unitId || null];
  function validate(body, workspace) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const outline = typeof body.outline === 'string' ? body.outline.trim() : '';
    const visibility = body.visibility || 'private';
    if (!name || name.length > 80 || !outline || outline.length > 1000 || !['private', 'workspace'].includes(visibility)
      || typeof body.reviewCredits !== 'boolean') return '请填写名称和不超过 1000 字的内容结构';
    if (visibility === 'workspace' && (!workspace.enabled || !workspace.unitId)) return '请先选择小组再共享模板';
    return null;
  }
  const toItem = (row, workspace) => ({ id: row.id, name: row.name, outline: row.outline, reviewCredits: Boolean(row.review_credits),
    visibility: row.visibility, ownerId: row.owner_id, updatedAt: row.updated_at,
    canEdit: Number(row.owner_id) === workspace.userId || (row.visibility === 'workspace' && workspacePolicy(workspace).canManageMembers) });
  const handler = fn => async (req, res) => {
    try {
      const workspace = await resolveWorkspace(req);
      if (!workspace.userId || !workspace.orgId) return res.status(403).json({ message: '无法确定当前用户和组织' });
      return await fn(req, res, workspace);
    } catch (error) {
      if (sendWorkspaceError(res, error)) return;
      console.error('[wechat-content-templates]', error.message);
      return res.status(500).json({ message: '内容模板暂时不可用' });
    }
  };
  router.get('/content-templates', permission, handler(async (_req, res, workspace) => {
    const [rows] = await pool.query(`SELECT id,name,outline,review_credits,visibility,owner_id,updated_at
      FROM wechat_content_templates WHERE organization_id = ? AND unit_id <=> ?
      AND (owner_id = ? OR (visibility = 'workspace' AND unit_id IS NOT NULL)) ORDER BY updated_at DESC, id DESC`,
    [...scope(workspace), workspace.userId]);
    return res.json({ items: rows.map(row => toItem(row, workspace)) });
  }));
  router.post('/content-templates', permission, handler(async (req, res, workspace) => {
    const body = req.body || {}, error = validate(body, workspace);
    if (error) return res.status(400).json({ message: error });
    const [result] = await pool.query(`INSERT INTO wechat_content_templates
      (organization_id,unit_id,owner_id,name,outline,review_credits,visibility) VALUES (?,?,?,?,?,?,?)`,
    [...scope(workspace), workspace.userId, body.name.trim(), body.outline.trim(), body.reviewCredits ? 1 : 0, body.visibility || 'private']);
    return res.status(201).json({ id: result.insertId });
  }));
  const owned = async (req, res, workspace) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) { res.status(404).json({ message: '模板不存在' }); return null; }
    const [rows] = await pool.query(`SELECT id,owner_id,visibility FROM wechat_content_templates
      WHERE id = ? AND organization_id = ? AND unit_id <=> ? LIMIT 1`, [id, ...scope(workspace)]);
    const row = rows[0];
    if (!row || (Number(row.owner_id) !== workspace.userId && !(row.visibility === 'workspace' && workspacePolicy(workspace).canManageMembers))) {
      res.status(404).json({ message: '模板不存在' }); return null;
    }
    return row;
  };
  router.put('/content-templates/:id', permission, handler(async (req, res, workspace) => {
    const row = await owned(req, res, workspace); if (!row) return;
    const body = req.body || {}, error = validate(body, workspace); if (error) return res.status(400).json({ message: error });
    const [updated] = await pool.query(`UPDATE wechat_content_templates SET name=?,outline=?,review_credits=?,visibility=?
      WHERE id=? AND organization_id=? AND unit_id <=> ? AND (owner_id=? OR (visibility='workspace' AND ?=1))`,
    [body.name.trim(), body.outline.trim(), body.reviewCredits ? 1 : 0, body.visibility || 'private', row.id, ...scope(workspace),
      workspace.userId, workspacePolicy(workspace).canManageMembers ? 1 : 0]);
    if (!updated.affectedRows) return res.status(404).json({ message: '模板不存在' });
    return res.json({ id: row.id });
  }));
  router.delete('/content-templates/:id', permission, handler(async (req, res, workspace) => {
    const row = await owned(req, res, workspace); if (!row) return;
    const [deleted] = await pool.query(`DELETE FROM wechat_content_templates WHERE id=? AND organization_id=? AND unit_id <=> ?
      AND (owner_id=? OR (visibility='workspace' AND ?=1))`, [row.id, ...scope(workspace), workspace.userId,
      workspacePolicy(workspace).canManageMembers ? 1 : 0]);
    if (!deleted.affectedRows) return res.status(404).json({ message: '模板不存在' });
    return res.json({ deleted: true });
  }));
}
module.exports = { registerContentTemplateRoutes };
