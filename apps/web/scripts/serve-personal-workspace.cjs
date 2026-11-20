const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const express = runtime('express');
const { fixture } = require('../../server/scripts/fixtures/workspace_join_db.cjs');
const { registerWorkspaceJoin } = require('../../server/lib/workspace_join');
const { registerUserAccessAdmin } = require('../../server/lib/user_access_admin');
const { workspacePolicy, userAccessProfile } = require('../../server/lib/access_policy');

async function createPersonalPreview({ ports = [0, 0, 0], dist = path.resolve(__dirname, '../dist') } = {}) {
  const f = fixture(), stats = { requests: [] }, app = express(), roles = new Map();
  f.sql.exec(`ALTER TABLE users ADD COLUMN department TEXT; ALTER TABLE users ADD COLUMN created_at TEXT DEFAULT '2026-11-17';
    ALTER TABLE organization_admin_grants ADD COLUMN granted_by INTEGER;
    CREATE TABLE organizations(id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO organizations VALUES(2,'本地测试学院'),(3,'另一测试学院');
    CREATE TABLE face_search_grants(organization_id INTEGER,user_id INTEGER,college_wide INTEGER,can_manage INTEGER,granted_by INTEGER);
    CREATE TABLE iam_login_identities(user_id INTEGER,subject_id TEXT);
    INSERT INTO iam_login_identities VALUES(1,'test-root'),(2,'test-student'),(3,'test-manager');
    UPDATE users SET name='测试同学' WHERE id=2; UPDATE users SET name='组织管理员' WHERE id=3;
    UPDATE users SET name='测试超级管理员' WHERE id=1;
    UPDATE organization_units SET name='学工与融媒体' WHERE id=1;
    UPDATE organization_units SET name='研究生会' WHERE id=2;`);
  const actor = async id => {
    const user = { ...f.sql.prepare('SELECT * FROM users WHERE id=?').get(id) };
    const collegeAdmin = Boolean(f.sql.prepare('SELECT 1 FROM organization_admin_grants WHERE user_id=? AND organization_id=?').get(id, user.organization_id));
    const membership = f.sql.prepare('SELECT role FROM organization_unit_memberships WHERE unit_id=? AND user_id=? AND removed_at IS NULL').get(user.active_unit_id, id);
    const workspace = { enabled: true, userId: id, orgId: user.organization_id, userRole: user.role, collegeAdmin, unitId: user.active_unit_id, role: membership?.role,
      ownPhotosOnly: id !== 1 && user.view_organization_photos !== 1 };
    return { ...user, ...userAccessProfile(workspace, ['photos.view', 'projects.view', ...(id === 1 ? ['users.manage_roles'] : [])]),
      canManageUserAccess: id === 1, needsAssignment: !(await f.join.summary(id)).hasMembership, iamManaged: true,
      campusStudentNo: user.student_no, activeUnitId: user.active_unit_id, unitRole: membership?.role, collegeAdmin, workspaceEnabled: true };
  };
  const auth = (req, res, next) => {
    const id = Number(/^Bearer local-workspace-user-(\d+)$/.exec(req.get('authorization') || '')?.[1]);
    if (![1, 2, 3].includes(id)) return res.sendStatus(401);
    req.user = { id, organization_id: 2 }; next();
  };
  app.use((req, res, next) => {
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.get('host') || '')) return res.sendStatus(403);
    res.set('Cache-Control', 'no-store');
    if (req.path.startsWith('/api/')) stats.requests.push({ path: req.path, method: req.method });
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.get('/api/users/me', auth, async (req, res) => res.json(await actor(req.user.id)));
  const router = express.Router();
  registerWorkspaceJoin(router, { db: f.db, auth }); registerUserAccessAdmin(router, { db: f.db, auth });
  app.use('/api/users', router);
  app.get('/api/workspaces', auth, async (req, res) => {
    const me = await actor(req.user.id);
    const units = f.sql.prepare(`SELECT ou.id,ou.name,m.role FROM organization_units ou
      LEFT JOIN organization_unit_memberships m ON m.unit_id=ou.id AND m.user_id=? AND m.removed_at IS NULL
      WHERE ou.organization_id=2 AND ou.archived_at IS NULL AND (?=1 OR m.user_id IS NOT NULL)`).all(me.id, me.collegeAdmin ? 1 : 0);
    res.json({ enabled: true, activeUnitId: me.activeUnitId, collegeAdmin: me.collegeAdmin, units,
      access: me.access, shareTargets: [{ id: 1, name: '学工与融媒体' }, { id: 2, name: '研究生会' }] });
  });
  app.get('/api/projects/list', (_req, res) => res.json({ list: [], total: 0, hasMore: false }));
  app.get('/api/projects/import-status', (_req, res) => res.json({ statuses: {} }));
  app.get('/api/album-desktop', (req, res) => res.json({ albums: [], groups: [], sharedAlbums: [], sharedFolders: [],
    preferences: { pins: [], colors: {} }, scope: { userId: req.user?.id || 3, organizationId: 2, unitId: 1 }, workspaceRevision: 1, userRevision: 1 }));
  app.get('/api/network', (_req, res) => res.json({}));
  app.get('/__preview/state', (_req, res) => res.json({ ...stats,
    applications: f.sql.prepare('SELECT id,unit_id,user_id,status,review_revision FROM organization_join_requests').all() }));
  app.use('/api', (_req, res) => res.json([]));
  app.use(express.static(dist, { index: false }));
  app.use((req, res) => {
    if (req.method !== 'GET') return res.sendStatus(405);
    const id = roles.get(req.socket.localPort) || 2;
    let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    html = html.replace('<head>', `<head><script>localStorage.setItem('mamage_jwt_token','local-workspace-user-${id}');</script>`);
    res.type('html').send(html);
  });
  const servers = [];
  try {
    for (const [index, port] of ports.entries()) {
      const server = app.listen(port, '127.0.0.1');
      await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
      roles.set(server.address().port, [2, 3, 1][index]); servers.push(server);
    }
  } catch (error) { servers.forEach(server => server.close()); f.close(); throw error; }
  const urls = servers.map(server => `http://127.0.0.1:${server.address().port}`);
  return { ...f, actor, stats, urls, async close() {
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    f.close();
  } };
}

module.exports = { createPersonalPreview };
if (require.main === module) createPersonalPreview({ ports: [5205, 5206, 5207] }).then(preview => {
  console.log(JSON.stringify({ localOnly: true, student: preview.urls[0] + '/personal', manager: preview.urls[1] + '/account', superadmin: preview.urls[2] + '/account' }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await preview.close(); process.exit(0); });
}).catch(error => { console.error(error.message); process.exitCode = 1; });
