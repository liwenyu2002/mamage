const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const { registerInvitationManagement, inviteBelongsToOrganization } = require('../lib/invitation_management');
const { workspacePermission } = require('../lib/access_policy');

test('invitation reads and revocation keep organization scope and reject contributors before any SQL', async () => {
  const invitations = [{ id: 10, orgId: 2, code: 'synthetic-own', revoked: 0 },
    { id: 20, orgId: 3, code: 'synthetic-other', revoked: 0 }];
  const queries = [];
  const pool = { query: async (sql, params) => {
    queries.push({ sql, params });
    assert.match(sql, /creator\.organization_id = \?/);
    if (sql.startsWith('UPDATE')) {
      const item = invitations.find(row => row.id === params[0] && row.orgId === params[1]);
      if (item) item.revoked = 1;
      return [{ affectedRows: item ? 1 : 0 }];
    }
    if (sql.startsWith('SELECT i.id FROM')) return [invitations.filter(row => row.id === params[0] && row.orgId === params[1] && row.revoked)];
    return [invitations.filter(row => row.orgId === params[0] && (!params[1] || row.id < params[1])).sort((a, b) => b.id - a.id)];
  } };
  const app = express();
  const authMiddleware = (req, res, next) => {
    if (!req.get('authorization')) return res.sendStatus(401);
    req.user = { id: 7, organization_id: 2 };
    req.workspace = { enabled: true, userId: 7, orgId: 2, unitId: 1, userRole: 'admin',
      role: 'editor', collegeAdmin: req.get('authorization') === 'admin' };
    next();
  };
  const requirePermission = permission => (req, res, next) => workspacePermission(req.workspace, permission, true) ? next() : res.sendStatus(403);
  const router = express.Router();
  registerInvitationManagement(router, { pool, authMiddleware, requirePermission });
  app.use('/api/users', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/users/invitations`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { authorization: 'student' } })).status, 403);
    assert.equal((await fetch(url + '/10', { method: 'DELETE', headers: { authorization: 'student' } })).status, 403);
    assert.equal(queries.length, 0);
    const headers = { authorization: 'admin' };
    const list = await (await fetch(url, { headers })).json();
    assert.deepEqual(list.list.map(item => item.id), [10]);
    assert.equal((await fetch(url + '?before=bad', { headers })).status, 400);
    assert.equal((await fetch(url + '/bad', { method: 'DELETE', headers })).status, 400);
    assert.equal((await fetch(url + '/20', { method: 'DELETE', headers })).status, 404);
    assert.equal(invitations[1].revoked, 0);
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const result = await fetch(url + '/10', { method: 'DELETE', headers });
      assert.equal(result.status, 200); assert.equal((await result.json()).revoked, true);
    }
    assert.equal(invitations[0].revoked, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('registration and redemption cannot consume another organization invitation', async () => {
  const db = { query: async (sql, params) => {
    assert.match(sql, /id = \? AND organization_id = \?/);
    return [params[0] === 7 && params[1] === 2 ? [{ id: 7 }] : []];
  } };
  assert.equal(await inviteBelongsToOrganization(db, 7, 2), true);
  assert.equal(await inviteBelongsToOrganization(db, 7, 3), false);
  assert.equal(await inviteBelongsToOrganization(db, null, 2), false);
  assert.equal(await inviteBelongsToOrganization(db, 7, null), false);
});
