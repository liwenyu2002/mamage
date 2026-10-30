const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright'), sharp = runtime('sharp');
const dist = path.resolve(__dirname, '../dist');
const artifacts = process.env.MAMAGE_WEBVIEW_QA_DIR;

async function main() {
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer((req, res) => {
    const requested = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const file = requested.startsWith(dist + '/') && fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(dist, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.MAMAGE_WEBVIEW_EXECUTABLE || undefined });
  const image = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#a7b9c4' } }).jpeg().toBuffer();
  const cases = [], failures = [];
  try {
    for (const { width, view, canCreate } of [390, 320].flatMap(width => [
      { width, view: 'home', canCreate: true }, { width, view: 'home', canCreate: false },
      { width, view: 'nested', canCreate: true }, { width, view: 'album', canCreate: true },
    ])) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
      try {
        await context.addInitScript(() => {
          localStorage.setItem('mamage_jwt_token', 'isolated-webview-test');
          localStorage.setItem('mamage-folder-style:v1:7', 'glass');
        });
        const albums = [9001, 9002, 9003, 9004].map(id => ({ id, name: `AI青年说：人工智能与未来校园创新实践交流系列活动 ${id}`, count: 30, images: [{ id, url: `/api/image/${id}.jpg`, thumbUrl: `/api/image/${id}.jpg`, projectId: id, type: 'normal' }], image: `/api/image/${id}.jpg`, cover: `/api/image/${id}.jpg`, coverSrc: `/api/image/${id}.jpg`, thumbnails: [`/api/image/${id}.jpg`], unitId: 1, adminId: 7, canEdit: true }));
        const groups = [
          { id: 'root', name: '测试文件夹', projectIds: [9001, 9002, 9003], parentId: null },
          { id: 'parent', name: '层级文件夹', projectIds: [], parentId: null },
          { id: 'child', name: '子文件夹', projectIds: [], parentId: 'parent' },
          { id: 'grandchild', name: '孙文件夹', projectIds: [9004], parentId: 'child' },
        ].map(group => ({ ...group, kind: 'manual', canEdit: true, createdBy: 7 }));
        await context.route('**/api/**', route => {
          const p = new URL(route.request().url()).pathname;
          if (p.startsWith('/api/image/')) return route.fulfill({ contentType: 'image/jpeg', body: image });
          let data = {};
          if (p === '/api/users/me') data = { id: 7, name: '李文宇', role: canCreate ? 'admin' : 'viewer', activeUnitId: 1, permissions: ['projects.view', 'photos.view', ...(canCreate ? ['projects.create'] : [])] };
          else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 1, units: [{ id: 1, name: '学工与融媒体中心', role: 'manager' }] };
          else if (p === '/api/album-desktop') data = { albums, groups, sharedAlbums: [], sharedFolders: [], preferences: { pins: [], colors: {} }, scope: { userId: 7, organizationId: 2, unitId: 1 }, workspaceRevision: 1, userRevision: 1 };
          else if (p === '/api/projects/list') data = { list: albums, total: albums.length, hasMore: false };
          else if (p === '/api/projects/9001') data = { ...albums[0], images: [], count: 0 };
          else if (p === '/api/photos') data = { list: [], total: 0, hasMore: false };
          return route.fulfill({ json: data });
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        const suffix = view === 'album' ? '?projectId=9001' : view === 'nested' ? '?folder=parent' : '';
        await page.goto(`${process.env.MAMAGE_WEBVIEW_TEST_URL || `http://127.0.0.1:${server.address().port}`}/${suffix}`);
        await page.locator(view === 'album' ? '.mamage-project-title-text' : '.acp-collection').first().waitFor();
        await page.locator('.acp-collection img').evaluateAll(imgs => Promise.all(imgs.map(img => img.decode().catch(() => {}))));
        await page.waitForTimeout(600);
        const metrics = await page.evaluate(() => {
          const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
          const card = document.querySelector('.acp-collection[aria-label="测试文件夹"]') || document.querySelector('.acp-collection');
          return {
            has: CSS.supports('selector(:has(*))'), cqi: CSS.supports('width: 1cqi'), dvh: CSS.supports('height: 100dvh'),
            topbar: rect(document.querySelector('.mamage-topbar')),
            controls: [...document.querySelectorAll('.mamage-nav-brand-slot, .mamage-nav-search-group, .mamage-create-album, .mamage-account-group > .glass-settings-slot, .mamage-user-menu')].map(rect),
            card: card && rect(card), previews: [...(card?.querySelectorAll('.acp-fan-cover') || [])].map(rect),
            imageCount: card?.querySelectorAll('img').length || 0,
            loadedImages: [...(card?.querySelectorAll('img') || [])].filter(img => img.complete && img.naturalWidth).length,
            scrollWidth: document.documentElement.scrollWidth,
          };
        });
        const label = `${view}-${width}-${canCreate ? 'admin' : 'viewer'}`;
        if (artifacts) await page.screenshot({ path: path.join(artifacts, `${label}.png`) });
        cases.push({ width, view, canCreate, ...metrics });
        const check = (condition, message) => { if (!condition) failures.push(`${label}: ${message}`); };
        check(metrics.controls.length === (view !== 'album' && canCreate ? 5 : 4), 'Header controls follow create permission and page');
        check(metrics.topbar.height <= 48 && metrics.controls.every(r => Math.abs(r.y - metrics.controls[0].y) < 2), 'Account circle wraps onto a second row');
        check(metrics.controls.every(r => r.x >= -1 && r.x + r.width <= width + 1), 'Header exceeds the viewport');
        if (view !== 'album') {
          check(metrics.previews.length > 0 && metrics.previews.every(r => r.width > metrics.card.width * .4 && r.width <= metrics.card.width * 1.4 && r.height <= 400), 'Folder previews escape their card');
          check(metrics.loadedImages === metrics.imageCount, 'Preview images must render');
          if (view === 'home') check(metrics.imageCount > 0, 'Photo fixture must render');
          if (view === 'nested') {
            check(await page.locator('.acp-fan-folder').count() > 0, 'Nested folder fixture must render');
            check(await page.locator('.acp-fan-folder-shell').first().evaluate(el =>
              getComputedStyle(el, '::after').backgroundColor !== 'rgba(0, 0, 0, 0)'), 'Folder shell must not lose its background');
          }
          await page.locator('.acp-collection').first().evaluate(card => { card.style.width = '200px'; card.style.maxWidth = '200px'; });
          await page.waitForTimeout(150);
          const sizes = await page.locator('.acp-collection').first().evaluate(card => ({
            width: card.clientWidth, fallback: parseFloat(card.style.getPropertyValue('--acp-card-inline-size')),
            previews: [...card.querySelectorAll('.acp-fan-cover')].map(el => el.getBoundingClientRect().width),
          }));
          check(metrics.cqi || Math.abs(sizes.width - sizes.fallback) < 1, 'Legacy container sizing updates on resize');
          check(sizes.previews.every(w => w < 260), 'Resized previews remain bounded');
        } else {
          await page.locator('.mamage-brand-button.is-project-title').click(); await page.waitForTimeout(700);
          const surface = await page.locator('.mamage-nav-brand-group').boundingBox();
          const info = await page.locator('.mamage-project-info-panel').boundingBox();
          check(info.y + info.height <= surface.y + surface.height + 1, 'Expanded album details stay inside one surface');
          check(await page.locator('.mamage-project-info-title').count() === 0, 'Album title is not duplicated');
          if (artifacts) await page.screenshot({ path: path.join(artifacts, `${label}-expanded.png`) });
          await page.locator('.mamage-brand-button.is-project-title').click(); await page.waitForTimeout(500);
        }
        await page.locator('.mamage-user-chip').click(); await page.waitForTimeout(600);
        const account = page.locator('.mamage-user-menu-panel'), ar = await account.boundingBox();
        check(ar.x >= 0 && ar.x + ar.width <= width + 1 && ar.y + ar.height <= 844, 'Account panel fits the viewport');
        check(await account.getByRole('button', { name: '账户信息', exact: true }).evaluate(el => {
          const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }), 'Account menu can be clicked');
        await page.locator('.mamage-header').getByRole('button', { name: '显示设置', exact: true }).click(); await page.waitForTimeout(600);
        const settings = await page.locator('.mamage-header .glass-settings').boundingBox();
        check(settings.x >= 0 && settings.x + settings.width <= width + 1 && settings.y + settings.height <= 844, 'Settings panel fits the viewport');
        check((await page.locator('.mamage-topbar').boundingBox()).height <= 48, 'Opening menus does not wrap the header');
        await page.keyboard.press('Escape');
        const input = page.locator('.mamage-nav-search-input'); await input.fill('拿话筒的人');
        check(await input.evaluate(el => getComputedStyle(el).paddingRight === '60px'), 'Text leaves room for search and clear buttons');
        check(metrics.scrollWidth <= width + 1, 'Page has horizontal overflow');
        check(errors.length === 0, `Page errors: ${errors.join('; ')}`);
      } finally { await context.close(); }
    }
    console.log(JSON.stringify({ browser: browser.version(), cases, failures }));
    assert.deepEqual(failures, []);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
