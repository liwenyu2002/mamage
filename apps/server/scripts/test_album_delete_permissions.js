const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');

function load(filename, dependencies) {
  const module = { exports: {} }, actual = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, process, console,
    require: key => Object.hasOwn(dependencies, key) ? dependencies[key] : actual(key) }, { filename });
  return module.exports;
}

function fixture({ role = 'editor', collegeAdmin = false, authenticated = true, race = false } = {}) {
  const workspace = { enabled: true, userId: 7, orgId: 2, userRole: 'admin', unitId: 1, role, collegeAdmin };
  const state = { projects: [
    { id: 9, organization_id: 2, unit_id: 1, admin_id: 7 },
    { id: 10, organization_id: 2, unit_id: 3 },
    { id: 11, organization_id: 3, unit_id: 1 },
    { id: 12, organization_id: 2, unit_id: 1, restricted_to_user_id: 99 },
  ], deleted: [], storageCalls: 0, commits: 0, rollbacks: 0, locked: false };
  const query = async (sql, params = []) => {
    if (sql.startsWith('SELECT role FROM users')) return [[{ role: 'admin' }]];
    if (sql.includes('FROM role_permissions')) return [[{ allowed: 1 }]];
    if (sql.startsWith('SELECT id, organization_id, unit_id, restricted_to_user_id, admin_id FROM projects')) {
      return [state.projects.filter(p => p.id === params[0]).map(p => ({ ...p }))];
    }
    if (sql.startsWith('SELECT id FROM projects WHERE')) {
      assert.ok(sql.endsWith('FOR UPDATE'));
      state.locked = true;
      if (race) state.projects.find(p => p.id === 9).unit_id = 3;
      return [state.projects.filter(p => p.id === params[0] && p.organization_id === params[1]).map(p => ({ ...p }))];
    }
    if (sql.includes('FROM photos') && sql.includes('FOR UPDATE')) return [[]];
    if (sql.startsWith('DELETE FROM projects')) {
      assert.ok(state.locked);
      state.deleted.push(params[0]);
      state.projects = state.projects.filter(p => p.id !== params[0]);
      return [{ affectedRows: 1 }];
    }
    throw Error('Unexpected SQL ' + sql);
  };
  let snapshot;
  const conn = { query, async beginTransaction() { snapshot = structuredClone(state.projects); },
    async commit() { state.commits++; }, async rollback() { state.rollbacks++; state.projects = snapshot; }, release() {} };
  const pool = { query, getConnection: async () => conn };
  const access = load(require.resolve('../lib/workspace_access'), { '../db': { pool } });
  const permissions = load(require.resolve('../lib/permissions'), { '../db': { pool }, './workspace_access': access });
  const router = express.Router(), app = express();
  app.use((req, _res, next) => {
    if (authenticated) req.user = { id: 7, role: 'admin', organization_id: 2 };
    req.workspace = { ...workspace };
    next();
  });
  const source = fs.readFileSync(require.resolve('../routes/projects'), 'utf8');
  const globals = { router, pool, requirePermission: permissions.requirePermission,
    resolveWorkspace: access.resolveWorkspace, requireProjectAccess: access.requireProjectAccess,
    sendWorkspaceError: access.sendWorkspaceError, populateReqUserFromAuthIfPresent: async () => {},
    assertNoActiveCopySource: async () => {}, skipLocalFileCheck: true,
    cosStorage: { async deleteObjectsForPhotoRows() { state.storageCalls++; return {}; } }, console };
  vm.runInNewContext(source.slice(source.indexOf("router.param('id'"), source.indexOf('// 小工具：安全解析 meta JSON')), globals);
  vm.runInNewContext(source.slice(source.indexOf("router.delete('/:id',"), source.indexOf('module.exports = router;')), globals);
  app.use('/api/projects', router);
  return { app, state };
}

async function remove(f, id) {
  const server = f.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { return await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${id}`, { method: 'DELETE' }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('ordinary members and editors cannot delete even their own albums', async () => {
  for (const role of ['member', 'editor']) {
    const f = fixture({ role });
    assert.ok([403, 404].includes((await remove(f, 9)).status));
    assert.deepEqual(f.state.deleted, []); assert.equal(f.state.storageCalls, 0);
  }
});

test('workspace managers and college administrators retain scoped album deletion', async () => {
  for (const options of [{ role: 'manager' }, { collegeAdmin: true }]) {
    const f = fixture(options);
    assert.equal((await remove(f, 9)).status, 200);
    assert.deepEqual(f.state.deleted, [9]); assert.equal(f.state.commits, 1);
  }
  const college = fixture({ collegeAdmin: true });
  assert.equal((await remove(college, 10)).status, 200);
});

test('managers cannot delete albums outside their unit or assigned private scope', async () => {
  for (const id of [10, 11, 12, 999]) {
    const f = fixture({ role: 'manager' });
    assert.equal((await remove(f, id)).status, 404); assert.deepEqual(f.state.deleted, []);
  }
  const college = fixture({ collegeAdmin: true });
  assert.equal((await remove(college, 11)).status, 404);
});

test('malformed album IDs cannot bypass the workspace parameter guard', async () => {
  for (const id of ['9junk', '10junk', '-9', '9.5']) {
    const f = fixture({ role: 'manager' });
    assert.equal((await remove(f, id)).status, 400); assert.deepEqual(f.state.deleted, []);
  }
  const overflow = fixture({ role: 'manager' });
  assert.ok([400, 404].includes((await remove(overflow, '9007199254740992')).status));
  assert.deepEqual(overflow.state.deleted, []);
});

test('album scope is checked again inside the deletion transaction after locking', async () => {
  const f = fixture({ role: 'manager', race: true });
  assert.equal((await remove(f, 9)).status, 404);
  assert.deepEqual(f.state.deleted, []); assert.equal(f.state.rollbacks, 1); assert.equal(f.state.storageCalls, 0);
});

test('anonymous users cannot delete albums', async () => {
  const f = fixture({ authenticated: false, role: 'manager' });
  assert.equal((await remove(f, 9)).status, 401); assert.deepEqual(f.state.deleted, []);
});
