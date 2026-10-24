const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright'), sharp = runtime('sharp');
const { attachVideoProcessingState } = runtime('./lib/video_processing_state');
const dist = process.env.MAMAGE_REFRESH_QA_DIST || path.resolve(__dirname, '../dist');
(async () => {
  const poster = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#71998e' } }).jpeg().toBuffer();
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch(), results = [];
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        let status = 'running';
        const rawRequests = [], errors = [];
        const db = { query: async () => [[{ dedupe_key: '11', status }]] };
        const photo = async () => (await attachVideoProcessingState([{ id: 11, projectId: 9001, type: 'video', unitId: 1, photographerId: 7,
          url: '/api/image/raw.mov', thumbUrl: '/api/image/poster.jpg', playbackUrl: status === 'done' ? '/api/image/ready.mp4' : null,
          title: '', originalFilename: '校园活动 原始相机文件_001.MOV', aiStatus: 'skipped' }], { db, enabled: true }))[0];
        await context.addInitScript(() => localStorage.setItem('mamage_jwt_token', 'isolated-refresh-fixture'));
        await context.route('**/api/**', async route => {
          const req = route.request(), pathname = new URL(req.url()).pathname;
          if (pathname === '/api/image/poster.jpg') return route.fulfill({ contentType: 'image/jpeg', body: poster });
          if (pathname === '/api/image/raw.mov') { rawRequests.push(pathname); return route.fulfill({ status: 404, body: '' }); }
          const current = await photo();
          let data = {};
          if (pathname === '/api/users/me') data = { id: 7, role: 'admin', activeUnitId: 1, metadataEditScope: 'own', permissions: ['projects.view', 'photos.view', 'photos.edit', 'photos.zip', 'upload.photo'] };
          else if (pathname === '/api/workspaces') data = { enabled: true, activeUnitId: 1, units: [{ id: 1, name: 'Test', role: 'manager' }] };
          else if (pathname === '/api/projects/9001') data = { id: 9001, name: '转码刷新回归', images: [current], count: 1, adminId: 7, unitId: 1 };
          else if (pathname === '/api/photos') data = { list: [current], total: 1 };
          else if (pathname === '/api/photos/11') data = current;
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/?projectId=9001');
        await page.getByRole('button', { name: '视频转码中', exact: true }).waitFor();
        await page.reload();
        await page.getByRole('button', { name: '视频转码中', exact: true }).waitFor();
        assert.equal(await page.locator('.detail-video-thumb').count(), 1);
        assert.deepEqual(rawRequests, [], 'Processing must not load the raw video as a poster');
        status = 'failed'; await page.reload();
        await page.getByText('处理失败', { exact: true }).waitFor();
        assert.equal(await page.locator('.detail-video-thumb').count(), 1, 'Failed processing remains visible');
        status = 'running'; await page.reload();
        await page.getByRole('button', { name: '视频转码中', exact: true }).waitFor();
        status = 'done';
        await page.getByRole('button', { name: '打开视频', exact: true }).waitFor({ timeout: 15000 });
        assert.equal(await page.locator('.detail-video-thumb').count(), 1, 'Finishing the job updates the same visible video without another refresh');
        await page.getByRole('button', { name: '打开视频', exact: true }).click();
        const info = page.getByRole('button', { name: '显示信息', exact: true }); if (await info.count()) await info.click();
        assert.equal(await page.locator('.viewer-sidebar-head strong').innerText(), '校园活动 原始相机文件_001.MOV');
        assert.deepEqual(errors, []);
        results.push({ width, visibleAfterRefresh: true, failedVisible: true, completesWithoutRefresh: true, originalFilenameVisible: true });
      } finally { await context.close(); }
    }
    console.log(JSON.stringify({ passed: true, results, storageWrites: 0 }));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
