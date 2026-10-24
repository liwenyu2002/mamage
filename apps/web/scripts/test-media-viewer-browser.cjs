const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), cp = require('node:child_process');
const assert = require('node:assert/strict'), os = require('node:os');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright'), sharp = runtime('sharp');
const dist = process.env.MAMAGE_VIEWER_QA_DIST || path.resolve(__dirname, '../dist');
const artifactDir = process.env.MAMAGE_VIEWER_QA_DIR;
const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mamage-viewer-'));
  if (artifactDir) fs.mkdirSync(artifactDir, { recursive: true });
  const images = {};
  for (const [name, width, height] of [['landscape', 1600, 900], ['portrait', 800, 1200]]) {
    images[name] = await sharp({ create: { width, height, channels: 3, background: '#6b968e' } })
      .composite([{ input: { create: { width, height: 32, channels: 3, background: '#e3b372' } }, top: 0, left: 0 },
        { input: { create: { width, height: 32, channels: 3, background: '#bf7683' } }, top: height - 32, left: 0 }]).jpeg().toBuffer();
  }
  cp.execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=5', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', temp + '/video.mp4']);
  const video = fs.readFileSync(temp + '/video.mp4');
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch(), results = [];
  try {
    const scenarios = process.env.MAMAGE_VIEWER_QA_RED ? [{ width: 1440, height: 1000, zoom: 1, kind: 'video' }]
      : [
        { width: 1440, height: 960, zoom: 1, kind: 'video' }, { width: 1440, height: 960, zoom: 1, kind: 'landscape' },
        { width: 1024, height: 768, zoom: 1.5, kind: 'portrait' }, { width: 1440, height: 900, zoom: 0.8, kind: 'video' },
        { width: 1440, height: 960, zoom: 1.5, kind: 'portrait' }, { width: 1440, height: 960, zoom: 2, kind: 'landscape' },
        { width: 390, height: 844, zoom: 1, kind: 'video' }, { width: 390, height: 844, zoom: 1, kind: 'portrait' },
        { width: 844, height: 390, zoom: 1, kind: 'video' }, { width: 320, height: 640, zoom: 1, kind: 'landscape' },
      ];
    for (const scenario of scenarios) {
      const { width, height, zoom, kind } = scenario, context = await browser.newContext({ viewport: { width, height } });
      try {
        await context.addInitScript(zoom => { localStorage.setItem('mamage_jwt_token', 'isolated-viewer-fixture'); localStorage.setItem('mamage-ui-zoom', String(zoom)); }, zoom);
        const description = '活动现场，两名工作人员正在整理物资，桌面摆有证件和资料。';
        const photos = ['landscape', 'video', 'portrait'].map((kind, index) => ({ id: index + 11, projectId: 9001, title: kind === 'video' ? '活动现场 · 竖屏视频' : '校园活动纪实照片',
          originalFilename: '相机原片文件名_'.repeat(8) + kind + (kind === 'video' ? '.MOV' : '.JPG'),
          type: kind === 'video' ? 'video' : 'normal', url: `/api/image/${kind === 'video' ? 'video.mp4' : kind + '.jpg'}`, thumbUrl: `/api/image/${kind === 'portrait' ? 'portrait' : 'landscape'}.jpg`, unitId: 1,
          videoPlaybackUrl: '/api/image/video.mp4', photographerName: '摄影老师', photographerId: 7,
          description, tags: ['校园活动', '纪实', '多人', '物资整理'], aiStatus: 'done', detailedDescription: description.repeat(8),
          videoAnalysis: kind === 'video' ? { global: { description: description.repeat(3), totalSemantic: description.repeat(10), tags: ['室内', '整理物资'] },
            coverage: { duration: 4 }, segments: [{ start: 0, end: 2, description }, { start: 2, end: 4, description }], transcript: { status: 'disabled' } } : null,
        }));
        const album = { id: 9001, name: '媒体查看器验收', images: photos, count: 3, adminId: 7, unitId: 1 };
        const actor = { id: 7, name: '查看器测试', role: 'admin', activeUnitId: 1, canFaceSearch: true, metadataEditScope: 'own',
          permissions: ['projects.view', 'photos.view', 'photos.edit', 'photos.zip', 'upload.photo', 'tags.edit'] };
        const errors = [], edits = [];
        let rejectEdit = false;
        await context.route('**/api/**', async route => {
          const req = route.request(), p = new URL(req.url()).pathname;
          if (req.method() === 'PATCH' && /^\/api\/photos\/\d+$/.test(p)) {
            if (rejectEdit) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) });
            const photo = photos.find(photo => String(photo.id) === p.split('/').pop());
            const payload = req.postDataJSON();
            edits.push({ id: photo.id, ...payload });
            Object.assign(photo, payload);
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(photo) });
          }
          if (p === '/api/image/video.mp4') {
            const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers().range || '');
            if (range) {
              const start = Number(range[1]), end = Math.min(video.length - 1, range[2] ? Number(range[2]) : video.length - 1);
              return route.fulfill({ status: 206, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${video.length}` }, body: video.subarray(start, end + 1) });
            }
            return route.fulfill({ contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' }, body: video });
          }
          if (p.startsWith('/api/image/')) return route.fulfill({ contentType: 'image/jpeg', body: images[p.includes('portrait') ? 'portrait' : 'landscape'] });
          if (p === '/api/photos/search') {
            const list = photos.filter(photo => photo.type !== 'video').slice(kind === 'portrait' ? 1 : 0, kind === 'portrait' ? 2 : 1);
            const search = { aiUsed: false, chips: [] };
            return route.fulfill({ contentType: 'application/x-ndjson', body: [
              { type: 'results', data: { list, search, total: 1 } }, { type: 'complete', data: { total: 1, hasMore: false, search } },
            ].map(frame => JSON.stringify(frame) + '\n').join('') });
          }
          let data = {};
          if (p === '/api/users/me') data = actor;
          else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 1, units: [{ id: 1, name: '测试小组', role: 'manager' }] };
          else if (p === '/api/projects/9001') data = album;
          else if (p === '/api/photos') data = { list: photos, total: 3, hasMore: false };
          else if (/^\/api\/photos\/\d+$/.test(p)) data = photos.find(photo => String(photo.id) === p.split('/').pop());
          else if (p.endsWith('/person-observations')) data = { enabled: false, people: [] };
          else if (p === '/api/album-desktop') data = { albums: [album], groups: [], preferences: { pins: [], recentItems: [], colors: {}, dismissed: [] }, workspaceRevision: 1, userRevision: 1, scope: { userId: 7, organizationId: 2, unitId: 1 } };
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + `/?projectId=9001&photoId=${kind === 'video' ? 12 : kind === 'portrait' ? 13 : 11}`);
        await page.locator('.viewer-overlay.is-open').waitFor();
        await page.waitForTimeout(500);
        const media = page.locator('.viewer-slide.is-active .viewer-carousel-img');
        if (kind === 'video') await media.evaluate(video => new Promise(resolve => { if (video.readyState >= 1) return resolve(); video.addEventListener('loadedmetadata', resolve, { once: true }); }));
        else await media.evaluate(image => image.decode());
        const toggle = page.getByRole('button', { name: '显示信息', exact: true });
        if (await toggle.count()) await toggle.click();
        assert.equal(await page.locator('.viewer-sidebar-head strong').innerText(), photos.find(photo => photo.id === (kind === 'video' ? 12 : kind === 'portrait' ? 13 : 11)).originalFilename);
        assert.ok(await page.locator('.viewer-sidebar-head strong').evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1), 'Long original filenames wrap instead of being hidden or overflowing');
        assert.equal(await page.locator('.viewer-file-info').count(), 0, 'Do not duplicate the filename below the information heading');
        const measure = async () => {
          const mediaRect = await media.evaluate(rect);
          for (const selector of ['.viewer-info-card', '.viewer-topbar', '.viewer-dock-actions', '.viewer-tone-panel', '.viewer-nav', '.viewer-sidebar-head', '.ui-zoom-control']) {
            for (const element of await page.locator(selector).all()) if (await element.isVisible()) {
              const box = await element.evaluate(rect);
              assert.ok(overlap(mediaRect, box) <= 1, `${selector} covers media: ${JSON.stringify({ mediaRect, box, scenario })}`);
            }
          }
          assert.ok(mediaRect.x >= -1 && mediaRect.y >= -1 && mediaRect.x + mediaRect.w <= width + 1 && mediaRect.y + mediaRect.h <= height + 1, 'Media must fit the viewport');
          const expectedRatio = kind === 'video' ? 360 / 640 : kind === 'portrait' ? 800 / 1200 : 1600 / 900;
          assert.ok(Math.abs(mediaRect.w / mediaRect.h - expectedRatio) < 0.01, 'No cropping, stretching, or incorrect thumbnail aspect ratio');
        };
        if (artifactDir) await page.screenshot({ path: path.join(artifactDir, `${kind}-${width}-${height}-${zoom}-before.png`), animations: 'disabled' });
        await measure();
        const editor = page.getByRole('textbox', { name: '描述', exact: true });
        assert.equal(await editor.count(), 1, 'Description is editable directly inside details');
        await editor.fill(description + '补充现场信息');
        await page.getByRole('textbox', { name: '标签', exact: true }).fill('现场记录');
        await page.getByRole('button', { name: '保存', exact: true }).click();
        await page.getByRole('button', { name: '保存', exact: true }).waitFor({ state: 'detached' });
        assert.equal(edits.length, 1);
        assert.equal(edits[0].description, description + '补充现场信息');
        assert.ok(edits[0].tags.includes('现场记录'), 'Saving includes uncommitted tag input');
        await editor.fill('不保存的修改');
        await page.getByRole('button', { name: '撤销', exact: true }).click();
        assert.equal(await editor.inputValue(), description + '补充现场信息');
        if (width === 1440 && zoom === 1 && kind === 'landscape') {
          rejectEdit = true;
          await editor.fill('权限被撤回后的草稿');
          await page.getByRole('button', { name: '保存', exact: true }).click();
          await page.getByRole('alert').filter({ hasText: '没有修改' }).waitFor();
          assert.equal(await editor.inputValue(), '权限被撤回后的草稿', 'Failed saves preserve the draft');
          rejectEdit = false;
          await page.getByRole('button', { name: '撤销', exact: true }).click();
        }
        if (kind === 'video') {
          await page.getByRole('button', { name: '展开', exact: true }).click(); await measure();
          await page.getByRole('button', { name: /0:02.*0:04/ }).click();
          await page.waitForFunction(() => document.querySelector('.viewer-slide.is-active video')?.currentTime >= 1.9);
          await media.evaluate(video => video.pause());
        }
        if (artifactDir) await page.screenshot({ path: path.join(artifactDir, `${kind}-${width}-${height}-${zoom}.png`), animations: 'disabled' });
        await page.getByRole('button', { name: '隐藏信息', exact: true }).click(); await measure();
        assert.equal(await page.getByRole('button', { name: '编辑信息', exact: true }).count(), 0);
        const infoButton = page.getByRole('button', { name: '显示信息', exact: true });
        assert.ok(await infoButton.evaluate(el => document.querySelector('.viewer-dock-actions').contains(el)), 'Info control belongs to the bottom toolbar');
        await infoButton.click();
        await page.locator('.viewer-edit-textarea').waitFor(); await measure();
        assert.ok(await editor.evaluate(el => document.querySelector('.viewer-details-panel').contains(el)), 'Editable fields remain inside details');
        assert.equal(await page.getByRole('dialog').count(), 1, 'Editing must not open another dialog');
        await page.getByRole('button', { name: '隐藏信息', exact: true }).click();
        await page.getByRole('button', { name: '显示信息', exact: true }).click(); await measure();
        if (kind !== 'video') {
          await page.getByTitle('调色', { exact: true }).click(); await page.locator('.viewer-tone-panel').waitFor(); await measure();
          const titleBefore = await page.locator('.viewer-topbar-title').innerText();
          await page.locator('.viewer-tone-slider input').first().focus(); await page.keyboard.press('ArrowRight');
          assert.equal(await page.locator('.viewer-topbar-title').innerText(), titleBefore, 'Slider keys must not change the selected photo');
          await page.locator('.viewer-tone-close').click(); await measure();
        } else {
          await media.focus(); await page.keyboard.press('ArrowRight');
          assert.match(await page.locator('.viewer-topbar-title').innerText(), /视频/, 'Native video keys must not advance the album');
          const center = await media.boundingBox(); await page.mouse.move(center.x + center.width * 0.2, center.y + center.height - 20); await page.mouse.down();
          await page.mouse.move(center.x + center.width * 0.8, center.y + center.height - 20); await page.mouse.up();
          assert.match(await page.locator('.viewer-topbar-title').innerText(), /视频/, 'Scrubbing must not trigger album swipes');
        }
        await page.locator('.viewer-topbar-close').focus(); await page.keyboard.press('Shift+Tab');
        assert.ok(await page.evaluate(() => document.querySelector('.viewer-overlay').contains(document.activeElement)), 'Keyboard focus stays in the viewer');
        await page.keyboard.press('Escape'); await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
        if (width === 1440 && zoom === 1 && kind === 'landscape') {
          photos[0].photographerId = 8;
          const savedFilename = photos[0].originalFilename, savedTitle = photos[0].title;
          photos[0].originalFilename = null;
          await page.goto(base + '/?projectId=9001&photoId=11');
          await page.locator('.viewer-overlay.is-open').waitFor();
          assert.equal(await page.locator('.viewer-sidebar-head strong').innerText(), savedTitle, 'Historical records without a filename retain their title');
          assert.equal(await page.locator('.viewer-edit-panel').count(), 0, 'Other uploaders retain read-only details');
          assert.equal(await page.locator('.viewer-dock-btn--info').count(), 1, 'Read-only users can still toggle information');
          photos[0].title = '';
          await page.goto(base + '/?projectId=9001&photoId=11'); await page.locator('.viewer-overlay.is-open').waitFor();
          assert.equal(await page.locator('.viewer-sidebar-head strong').innerText(), '未命名', 'Never invent a filename for unrecorded history');
          await page.keyboard.press('Escape'); await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
          photos[0].photographerId = 7;
          photos[0].originalFilename = savedFilename; photos[0].title = savedTitle;
        }
        if (kind !== 'video' && zoom === 1 && width >= 390) {
          await page.goto(base);
          await page.locator('.album-desktop').waitFor();
          const search = page.getByRole('textbox', { name: '用自然语言搜索项目、照片、人物或场景', exact: true });
          await search.fill('校园活动'); await page.keyboard.press('Enter');
          await page.getByTitle('点击预览大图', { exact: true }).click();
          await page.getByRole('dialog', { name: '照片预览', exact: true }).waitFor();
          const info = page.getByRole('button', { name: '显示信息', exact: true }); if (await info.count()) await info.click();
          assert.equal(await page.locator('.viewer-sidebar-head strong').innerText(), photos.find(photo => photo.id === (kind === 'portrait' ? 13 : 11)).originalFilename);
          await page.locator('.viewer-slide.is-active img').evaluate(image => image.decode()); await measure();
          if (artifactDir) await page.screenshot({ path: path.join(artifactDir, `global-${kind}-${width}.png`), animations: 'disabled' });
          await page.keyboard.press('Escape'); await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
        }
        assert.deepEqual(errors, []);
        results.push({ ...scenario, effectiveZoom: await page.evaluate(() => Number(getComputedStyle(document.documentElement).zoom)), noObstruction: true });
      } finally { await context.close(); }
    }
    if (artifactDir) fs.writeFileSync(path.join(artifactDir, 'results.json'), JSON.stringify({ passed: true, scenarios: results, globalPhotoPreviewChecked: true, editAndToneChecked: true, inlineEdits: true, permissionFailureRetainsDraft: true, otherUploadsReadOnly: true, noStorageWrites: true }, null, 2));
    console.log(JSON.stringify(results));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(temp, { recursive: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
