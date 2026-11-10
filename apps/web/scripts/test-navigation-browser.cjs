const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright');
const sharp = runtime('sharp');
const dist = path.resolve(__dirname, '../dist');

async function main() {
  const image = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#859da9' } }).jpeg().toBuffer();
  const photos = Array.from({ length: 80 }, (_, i) => ({ id: 101 + i, projectId: 1, title: `Photo ${i + 1}`,
    projectName: 'Campus Album', type: 'normal', url: '/api/image/test.jpg', thumbUrl: '/api/image/test.jpg',
    width: 640, height: 480, unitId: 1, photographerId: 7, aiStatus: 'done' }));
  const album = { id: 1, name: 'Campus Album', title: 'Campus Album', count: photos.length,
    unitId: 1, adminId: 7, canEdit: true, groups: ['events'], images: photos, coverThumbUrl: '/api/image/test.jpg' };
  const groups = [{ id: 'campus', name: 'Campus Folder', parentId: null, projectIds: [] },
    { id: 'events', name: 'Events Folder', parentId: 'campus', projectIds: [1] }]
    .map(g => ({ ...g, kind: 'manual', createdBy: 7, canEdit: true }));
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch();
  const results = [];
  const screenshotDir = path.resolve(__dirname, '../../../.local/navigation-qa');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const checks = {
    async folders(page) {
      await page.goto(base);
      await page.getByRole('button', { name: '打开文件夹 Campus Folder', exact: true }).click();
      await page.getByRole('button', { name: '打开文件夹 Events Folder', exact: true }).click();
      await page.goBack();
      await page.waitForFunction(() => new URL(location.href).searchParams.get('folder') === 'campus'
        && document.querySelector('.acp-page-heading h1')?.textContent.includes('Campus Folder'));
      await page.goBack();
      await page.getByRole('heading', { name: /小组空间/, level: 1 }).waitFor();
      await page.goForward();
      await page.getByRole('heading', { name: /Campus Folder/, level: 1 }).waitFor();
    },
    async viewer(page) {
      await page.goto(base + '/?folder=events');
      await page.locator('.desktop-album .project-card').first().click();
      await page.locator('[data-photo-id="101"] img').first().click();
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.goBack();
      await page.waitForFunction(() => !document.querySelector('.viewer-overlay') && document.querySelector('.detail-gallery'));
      assert.equal(new URL(page.url()).searchParams.get('projectId'), '1');
      await page.goForward();
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.locator('.viewer-topbar-close').click();
      await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
      await page.goBack();
      await page.getByRole('heading', { name: /Events Folder/, level: 1 }).waitFor();
    },
    async search(page) {
      await page.goto(base);
      const input = page.locator('.mamage-nav-search-input');
      await input.fill('拿话筒'); await input.press('Enter');
      await page.locator('.app-photo-search-card').first().waitFor();
      await page.locator('.app-photo-search-card').first().getByText('Campus Album', { exact: true }).click();
      await page.locator('.detail-gallery').waitFor();
      await page.goBack();
      await page.getByText('“拿话筒”的搜索结果', { exact: true }).waitFor();
      await page.locator('.app-photo-search-card').first().waitFor();
      assert.equal(await input.inputValue(), '拿话筒');
    },
    async albumBack(page) {
      await page.goto(base + '/?folder=events');
      await page.locator('.desktop-album .project-card').first().click();
      await page.locator('.detail-gallery').waitFor();
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.getByRole('heading', { name: /Events Folder/, level: 1 }).waitFor();
      await page.goForward();
      await page.locator('.detail-gallery').waitFor();
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.getByRole('heading', { name: /Events Folder/, level: 1 }).waitFor();
    },
    async directPhoto(page) {
      await page.goto(base + '/?folder=events&projectId=1&photoId=101');
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.getByRole('button', { name: '下一张', exact: true }).last().click();
      await page.waitForURL('**photoId=102');
      await page.reload();
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.goBack();
      await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
      assert.equal(new URL(page.url()).searchParams.get('projectId'), '1');
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.getByRole('heading', { name: /Events Folder/, level: 1 }).waitFor();
    },
    async searchPreview(page) {
      await page.goto(base + '/?q=speaker');
      await page.locator('.app-photo-search-card').first().getByTitle('点击预览大图').click();
      await page.waitForFunction(() => new URL(location.href).searchParams.has('previewId'));
      await page.goBack();
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('previewId'));
      await page.getByText('“speaker”的搜索结果', { exact: true }).waitFor();
    },
    async folderSearch(page) {
      await page.goto(base + '/?folder=events');
      const input = page.locator('.mamage-nav-search-input');
      await input.fill('speaker'); await input.press('Enter');
      await page.locator('.scoped-search-photo').first().click();
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.goBack();
      await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.locator('.scoped-search-photo').first().waitFor();
      assert.equal(new URL(page.url()).searchParams.get('folder'), 'events');
      assert.equal(await input.inputValue(), 'speaker');
      await page.goBack();
      await page.locator('.scoped-search').waitFor({ state: 'detached' });
      await page.getByRole('heading', { name: /Events Folder/, level: 1 }).waitFor();
    },
    async albumSearch(page) {
      await page.goto(base + '/?projectId=1');
      await page.locator('.detail-gallery').waitFor();
      const input = page.locator('.mamage-nav-search-input');
      await input.fill('speaker'); await input.press('Enter');
      await page.locator('.detail-search-input input').waitFor();
      await page.locator('[data-photo-id="101"] img').first().click();
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.goBack();
      await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
      assert.equal(await input.inputValue(), 'speaker');
      await page.goBack();
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('q'));
      assert.equal(await input.inputValue(), '');
      await page.locator('.detail-gallery').waitFor();
    },
    async scrollRestore(page) {
      await page.goto(base + '/?projectId=1');
      await page.locator('[data-photo-id="125"]').scrollIntoViewIfNeeded();
      const y = await page.evaluate(() => scrollY);
      assert.ok(y > 100);
      await page.locator('[data-photo-id="125"] img').first().evaluate(image => image.click());
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.goBack();
      await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
      await page.waitForFunction(y => Math.abs(scrollY - y) < 3, y).catch(async error => {
        throw new Error(`Viewer scroll restore: expected ${y}, actual ${await page.evaluate(() => JSON.stringify({ y: scrollY, state: history.state }))}; ${error.message}`);
      });
      await page.evaluate(() => document.querySelector('.mamage-nav-link:last-child').click());
      await page.waitForURL('**/about');
      await page.goBack();
      await page.waitForFunction(y => Math.abs(scrollY - y) < 3, y).catch(async error => {
        throw new Error(`Album scroll restore: expected ${y}, actual ${await page.evaluate(() => JSON.stringify({ y: scrollY, state: history.state }))}; ${error.message}`);
      });
    },
    async unsaved(page) {
      await page.goto(base + '/?projectId=1&photoId=101');
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.locator('.viewer-details-panel textarea').fill('Unsaved edit');
      page.once('dialog', dialog => dialog.dismiss());
      await page.goBack();
      await page.waitForFunction(() => new URL(location.href).searchParams.has('photoId'));
      await page.locator('.viewer-overlay.is-open').waitFor();
      assert.equal(await page.locator('.viewer-details-panel textarea').inputValue(), 'Unsaved edit');
      page.once('dialog', dialog => dialog.accept());
      await page.locator('.viewer-topbar-close').click();
      await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
    },
    async filterRestore(page) {
      await page.goto(base + '/?projectId=1');
      await page.locator('.detail-gallery').waitFor();
      await page.getByRole('button', { name: '打开功能', exact: true }).click();
      await page.getByRole('checkbox', { name: '只看我上传的', exact: true }).check();
      await page.locator('.mamage-nav-link').filter({ hasText: '关于' }).click();
      await page.waitForURL('**/about');
      await page.goBack();
      await page.locator('.detail-gallery').waitFor();
      await page.getByRole('button', { name: '打开功能', exact: true }).click();
      assert.equal(await page.getByRole('checkbox', { name: '只看我上传的', exact: true }).isChecked(), true);
      await page.locator('.detail-media-filter-btn').filter({ hasText: '只看照片' }).click();
      await page.reload();
      await page.locator('.detail-gallery').waitFor();
      await page.getByRole('button', { name: '打开功能', exact: true }).click();
      assert.equal(await page.getByRole('checkbox', { name: '只看我上传的', exact: true }).isChecked(), true);
      assert.equal(await page.locator('.detail-media-filter-btn').filter({ hasText: '只看照片' }).getAttribute('aria-pressed'), 'true');
    },
    async paginationRestore(page) {
      await page.goto(base + '/?folder=events');
      await page.getByRole('button', { name: '按活动日期排序', exact: true }).click();
      await page.getByRole('option', { name: '活动日期 · 旧到新' }).click();
      await page.getByRole('button', { name: '加载更多', exact: true }).click();
      assert.equal(await page.locator('.acp-albums .desktop-album').count(), 26);
      await page.locator('.acp-folder-breadcrumb').getByRole('button', { name: 'Campus Folder', exact: true }).click();
      await page.getByRole('heading', { name: /Campus Folder/, level: 1 }).waitFor();
      await page.goBack();
      await page.getByRole('heading', { name: /Events Folder/, level: 1 }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('.acp-albums .desktop-album').length === 26);
      assert.match(await page.getByRole('button', { name: '按活动日期排序', exact: true }).textContent(), /旧到新/);
    },
    async galleryPaginationRestore(page) {
      await page.goto(base + '/?projectId=1');
      await page.getByRole('button', { name: /加载更多照片/ }).evaluate(button => button.click());
      await page.waitForFunction(() => document.querySelectorAll('.detail-gallery [data-photo-id]').length === 160);
      const input = page.locator('.mamage-nav-search-input');
      await input.fill('speaker'); await input.press('Enter');
      await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'speaker'
        && document.querySelectorAll('.detail-gallery [data-photo-id]').length === 96);
      await page.goBack();
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('q')
        && document.querySelectorAll('.detail-gallery [data-photo-id]').length === 160);
      assert.equal(await page.evaluate(() => history.state.mamageNavigation.views.galleryLimit), 160);
    },
    async sharedFolder(page) {
      await page.goto(base + '/?sharedFolder=5');
      await page.getByRole('button', { name: '打开文件夹 Events Folder', exact: true }).click();
      await page.locator('.shared-folder-view .project-card').first().click();
      await page.locator('.detail-gallery').waitFor();
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.locator('.shared-folder-view h1').filter({ hasText: 'Events Folder' }).waitFor();
      await page.goBack();
      await page.locator('.shared-folder-view h1').filter({ hasText: 'Campus Folder' }).waitFor();
    },
    async classic(page) {
      await page.addInitScript(() => localStorage.setItem('mamage-folder-style:v1:7', 'classic'));
      await page.goto(base);
      await page.getByRole('button', { name: '浏览文件夹 Campus Folder', exact: true }).click();
      await page.getByRole('button', { name: '浏览文件夹 Events Folder', exact: true }).click();
      await page.getByRole('button', { name: '预览相册 Campus Album', exact: true }).click();
      await page.getByRole('button', { name: '打开相册 Campus Album', exact: true }).click();
      await page.locator('.detail-gallery').waitFor();
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.locator('.acp-column-inspector').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('folder'), 'events');
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.locator('.acp-column-inspector').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get('folder') === 'campus');
    },
    async publicAlbum(page) {
      await page.goto(base + '/share/album-test');
      await page.locator('.share-photo').first().click();
      await page.locator('.sv-viewer').waitFor();
      await page.keyboard.press('ArrowRight');
      await page.waitForURL('**previewId=102');
      await page.goBack();
      await page.locator('.sv-viewer').waitFor({ state: 'detached' });
      await page.locator('.share-photo').first().waitFor();
      await page.goForward();
      await page.locator('.sv-viewer').waitFor();
      await page.reload();
      await page.locator('.sv-viewer').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('.sv-viewer').waitFor({ state: 'detached' });
      assert.equal(new URL(page.url()).pathname, '/share/album-test');
    },
    async publicFolder(page) {
      await page.goto(base + '/share/folder-test');
      await page.getByRole('button', { name: '打开文件夹 Events Folder', exact: true }).click();
      await page.locator('.shared-folder-view .project-card').first().click();
      await page.locator('.share-photo').first().click();
      await page.locator('.sv-viewer').waitFor();
      await page.goBack();
      await page.locator('.sv-viewer').waitFor({ state: 'detached' });
      assert.equal(new URL(page.url()).searchParams.get('projectId'), '1');
      await page.goBack();
      await page.locator('.shared-folder-view h1').filter({ hasText: 'Events Folder' }).waitFor();
      await page.goBack();
      await page.locator('.shared-folder-view h1').filter({ hasText: 'Campus Folder' }).waitFor();
    },
    async mobile(page) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(base + '/?folder=events');
      await page.locator('.desktop-album .project-card').first().click();
      await page.locator('[data-photo-id="101"] img').first().click();
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.locator('.viewer-overlay').evaluate(async element => {
        await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
      });
      await page.screenshot({ path: path.join(screenshotDir, 'mobile-viewer.png') });
      await page.goBack();
      await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.getByRole('heading', { name: /Events Folder/, level: 1 }).waitFor();
      await page.screenshot({ path: path.join(screenshotDir, 'mobile-returned-folder.png') });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    },
    async about(page) {
      await page.goto(base);
      await page.locator('.mamage-nav-link').filter({ hasText: '关于' }).click();
      await page.waitForURL('**/about');
      await page.goBack();
      await page.locator('.album-desktop').waitFor();
      await page.goForward();
      await page.waitForFunction(() => document.querySelector('.mamage-nav-link.is-active')?.textContent === '关于');
      await page.reload();
      await page.waitForFunction(() => document.querySelector('.mamage-nav-link.is-active')?.textContent === '关于');
    },
  };
  try {
    for (const [name, check] of Object.entries(checks)) {
      if (process.env.NAV_CASE && process.env.NAV_CASE !== name) continue;
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const errors = [], writes = [];
      const testPhotos = name === 'galleryPaginationRestore'
        ? [...photos, ...photos.map(photo => ({ ...photo, id: photo.id + 80 }))] : photos;
      const testAlbum = { ...album, images: testPhotos, count: testPhotos.length };
      const testAlbums = name === 'paginationRestore'
        ? Array.from({ length: 26 }, (_, i) => ({ ...album, id: i + 1, name: `Album ${i + 1}`, eventDate: `2026-10-${String(i + 1).padStart(2, '0')}` }))
        : [testAlbum];
      const testGroups = groups.map(group => group.id === 'events' ? { ...group, projectIds: testAlbums.map(item => item.id) } : group);
      await context.addInitScript(() => { try { localStorage.setItem('mamage_jwt_token', 'isolated-navigation-fixture'); } catch {} });
      await context.route('**/*', route => {
        const req = route.request(), url = new URL(req.url()), p = url.pathname;
        if (p.startsWith('/api/image/')) return route.fulfill({ contentType: 'image/jpeg', body: image });
        if (p.startsWith('/api/')) {
          if (req.method() !== 'GET') { writes.push(p); return route.abort(); }
          let data = {};
          if (p === '/api/users/me') data = { id: 7, name: 'Test User', role: 'admin', activeUnitId: 1, metadataEditScope: 'own',
            permissions: ['projects.view', 'projects.create', 'photos.view', 'photos.edit', 'ai.generate'] };
          else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 1, units: [{ id: 1, name: 'Test Workspace', role: 'manager' }] };
          else if (p === '/api/album-desktop') data = { albums: testAlbums, groups: testGroups, sharedAlbums: [], sharedFolders: [],
            preferences: { pins: [], recentItems: [], colors: {} }, scope: { userId: 7, unitId: 1 },
            workspaceRevision: 1, userRevision: 1, canOrganize: true, canDeleteFolders: true };
          else if (p === '/api/projects/list') data = { list: [album], total: 1, hasMore: false };
          else if (p === '/api/projects/1') data = testAlbum;
          else if (p === '/api/folder-shares/5') data = { share: { id: 5, folderId: 'campus', originLabel: 'Another Workspace', mode: 'readonly' }, groups, albums: [album] };
          else if (p.startsWith('/api/share/')) data = p.endsWith('/folder-test') && !url.searchParams.has('projectId')
            ? { title: 'Campus Folder', folder: { share: { folderId: 'campus', originLabel: 'Test Workspace', mode: 'readonly' }, groups, albums: [album] } }
            : { projectId: 1, title: 'Campus Album', photos, total: photos.length, hasMore: false };
          else if (p === '/api/photos/search' || p === '/api/photos') data = { list: testPhotos, total: testPhotos.length, hasMore: false,
            search: { scope: { type: url.searchParams.has('folderId') ? 'folder' : 'project', id: url.searchParams.get('folderId') || '1' } } };
          else if (p === '/api/photos/101') data = photos[0];
          return route.fulfill({ json: data });
        }
        return url.origin === base ? route.continue() : route.abort();
      });
      const page = await context.newPage(); page.setDefaultTimeout(5000);
      page.on('pageerror', e => errors.push(e.message));
      try { await check(page); assert.deepEqual(errors, []); assert.deepEqual(writes, []); results.push({ name, passed: true }); }
      catch (error) { results.push({ name, passed: false, error: error.message.split('\n').slice(0, 4).join('\n'), url: page.url(), errors }); }
      finally { await context.close(); }
    }
    console.log(JSON.stringify(results, null, 2));
    assert.ok(results.length && results.every(r => r.passed), 'All navigation paths must restore the expected page');
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
