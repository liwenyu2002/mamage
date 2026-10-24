const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright'), sharp = runtime('sharp');
const dist = process.env.MAMAGE_IMPORT_QA_DIST || path.resolve(__dirname, '../dist');
const artifacts = process.env.MAMAGE_IMPORT_QA_DIR;
const html = '<html><head><title>502 Bad Gateway</title></head><body>nginx/1.28.2</body></html>';

(async () => {
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const image = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#769888' } }).jpeg().toBuffer();
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch(), cases = [];
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const state = { list: 'failure', active: false, jobFailure: false, updatesFailure: false, listReads: 0, jobReads: 0, writes: [] };
      const errors = [];
      try {
        await context.addInitScript(() => {
          localStorage.setItem('mamage_jwt_token', 'isolated-import-recovery-fixture');
          const interval = window.setInterval.bind(window), timeout = window.setTimeout.bind(window);
          window.setInterval = (fn, ms, ...args) => interval(fn, ms === 15000 ? 150 : ms, ...args);
          window.setTimeout = (fn, ms, ...args) => timeout(fn, [2500, 6000, 10000].includes(ms) ? 150 : ms, ...args);
        });
        await context.route('**/api/**', async route => {
          const req = route.request(), p = new URL(req.url()).pathname;
          if (p.startsWith('/api/image/')) return route.fulfill({ contentType: 'image/jpeg', body: image });
          if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
            state.writes.push(p);
            if (p === '/api/external-imports/jobs/100/resume') return route.fulfill({ status: 403, json: { error: '没有继续转存权限' } });
            // Existing rendered analytics are unrelated to the test.
            if (/\/rendered$/.test(p)) return route.fulfill({ json: { ok: true } });
            return route.abort();
          }
          let data = {};
          const photo = { id: 1001, projectId: 76, type: 'normal', url: '/api/image/fixture.jpg', thumbUrl: '/api/image/fixture.jpg', title: '已上传照片', aiStatus: 'done' };
          if (p === '/api/users/me') data = { id: 7, role: 'admin', activeUnitId: 1, metadataEditScope: 'unit', permissions: ['projects.view', 'photos.view', 'upload.photo'] };
          else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 1, units: [{ id: 1, name: '验收部门', role: 'manager' }] };
          else if (p === '/api/projects/76') data = { id: 76, name: '网关恢复验收', images: [photo], photos: [photo], count: 1, adminId: 7, unitId: 1 };
          else if (p === '/api/photos') data = { list: [photo], total: 1 };
          else if (p === '/api/external-imports/jobs') {
            state.listReads++;
            if (state.list === 'failure') return route.fulfill({ status: 502, contentType: 'text/html', body: html });
            data = { sources: [], jobs: state.active ? [{ id: 100, status: 'completed_with_errors' }] : [] };
          } else if (p === '/api/external-imports/jobs/100') {
            state.jobReads++;
            if (state.jobFailure) return route.fulfill({ status: 503, contentType: 'text/html', body: html });
            data = { id: 100, projectId: 76, status: 'completed_with_errors', discoveredCount: 10, counts: { done: 9, failed: 1 }, canControl: true };
          } else if (p === '/api/external-imports/jobs/100/updates') {
            if (state.updatesFailure) return route.fulfill({ status: 504, contentType: 'text/html', body: html });
            data = { photos: [], sections: [], hasMore: false };
          }
          return route.fulfill({ json: data });
        });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/?projectId=76');
        const photos = page.locator('.detail-photo-item'), alert = page.locator('.external-import-status-error');
        await photos.first().waitFor(); await alert.waitFor();
        if (artifacts) await page.screenshot({ path: path.join(artifacts, `unavailable-${width}.png`) });
        assert.doesNotMatch(await alert.innerText(), /<html|nginx|Bad Gateway/);
        assert.match(await alert.innerText(), /自动重试/);
        const before = state.listReads; state.list = 'success';
        await alert.waitFor({ state: 'detached', timeout: 6000 });
        assert.ok(state.listReads > before); assert.equal(await photos.count(), 1);
        state.active = true;
        const banner = page.locator('.external-import-banner'); await banner.waitFor();
        state.jobFailure = true; await alert.waitFor();
        assert.equal(await photos.count(), 1); assert.equal(await banner.count(), 1);
        state.jobFailure = false; await alert.waitFor({ state: 'detached', timeout: 6000 });
        state.updatesFailure = true; await alert.waitFor();
        // Successful list polls must not clear a still-failing job updates request.
        await page.waitForTimeout(350); assert.equal(await alert.count(), 1);
        state.updatesFailure = false; await alert.waitFor({ state: 'detached', timeout: 6000 });
        await page.getByRole('button', { name: '继续转存', exact: true }).click();
        await page.getByText('没有继续转存权限', { exact: true }).waitFor();
        const readCount = state.jobReads;
        await page.waitForFunction(() => document.querySelector('.external-import-banner') !== null);
        await page.waitForTimeout(350);
        assert.ok(state.jobReads > readCount);
        assert.equal(await alert.innerText(), '没有继续转存权限', 'Background success must not erase a failed user action');
        assert.equal(state.writes.filter(p => p.endsWith('/resume')).length, 1, 'Never retry a control action');
        assert.ok(state.writes.every(p => p.endsWith('/resume') || /\/rendered$/.test(p)));
        assert.equal(await photos.count(), 1); assert.deepEqual(errors, []);
        if (artifacts) await page.screenshot({ path: path.join(artifacts, `recovered-${width}.png`) });
        cases.push({ width, noHtml: true, listRecovery: true, jobRecovery: true, updatesRecovery: true, actionErrorRetained: true, photosRetained: true });
      } finally { await context.close(); }
    }
    if (artifacts) fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ passed: true, cases }, null, 2));
    console.log(JSON.stringify({ passed: true, cases }));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
