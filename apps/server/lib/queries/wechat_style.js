// 公众号样式块（wechat_style_blocks）dao。组织/单元/创建者权限判定留在路由。
async function listBlocks(db, { orgId, unitScopeSql, params }) {
  const [rows] = await db.query(
    `SELECT * FROM wechat_style_blocks WHERE org_id <=> ? ${unitScopeSql}
      ORDER BY created_at DESC LIMIT 500`, [orgId, ...params]);
  return rows || [];
}

async function insertBlock(db, row) {
  const [result] = await db.query(
    `INSERT INTO wechat_style_blocks
       (org_id, unit_id, type, name, html_template, accent_editable, source, source_url, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'extracted', ?, ?, NOW())`,
    [row.orgId, row.unitId, row.type, row.name, row.htmlTemplate, row.accentEditable ? 1 : 0,
      row.sourceUrl, row.createdBy]);
  return result;
}

async function listByIds(db, ids) {
  const [rows] = await db.query(
    `SELECT * FROM wechat_style_blocks WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id ASC`, ids);
  return rows || [];
}

async function findBlock(db, id) {
  const [rows] = await db.query('SELECT * FROM wechat_style_blocks WHERE id = ? LIMIT 1', [id]);
  return rows && rows.length ? rows[0] : null;
}

async function deleteBlock(db, id) {
  await db.query('DELETE FROM wechat_style_blocks WHERE id = ?', [id]);
}

module.exports = { listBlocks, insertBlock, listByIds, findBlock, deleteBlock };
