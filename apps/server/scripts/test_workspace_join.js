const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerWorkspaceJoin } = require('../lib/workspace_join');
const { fixture } = require('./fixtures/workspace_join_db.cjs');
const run = callback => async () => { const f = fixture(); try { await callback(f); } finally { f.close(); } };

test('unassigned student can choose a same-school organization or decline without obtaining membership', run(async f => {
  const initial = await f.join.mine(2);
  assert.equal(initial.needsChoice, true);
  assert.deepEqual(initial.units.map(u => u.id).sort(), [1, 2]);
  await f.join.skip(2); await f.join.skip(2);
  assert.equal((await f.join.mine(2)).needsChoice, false);
  assert.equal((await f.join.summary(2)).hasMembership, false);
  assert.equal(f.sql.prepare('SELECT role FROM users WHERE id=2').get().role, 'visitor');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM organization_unit_memberships WHERE user_id=2').get().n, 0);
}));

test('application is idempotent and notifies only its organization reviewers and superadministrator', run(async f => {
  const request = await f.join.apply(2, { unitId: 1, reason: 'Student media team' });
  const repeated = await f.join.apply(2, { unitId: '1', reason: 'Duplicate' });
  assert.equal(request.id, repeated.id); assert.equal(repeated.created, false);
  assert.equal((await f.join.summary(3)).pendingCount, 1);
  assert.equal((await f.join.summary(4)).pendingCount, 0);
  assert.equal((await f.join.summary(1)).pendingCount, 1);
  assert.equal((await f.join.summary(6)).pendingCount, 1);
  assert.equal((await f.join.mine(2)).requests[0].reason, 'Student media team');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM organization_access_audit').get().n, 1);
  assert.equal(f.sql.prepare('SELECT active_unit_id FROM users WHERE id=2').get().active_unit_id, null);
}));

test('invalid identifiers, forged privileges, archived and foreign organizations never create a request', run(async f => {
  for (const unitId of [true, [1], '1e0', '0x1', 0, -1]) await assert.rejects(f.join.apply(2, { unitId }), e => e.code === 'INVALID_JOIN_REQUEST');
  for (const unitId of [3, 4, 999]) await assert.rejects(f.join.apply(2, { unitId }), e => e.code === 'UNIT_NOT_FOUND');
  await assert.rejects(f.join.apply(2, { unitId: 1, role: 'manager' }), e => e.code === 'INVALID_JOIN_REQUEST');
  await assert.rejects(f.join.apply(2, { unitId: 1, reason: 'x'.repeat(301) }), e => e.code === 'INVALID_JOIN_TEXT');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM organization_join_requests').get().n, 0);
}));

test('manager can approve only an actual pending request and grants a normal contributor, never administration', run(async f => {
  const request = await f.join.apply(2, { unitId: 1 });
  await assert.rejects(f.join.review(4, request.id, { decision: 'approve' }), e => e.code === 'JOIN_REQUEST_NOT_FOUND');
  await assert.rejects(f.join.review(2, request.id, { decision: 'approve' }), e => e.code === 'JOIN_REVIEW_FORBIDDEN');
  await assert.rejects(f.join.review(7, request.id, { decision: 'approve' }), e => e.code === 'JOIN_REVIEW_FORBIDDEN');
  await assert.rejects(f.join.review(3, request.id, { decision: 'approve', role: 'manager' }), e => e.code === 'INVALID_JOIN_REVIEW');
  await f.join.review(3, request.id, { decision: 'approve', note: 'Welcome' });
  assert.equal(f.sql.prepare('SELECT role FROM organization_unit_memberships WHERE user_id=2').get().role, 'editor');
  assert.deepEqual({ ...f.sql.prepare('SELECT role,active_unit_id FROM users WHERE id=2').get() }, { role: 'photographer', active_unit_id: 1 });
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM organization_admin_grants WHERE user_id=2').get().n, 0);
  assert.equal((await f.join.summary(3)).pendingCount, 0);
  assert.equal((await f.join.summary(2)).unreadCount, 1);
  await assert.rejects(f.join.review(1, request.id, { decision: 'reject' }), e => e.code === 'JOIN_REQUEST_CHANGED');
}));

test('withdrawal prevents later approval, remains private, and permits a fresh request', run(async f => {
  const first = await f.join.apply(2, { unitId: 1 });
  await assert.rejects(f.join.withdraw(5, first.id), e => e.code === 'JOIN_REQUEST_NOT_FOUND');
  await f.join.withdraw(2, first.id);
  await assert.rejects(f.join.review(3, first.id, { decision: 'approve' }), e => e.code === 'JOIN_REQUEST_CHANGED');
  assert.equal((await f.join.summary(3)).pendingCount, 0);
  const next = await f.join.apply(2, { unitId: 1, reason: 'Again' });
  assert.equal(next.id, first.id); assert.equal(next.status, 'pending');
  assert.equal((await f.join.summary(2)).hasMembership, false);
}));

test('rejection does not grant access and only the applicant can acknowledge its exact notification revision', run(async f => {
  const request = await f.join.apply(2, { unitId: 1 });
  await f.join.review(3, request.id, { decision: 'reject', note: 'Please use your course team' });
  const notification = { id: request.id, revision: 1 };
  assert.equal((await f.join.summary(2)).hasMembership, false);
  await f.join.markRead(5, [notification]);
  assert.equal((await f.join.summary(2)).unreadCount, 1);
  await f.join.markRead(2, [notification]);
  assert.equal((await f.join.summary(2)).unreadCount, 0);
  await f.join.apply(2, { unitId: 1 });
  await f.join.review(3, request.id, { decision: 'reject' });
  await f.join.markRead(2, [notification]);
  assert.equal((await f.join.summary(2)).unreadCount, 1, 'An old read receipt cannot swallow a newer decision');
  assert.equal((await f.join.mine(2)).requests[0].reviewRevision, 2);
}));

test('revocation of manager grants and archived organizations are rechecked before approval', run(async f => {
  const request = await f.join.apply(2, { unitId: 1 });
  f.sql.exec("UPDATE organization_unit_memberships SET removed_at='2026' WHERE user_id=3");
  await assert.rejects(f.join.review(3, request.id, { decision: 'approve' }), e => e.code === 'JOIN_REVIEW_FORBIDDEN');
  f.sql.exec("UPDATE organization_units SET archived_at='2026' WHERE id=1");
  await assert.rejects(f.join.review(1, request.id, { decision: 'approve' }), e => e.code === 'JOIN_TARGET_CHANGED');
  assert.equal(f.sql.prepare('SELECT status FROM organization_join_requests').get().status, 'pending');
}));

test('global superadministrator can handle another school, but the college administrator cannot', run(async f => {
  const request = await f.join.apply(5, { unitId: 3 });
  assert.equal((await f.join.inbox(6)).total, 0);
  await assert.rejects(f.join.review(6, request.id, { decision: 'approve' }), e => e.code === 'JOIN_REQUEST_NOT_FOUND');
  await f.join.review(1, request.id, { decision: 'approve' });
  assert.equal((await f.join.summary(5)).hasMembership, true);
}));

test('approval preserves existing role, unrelated memberships and active workspace', run(async f => {
  const request = await f.join.apply(2, { unitId: 1 });
  f.sql.exec("INSERT INTO organization_unit_memberships VALUES(1,2,'viewer',NULL),(2,2,'manager',NULL);UPDATE users SET role='admin',active_unit_id=2 WHERE id=2");
  await f.join.review(3, request.id, { decision: 'approve' });
  assert.equal(f.sql.prepare('SELECT role FROM organization_unit_memberships WHERE user_id=2 AND unit_id=1').get().role, 'viewer');
  assert.equal(f.sql.prepare('SELECT active_unit_id FROM users WHERE id=2').get().active_unit_id, 2);
  assert.equal(f.sql.prepare('SELECT role FROM users WHERE id=2').get().role, 'admin');
}));

test('an account disabled after applying cannot obtain a new membership', run(async f => {
  const request = await f.join.apply(2, { unitId: 1 });
  const previous = process.env.IAM_ACCOUNT_GUARD;
  try {
    process.env.IAM_ACCOUNT_GUARD = '1';
    f.sql.exec('INSERT INTO iam_user_state(user_id,disabled) VALUES(2,1)');
    await assert.rejects(f.join.review(3, request.id, { decision: 'approve' }), e => e.code === 'JOIN_TARGET_DISABLED');
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM organization_unit_memberships WHERE user_id=2').get().n, 0);
    assert.equal(f.sql.prepare('SELECT status FROM organization_join_requests').get().status, 'pending');
  } finally {
    if (previous === undefined) delete process.env.IAM_ACCOUNT_GUARD; else process.env.IAM_ACCOUNT_GUARD = previous;
  }
}));

test('audit failure rolls back membership, account role and request status together', run(async f => {
  const request = await f.join.apply(2, { unitId: 1 });
  f.sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON organization_access_audit BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  await assert.rejects(f.join.review(3, request.id, { decision: 'approve' }), /synthetic failure/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM organization_unit_memberships WHERE user_id=2').get().n, 0);
  assert.equal(f.sql.prepare('SELECT role FROM users WHERE id=2').get().role, 'visitor');
  assert.equal(f.sql.prepare('SELECT status FROM organization_join_requests').get().status, 'pending');
}));

test('HTTP endpoints require authentication and an ordinary student cannot enumerate other applicants', run(async f => {
  const app = express(), router = express.Router();
  app.use(express.json());
  registerWorkspaceJoin(router, { db: f.db, auth: (req, res, next) => {
    const id = Number(req.get('x-test-user')); if (!id) return res.sendStatus(401);
    req.user = { id, role: 'superadmin' }; next();
  } });
  app.use('/api/users', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/users/workspace-join`;
  try {
    assert.equal((await fetch(base + '/me')).status, 401);
    assert.equal((await fetch(base + '/inbox', { headers: { 'x-test-user': '2' } })).status, 403);
    const response = await fetch(base + '/requests', { method: 'POST', headers: { 'x-test-user': '2', 'Content-Type': 'application/json' }, body: JSON.stringify({ unitId: 1 }) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const inbox = await (await fetch(base + '/inbox', { headers: { 'x-test-user': '3' } })).json();
    assert.equal(inbox.requests[0].name, 'New student');
    assert.equal(inbox.total, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}));

module.exports = { fixture };
