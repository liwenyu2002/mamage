const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const serverRequire = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = serverRequire('playwright'), sharp = serverRequire('sharp');
const dist = process.env.MAMAGE_SHARE_QA_DIST || path.resolve(__dirname, '../dist');
const artifactDir = process.env.MAMAGE_SHARE_QA_DIR;
(async () => {
  if (artifactDir) fs.mkdirSync(artifactDir, { recursive: true });
  const image = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#789b8e' } }).jpeg().toBuffer();
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture.test').pathname);
    const target = file.startsWith(dist + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch();
  const results = [];
  try {
    for (const style of ['glass', 'classic']) for (const width of [1440, 390]) for (const mode of ['read', 'collaborate']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        await context.addInitScript(style => {
          localStorage.setItem('mamage_jwt_token', 'isolated-fixture');
          localStorage.setItem('mamage-folder-style:v1:67', style);
        }, style);
        const actor = { id: 67, role: 'admin', name: '共享验收', activeUnitId: 2, metadataEditScope: 'own',
          permissions: ['photos.view', 'projects.view', 'projects.update', 'photos.edit', 'upload.photo'] };
        let count = 2, revoked = false;
        const source = () => ({ id: 76, name: '共享原相册', projectName: '共享原相册', count,
          canEdit: mode === 'collaborate', unitId: 1, adminId: 44, shareMode: mode,
          originLabel: '学院 / 来源部门', image: '/api/image/fixture.jpg', createdAt: '2026-10-01',
          photos: Array.from({ length: count }, (_, index) => ({ id: index + 1, projectId: 76, title: `原片${index + 1}`,
            type: 'normal', url: '/api/image/fixture.jpg', thumbUrl: '/api/image/fixture.jpg',
            photographerId: 44, canEdit: mode === 'collaborate', tags: [], aiStatus: 'done' })) });
        const copy = { id: 81, name: '共享原相册（副本）', count: 1, groups: [], createdAt: '2026-09-01' };
        const errors = [], requests = [], writes = [];
        await context.route('**/api/**', async route => {
          const request = route.request(), p = new URL(request.url()).pathname;
          if (p.startsWith('/api/image/')) return route.fulfill({ contentType: 'image/jpeg', body: image });
          if (request.method() !== 'GET') writes.push(p);
          requests.push(p);
          let data = {};
          if (p === '/api/users/me') data = actor;
          else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 2, units: [{ id: 2, name: '接收部门', role: 'editor' }] };
          else if (p === '/api/album-desktop') data = { albums: [copy], sharedAlbums: revoked ? [] : [source()], groups: [],
            scope: { userId: 67, organizationId: 2, unitId: 2 }, preferences: { pins: [], recentItems: [], colors: {}, dismissed: [] },
            canOrganize: false, canDeleteFolders: false, workspaceRevision: 1, userRevision: 1 };
          else if (p === '/api/projects/list') data = { list: [copy], total: 1, hasMore: false };
          else if (p === '/api/projects') data = [copy];
          else if (p === '/api/projects/import-status') data = { statuses: {} };
          else if (p === '/api/projects/76') data = source();
          else if (/^\/api\/photos\/\d+$/.test(p)) data = source().photos.find(photo => photo.id === Number(p.split('/').at(-1))) || {};
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        const shared = page.getByRole('region', { name: '与我共享', exact: true });
        await shared.waitFor();
        assert.equal(await shared.getByRole('button').count(), 1);
        const text = await shared.innerText();
        assert.ok(text.includes('学院 / 来源部门')); assert.ok(text.includes(mode === 'read' ? '只读' : '共同编辑'));
        assert.ok(text.includes('2 张')); assert.ok(!text.includes('副本'));
        const cover = shared.locator('img'); await cover.evaluate(img => img.decode());
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        if (artifactDir) await page.screenshot({ path: path.join(artifactDir, `${style}-${width}-${mode}.png`) });
        await shared.getByRole('button', { name: '打开共享相册 共享原相册' }).click();
        await page.waitForFunction(() => document.querySelectorAll('.detail-photo-item').length === 2);
        assert.equal(new URL(page.url()).searchParams.get('projectId'), '76');
        assert.ok(!requests.includes('/api/projects/81'));
        count = 3;
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.getByText('3 张 · ' + (mode === 'read' ? '只读' : '共同编辑') + ' · 实时共享', { exact: true }).waitFor();
        await page.getByRole('button', { name: '打开共享相册 共享原相册' }).click();
        await page.waitForFunction(() => document.querySelectorAll('.detail-photo-item').length === 3);
        assert.equal(copy.count, 1);
        revoked = true;
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.locator('.album-desktop').waitFor();
        assert.equal(await page.getByRole('region', { name: '与我共享', exact: true }).count(), 0);
        assert.deepEqual(writes, []); assert.deepEqual(errors, []);
        results.push({ style, width, mode, sourceOpens: true, newPhotosVisible: true, copyUnchanged: true, revokedHidden: true, noWrites: true });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  console.log(JSON.stringify({ passed: true, cases: results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
