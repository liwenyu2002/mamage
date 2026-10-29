const { error, sha256 } = require('./iam_protocol');
const name = value => typeof value === 'string' ? value.normalize('NFKC').trim() : '';
const email = value => name(value).toLowerCase();
function scalar(value) {
  if (Array.isArray(value)) return value.length === 1 ? scalar(value[0]) : '';
  return typeof value === 'string' ? value.trim() : '';
}
function claimsFromProfile(profile, cfg = {}) {
  const attributes = profile?.attributes && typeof profile.attributes === 'object' && !Array.isArray(profile.attributes) ? profile.attributes : {};
  const pick = keys => {
    const values = [...new Set(keys.flatMap(key => [scalar(attributes[key]), scalar(profile?.[key])]).filter(Boolean))];
    if (values.length > 1) throw error('IAM_PROFILE_CLAIMS_CONFLICT', 403);
    return values[0] || '';
  };
  const claims = { name: name(pick(['name', 'displayName', 'cn'])), email: email(pick(['email', 'mail'])),
    studentNo: name(pick(['studentNo', 'student_no', 'employeeNumber', 'workNo', 'jobNumber'])) };
  const subject = email(profile?.id);
  if (cfg.subjectEmailDomain && cfg.profileIdPath === 'id' && /^[^\s@]+@[^\s@]+$/.test(subject)
    && subject.split('@')[1] === cfg.subjectEmailDomain) {
    if (claims.email && claims.email !== subject) throw error('IAM_PROFILE_CLAIMS_CONFLICT', 403);
    claims.email = subject; claims.subjectEmail = true;
  }
  if (claims.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)) throw error('IAM_PROFILE_CLAIMS_CONFLICT', 403);
  if (claims.name.length > 50 || claims.email.length > 255 || claims.studentNo.length > 32) throw error('IAM_PROFILE_CLAIMS_CONFLICT', 403);
  return claims;
}
async function matchUser(conn, cfg, claims) {
  const [rows] = await conn.query(`SELECT id, name, email, student_no FROM users WHERE organization_id = ? AND
    ((email = ? AND email <> '') OR (student_no = ? AND student_no <> '')) FOR UPDATE`, [cfg.orgId, claims.email || '', claims.studentNo || '']);
  const candidates = rows.filter(r => (claims.email && email(r.email) === email(claims.email))
    || (claims.studentNo && name(r.student_no) === name(claims.studentNo)));
  if (candidates.length > 1) throw error('IAM_ACCOUNT_MATCH_CONFLICT', 403);
  const user = candidates[0];
  if (!user) return null;
  if (!claims.name && !claims.subjectEmail) throw error('IAM_ACCOUNT_LINK_REQUIRED', 403);
  if (claims.name && name(user.name) !== claims.name) throw error('IAM_ACCOUNT_MATCH_CONFLICT', 403);
  return Number(user.id);
}
async function resolveProfile(db, cfg, profile, subject) {
  const conn = await db.getConnection();
  let result;
  try {
    await conn.beginTransaction();
    const [[linked]] = await conn.query('SELECT user_id FROM iam_login_identities WHERE source_key = ? AND subject_id = ? FOR UPDATE', [cfg.sourceKey, subject]);
    let userId = Number(linked?.user_id);
    if (!userId) {
      let claims = {}, reason;
      try {
        claims = claimsFromProfile(profile, cfg); userId = await matchUser(conn, cfg, claims);
        if (!userId && cfg.autoProvision) {
          const [conflicts] = await conn.query(`SELECT id FROM users WHERE
            (email = ? AND email <> '') OR (student_no = ? AND student_no <> '') OR (name = ? AND name <> '') LIMIT 1 FOR UPDATE`,
          [claims.email || '', claims.studentNo || '', claims.name || '']);
          if (conflicts.length) throw error('IAM_ACCOUNT_LINK_REQUIRED', 403);
          const studentNo = 'iam_' + sha256(`${cfg.sourceKey}\n${subject}`).slice(0, 28);
          const [created] = await conn.query("INSERT INTO users (student_no, name, email, role, organization_id) VALUES (?, ?, ?, 'visitor', ?)",
            [studentNo, claims.name || '校园用户', claims.email || null, cfg.orgId]);
          userId = Number(created.insertId);
        }
      }
      catch (e) { if (!/^IAM_/.test(e.code || '')) throw e; reason = e.code; }
      if (!userId) {
        reason ||= 'IAM_ACCOUNT_LINK_REQUIRED';
        await conn.query('DELETE FROM iam_login_pending WHERE source_key = ? AND subject_id = ?', [cfg.sourceKey, subject]);
        await conn.query('INSERT INTO iam_login_pending (source_key, subject_id, claims, reason) VALUES (?, ?, ?, ?)',
          [cfg.sourceKey, subject, JSON.stringify(claims), reason]);
        result = { error: reason };
      } else {
        await conn.query('INSERT INTO iam_login_identities (source_key, subject_id, user_id) VALUES (?, ?, ?)', [cfg.sourceKey, subject, userId]);
        await conn.query('INSERT INTO iam_identity_audit (source_key, identity_hash, user_id, action) VALUES (?, ?, ?, ?)',
          [cfg.sourceKey, sha256(subject), userId, 'profile_account_linked']);
      }
    }
    if (!result?.error) {
      const [[user]] = await conn.query('SELECT id, role, organization_id FROM users WHERE id = ? FOR UPDATE', [userId]);
      if (!user || Number(user.organization_id) !== cfg.orgId) throw error('IAM_ACCOUNT_LINK_INVALID', 403);
      result = { user };
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
  if (result.error) throw error(result.error, 403);
  return result.user;
}
async function auditExisting(db, cfg, names) {
  if (!Array.isArray(names) || names.length > 100 || names.some(n => !name(n) || name(n).length > 50)) throw error('IAM_INVALID_MATCH_LIST');
    const [rows] = await db.query('SELECT id, name, email, student_no FROM users WHERE organization_id = ? AND name IN (?)', [cfg.orgId, names]);
    const report = [];
    for (const expected of [...new Set(names.map(name))]) {
      const candidates = rows.filter(u => name(u.name) === expected), user = candidates[0];
      if (candidates.length !== 1 || (!email(user.email) && !name(user.student_no))) {
        report.push({ name: expected, status: candidates.length ? 'conflict' : 'not_found' }); continue;
      }
      report.push({ name: expected, userId: Number(user.id), status: 'candidate' });
    }
    return report;
}
module.exports = { claimsFromProfile, matchUser, resolveProfile, auditExisting };
