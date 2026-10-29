const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../../server/package.json'))('playwright');
const dist = path.resolve(__dirname, '../dist'), artifacts = process.env.MAMAGE_USER_NAME_QA_DIR;

async function main() {
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer((req, res) => {
    const requested = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const file = requested.startsWith(dist + '/') && fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested : path.join(dist, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch(), base = `http://127.0.0.1:${server.address().port}`, cases = [];
  try {
    for (const width of [320, 390, 1024, 1100, 1440]) for (const name of ['李文宇', '欧阳思远', 'Alexandria Montgomery']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const errors = [], writes = [];
      try {
        await context.addInitScript(() => localStorage.setItem('mamage_jwt_token', 'isolated-user-name-fixture'));
        await context.route('**/api/**', route => {
          const req = route.request(), p = new URL(req.url()).pathname, send = json => route.fulfill({ json });
          if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { writes.push(p); return route.abort(); }
          if (p === '/api/users/me') return send({ id: 7, name, displayName: 'Nickname', email: 'student@example.invalid', role: 'admin',
            permissions: ['projects.view', 'projects.create', 'photos.view'], workspaceEnabled: true, activeUnitId: 1 });
          if (p === '/api/workspaces') return send({ enabled: true, activeUnitId: 1, units: [{ id: 1, name: '学工与融媒体中心', role: 'manager' }] });
          if (p === '/api/album-desktop') return send({ albums: [], groups: [], sharedAlbums: [], sharedFolders: [], preferences: { pins: [], colors: {} },
            scope: { userId: 7, organizationId: 2, unitId: 1 }, workspaceRevision: 1, userRevision: 1 });
          if (p === '/api/projects/list') return send({ list: [], total: 0, hasMore: false });
          if (p === '/api/projects/import-status') return send({ statuses: {} });
          if (p === '/api/projects/84') return send({ id: 84, name: '测试相册', photos: [], timelineSections: [], permissions: {} });
          return send([]);
        });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        for (const route of ['/', '/?projectId=84']) {
          await page.goto(base + route);
          const label = page.locator('.mamage-user-name'); await label.waitFor();
          assert.equal(await label.innerText(), name);
          assert.equal(await page.locator('.mamage-avatar').count(), 0);
          const geometry = await label.evaluate(el => {
            const rect = el.getBoundingClientRect(), chip = el.closest('summary').getBoundingClientRect();
            const input = document.querySelector('.mamage-nav-search-input').getBoundingClientRect();
            return { textFits: el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1,
              withinChip: rect.left >= chip.left && rect.right <= chip.right + 1,
              separated: input.right <= chip.left + 1, viewportFits: document.documentElement.scrollWidth <= innerWidth + 1 };
          });
          assert.deepEqual(geometry, { textFits: true, withinChip: true, separated: true, viewportFits: true }, `${width} ${name} ${route}`);
          await page.locator('.mamage-user-chip').focus(); await page.locator('.mamage-user-chip').press('Enter');
          assert.equal(await page.locator('.mamage-user-chip').evaluate(el => getComputedStyle(el).outlineColor), 'rgba(0, 0, 0, 0.24)');
          await page.getByRole('button', { name: '账户信息', exact: true }).waitFor();
          await page.locator('.mamage-user-chip').press('Enter');
          await page.locator('.mamage-user-chip').evaluate(el => el.blur());
          if (artifacts) await page.screenshot({ path: path.join(artifacts, `header-${width}-${name.length}-${route === '/' ? 'home' : 'album'}.png`) });
          cases.push({ width, name, route });
        }
        assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      } finally { await context.close(); }
    }
    console.log(JSON.stringify({ passed: true, cases: cases.length }));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
