const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerContentTemplateRoutes } = require('../routes/wechat_content_templates');

test('content templates are private by default, scoped to the workspace and managed only by owner or manager', async () => {
  const rows = []; let nextId = 1;
  const pool = { query: async (sql, params) => {
    if (sql.includes('INSERT INTO')) {
      const [organization_id, unit_id, owner_id, name, outline, review_credits, visibility] = params;
      rows.push({ id: nextId++, organization_id, unit_id, owner_id, name, outline, review_credits, visibility });
      return [{ insertId: nextId - 1 }];
    }
    if (sql.includes('SELECT id,name')) {
      const [org, unit, user] = params;
      return [rows.filter(row => row.organization_id === org && row.unit_id === unit
        && (row.owner_id === user || (row.visibility === 'workspace' && unit !== null)))];
    }
    if (sql.includes('SELECT id,owner_id')) {
      const [id, org, unit] = params;
      return [rows.filter(row => row.id === id && row.organization_id === org && row.unit_id === unit)];
    }
    if (sql.includes('UPDATE wechat_content_templates')) {
      const [name, outline, review_credits, visibility, id, org, unit, user, manager] = params;
      const row = rows.find(item => item.id === id && item.organization_id === org && item.unit_id === unit
        && (item.owner_id === user || (item.visibility === 'workspace' && manager === 1)));
      if (row) Object.assign(row, { name, outline, review_credits, visibility });
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (sql.includes('DELETE FROM')) {
      const [id, org, unit, user, manager] = params;
      const index = rows.findIndex(row => row.id === id && row.organization_id === org && row.unit_id === unit
        && (row.owner_id === user || (row.visibility === 'workspace' && manager === 1)));
      if (index >= 0) rows.splice(index, 1);
      return [{ affectedRows: index >= 0 ? 1 : 0 }];
    }
    throw Error(`Unexpected SQL: ${sql}`);
  } };
  const app = express(), router = express.Router(); app.use(express.json());
  app.use((req, _res, next) => { req.workspace = { enabled: true, userId: Number(req.get('x-user') || 1),
    orgId: Number(req.get('x-org') || 1), unitId: Number(req.get('x-unit') || 10), role: req.get('x-role') || 'member' }; next(); });
  registerContentTemplateRoutes(router, { pool, requirePermission: () => (_req, _res, next) => next(),
    resolveWorkspace: async req => req.workspace, sendWorkspaceError: () => false });
  app.use(router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = 'GET', user = 1, org = 1, unit = 10, role = 'member', data } = {}) => fetch(base + path, {
    method, headers: { 'content-type': 'application/json', 'x-user': String(user), 'x-org': String(org), 'x-unit': String(unit), 'x-role': role },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const template = { name: '活动报道', outline: '导语\n活动经过', reviewCredits: true };
  try {
    const created = await (await call('/content-templates', { method: 'POST', data: template })).json();
    assert.equal((await (await call('/content-templates', { user: 2 })).json()).items.length, 0);
    assert.equal((await call(`/content-templates/${created.id}`, { method: 'PUT', user: 3, role: 'manager', data: template })).status, 404);
    assert.equal((await call(`/content-templates/${created.id}`, { method: 'PUT', data: { ...template, visibility: 'workspace' } })).status, 200);
    assert.equal((await (await call('/content-templates', { user: 2 })).json()).items[0].canEdit, false);
    assert.equal((await (await call('/content-templates', { user: 3, role: 'manager' })).json()).items[0].canEdit, true);
    assert.equal((await (await call('/content-templates', { user: 2, unit: 11 })).json()).items.length, 0);
    assert.equal((await (await call('/content-templates', { user: 2, org: 2 })).json()).items.length, 0);
    assert.equal((await call(`/content-templates/${created.id}`, { method: 'DELETE', user: 2 })).status, 404);
    assert.equal((await call(`/content-templates/${created.id}`, { method: 'DELETE', user: 3, role: 'manager' })).status, 200);
    assert.equal((await call('/content-templates', { method: 'POST', data: { ...template, outline: 'x'.repeat(1001) } })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
