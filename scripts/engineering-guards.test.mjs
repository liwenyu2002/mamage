import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { budgetViolations, scanRouteSql } from './audit-inline-sql.mjs';
import { inventory } from './gen-auth-matrix.mjs';

test('SQL in a DAO argument still counts as route SQL, including dynamic fragments', () => {
  const found = scanRouteSql([
    'const select = "SELECT " + columns;',
    'dao.list(db, { sql: `WITH scoped AS (SELECT * FROM fixtures) SELECT * FROM scoped` });',
    'const where = `WHERE item.owner_id = ${ownerId}`;',
    'conn["execute"](statement, args);',
    'db?.query(statement);',
  ].join('\n'));
  assert.deepEqual(found, [
    { line: 1, kind: 'SQL text' }, { line: 2, kind: 'SQL text' }, { line: 3, kind: 'SQL text' },
    { line: 4, kind: 'direct query' }, { line: 5, kind: 'direct query' },
  ]);
});

test('comments, normal messages and named DAO operations do not spend the SQL budget', () => {
  assert.deepEqual(scanRouteSql([
    '// pool.query("SELECT * FROM fixtures");',
    'const message = "Update your display name";',
    'const SELECTED = "selected item";',
    'return fixtureDao.listVisible(db, organizationId);',
  ].join('\n')), []);
});

test('removing debt in one route does not create a budget for another', () => {
  const hit = { line: 1, kind: 'SQL text' };
  assert.deepEqual(budgetViolations({ 'other.js': [hit] }, { 'old.js': 1 }), [['other.js', [hit]]]);
  assert.deepEqual(budgetViolations({ 'old.js': [hit] }, { 'old.js': 1 }), []);
});

test('inventory follows actual mounts and helper registrations, including literal loops and scoped guards', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mamage-route-inventory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, source) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  };
  write('app.js', [
    'const albumRouter = require("./routes/albums");',
    'app.use("/api/catalog", authMiddleware, albumRouter);',
    'app.use("/api/second", albumRouter);',
    'app.get("/api/health", reply);',
  ].join('\n'));
  write('routes/albums.js', [
    'router.get("/", list);',
    'router.use("/admin", requirePermission("albums.manage"));',
    'require("../lib/register").registerExtras(router);',
  ].join('\n'));
  write('lib/register.js', [
    'function registerExtras(router) {',
    '  for (const [segment, handler] of [["recent", byRecent], ["starred", byStar]]) {',
    '    router.get(`/admin/${segment}`, handler);',
    '  }',
    '}',
    'function notMounted(router) { router.get("/orphan", unused); }',
  ].join('\n'));
  write('routes/key_not_mounted.js', 'router.get("/", handler);');
  const rows = inventory(root);
  const find = endpoint => rows.find(row => row.endpoint === endpoint);
  assert.equal(rows.length, 7);
  assert.deepEqual(find('/api/catalog').guards, ['登录']);
  assert.deepEqual(find('/api/catalog/admin/recent').guards, ['登录', '权限 albums.manage']);
  assert.deepEqual(find('/api/second/admin/starred').guards, ['权限 albums.manage']);
  assert.deepEqual(find('/api/health').guards, []);
  assert.equal(find('/api/key-not-mounted'), undefined);
  assert.equal(find('/api/catalog/orphan'), undefined);
  write('routes/albums.js', 'router.get("/", handler); router.get("/", otherHandler);');
  assert.throws(() => inventory(root), /Duplicate documented route: GET \/api\/catalog/);
});

test('the MaMage inventory includes separately registered and generated API routes', () => {
  const rows = inventory();
  const find = (method, endpoint) => rows.find(row => row.method === method && row.endpoint === endpoint);
  assert.ok(find('POST', '/api/integrations/iam/accounts'));
  assert.ok(find('POST', '/api/integrations/iam/departments'));
  assert.ok(find('GET', '/api/auth/iam/qr/:id/image'));
  assert.ok(find('GET', '/api/ai/news/rewrites/:clientRequestId'));
  assert.ok(find('POST', '/api/wechat-compositions/layout'));
  assert.ok(find('POST', '/api/photos/video-downloads/source'));
  assert.ok(find('POST', '/api/users/workspace-join/requests/:id/review'));
  assert.deepEqual(find('GET', '/api/folder-shares/received').guards, ['权限 photos.view']);
  assert.deepEqual(find('GET', '/api/organizations').guards, ['权限 photos.view']);
  assert.equal(find('GET', '/api/news-paragraphs/rewrites/:clientRequestId'), undefined);
});
