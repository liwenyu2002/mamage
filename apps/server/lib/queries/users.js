// 用户 / 邀请码的 dao 层。权限判定与错误码留在 routes/users.js。
const USER_COLUMNS = 'id, student_no, name, department, role, email, avatar_url, nickname, organization_id';

async function findByEmail(db, email) {
  const [rows] = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  return rows || [];
}

async function findByStudentNo(db, studentNo) {
  const [rows] = await db.query('SELECT id FROM users WHERE student_no = ?', [studentNo]);
  return rows || [];
}

async function findPublicById(db, id) {
  const [rows] = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [id]);
  return rows && rows.length ? rows[0] : null;
}

async function findPasswordHash(db, userId) {
  const [rows] = await db.query('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows && rows.length ? rows[0].password_hash : null;
}

async function updatePassword(db, { userId, hash }) {
  await db.query('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, new Date(), userId]);
}

async function updateRole(db, { userId, role }) {
  await db.query('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [role, new Date(), userId]);
}

// ---- 邀请码 ----
async function insertInvitation(db, { code, role, createdBy, expiresAt, maxUses, note }) {
  const [result] = await db.query(
    'INSERT INTO invitations (code, role, created_by, expires_at, max_uses, note) VALUES (?, ?, ?, ?, ?, ?)',
    [code, role, createdBy, expiresAt || null, maxUses || 1, note || null]);
  return result;
}

async function lockInvitationByCode(conn, code) {
  const [rows] = await conn.query('SELECT * FROM invitations WHERE code = ? FOR UPDATE', [code]);
  return rows && rows.length ? rows[0] : null;
}

async function incrementInvitationUses(conn, invitationId) {
  await conn.query('UPDATE invitations SET uses = uses + 1 WHERE id = ?', [invitationId]);
}

/** 原始查询（登录/注册里拼动态 where 的地方仍由调用方构造 SQL） */
async function queryRaw(db, sql, params) {
  const [rows] = await db.query(sql, params);
  return rows || [];
}

module.exports = {
  USER_COLUMNS,
  findByEmail, findByStudentNo, findPublicById, findPasswordHash, updatePassword, updateRole,
  insertInvitation, lockInvitationByCode, incrementInvitationUses, queryRaw,
};
