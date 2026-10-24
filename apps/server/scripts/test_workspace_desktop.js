const assert = require('node:assert/strict');
const crypto = require('node:crypto');
if (!String(process.env.DB_NAME || '').endsWith('_workspace_test')) {
  throw Error('Set DB_NAME to an isolated *_workspace_test database');
}
process.env.ORGANIZATION_UNITS_ACTIVE = '1';
const express = require('express');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { JWT_SECRET } = require('../config/keys');

async function main() {
  const suffix = crypto.randomBytes(6).toString('hex');
  const ids = {}; let server;
  const insert = async (sql, params) => (await pool.query(sql, params))[0].insertId;
  try {
    const [permissions] = await pool.query("SELECT id FROM role_permissions WHERE role = 'photographer' AND permission = 'photos.view'");
    if (!permissions.length) ids.permission = await insert("INSERT INTO role_permissions (role, permission) VALUES ('photographer', 'photos.view')");
    ids.org = await insert('INSERT INTO organizations (name, slug, code) VALUES (?, ?, ?)', ['Desktop test', suffix, suffix]);
    ids.unit = await insert('INSERT INTO organization_units (organization_id, name, slug) VALUES (?, ?, ?)', [ids.org, 'Desktop unit', suffix]);
    ids.user = await insert('INSERT INTO users (student_no, name, role, organization_id, active_unit_id) VALUES (?, ?, ?, ?, ?)',
      [suffix, 'Desktop tester', 'photographer', ids.org, ids.unit]);
    await pool.query("INSERT INTO organization_unit_memberships (user_id, unit_id, role) VALUES (?, ?, 'manager')", [ids.user, ids.unit]);
    ids.project = await insert('INSERT INTO projects (uuid, name, organization_id, unit_id) VALUES (UUID(), ?, ?, ?)', ['Nested folder album', ids.org, ids.unit]);
    const app = express(); app.use(express.json()); app.use('/api/album-desktop', require('../routes/album_desktop'));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/album-desktop`;
    const headers = { Authorization: `Bearer ${jwt.sign({ id: ids.user }, JWT_SECRET)}`,
      'X-Mamage-Unit-Id': String(ids.unit), 'Content-Type': 'application/json' };
    assert.equal((await fetch(base)).status, 401);
    const initialResponse = await fetch(base, { headers });
    assert.equal(initialResponse.status, 200, await initialResponse.clone().text());
    const initial = await initialResponse.json();
    assert.equal(initial.albums.length, 1);
    const groups = [{ id: 'parent', name: 'Parent', projectIds: [], parentId: null },
      { id: 'child', name: 'Child', projectIds: [ids.project], parentId: 'parent' }];
    const body = { scope: initial.scope, workspaceRevision: initial.workspaceRevision,
      userRevision: initial.userRevision, groups, preferences: { pins: ['group:child'], colors: { child: '#abcdef' } } };
    const saved = await fetch(base + '/state', { method: 'PUT', headers, body: JSON.stringify(body) });
    assert.equal(saved.status, 200, await saved.clone().text());
    const read = await (await fetch(base, { headers })).json();
    assert.deepEqual(read.groups.map(group => [group.id, group.parentId, group.projectIds]),
      [['parent', null, []], ['child', 'parent', [ids.project]]]);
    assert.deepEqual(read.preferences.pins, ['group:child']);
    assert.equal(read.preferences.colors.child, '#abcdef');
    assert.equal((await fetch(base + '/state', { method: 'PUT', headers, body: JSON.stringify(body) })).status, 409);
    await require('./migrate_album_desktop').migrate();
    const afterIdempotentCreate = await (await fetch(base, { headers })).json();
    assert.deepEqual(afterIdempotentCreate.groups, read.groups);
    assert.equal(afterIdempotentCreate.workspaceRevision, read.workspaceRevision);
    console.log('workspace desktop database integration: nested folders, album membership, preferences, revision conflicts and non-destructive reinitialization passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (ids.org) {
      for (const table of ['album_desktop_users', 'album_desktop_workspaces']) {
        await pool.query(`DELETE FROM ${table} WHERE organization_id = ?`, [ids.org]).catch(() => {});
      }
      if (ids.project) await pool.query('DELETE FROM projects WHERE id = ?', [ids.project]);
      if (ids.user) {
        await pool.query('DELETE FROM organization_unit_memberships WHERE user_id = ?', [ids.user]);
        await pool.query('DELETE FROM users WHERE id = ?', [ids.user]);
      }
      if (ids.unit) await pool.query('DELETE FROM organization_units WHERE id = ?', [ids.unit]);
      await pool.query('DELETE FROM organizations WHERE id = ?', [ids.org]);
    }
    if (ids.permission) await pool.query('DELETE FROM role_permissions WHERE id = ?', [ids.permission]);
    await pool.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
