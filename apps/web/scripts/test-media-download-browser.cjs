const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright'), sharp = runtime('sharp');
const dist = process.env.MAMAGE_MEDIA_QA_DIST || path.resolve(__dirname, '../dist');

(async () => {
  const image = await sharp({ create: { width: 480, height: 320, channels: 3, background: '#83aca2' } }).jpeg().toBuffer();
  const payload = Buffer.alloc(131072, 9), requests = [];
  const storage = http.createServer((req, res) => {
    requests.push({ url: req.url, auth: !!req.headers.authorization });
    const mode = new URL(req.url, 'http://fixture').searchParams.get('mode');
    if (mode !== 'cors' && !(mode === 'preflight' && req.headers.range)) res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition,Content-Length');
    if (mode === 'working' || (mode === 'preflight' && !req.headers.range)) {
      res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Disposition': 'attachment; filename="direct.mp4"' });
      res.end(req.headers.range ? payload.subarray(0, 1) : payload);
    } else { res.writeHead(403, { 'Content-Type': 'application/xml' }); res.end('<Error><Code>AccessDenied</Code></Error>'); }
  });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname.startsWith('/api/image/')) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="fallback.mp4"' });
      res.end(payload); return;
    }
    const file = path.join(dist, url.pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => storage.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, storageBase = `http://127.0.0.1:${storage.address().port}`, browser = await chromium.launch();
  const results = [];
  try {
    const cases = process.env.MAMAGE_MEDIA_QA_RED ? [{ kind: 'single-video', width: 1440, mode: 'denied' }]
      : ['single-video', 'single-photo'].flatMap(kind => [1440, 390].map(width => ({ kind, width, mode: 'denied' })))
        .concat(['working', 'cors', 'refresh', 'preflight', 'eligibility'].map((mode, i) => ({ kind: 'single-video', width: i % 2 ? 390 : 1440, mode })));
    for (const { kind, width, mode } of cases) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, acceptDownloads: true });
      await context.addInitScript(() => {
        localStorage.setItem('mamage_jwt_token', 'isolated-download-fixture'); window.__downloadTargets = []; window.__downloadOrigins = [];
        document.addEventListener('click', event => { const a = event.target.closest?.('a'); if (a?.download) { window.__downloadTargets.push(a.target); window.__downloadOrigins.push(new URL(a.href).origin); } }, true);
      });
      const photos = [11].map((id, i) => ({
        id, projectId: 9001, type: kind === 'single-video' || (kind === 'mixed' && i === 0) ? 'video' : 'normal',
        url: `/api/image/original-${id}.${kind === 'single-video' || (kind === 'mixed' && i === 0) ? 'mp4' : 'jpg'}?ma=expired-fixture`,
        thumbUrl: '/api/image/thumb.jpg', title: '下载验收', photographerId: 7, aiStatus: 'done',
      }));
      const album = { id: 9001, name: '下载窗口验收', images: photos, unitId: 1, adminId: 7, count: photos.length };
      const actor = { id: 7, name: '下载验收', role: 'admin', activeUnitId: 1, permissions: ['photos.view', 'photos.zip', 'projects.view', 'upload.photo'] };
      const apiCalls = []; let eligibilityCalls = 0, signatureCalls = 0;
      await context.route('**/api/**', async route => {
        const req = route.request(), url = new URL(req.url()), p = url.pathname; apiCalls.push(p);
        if (p.startsWith('/api/image/')) {
          if (req.isNavigationRequest()) return route.continue();
          return route.fulfill({ contentType: 'image/jpeg', body: image });
        }
        let data = {};
        if (p === '/api/users/me') data = actor;
        else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 1, units: [{ id: 1, name: '下载测试小组', role: 'editor' }] };
        else if (p === '/api/projects/9001') data = album;
        else if (p === '/api/photos') data = { list: photos, total: photos.length, hasMore: false };
        else if (p === '/api/photos/direct-status') {
          if (mode === 'eligibility' && ++eligibilityCalls === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
          data = { eligible: true };
        }
        else if (/\/direct-url$/.test(p)) {
          signatureCalls++;
          const responseMode = mode === 'eligibility' || (mode === 'refresh' && signatureCalls > 1) ? 'working' : mode === 'refresh' ? 'denied' : mode;
          data = { url: `${storageBase}/original.mp4?mode=${responseMode}`, expiresIn: 60 };
        }
        else if (/^\/api\/photos\/\d+$/.test(p)) { const photo = photos.find(photo => String(photo.id) === p.split('/').pop()); data = { ...photo, url: photo.url.replace('expired-fixture', 'fresh-fixture') }; }
        else if (p === '/api/album-desktop') data = { albums: [album], groups: [], preferences: {}, scope: { userId: 7, organizationId: 2, unitId: 1 } };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      });
      const page = await context.newPage(), popups = [], downloads = [], errors = [];
      let settle;
      const settled = new Promise(resolve => { settle = resolve; });
      page.on('popup', popup => { popups.push(popup); settle(); });
      page.on('download', download => { downloads.push(download); if (downloads.length === photos.length) settle(); });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/?projectId=9001');
      await page.getByRole('navigation', { name: '相册底部操作' }).waitFor();
      await page.getByRole('button', { name: '选择', exact: true }).click();
      await page.getByRole('button', { name: '全选', exact: true }).click();
      await page.getByRole('button', { name: '直接下载', exact: true }).click();
      await page.getByRole('button', { name: '开始下载', exact: true }).click();
      await page.getByText(`已开始下载 ${photos.length} 张`, { exact: true }).waitFor();
      assert.ok((await page.evaluate(() => window.__downloadTargets)).every(target => target !== '_blank'), 'Downloads must not target a new storage error tab');
      let deadline;
      try { await Promise.race([settled, new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('Download did not start')), 5000); })]); }
      finally { clearTimeout(deadline); }
      assert.equal(popups.length, 0, 'Downloads must not open storage AccessDenied tabs');
      assert.equal(downloads.length, photos.length, 'Every original must reach the browser downloader');
      for (const download of downloads) { assert.equal(await download.failure(), null); assert.deepEqual(fs.readFileSync(await download.path()), payload); }
      assert.equal(page.url(), base + '/?projectId=9001'); assert.deepEqual(errors, []);
      assert.ok(requests.every(request => !request.auth), 'Never send website bearer credentials to storage');
      const expectsDirect = ['working', 'refresh', 'preflight', 'eligibility'].includes(mode);
      const origins = await page.evaluate(() => window.__downloadOrigins);
      assert.ok(origins.every(origin => origin === (expectsDirect ? storageBase : base)), 'Prefer storage for recoverable failures; proxy only when necessary');
      if (!expectsDirect) assert.ok(photos.every(photo => apiCalls.includes(`/api/photos/${photo.id}`)), 'Refresh fallback signatures instead of reusing expired page URLs');
      if (mode === 'refresh') assert.equal(signatureCalls, 2);
      results.push({ kind, width, mode, popups: popups.length, files: downloads.length, direct: expectsDirect, passed: true }); await context.close();
    }
    console.log(JSON.stringify(results));
  } finally {
    await browser.close(); server.closeAllConnections(); storage.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); await new Promise(resolve => storage.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
