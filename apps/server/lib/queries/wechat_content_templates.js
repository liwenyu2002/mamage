// 公众号内容模板（wechat_content_templates）dao。可见性/权限判定留在路由。
async function listForWorkspace(db, { scopeParams, userId }) {
  const [rows] = await db.query(
    `SELECT id,name,outline,review_credits,visibility,owner_id,updated_at
       FROM wechat_content_templates WHERE organization_id = ? AND unit_id <=> ?
        AND (owner_id = ? OR (visibility = 'workspace' AND unit_id IS NOT NULL))
      ORDER BY updated_at DESC, id DESC`, [...scopeParams, userId]);
  return rows || [];
}

async function insertTemplate(db, { scopeParams, userId, name, outline, reviewCredits, visibility }) {
  const [result] = await db.query(
    `INSERT INTO wechat_content_templates
       (organization_id,unit_id,owner_id,name,outline,review_credits,visibility) VALUES (?,?,?,?,?,?,?)`,
    [...scopeParams, userId, name, outline, reviewCredits ? 1 : 0, visibility || 'private']);
  return result;
}

async function findOwnedRow(db, { id, scopeParams }) {
  const [rows] = await db.query(
    `SELECT id,owner_id,visibility FROM wechat_content_templates
      WHERE id = ? AND organization_id = ? AND unit_id <=> ? LIMIT 1`, [id, ...scopeParams]);
  return rows && rows.length ? rows[0] : null;
}

async function updateTemplate(db, { id, scopeParams, name, outline, reviewCredits, visibility, userId, canManage }) {
  const [result] = await db.query(
    `UPDATE wechat_content_templates SET name=?,outline=?,review_credits=?,visibility=?
      WHERE id=? AND organization_id=? AND unit_id <=> ? AND (owner_id=? OR (visibility='workspace' AND ?=1))`,
    [name, outline, reviewCredits ? 1 : 0, visibility || 'private', id, ...scopeParams, userId, canManage ? 1 : 0]);
  return Number(result && result.affectedRows) || 0;
}

async function deleteTemplate(db, { id, scopeParams, userId, canManage }) {
  const [result] = await db.query(
    `DELETE FROM wechat_content_templates WHERE id=? AND organization_id=? AND unit_id <=> ?
      AND (owner_id=? OR (visibility='workspace' AND ?=1))`, [id, ...scopeParams, userId, canManage ? 1 : 0]);
  return Number(result && result.affectedRows) || 0;
}

module.exports = { listForWorkspace, insertTemplate, findOwnedRow, updateTemplate, deleteTemplate };
