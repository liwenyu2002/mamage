const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright'), sharp = runtime('sharp');
const dist = process.env.MAMAGE_VIDEO_QA_DIST || path.resolve(__dirname, '../dist');
const artifacts = process.env.MAMAGE_VIDEO_QA_DIR;

(async () => {
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const image = await sharp({ create: { width: 480, height: 320, channels: 3, background: '#83aca2' } }).jpeg().toBuffer();
  const zipBytes = Buffer.from('PK-fixture-download'), downloads = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/api/photos/zip') {
      const ticket = url.searchParams.get('ticket');
      downloads.set(ticket, (downloads.get(ticket) || 0) + 1);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="videos.zip"' });
      res.end(zipBytes); return;
    }
    const file = path.join(dist, url.pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch();
  const results = [];
  try {
    for (const mode of ['folder', 'zip', 'album-mixed', 'album-photos', 'transfer-video', 'transfer-mixed', 'transfer-photos']) for (const width of [1440, 390]) {
      console.log(JSON.stringify({ testing: mode, width }));
      const context = await browser.newContext({ viewport: { width, height: 960 }, acceptDownloads: true });
      await context.addInitScript(mode => {
        localStorage.setItem('mamage_jwt_token', 'isolated-video-fixture');
        window.__videoTest = { picker: 0, active: 0, max: 0, saved: [] };
        if (mode !== 'folder') Object.defineProperty(window, 'isSecureContext', { value: false });
        else window.showDirectoryPicker = async () => {
          window.__videoTest.picker++;
          return { getDirectoryHandle: async () => ({
            getFileHandle: async name => ({ createWritable: async () => {
              window.__videoTest.active++; window.__videoTest.max = Math.max(window.__videoTest.max, window.__videoTest.active);
              let size = 0;
              return { write: async value => { size += value.byteLength; await new Promise(resolve => setTimeout(resolve, 15)); },
                close: async () => { window.__videoTest.saved.push({ name, size }); window.__videoTest.active--; },
                abort: async () => { window.__videoTest.active--; } };
            } }), removeEntry: async () => {},
          }) };
        };
      }, mode);
      const isPhoto = id => mode.endsWith('-photos') || (mode.endsWith('-mixed') && id === 11);
      const photos = [11, 12, 13, 14, 15].map(id => ({ id, projectId: 9001, type: isPhoto(id) ? 'normal' : 'video', mediaType: isPhoto(id) ? 'image' : 'video',
        url: `/api/image/original.${isPhoto(id) ? 'jpg' : 'mp4'}`, thumbUrl: '/api/image/thumb.jpg', title: '活动现场', photographerId: 7, aiStatus: 'done' }));
      const album = { id: 9001, name: '批量视频验收', images: photos, unitId: 1, adminId: 7, count: photos.length };
      const actor = { id: 7, name: '下载验收', role: 'admin', activeUnitId: 1, permissions: ['photos.view', 'photos.zip', 'projects.view', 'upload.photo'] };
      if (mode.startsWith('transfer-')) await context.addInitScript(photos => localStorage.setItem('photo-transfer-selection', JSON.stringify(photos)), photos);
      const calls = [], errors = [];
      await context.route('**/api/**', async route => {
        const req = route.request(), p = new URL(req.url()).pathname; calls.push({ p, method: req.method() });
        if (p.startsWith('/api/image/')) return route.fulfill({ contentType: 'image/jpeg', body: image });
        if (p.startsWith('/api/video-test/')) return route.fulfill({ contentType: 'video/mp4', headers: { 'Content-Length': '131072' }, body: Buffer.alloc(131072, 3) });
        if (p === '/api/photos/zip') return route.continue();
        let data = {};
        if (p === '/api/users/me') data = actor;
        else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 1, units: [{ id: 1, name: '下载测试小组', role: 'editor' }] };
        else if (p === '/api/projects/9001') data = album;
        else if (p === '/api/photos') data = { list: photos, total: photos.length, hasMore: false };
        else if (['/api/photos/video-downloads/manifest', '/api/photos/video-downloads/summary'].includes(p)) data = {
          items: req.postDataJSON().photoIds.map(id => ({ id, name: `活动现场_${id}.mp4`, size: 2 * 1024 ** 3 })),
          totalBytes: 10 * 1024 ** 3, unknownSizeCount: 0, mediaCounts: { videos: photos.filter(p => p.type === 'video').length, photos: photos.filter(p => p.type !== 'video').length }, zipName: '校园活动_2026-10-18.zip' };
        else if (p === '/api/photos/video-downloads/source') { const id = req.postDataJSON().photoId; data = { id, url: `/api/video-test/${id}`, fallbackUrl: `/api/video-test/${id}` }; }
        else if (p === '/api/photos/zip-ticket') {
          assert.equal(req.postDataJSON().videoOnly, !mode.endsWith('-mixed') && !mode.endsWith('-photos'));
          assert.deepEqual(req.postDataJSON().photoIds.map(Number), photos.map(photo => photo.id));
          data = { ticket: `fixture-${mode}-${width}` };
        }
        else if (p === '/api/album-desktop') data = { albums: [album], groups: [], preferences: {}, scope: { userId: 7, organizationId: 2, unitId: 1 } };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/?projectId=9001');
      await page.getByRole('navigation', { name: '相册底部操作' }).waitFor();
      const popups = []; page.on('popup', popup => popups.push(popup));
      const download = mode !== 'folder' ? page.waitForEvent('download') : null;
      if (download) download.catch(() => {});
      if (mode.startsWith('transfer-')) {
        if (width < 900) { await page.getByRole('button', { name: '中转站菜单', exact: true }).click(); await page.getByRole('button', { name: '打包', exact: true }).click(); }
        else { await page.getByTitle('中转站', { exact: true }).click(); await page.getByTitle('打包下载', { exact: true }).click(); }
      } else {
        await page.getByRole('button', { name: '选择', exact: true }).click();
        await page.getByRole('button', { name: '全选', exact: true }).click();
        await page.getByRole('button', { name: '直接下载', exact: true }).click();
      }
      if (mode === 'folder') {
        await page.getByText('视频已保存', { exact: true }).waitFor();
        const saved = await page.evaluate(() => window.__videoTest);
        assert.equal(saved.saved.length, 5); assert.equal(saved.max, 2); assert.equal(saved.picker, 1);
        assert.ok(saved.saved.every(file => file.size === 131072));
        assert.equal(calls.filter(c => c.p === '/api/photos/zip-ticket').length, 0);
      } else {
        const file = await download; assert.equal(await file.failure(), null);
        await page.getByText('已交给浏览器下载', { exact: true }).waitFor();
        assert.equal(calls.filter(c => c.p === '/api/photos/zip-ticket').length, 1);
        // Native browser downloads may bypass Playwright routing; assert actual server traffic and bytes.
        assert.equal(downloads.get(`fixture-${mode}-${width}`), 1);
        assert.deepEqual(fs.readFileSync(await file.path()), zipBytes);
        assert.equal(calls.filter(c => c.p === '/api/photos/zip-direct' && c.method === 'POST').length, 0);
      }
      await page.getByText('约 10.0 GB', { exact: true }).waitFor();
      assert.equal(popups.length, 0);
      if (mode === 'transfer-mixed') {
        await page.getByText('校园活动_2026-10-18.zip', { exact: true }).waitFor();
        assert.equal(calls.filter(c => c.p === '/api/photos/zip-direct' && c.method === 'POST').length, 0);
      }
      const bounds = await page.locator('.video-download').boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height < 960);
      if (width < 900) {
        const trigger = await page.getByRole('button', { name: '中转站菜单', exact: true }).boundingBox();
        assert.ok(bounds.y + bounds.height < trigger.y, `Download details must not overlap the transfer button: ${JSON.stringify({ bounds, trigger })}`);
      }
      for (const icon of await page.locator('.video-download header svg').all()) {
        const box = await icon.boundingBox(); assert.ok(box && box.width <= 20 && box.height <= 20, 'Download icons must stay compact');
      }
      assert.deepEqual(errors, []);
      if (artifacts) await page.screenshot({ path: path.join(artifacts, `${mode}-${width}.png`), animations: 'disabled' });
      results.push({ mode, width, passed: true, requests: calls.filter(c => /video-downloads|zip/.test(c.p)) });
      await context.close();
    }
    console.log(JSON.stringify(results));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
