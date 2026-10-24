const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const mock = (name, exports) => { const id = require.resolve(name); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let granted = false, photoAllowed = true, reads = 0, audits = 0;
mock('../db', { pool: { query: async sql => {
  if (sql.includes('face_search_grants')) return [granted ? [{ college_wide: 1 }] : []];
  if (sql.includes('organization_access_audit')) { audits++; return [{}]; }
  throw Error('Unexpected SQL');
} } });
mock('../lib/permissions', { requirePermission: () => (req, res, next) => { req.user = { id: 7, organization_id: 2 }; next(); } });
mock('../lib/media_access', {});
mock('../lib/workspace_access', {
  WorkspaceAccessError: class extends Error { constructor(message, status = 403) { super(message); this.status = status; } },
  resolveWorkspace: async () => ({ enabled: true, orgId: 2, userId: 7, unitId: 2 }),
  requirePhotoAccess: async () => { if (!photoAllowed) throw Object.assign(Error('PHOTO_NOT_FOUND'), { status: 404 }); },
  sendWorkspaceError: (res, error) => { if (!error.status) return false; res.status(error.status).json({ error: error.message }); return true; },
});
mock('../lib/face_detector', {}); mock('../lib/face_avatar', {}); mock('../lib/face_feedback', {});
mock('../lib/photo_person_observations', { enabled: () => true,
  loadPhotoFaces: async () => { reads++; return [{ id: 1 }]; },
  readObservations: async () => new Map([[1, {}]]), presentPeople: () => [{ personName: '人物姓名' }],
});

test('person observations require both face authorization and current photo access, with access audit', async () => {
  const app = express(); app.use('/api', require('../routes/faces'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/photos/77/faces/observations`;
    const denied = await fetch(url);
    assert.equal(denied.status, 403);
    assert.equal(reads, 0);
    granted = true; photoAllowed = false;
    assert.equal((await fetch(url)).status, 404);
    assert.equal(reads, 0);
    photoAllowed = true;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).people[0].personName, '人物姓名');
    assert.equal(reads, 1);
    assert.ok(audits > 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
