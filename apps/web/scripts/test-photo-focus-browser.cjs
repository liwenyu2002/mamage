const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright'), sharp = runtime('sharp');
const dist = process.env.MAMAGE_FOCUS_QA_DIST || path.resolve(__dirname, '../dist');
const artifacts = process.env.MAMAGE_FOCUS_QA_DIR;
(async () => {
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#759b91' } })
    .composite([{ input: { create: { width: 640, height: 70, channels: 3, background: '#d7b86c' } }, top: 0, left: 0 }]).jpeg().toBuffer();
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port, browser = await chromium.launch(), cases = [];
  try {
    for (const width of [1440, 390]) for (const timeline of [false, true]) {
      const reducedMotion = width === 390 ? 'reduce' : 'no-preference';
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion });
      try {
        const errors = [], writes = [], targetId = 2180;
        const photo = { id: 1001, projectId: 9001, type: 'normal', url: '/api/image/source.jpg', thumbUrl: '/api/image/source.jpg',
          title: '人物入口照片', width: 640, height: 480, unitId: 1, photographerId: 7, aiStatus: 'done',
          faces: [{ faceId: 11, personId: 22, personName: '测试人物', photoId: 1001, bbox: { x: .2, y: .2, w: .3, h: .3 }, normalized: true }] };
        const photos = Array.from({ length: 220 }, (_, index) => ({ id: 2000 + index, projectId: 9002, type: 'normal',
          url: `/api/image/${index}.jpg`, thumbUrl: `/api/image/${index}.jpg`, title: '照片 ' + index,
          width: 640, height: 480, unitId: 1, photographerId: 8, aiStatus: index < 3 ? 'pending' : 'done', timelineSectionId: timeline ? (index < 100 ? 1 : 2) : null }));
        const source = { id: 9001, name: '人物入口', images: [photo], count: 1, adminId: 7, unitId: 1 };
        const album = { id: 9002, name: '目标相册', images: photos, count: photos.length, adminId: 7, unitId: 1,
          timelineEnabled: timeline, timelineSections: timeline ? [{ id: 1, name: '开场', sortOrder: 0 }, { id: 2, name: '交流', sortOrder: 1 }] : [] };
        await context.addInitScript(() => { try { localStorage.setItem('mamage_jwt_token', 'isolated-photo-focus-fixture'); } catch {} });
        await context.route('**/api/**', async route => {
          const req = route.request(), url = new URL(req.url()), p = url.pathname;
          if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { writes.push(p); return route.abort(); }
          if (p.startsWith('/api/image/')) return route.fulfill({ contentType: 'image/jpeg', body: jpeg });
          let data = {};
          if (p === '/api/users/me') data = { id: 7, role: 'admin', name: '验收', activeUnitId: 1, canFaceSearch: true,
            permissions: ['projects.view', 'photos.view', 'photos.edit', 'photos.zip', 'upload.photo', 'tags.edit'] };
          else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 1, units: [{ id: 1, name: '测试', role: 'manager' }] };
          else if (p === '/api/projects/9001') data = source;
          else if (p === '/api/projects/9002') { await new Promise(resolve => setTimeout(resolve, 120)); data = album; }
          else if (p === '/api/photos/1001/faces') data = { faces: photo.faces };
          else if (p === '/api/faces/11/person') data = { personId: 22, name: '测试人物', total: 1, photos: [{ ...photos[180], projectName: album.name }] };
          else if (p === '/api/photos/1001') data = photo;
          else if (/^\/api\/photos\/\d+$/.test(p)) data = photos.find(photo => String(photo.id) === p.split('/').pop()) || {};
          else if (p === '/api/photos') data = { list: photos, total: photos.length };
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/?projectId=9001&photoId=1001');
        await page.locator('.viewer-overlay.is-open').waitFor();
        await page.getByTitle('显示人脸框', { exact: true }).click();
        await page.locator('.viewer-face-box').click();
        await page.locator('.person-sheet-album-link').waitFor();
        const opened = context.waitForEvent('page');
        await page.getByTitle('跳转相册', { exact: true }).click();
        const targetPage = await opened; targetPage.on('pageerror', error => errors.push(error.message));
        await targetPage.waitForURL('**/*focusPhotoId=2180');
        const card = targetPage.locator(`[data-photo-id="${targetId}"]`);
        await targetPage.locator(`[data-photo-id="${targetId}"].is-photo-focused`).waitFor();
        await targetPage.waitForFunction(id => {
          const card = document.querySelector(`[data-photo-id="${id}"]`), r = card?.getBoundingClientRect();
          return r && r.top >= 60 && r.bottom <= innerHeight - 35;
        }, targetId);
        assert.equal(await targetPage.locator('.viewer-overlay').count(), 0, 'Album navigation locates the card, not an obscuring viewer');
        assert.ok(await targetPage.evaluate(() => scrollY > 500), 'A photo beyond the first render page is actually scrolled into view');
        assert.ok(await targetPage.locator('.detail-photo-item[data-photo-id]').count() > 96);
        const flash = await card.evaluate(el => getComputedStyle(el, '::after').animationName);
        assert.equal(flash, reducedMotion === 'reduce' ? 'none' : 'detail-photo-focus-pulse');
        assert.equal(await targetPage.locator('.is-photo-focused').count(), 1);
        if (artifacts) await targetPage.screenshot({ path: path.join(artifacts, `focused-${width}-${timeline}.png`), animations: 'allow' });
        if (width === 1440 && !timeline) {
          await targetPage.waitForTimeout(1700);
          await targetPage.setViewportSize({ width: 2200, height: 900 });
          assert.match(await card.getAttribute('class'), /is-photo-focused/, 'Masonry remounts must retain the active highlight');
          await targetPage.setViewportSize({ width, height: 900 });
        }
        await targetPage.waitForFunction(() => !new URL(location.href).searchParams.has('focusPhotoId'), null, { timeout: 6000 });
        assert.equal(await targetPage.locator('.is-photo-focused').count(), 0, 'The highlight finishes instead of flashing forever');
        if (width === 1440 && !timeline) {
          await page.locator('.person-sheet-thumb-btn').click();
          await page.waitForFunction(() => new URL(location.href).searchParams.get('projectId') === '9002'
            && document.querySelector('.viewer-topbar-title')?.textContent === '照片 180');
          assert.equal(await page.locator('.is-photo-focused').count(), 0, 'Keep the locate request pending while its preview is open');
          await page.locator('.viewer-topbar-close').click();
          await page.locator('[data-photo-id="2180"].is-photo-focused').waitFor();
          await page.waitForFunction(() => {
            const r = document.querySelector('[data-photo-id="2180"]')?.getBoundingClientRect();
            return r && r.top >= 60 && r.bottom < innerHeight - 35;
          });
          await page.waitForFunction(() => !new URL(location.href).searchParams.has('focusPhotoId'), null, { timeout: 6000 });
        }
        await targetPage.goto(base + '/?projectId=9002&focusPhotoId=99999');
        await targetPage.getByText('这张照片不在当前可见相册中', { exact: true }).waitFor();
        assert.equal(await targetPage.locator('.is-photo-focused').count(), 0, 'A missing/inaccessible target never highlights another photo');
        assert.deepEqual(errors, []); assert.deepEqual(writes, []);
        cases.push({ width, timeline, personAlbumLink: true, beyondFirstPage: true, centered: true, wholeCardHighlight: true,
          reducedMotionRespected: true, consumesOnce: true, missingTargetSafe: true, writes: 0 });
      } finally { await context.close(); }
    }
    if (artifacts) fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ passed: true, cases }, null, 2));
    console.log(JSON.stringify({ passed: true, cases }));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
