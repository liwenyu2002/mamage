const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');

function mock(name, exports) {
  const path = require.resolve(name);
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

test('the group manager can change only an existing regular member of their own group', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.function('FIELD', { varargs: true }, (value, ...values) => values.indexOf(value) + 1);
  sql.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT, email TEXT, role TEXT, organization_id INTEGER,
      active_unit_id INTEGER, view_organization_photos INTEGER DEFAULT 1);
    CREATE TABLE organization_units(id INTEGER PRIMARY KEY, organization_id INTEGER, archived_at TEXT);
    CREATE TABLE organization_unit_memberships(unit_id INTEGER, user_id INTEGER, role TEXT, created_at TEXT, removed_at TEXT,
      PRIMARY KEY(unit_id,user_id));
    CREATE TABLE organization_admin_grants(organization_id INTEGER, user_id INTEGER);
    CREATE TABLE organization_access_audit(organization_id, unit_id, user_id, action, resource_type, resource_id, details);
    INSERT INTO organization_units VALUES (7,2,NULL),(8,2,NULL),(9,3,NULL);
    INSERT INTO users(id,name,role,organization_id,active_unit_id) VALUES
      (1,'Manager','admin',2,7),(2,'Member','visitor',2,7),(3,'Co-manager','admin',2,7),
      (4,'Superadmin','superadmin',2,7),(5,'Outsider','visitor',3,9),
      (6,'Former member','visitor',2,7),(7,'New applicant','visitor',2,NULL),
      (8,'Other member','visitor',2,8);
    INSERT INTO organization_admin_grants VALUES (2,4);
    INSERT INTO organization_unit_memberships VALUES
      (7,1,'manager','2026',NULL),(7,2,'viewer','2026',NULL),(7,3,'manager','2026',NULL),
      (7,4,'editor','2026',NULL),(7,6,'editor','2026','2026'),
      (8,2,'viewer','2026',NULL),(8,8,'viewer','2026',NULL),(9,5,'viewer','2026',NULL);`);
  const query = async (source, params = []) => {
    const statement = sql.prepare(source.replace(/\s+FOR UPDATE/g, ''));
    if (/^SELECT/i.test(source.trim())) return [statement.all(...params)];
    return [{ affectedRows: statement.run(...params).changes }];
  };
  mock('../db', { pool: { query, getConnection: async () => ({
    query, beginTransaction: async () => sql.exec('BEGIN'), commit: async () => sql.exec('COMMIT'),
    rollback: async () => { if (sql.isTransaction) sql.exec('ROLLBACK'); }, release() {},
  }) } });
  mock('../lib/permissions', { requirePermission: permission => (req, res, next) => {
    assert.equal(permission, 'photos.view');
    const user = sql.prepare('SELECT * FROM users WHERE id=?').get(Number(req.get('x-test-user')));
    if (!user) return res.sendStatus(401);
    req.user = user;
    next();
  } });
  const original = process.env.ORGANIZATION_UNITS_ACTIVE;
  process.env.ORGANIZATION_UNITS_ACTIVE = '1';
  let server;
  try {
    const app = express();
    app.use(express.json());
    app.use('/api/workspaces', require('../routes/workspaces'));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/workspaces`;
    const request = (actor, path, role, method = role == null ? 'GET' : 'PUT') => fetch(base + path, {
      method, headers: { 'x-test-user': String(actor), 'content-type': 'application/json' },
      ...(role == null ? {} : { body: JSON.stringify({ role }) }),
    });
    const before = await request(1, '/7/members');
    assert.equal(before.status, 200);
    const members = await before.json();
    assert.deepEqual(members.filter(member => member.canChangeRole).map(member => member.id), [2]);
    assert.ok(members.every(member => !member.canRemove));
    const updated = await request(1, '/7/members/2', 'editor');
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).role, 'editor');
    const readRole = (unit, user) => sql.prepare('SELECT role FROM organization_unit_memberships WHERE unit_id=? AND user_id=?').get(unit, user)?.role;
    assert.equal(readRole(7, 2), 'editor');
    assert.equal(readRole(8, 2), 'viewer');
    assert.equal(sql.prepare('SELECT role FROM users WHERE id=2').get().role, 'visitor', 'The school account role is independent');
    for (const path of ['/7/members/1', '/7/members/3', '/7/members/4', '/7/members/6', '/7/members/7', '/8/members/8', '/9/members/5']) {
      assert.equal((await request(1, path, 'viewer')).status, 403, path);
    }
    assert.equal((await request(1, '/7/members/2', 'manager')).status, 403);
    assert.equal((await request(1, '/7/members/2', null, 'DELETE')).status, 403);
    assert.equal((await request(2, '/7/members/1', 'viewer')).status, 403);
    assert.equal((await request(8, '/7/members')).status, 403);
    assert.equal((await request(1, '/7/members/2', 'viewer')).status, 200);
    assert.equal(readRole(7, 2), 'viewer');
    assert.deepEqual(sql.prepare('SELECT action FROM organization_access_audit').all().map(row => row.action),
      ['membership.role.configure', 'membership.role.configure']);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (original === undefined) delete process.env.ORGANIZATION_UNITS_ACTIVE;
    else process.env.ORGANIZATION_UNITS_ACTIVE = original;
    sql.close();
  }
});
