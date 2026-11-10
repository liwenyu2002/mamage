// 重复账号扫描：找出「同一个人可能有多个账号」的情况，供超管后台合并。
// 只读，不改任何数据；结果按严重程度排序。
const AUTO_PREFIX = /^(iam_|auto|merged-)/;

const normalize = value => (typeof value === 'string' ? value.normalize('NFKC').trim() : '');
const lower = value => normalize(value).toLowerCase();

async function scan(db, { limit = 200 } = {}) {
  const [users] = await db.query(`SELECT u.id, u.name, u.email, u.student_no, u.role, u.organization_id,
      u.created_at, CHAR_LENGTH(COALESCE(u.password_hash,'')) AS hash_len,
      (SELECT COUNT(*) FROM iam_login_identities i WHERE i.user_id = u.id) AS identities,
      (SELECT COUNT(*) FROM projects p WHERE p.admin_id = u.id) AS projects
    FROM users u ORDER BY u.id`);

  const rows = users.map(row => ({
    id: Number(row.id), name: normalize(row.name), email: lower(row.email), studentNo: normalize(row.student_no),
    role: row.role, organizationId: Number(row.organization_id), createdAt: row.created_at,
    hasPassword: Number(row.hash_len) > 0, identities: Number(row.identities), projects: Number(row.projects),
    autoProvisioned: AUTO_PREFIX.test(String(row.student_no || '')),
    retired: /^merged-/.test(String(row.student_no || '')),
  }));

  // 已退役（merged-*）的账号是合并后的墓碑行，不参与重复判定
  const active = rows.filter(row => !row.retired);
  const groups = [];
  const byName = new Map();
  for (const row of active) {
    if (!row.name) continue;
    const key = `${row.organizationId}\u0000${row.name}`;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    // 只有「同一学院同名」且至少一个是自动开户/有身份绑定的，才值得人工确认
    if (!list.some(row => row.autoProvisioned || row.identities > 0)) continue;
    groups.push({ reason: 'same-name', name: list[0].name, organizationId: list[0].organizationId,
      accounts: list.map(brief) });
  }

  const byEmail = new Map();
  for (const row of active) if (row.email) {
    if (!byEmail.has(row.email)) byEmail.set(row.email, []);
    byEmail.get(row.email).push(row);
  }
  for (const [email, list] of byEmail) {
    if (list.length < 2) continue;
    groups.push({ reason: 'same-email', email, accounts: list.map(brief) });
  }

  const byStudentNo = new Map();
  for (const row of active) if (row.studentNo) {
    if (!byStudentNo.has(row.studentNo)) byStudentNo.set(row.studentNo, []);
    byStudentNo.get(row.studentNo).push(row);
  }
  for (const [studentNo, list] of byStudentNo) {
    if (list.length < 2) continue;
    groups.push({ reason: 'same-student-no', studentNo, accounts: list.map(brief) });
  }

  // 身份已绑定但没有邮箱的账号：后续同步容易冲突（例如李智那次）
  const risky = active.filter(row => row.identities > 0 && !row.email);
  if (risky.length) groups.push({ reason: 'identity-without-email', accounts: risky.map(brief) });

  const seen = new Set();
  const unique = groups.filter(group => {
    const key = group.reason + '|' + group.accounts.map(a => a.id).sort().join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);

  return {
    scannedAt: new Date().toISOString(),
    totals: { users: rows.length, autoProvisioned: rows.filter(r => r.autoProvisioned).length,
      withIdentity: rows.filter(r => r.identities > 0).length, withoutEmail: rows.filter(r => !r.email).length },
    groups: unique,
    groupCount: unique.length,
  };
}

const brief = row => ({ id: row.id, name: row.name, email: row.email || null, studentNo: row.studentNo || null,
  role: row.role, createdAt: row.createdAt, hasPassword: row.hasPassword, identities: row.identities,
  projects: row.projects, autoProvisioned: row.autoProvisioned });

module.exports = { scan };
