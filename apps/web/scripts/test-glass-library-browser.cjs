const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright'), sharp = runtime('sharp');
const dist = path.resolve(__dirname, '../dist');
const baseline = process.env.MAMAGE_GLASS_BASELINE_DIST;
const artifacts = process.env.MAMAGE_GLASS_QA_DIR;

async function serve(root) {
  const server = http.createServer((req, res) => {
    const requested = path.join(root, new URL(req.url, 'http://fixture').pathname);
    const file = requested.startsWith(root + '/') && fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

async function main() {
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const server = await serve(dist), beforeServer = baseline ? await serve(path.resolve(baseline)) : null;
  const browser = await chromium.launch(), results = [];
  const image = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#a7b9c4' } }).jpeg().toBuffer();
  const photos = [11, 12, 13].map(id => ({ id, type: 'normal', projectId: 9001, url: `/api/image/${id}.jpg`, thumbUrl: `/api/image/${id}.jpg`,
    originalFilename: `DSC_${id}.JPG`, title: `活动照片 ${id}`, description: '师生现场交流', aiStatus: 'done', photographerId: 7, unitId: 1 }));
  const album = { id: 9001, name: '玻璃界面验收', images: photos, count: 3, unitId: 1, adminId: 7, canEdit: true, image: photos[0].url };
  async function fixture(width, style, reducedMotion = 'no-preference') {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion });
    await context.addInitScript(style => {
      if (!/^https?:$/.test(location.protocol)) return;
      localStorage.setItem('mamage_jwt_token', 'isolated-glass-fixture');
      localStorage.setItem('mamage-folder-style:v1:7', style);
    }, style);
    const errors = [], writes = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route('**/api/**', route => {
      const req = route.request(), p = new URL(req.url()).pathname;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { writes.push(p); return route.abort(); }
      if (p.startsWith('/api/image/')) return route.fulfill({ contentType: 'image/jpeg', body: image });
      let data = {};
      if (p === '/api/users/me') data = { id: 7, name: '查看器测试', role: 'admin', activeUnitId: 1, canFaceSearch: true, metadataEditScope: 'own',
        permissions: ['projects.view', 'projects.create', 'photos.view', 'photos.edit', 'photos.zip', 'upload.photo', 'tags.edit'] };
      else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 1, units: [{ id: 1, name: '学工与融媒体中心', role: 'manager' }] };
      else if (p === '/api/album-desktop') data = { albums: [album], groups: [{ id: 'root', name: '测试文件夹', projectIds: [9001], kind: 'manual', parentId: null, canEdit: true, createdBy: 7 }],
        sharedAlbums: [], sharedFolders: [], preferences: { pins: [], colors: {} }, scope: { userId: 7, organizationId: 2, unitId: 1 }, workspaceRevision: 1, userRevision: 1 };
      else if (p === '/api/projects/9001') data = album;
      else if (p === '/api/photos') data = { list: photos, total: 3, hasMore: false };
      else if (p === '/api/projects/list') data = { list: [album], total: 1, hasMore: false };
      else if (p.endsWith('/person-observations')) data = { enabled: false, people: [] };
      return route.fulfill({ json: data });
    });
    return { context, errors, writes };
  }
  const folderStyle = async (page, style) => {
    const selector = style === 'glass' ? '.acp-collection' : '.acp-column-folder-glyph';
    await page.locator(selector).first().waitFor();
    await page.waitForTimeout(700);
    return page.locator(selector).first().evaluate(root => [root, ...root.querySelectorAll('*')].map(el => {
      const css = getComputedStyle(el);
      return { class: el.className.baseVal ?? el.className,
        values: ['background', 'boxShadow', 'border', 'borderRadius', 'backdropFilter', 'transform', 'width', 'height'].map(key => css[key]) };
    }));
  };
  try {
    for (const width of [1440, 900, 390, 320]) {
      for (const style of ['glass', 'classic']) {
        const f = await fixture(width, style), page = await f.context.newPage();
        try {
          await page.goto(server.url);
          assert.equal(await page.locator('.mamage-header').evaluate(el => getComputedStyle(el, '::before').content), 'none');
          await page.locator('.mamage-header').getByRole('button', { name: '显示设置', exact: true }).click();
          await page.waitForTimeout(700);
          assert.ok(await page.locator('.mamage-header .glass-settings').evaluate(el => {
            const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth;
          }), 'Header display settings must remain in the viewport');
          await page.keyboard.press('Escape');
          const after = await folderStyle(page, style);
          if (beforeServer) {
            const oldPage = await f.context.newPage(); await oldPage.goto(beforeServer.url);
            assert.deepEqual(after, await folderStyle(oldPage, style), `${style} folders changed at ${width}px`);
            await oldPage.close();
          }
          await page.locator('.mamage-user-chip').click();
          const accountMaterial = await page.locator('.mamage-account-surface').evaluate(el => {
            const s = getComputedStyle(el); return { background: s.background, edge: s.boxShadow, blur: s.backdropFilter };
          });
          assert.equal(accountMaterial.blur, 'blur(20px) saturate(1.45)');
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          if (artifacts) await page.screenshot({ path: path.join(artifacts, `home-${style}-${width}.png`), animations: 'disabled' });
          await page.goto(server.url + '/?projectId=9001&photoId=11');
          await page.locator('.viewer-overlay').waitFor();
          await page.locator('.viewer-slide.is-active img').evaluate(img => img.decode());
          await page.waitForTimeout(700);
          const before = await page.locator('.viewer-dock-actions').boundingBox();
          assert.ok(Math.abs(before.x + before.width / 2 - width / 2) < 1);
          for (let toggle = 0; toggle < 3; toggle++) {
            await page.locator('.viewer-dock-btn--info').click();
            const frames = await page.evaluate(async () => {
              const frames = [], start = performance.now();
              do {
                await new Promise(requestAnimationFrame);
                const bar = document.querySelector('.viewer-dock-actions').getBoundingClientRect();
                const stage = document.querySelector('.viewer-img-stage').getBoundingClientRect();
                const slot = document.querySelector('.viewer-panel-slot').getBoundingClientRect();
                const overlap = Math.max(0, Math.min(stage.right, slot.right) - Math.max(stage.left, slot.left)) * Math.max(0, Math.min(stage.bottom, slot.bottom) - Math.max(stage.top, slot.top));
                frames.push({ center: bar.x + bar.width / 2, y: bar.y, overlap });
              } while (performance.now() - start < 700);
              return frames;
            });
            assert.ok(frames.every(f => Math.abs(f.center - width / 2) < 1 && f.overlap < 1), JSON.stringify(frames));
            if (width > 900) assert.ok(frames.every(f => Math.abs(f.y - before.y) < 1), 'Sidebar moves the toolbar vertically');
          }
          await page.locator('.viewer-overlay').getByRole('button', { name: '显示设置', exact: true }).click();
          await page.waitForTimeout(700);
          const settings = await page.locator('.viewer-overlay .glass-settings').evaluate(el => {
            const s = getComputedStyle(el), r = el.getBoundingClientRect();
            return { background: s.background, edge: s.boxShadow, blur: s.backdropFilter, left: r.left, right: r.right, opacity: s.opacity };
          });
          assert.deepEqual({ background: settings.background, edge: settings.edge, blur: settings.blur }, accountMaterial);
          assert.equal(settings.opacity, '1'); assert.ok(settings.left >= 0 && settings.right <= width);
          assert.ok(await page.evaluate(() => {
            const head = document.querySelector('.viewer-overlay .glass-settings-head').getBoundingClientRect();
            return [...document.querySelectorAll('.viewer-topbar-left, .viewer-topbar-right > :not(.glass-settings-slot)')]
              .filter(el => getComputedStyle(el).display !== 'none')
              .every(el => el.getBoundingClientRect().right <= head.left + 1);
          }), 'Expanded settings overlaps existing header controls');
          await page.getByRole('checkbox', { name: '深色外观' }).check();
          const blur = page.getByRole('slider', { name: '玻璃模糊' });
          await blur.focus(); await blur.press('Home');
          for (let i = 0; i < 6; i++) await blur.press('ArrowRight');
          assert.equal(await page.locator('.viewer-overlay .glass-settings').evaluate(el => getComputedStyle(el).backdropFilter), 'blur(15px) saturate(1.45)');
          if (artifacts) await page.screenshot({ path: path.join(artifacts, `viewer-dark-${style}-${width}.png`) });
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('.viewer-overlay').count(), 1, 'Escape closes settings first');
          assert.equal(await page.locator('.viewer-overlay .glass-settings-body').getAttribute('inert'), '');
          await page.getByRole('button', { name: '下一张', exact: true }).click();
          await page.waitForTimeout(700);
          assert.match(await page.locator('.viewer-topbar-counter').innerText(), /2 \/ 3/);
          await page.getByRole('button', { name: '上一张', exact: true }).click();
          await page.waitForTimeout(700);
          assert.match(await page.locator('.viewer-topbar-counter').innerText(), /1 \/ 3/);
          for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '下一张', exact: true }).click();
          await page.waitForTimeout(700);
          assert.match(await page.locator('.viewer-topbar-counter').innerText(), /1 \/ 3/);
          // Opening the viewer consumes photoId, so restore the deep link on the fresh load.
          await page.goto(server.url + '/?projectId=9001&photoId=11');
          await page.locator('.viewer-overlay[data-glass-theme="dark"]').waitFor();
          assert.equal(await page.locator('.viewer-overlay').evaluate(el => el.style.getPropertyValue('--glass-blur')), '15px');
          assert.deepEqual(f.errors, []); assert.deepEqual(f.writes, []);
          results.push({ width, style, foldersUnchanged: Boolean(baseline), motionChecked: true });
        } catch (error) {
          if (artifacts) await page.screenshot({ path: path.join(artifacts, `failure-${style}-${width}.png`) });
          console.error(JSON.stringify({ width, style, url: page.url(), errors: f.errors, writes: f.writes }));
          throw error;
        } finally { await f.context.close(); }
      }
    }
    const reduced = await fixture(1440, 'glass', 'reduce');
    try {
      const page = await reduced.context.newPage(); await page.goto(server.url + '/?projectId=9001&photoId=11');
      await page.locator('.viewer-overlay').waitFor();
      assert.equal(await page.locator('.viewer-slide.is-active .viewer-face-image-surface').evaluate(el => getComputedStyle(el).animationName), 'none');
      assert.equal(await page.locator('.viewer-wrap').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    } finally { await reduced.context.close(); }
    console.log(JSON.stringify({ passed: true, cases: results, reducedMotion: true, noProductionWrites: true }));
  } finally { await browser.close(); await server.close(); await beforeServer?.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
