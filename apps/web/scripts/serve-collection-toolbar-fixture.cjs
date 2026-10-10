// Isolated production-build fixture for browser testing. No production requests or writes.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../dist');
const albums = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, name: `测试相册 ${index + 1}`,
  title: `测试相册 ${index + 1}`, description: '原有描述', eventDate: '2026-10-01', image: '/fixture.svg', count: 12,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', year: '2026' }));
const state = { albums, scope: { userId: 999, organizationId: 2, unitId: 10 },
  groups: [{ id: 'campus', name: '校园活动', kind: 'manual', projectIds: [1, 2], rule: {}, symbol: 'image', layout: 'stack', color: '#515c67', tint: '#e6e9ec' },
    { id: 'other', name: '另一个相册集', kind: 'manual', projectIds: [1], rule: {}, symbol: 'grid', layout: 'stack', color: '#515c67', tint: '#e6e9ec' },
    { id: 'empty', name: '空相册集', kind: 'manual', projectIds: [], rule: {}, symbol: 'grid', layout: 'stack', color: '#515c67', tint: '#e6e9ec' },
    { id: 'smart', name: '智能相册集', kind: 'smart', projectIds: [], rule: { year: '2026' }, symbol: 'smart', layout: 'rule', color: '#515c67', tint: '#e6e9ec' }],
  preferences: { pins: [], recentItems: [], colors: {}, dismissed: [] }, workspaceRevision: 1, userRevision: 1, canOrganize: true };
const controls = { readOnly: false, failSave: false, failEdit: false, failCreate: false };
const calls = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const endpoint = url.pathname;
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const body = async () => { let value = ''; for await (const part of req) value += part; return value ? JSON.parse(value) : {}; };
  try {
    if (endpoint === '/__fixture/state') return send({ state, calls, controls });
    if (endpoint === '/__fixture/control' && req.method === 'POST') { Object.assign(controls, await body()); state.canOrganize = !controls.readOnly; return send({ ok: true }); }
    if (endpoint === '/api/users/login') return send({ token: 'isolated-collection-fixture-only' });
    if (endpoint === '/api/users/me') return send({ id: 999, name: '隔离测试', organizationName: '测试学院', role: controls.readOnly ? 'visitor' : 'superadmin',
      permissions: ['photos.view', ...(controls.readOnly ? [] : ['projects.create', 'projects.update', 'photos.upload'])] });
    if (endpoint === '/api/workspaces') return send({ enabled: true, activeUnitId: 10, units: [{ id: 10, name: '测试组织', role: controls.readOnly ? 'viewer' : 'admin' }] });
    if (endpoint === '/api/album-desktop') return send(state);
    if (endpoint === '/api/album-desktop/state' && req.method === 'PUT') {
      const data = await body(); calls.push({ endpoint, data, unit: req.headers['x-mamage-unit-id'] });
      if (controls.failSave) return send({ message: '模拟保存冲突' }, 409);
      if (data.groups && controls.readOnly) return send({ message: '无编辑权限' }, 403);
      if ((data.groups && data.workspaceRevision !== state.workspaceRevision) || (data.preferences && data.userRevision !== state.userRevision)) return send({ message: '版本冲突' }, 409);
      if (data.groups) { state.groups = data.groups; state.workspaceRevision++; }
      if (data.preferences) { state.preferences = data.preferences; state.userRevision++; }
      return send({ workspaceRevision: state.workspaceRevision, userRevision: state.userRevision });
    }
    if (endpoint === '/api/projects' && req.method === 'POST') {
      const data = await body(); calls.push({ endpoint, data, unit: req.headers['x-mamage-unit-id'] });
      if (controls.readOnly) return send({ message: '无创建权限' }, 403);
      if (controls.failCreate) return send({ message: '模拟创建失败' }, 500);
      const album = { ...data, name: data.projectName, title: data.projectName, description: data.description || '',
        id: Math.max(0, ...albums.map(a => a.id)) + 1, count: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), year: '2026', image: null };
      albums.push(album); return send({ ...album, projectName: album.name, photoCount: 0 });
    }
    const edit = endpoint.match(/^\/api\/projects\/(\d+)\/update$/);
    if (edit && req.method === 'POST') {
      const data = await body(); calls.push({ endpoint, data, unit: req.headers['x-mamage-unit-id'] });
      if (controls.readOnly) return send({ message: '无编辑权限' }, 403);
      if (controls.failEdit) return send({ message: '模拟编辑失败，请重试' }, 500);
      const album = albums.find(a => a.id === Number(edit[1]));
      Object.assign(album, data, { name: data.projectName, title: data.projectName }); return send(album);
    }
    if (endpoint === '/api/projects/list') return send({ list: albums.map(a => ({ ...a, projectName: a.name, photoCount: a.count, coverThumbUrl: a.image, previewImages: [{ thumbUrl: a.image }] })), total: albums.length, page: 1, pageSize: 24, hasMore: false });
    if (endpoint === '/api/projects/import-status') return send({ statuses: {} });
    if (/^\/api\/projects\/\d+$/.test(endpoint)) { const album = albums.find(a => a.id === Number(endpoint.split('/').pop())); return send({ ...album, projectName: album?.name, photos: [{ id: 901, thumbUrl: '/fixture.svg', url: '/fixture.svg', width: 1600, height: 1000 }], photoCount: 1 }); }
    if (endpoint === '/fixture.svg') { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#b6c8b9"/></svg>'); }
    if (endpoint.startsWith('/api/')) {
      if (req.method !== 'GET') { calls.push({ unexpected: true, endpoint, method: req.method }); return send({ message: 'Unexpected fixture write' }, 405); }
      return send(endpoint.includes('random') ? { list: [] } : {});
    }
    const file = path.resolve(root, `.${endpoint === '/' ? '/index.html' : endpoint}`);
    if (!file.startsWith(root + path.sep)) return send({}, 404);
    const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'index.html');
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' }); res.end(fs.readFileSync(target));
  } catch (error) { send({ message: error.message }, 500); }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/`, pid: process.pid, fixtureOnly: true })));
