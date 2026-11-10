const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mergeAccounts, preview } = require('../lib/account_merge');

const user = (id, extra = {}) => ({ id, name: '用户' + id, email: `u${id}@example.edu`, student_no: 'v-' + id,
  role: 'admin', organization_id: 2, active_unit_id: null, password_hash: 'hash', ...extra });

function fake({ users = {}, faces = [], dedupe = 0 } = {}) {
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/SELECT COUNT\(\*\) AS n/.test(sql)) return [[{ n: 3 }]];
    if (/FROM users WHERE id = \?/.test(sql)) { const row = users[params[0]]; return [row ? [row] : []]; }
    if (/FROM face_search_grants WHERE user_id = \?$/.test(sql)) return [faces.filter(f => f.user_id === params[0])];
    if (/FROM face_search_grants WHERE user_id = \? AND organization_id = \?/.test(sql)) {
      return [faces.filter(f => f.user_id === params[0] && f.organization_id === params[1])];
    }
    if (/^UPDATE IGNORE/.test(sql)) return [{ affectedRows: 1 }];
    if (/^DELETE/.test(sql)) return [{ affectedRows: dedupe }];
    return [{ affectedRows: 1 }];
  };
  const conn = { query, beginTransaction: async () => calls.push({ sql: 'BEGIN' }),
    commit: async () => calls.push({ sql: 'COMMIT' }), rollback: async () => calls.push({ sql: 'ROLLBACK' }), release() {} };
  return { calls, db: { query, getConnection: async () => conn } };
}

test('合并拒绝同一账号与超级管理员', async () => {
  const { db } = fake({ users: { 1: user(1), 2: user(2, { role: 'superadmin' }) } });
  await assert.rejects(mergeAccounts(db, 9, 1, 1), /不能把账号合并到自己/);
  await assert.rejects(mergeAccounts(db, 9, 1, 2), (e) => e.code === 'PROTECTED_SUPERADMIN');
  await assert.rejects(mergeAccounts(db, 9, 1, 3), (e) => e.code === 'USER_NOT_FOUND');
});

test('合并把归属、成员关系、IAM 身份转到保留账号并退役来源账号', async () => {
  const { db, calls } = fake({ users: { 1: user(1), 2: user(2) }, dedupe: 2 });
  const result = await mergeAccounts(db, 9, 1, 2);
  assert.equal(result.source.id, 1);
  assert.equal(result.target.id, 2);
  assert.ok(result.moved['projects.admin_id'] >= 1);
  assert.ok(calls.some(c => c.sql === 'COMMIT'));
  assert.ok(calls.some(c => /UPDATE IGNORE organization_unit_memberships/.test(c.sql)), '成员关系需要去重转移');
  assert.ok(calls.some(c => /UPDATE IGNORE iam_login_identities/.test(c.sql)), 'IAM 登录身份需要改绑');
  const retire = calls.find(c => /UPDATE users SET student_no = CONCAT\('merged-'/.test(c.sql));
  assert.ok(retire, '来源账号需要退役');
  assert.deepEqual(retire.params, [1]);
  assert.ok(calls.some(c => /disabled = 1/.test(c.sql)), '来源账号需要停用');
  assert.equal(result.moved['user_favorites.user_id.deduped'], 2);
});

test('预览返回转移条数并标出被阻止的原因', async () => {
  const { db } = fake({ users: { 1: user(1), 2: user(2, { role: 'superadmin' }) } });
  const info = await preview(db, 1, 2);
  assert.equal(info.source.id, 1);
  assert.equal(info.target.id, 2);
  assert.match(info.blocked, /超级管理员/);
});
