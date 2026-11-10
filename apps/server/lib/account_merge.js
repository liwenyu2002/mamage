// 账号合并：把「重复/临时账号」上的数据与身份链路并入保留账号，并退役来源账号。
// 只在超级管理员后台使用；整个过程在一个事务里完成，来源账号保留行以便审计与追溯。
const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

const positiveId = value => (typeof value === 'number' || (typeof value === 'string' && /^[1-9]\d*$/.test(value)))
  && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

// 直接改归属即可的表
const OWNED = [
  ['projects', 'admin_id'],
  ['photos', 'photographer_id'],
  ['share_links', 'created_by'],
  ['invitations', 'created_by'],
  ['video_editor_assets', 'user_id'],
  ['video_projects', 'user_id'],
  ['video_render_jobs', 'user_id'],
  ['wechat_compositions', 'user_id'],
  ['wechat_content_templates', 'owner_id'],
  ['wechat_monitor_accounts', 'created_by'],
  ['wechat_previews', 'created_by'],
  ['wechat_style_blocks', 'created_by'],
  ['ai_jobs', 'user_id'],
  ['ai_job_batches', 'user_id'],
  ['face_persons', 'created_by'],
  ['face_feedback_events', 'user_id'],
  ['projects', 'restricted_to_user_id'],
];
// 收件人 / 授权目标
const RECIPIENTS = [
  ['internal_shares', 'target_user_id'],
  ['folder_shares', 'target_user_id'],
];
// 带唯一键（user_id, …）的表：先 UPDATE IGNORE，再清理冲突残留
const UNIQUE_OWNED = [
  ['user_favorites', 'user_id'],
  ['album_desktop_users', 'user_id'],
];
const MEMBERSHIPS = [
  ['organization_unit_memberships', 'user_id'],
  ['organization_admin_grants', 'user_id'],
];

const userRow = async (db, userId, lock = false) => {
  const [[row]] = await db.query(`SELECT id, name, email, student_no, role, organization_id, active_unit_id, password_hash
    FROM users WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [userId]);
  return row || null;
};

async function summary(db, userId) {
  const counts = {};
  for (const [table, column] of [...OWNED, ...RECIPIENTS, ...UNIQUE_OWNED, ...MEMBERSHIPS]) {
    const key = `${table}.${column}`;
    if (counts[key] !== undefined) continue;
    const [[row]] = await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`, [userId]);
    counts[key] = Number(row.n);
  }
  const [[faces]] = await db.query('SELECT COUNT(*) AS n FROM face_search_grants WHERE user_id = ?', [userId]);
  const [[identities]] = await db.query('SELECT COUNT(*) AS n FROM iam_login_identities WHERE user_id = ?', [userId]);
  counts['face_search_grants.user_id'] = Number(faces.n);
  counts['iam_login_identities.user_id'] = Number(identities.n);
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}

async function preview(db, sourceId, targetId) {
  const source = positiveId(sourceId), target = positiveId(targetId);
  if (!source || !target) throw fail('INVALID_USER_ID', '请选择要合并的两个账号');
  if (source === target) throw fail('SAME_ACCOUNT', '不能把账号合并到自己');
  const rows = { source: await userRow(db, source), target: await userRow(db, target) };
  if (!rows.source || !rows.target) throw fail('USER_NOT_FOUND', '账号不存在', 404);
  return {
    source: { id: rows.source.id, name: rows.source.name, email: rows.source.email, student_no: rows.source.student_no, role: rows.source.role },
    target: { id: rows.target.id, name: rows.target.name, email: rows.target.email, student_no: rows.target.student_no, role: rows.target.role },
    moving: await summary(db, source),
    targetExisting: await summary(db, target),
    blocked: rows.source.role === 'superadmin' ? '超级管理员账号不能作为被合并方'
      : rows.target.role === 'superadmin' ? '超级管理员账号不能作为合并目标' : null,
  };
}

async function mergeAccounts(db, actorId, sourceId, targetId) {
  const source = positiveId(sourceId), target = positiveId(targetId);
  if (!source || !target) throw fail('INVALID_USER_ID', '请选择要合并的两个账号');
  if (source === target) throw fail('SAME_ACCOUNT', '不能把账号合并到自己');
  const conn = await db.getConnection();
  const moved = {};
  try {
    await conn.beginTransaction();
    const from = await userRow(conn, source, true);
    const to = await userRow(conn, target, true);
    if (!from || !to) throw fail('USER_NOT_FOUND', '账号不存在', 404);
    if (from.role === 'superadmin' || to.role === 'superadmin') throw fail('PROTECTED_SUPERADMIN', '超级管理员账号不参与合并', 403);

    for (const [table, column] of OWNED) {
      const [result] = await conn.query(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`, [target, source]);
      if (result.affectedRows) moved[`${table}.${column}`] = result.affectedRows;
    }
    for (const [table, column] of [...RECIPIENTS, ...UNIQUE_OWNED, ...MEMBERSHIPS]) {
      const [result] = await conn.query(`UPDATE IGNORE ${table} SET ${column} = ? WHERE ${column} = ?`, [target, source]);
      const [left] = await conn.query(`DELETE FROM ${table} WHERE ${column} = ?`, [source]);
      const total = result.affectedRows;
      if (total || left.affectedRows) moved[`${table}.${column}`] = total;
      if (left.affectedRows) moved[`${table}.${column}.deduped`] = left.affectedRows;
    }

    // 人物检索授权：同一学院取并集（可检索/可维护任一为真则保留）
    const [faces] = await conn.query('SELECT organization_id, college_wide, can_manage FROM face_search_grants WHERE user_id = ?', [source]);
    for (const row of faces) {
      const [existing] = await conn.query('SELECT id, college_wide, can_manage FROM face_search_grants WHERE user_id = ? AND organization_id = ?', [target, row.organization_id]);
      if (existing.length) {
        await conn.query('UPDATE face_search_grants SET college_wide = ?, can_manage = ? WHERE id = ?',
          [Number(row.college_wide) || Number(existing[0].college_wide) ? 1 : 0,
            Number(row.can_manage) || Number(existing[0].can_manage) ? 1 : 0, existing[0].id]);
        await conn.query('DELETE FROM face_search_grants WHERE user_id = ? AND organization_id = ?', [source, row.organization_id]);
      } else {
        await conn.query('UPDATE face_search_grants SET user_id = ? WHERE user_id = ? AND organization_id = ?', [target, source, row.organization_id]);
      }
    }

    // IAM 身份链路：登录身份、账号映射、状态都转到保留账号
    const [identities] = await conn.query('UPDATE IGNORE iam_login_identities SET user_id = ? WHERE user_id = ?', [target, source]);
    if (identities.affectedRows) moved['iam_login_identities.user_id'] = identities.affectedRows;
    await conn.query('UPDATE IGNORE iam_accounts SET user_id = ? WHERE user_id = ?', [target, source]).catch(() => null);
    await conn.query('DELETE FROM iam_user_state WHERE user_id = ?', [source]).catch(() => null);

    // 退役来源账号：保留行做审计，但登录凭据与身份信息全部失效
    await conn.query(`UPDATE users SET student_no = CONCAT('merged-', id), email = NULL, password_hash = NULL,
      nickname = NULL, wechat_openid = NULL, dingtalk_union_id = NULL, role = 'visitor', updated_at = NOW() WHERE id = ?`, [source]);
    await conn.query('INSERT INTO iam_user_state (user_id, disabled, session_version) VALUES (?, 1, 1) ON DUPLICATE KEY UPDATE disabled = 1'
      , [source]).catch(() => null);

    await conn.commit();
    console.log('[account-merge]', JSON.stringify({ actorId, source, target, moved }));
    return { source: { id: from.id, name: from.name }, target: { id: to.id, name: to.name }, moved };
  } catch (error) {
    await conn.rollback().catch(() => null);
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { mergeAccounts, preview, summary };
