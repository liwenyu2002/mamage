const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright');
const sharp = runtime('sharp');
const dist = path.resolve(process.env.MAMAGE_GLASS_DIST || path.join(__dirname, '../dist'));
const output = process.env.MAMAGE_GLASS_QA_DIR ? path.resolve(process.env.MAMAGE_GLASS_QA_DIR)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'mamage-glass-fallback-'));
const androidUA = 'Mozilla/5.0 (Linux; Android 12; Pixel 5 Build/SQ3A.220705.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/104.0.5112.97 Mobile Safari/537.36 AliApp(DingTalk/7.6.5) com.alibaba.android.rimet/31496368 Channel/212200 language/zh-CN';

async function main() {
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), `Built App missing: ${dist}`);
  const index = fs.readFileSync(path.join(dist, 'index.html'));
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const requested = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const file = requested.startsWith(dist + '/') && fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested : path.join(dist, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html');
    // Keep this run on one hashed build even if another agent rebuilds dist.
    if (file === path.join(dist, 'index.html')) { res.end(index); return; }
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const report = { dist, output, indexSha256: createHash('sha256').update(index).digest('hex'),
    executable: process.env.MAMAGE_GLASS_EXECUTABLE || 'bundled', cases: [], failures: [] };
  try {
    browser = await chromium.launch({ ...(process.env.MAMAGE_GLASS_EXECUTABLE ? { executablePath: process.env.MAMAGE_GLASS_EXECUTABLE } : {}) });
    report.browserVersion = browser.version();
    const image = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#567d72' } }).jpeg().toBuffer();
    const photos = [11, 12].map(id => ({ id, projectId: 9001, unitId: 1, photographerId: 7, type: 'normal',
      url: `/api/image/${id}.jpg`, thumbUrl: `/api/image/${id}.jpg`, title: `Fixture photo ${id}`, originalFilename: `fixture-${id}.jpg`, aiStatus: 'done' }));
    const album = { id: 9001, title: 'Glass fallback fixture', name: 'Glass fallback fixture', adminId: 7, unitId: 1,
      canEdit: true, images: photos, image: photos[0].url, count: photos.length, timelineEnabled: false, timelineSections: [] };
    const widths = process.env.MAMAGE_GLASS_WIDTH ? [Number(process.env.MAMAGE_GLASS_WIDTH)] : [390, 320];
    const modes = process.env.MAMAGE_GLASS_MODE ? [process.env.MAMAGE_GLASS_MODE] : ['dingtalk', 'normal'];
    for (const width of widths) for (const mode of modes) {
      assert.ok(['dingtalk', 'normal'].includes(mode), 'MAMAGE_GLASS_MODE must be dingtalk or normal');
      const fallback = mode === 'dingtalk';
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce',
        serviceWorkers: 'block', ...(fallback ? { userAgent: androidUA, isMobile: true, hasTouch: true } : {}) });
      const result = { width, mode, forcedNoBackdrop: fallback, surfaces: [], errors: [], unexpectedRequests: [], writes: [] };
      report.cases.push(result);
      const prefix = `${mode}-${width}`;
      const check = (condition, message) => { if (!condition) report.failures.push({ case: prefix, message }); };
      try {
        await context.addInitScript(({ fallback }) => {
          if (!/^https?:$/.test(location.protocol)) return;
          localStorage.setItem('mamage_jwt_token', 'isolated-glass-fallback-fixture');
          localStorage.setItem('mamage-folder-style:v1:7', 'glass');
          if (!fallback) return;
          // Model a WebView that reports CSS support but cannot render backdrop blur.
          // Never set the application's fallback attribute or change its fill tokens.
          const install = () => {
            if (!document.head) return false;
            const style = document.createElement('style');
            style.id = 'fixture-disable-backdrop';
            style.textContent = 'html:root:root:root:root *, html:root:root:root:root *::before, html:root:root:root:root *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }';
            document.head.append(style); return true;
          };
          if (!install()) {
            const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
            observer.observe(document, { childList: true, subtree: true });
          }
        }, { fallback });
        await context.route('**/*', route => {
          const request = route.request(), url = new URL(request.url()), p = url.pathname;
          if (url.origin !== base) { result.unexpectedRequests.push(`${request.method()} ${url.origin}${p}`); return route.abort(); }
          if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
            result.writes.push(`${request.method()} ${p}`); return route.abort();
          }
          if (!p.startsWith('/api/')) return route.continue();
          if (p.startsWith('/api/image/')) return route.fulfill({ contentType: 'image/jpeg', body: image });
          let data = {};
          if (p === '/api/users/me') data = { id: 7, name: 'Glass fixture', role: 'admin', activeUnitId: 1,
            workspaceEnabled: true, unitRole: 'manager', metadataEditScope: 'unit', photoDeleteScope: 'unit',
            permissions: ['projects.view', 'projects.create', 'projects.update', 'photos.view', 'photos.edit', 'photos.zip', 'upload.photo', 'tags.edit'] };
          else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 1, units: [{ id: 1, name: 'Fixture workspace', role: 'manager' }] };
          else if (p === '/api/album-desktop') data = { albums: [album], groups: [{ id: 'root', name: 'Fixture folder', parentId: null,
            kind: 'manual', projectIds: [9001], createdBy: 7, canEdit: true }], sharedAlbums: [], sharedFolders: [],
            preferences: { pins: [], recentItems: [], colors: {} }, canOrganize: true, canDeleteFolders: true,
            scope: { userId: 7, organizationId: 2, unitId: 1 }, workspaceRevision: 1, userRevision: 1 };
          else if (p === '/api/projects/9001') data = album;
          else if (p === '/api/projects/list') data = { list: [album], total: 1, hasMore: false };
          else if (p === '/api/photos') data = { list: photos, total: photos.length, hasMore: false };
          else if (/^\/api\/photos\/\d+$/.test(p)) data = photos.find(photo => photo.id === Number(p.split('/').at(-1))) || {};
          else if (p === '/api/projects/import-status') data = { statuses: {} };
          else if (p.endsWith('/person-observations')) data = { enabled: false, people: [] };
          else if (p === '/api/similarity/groups/simple') data = { groups: [], photos: {} };
          else if (p.endsWith('/previews')) data = { list: [] };
          return route.fulfill({ json: data });
        });
        const page = await context.newPage(); page.setDefaultTimeout(7000);
        page.on('pageerror', error => result.errors.push(error.message));
        const inspect = async (name, selector, pseudo = null) => {
          const locator = page.locator(selector).first(); await locator.waitFor({ state: 'visible' });
          // Some legacy opacity transitions still run under reduced motion.
          await locator.evaluate(async node => {
            await new Promise(requestAnimationFrame);
            const animations = [];
            for (let element = node; element; element = element.parentElement) {
              animations.push(...element.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity));
            }
            await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
          });
          const material = await locator.evaluate((node, pseudo) => {
            const css = getComputedStyle(node, pseudo), rect = node.getBoundingClientRect();
            // Canvas parses computed CSS colors on old and new engines alike.
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = css.backgroundColor; ctx.fillRect(0, 0, 1, 1);
            const rgba = [...ctx.getImageData(0, 0, 1, 1).data];
            let opacity = 1;
            for (let element = node; element; element = element.parentElement) opacity *= Number(getComputedStyle(element).opacity);
            if (pseudo) opacity *= Number(css.opacity);
            return { backgroundColor: css.backgroundColor, backgroundImage: css.backgroundImage, rgba,
              alpha: rgba[3] / 255, effectiveAlpha: rgba[3] / 255 * opacity, opacity,
              backdropFilter: css.backdropFilter || css.webkitBackdropFilter || 'none',
              content: css.content, display: css.display, visibility: css.visibility,
              rootFallback: document.documentElement.getAttribute('data-glass-fallback'),
              theme: node.closest('[data-glass-theme]')?.getAttribute('data-glass-theme') || null,
              width: rect.width, height: rect.height,
              supportsBackdrop: CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)') };
          }, pseudo);
          result.surfaces.push({ name, selector, pseudo, ...material });
          check(material.width > 0 && material.height > 0 && material.display !== 'none' && material.visibility === 'visible', `${name}: surface is not rendered`);
          if (pseudo) check(material.content !== 'none', `${name}: pseudo material is absent`);
          check(fallback ? material.rootFallback === 'true' : material.rootFallback === null,
            `${name}: root fallback should be ${fallback ? 'true' : 'absent'}, got ${material.rootFallback}`);
          if (fallback) {
            check(material.backdropFilter === 'none', `${name}: forced blur override was ineffective`);
            check(material.effectiveAlpha >= .9, `${name}: no-blur fill alpha ${material.effectiveAlpha.toFixed(3)} < 0.9`);
          } else {
            check(material.alpha < .9, `${name}: normal material unexpectedly became opaque (${material.alpha.toFixed(3)})`);
            check(material.backdropFilter !== 'none', `${name}: normal material lost its backdrop`);
            const readableAlpha = { 'display-settings': .82, account: .82, 'album-card-menu': .82, 'album-selection-actions': .82,
              'viewer-dark-settings': .86, 'viewer-dark-details': .86 }[name];
            if (readableAlpha) check(Math.abs(material.alpha - readableAlpha) < .01, `${name}: expected normal readable alpha ${readableAlpha}, got ${material.alpha}`);
          }
          if (name.startsWith('viewer-dark')) {
            check(material.theme === 'dark', `${name}: dark theme was not activated`);
            if (fallback) check(material.rgba.slice(0, 3).every(channel => channel < 80), `${name}: dark fallback fill is not dark`);
          }
          if (material.theme === 'dark' && material.alpha > .5) {
            check(material.rgba.slice(0, 3).every(channel => channel < 80), `${name}: dark panel stayed light`);
          }
          await page.screenshot({ path: path.join(output, `${prefix}-${name}.png`), animations: 'disabled' });
        };
        const step = async (name, run) => {
          try { await run(); } catch (error) {
            report.failures.push({ case: prefix, step: name, message: error.message });
            await page.screenshot({ path: path.join(output, `${prefix}-${name}-interaction-failure.png`) }).catch(() => {});
          }
        };
        const home = async () => { await page.goto(base); await page.locator('.detail-bottom-nav--adaptive').waitFor(); };
        const checkViewerTheme = async dark => {
          await page.locator('.viewer-overlay').evaluate(async node => {
            await new Promise(requestAnimationFrame);
            await Promise.all(node.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity)
              .map(animation => animation.finished.catch(() => {})));
          });
          const state = await page.locator('.viewer-overlay').evaluate(node => {
            const css = getComputedStyle(node), backdrop = getComputedStyle(node.querySelector('.viewer-backdrop'));
            return { theme: node.dataset.glassTheme, background: css.backgroundColor,
              backdrop: { background: backdrop.backgroundColor, filter: backdrop.filter },
              saved: JSON.parse(localStorage.getItem('mamage-viewer-appearance')) };
          });
          const pixels = await sharp(await page.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          // The far right of the stage is outside the fixture photo and all controls.
          const offset = (Math.round(pixels.info.height * .35) * pixels.info.width + pixels.info.width - 3) * pixels.info.channels;
          const rgb = [...pixels.data.subarray(offset, offset + 3)];
          const mediaBox = await page.locator('.viewer-slide.is-active img').first().boundingBox();
          const mediaOffset = (Math.round(mediaBox.y + mediaBox.height / 2) * pixels.info.width
            + Math.round(mediaBox.x + mediaBox.width / 2)) * pixels.info.channels;
          const mediaRgb = [...pixels.data.subarray(mediaOffset, mediaOffset + 3)];
          (result.themes ||= []).push({ dark, ...state, rgb, mediaRgb });
          check(mediaRgb.every((value, index) => Math.abs(value - [86, 125, 114][index]) < 4),
            `Appearance changed photo pixels: ${mediaRgb}`);
          check(state.theme === (dark ? 'dark' : 'light'), `Viewer theme did not follow ${dark ? 'dark' : 'light'} selection`);
          check(dark ? rgb.every(value => value < 100) : rgb.every(value => value > 180),
            `Viewer stage should be ${dark ? 'dark' : 'light'}, got pixel ${rgb} (${JSON.stringify(state)})`);
        };
        await step('display-settings', async () => {
          await home();
          await page.locator('.mamage-header').getByRole('button', { name: '显示设置', exact: true }).click();
          await inspect('display-settings', '.mamage-header .glass-settings.is-open');
        });
        await step('navigation', async () => {
          await home(); await page.getByRole('button', { name: '打开导航', exact: true }).click();
          await inspect('navigation', '.mamage-mobile-nav-panel.is-open');
        });
        await step('account', async () => {
          await home(); await page.locator('.mamage-user-chip').click();
          await page.getByRole('button', { name: '退出账号', exact: true }).waitFor();
          await inspect('account', '.mamage-user-menu[data-compact="true"] .mamage-user-menu-panel, .mamage-user-menu[data-compact="false"] .mamage-account-surface');
        });
        await step('workspace-dock', async () => {
          await home();
          await inspect('workspace-dock-capsule', '.detail-bottom-nav--adaptive .album-dock-morph-surface', '::before');
          await inspect('workspace-dock-primary', '.detail-bottom-nav--adaptive .detail-bottom-upload');
          await page.locator('.detail-bottom-nav--adaptive').getByRole('button', { name: '选择', exact: true }).click();
          await inspect('workspace-dock-expanded', '.detail-bottom-nav--adaptive .album-dock-morph-surface', '::before');
        });
        await step('album-card-menu', async () => {
          await page.goto(`${base}/?folder=root`);
          await page.getByRole('button', { name: `更多操作 ${album.name}`, exact: true }).click();
          await inspect('album-card-menu', '.desktop-photo-menu');
        });
        await step('album-actions', async () => {
          await page.goto(`${base}/?projectId=9001`);
          const dock = page.getByRole('navigation', { name: '相册底部操作', exact: true }); await dock.waitFor();
          await inspect('album-dock-capsule', '.detail-bottom-nav--adaptive .album-dock-morph-surface', '::before');
          await inspect('album-dock-primary', '.detail-bottom-nav--adaptive .detail-bottom-upload');
          await dock.getByRole('button', { name: '打开功能', exact: true }).click();
          await inspect('album-actions', '.detail-actions-sheet.is-open');
        });
        await step('album-selection-actions', async () => {
          await page.goto(`${base}/?projectId=9001`);
          const dock = page.getByRole('navigation', { name: '相册底部操作', exact: true }); await dock.waitFor();
          await dock.getByRole('button', { name: '选择', exact: true }).click();
          const selection = page.locator('[data-photo-id="11"] .detail-photo-select');
          await selection.click();
          assert.ok(await selection.locator('input').isChecked(), 'Fixture photo must actually be selected');
          await inspect('album-selection-actions', '.detail-selection-inline.is-expanded');
        });
        await step('viewer-dark', async () => {
          await home();
          await page.locator('.mamage-header').getByRole('button', { name: '显示设置', exact: true }).click();
          await page.getByRole('checkbox', { name: '深色外观', exact: true }).check();
          const siteTheme = await page.evaluate(() => {
            const rgba = color => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
              const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
              return [...ctx.getImageData(0, 0, 1, 1).data]; };
            return { theme: document.documentElement.dataset.glassTheme,
              body: rgba(getComputedStyle(document.body).backgroundColor),
              title: rgba(getComputedStyle(document.querySelector('h1')).color),
              folderTitle: rgba(getComputedStyle(document.querySelector('.acp-collection-caption strong')).color) };
          });
          result.siteTheme = siteTheme;
          check(siteTheme.theme === 'dark', `All-site appearance must apply to the root, got ${JSON.stringify(siteTheme)}`);
          check(siteTheme.body.slice(0, 3).every(value => value < 80), 'Site background stayed light');
          check(siteTheme.title.slice(0, 3).every(value => value > 180), 'Site heading is not readable in dark mode');
          check(siteTheme.folderTitle.slice(0, 3).every(value => value > 180), 'Folder heading is not readable in dark mode');
          await inspect('site-dark-settings', '.mamage-header .glass-settings.is-open');
          await page.keyboard.press('Escape');
          await page.getByRole('button', { name: '打开导航', exact: true }).click();
          await inspect('site-dark-navigation', '.mamage-mobile-nav-panel.is-open');
          await page.keyboard.press('Escape');
          await page.locator('.mamage-user-chip').click();
          await page.getByRole('button', { name: '退出账号', exact: true }).waitFor();
          await inspect('site-dark-account', '.mamage-user-menu[data-compact="true"] .mamage-user-menu-panel, .mamage-user-menu[data-compact="false"] .mamage-account-surface');
          await page.keyboard.press('Escape');
          await page.screenshot({ path: path.join(output, `${prefix}-site-dark.png`), animations: 'disabled' });
          await page.reload();
          check(await page.locator('html').getAttribute('data-glass-theme') === 'dark', 'Theme was lost on reload');
          await page.getByRole('button', { name: '更多操作 Fixture folder', exact: true }).click();
          await page.getByRole('menu', { name: '文件夹操作 Fixture folder', exact: true }).waitFor();
          const portal = await page.locator('.acp-collection-popup').evaluate(node => ({
            theme: node.closest('[data-glass-theme]')?.getAttribute('data-glass-theme'),
            fill: getComputedStyle(node).backgroundColor,
          }));
          check(portal.theme === 'dark', `Portal missed site theme: ${JSON.stringify(portal)}`);
          check(/rgba?\(26, 28, 31/.test(portal.fill), `Portal stayed light: ${portal.fill}`);
          await page.screenshot({ path: path.join(output, `${prefix}-site-dark-menu.png`), animations: 'disabled' });
          await page.goto(`${base}/?projectId=9001`);
          await page.getByRole('navigation', { name: '相册底部操作', exact: true })
            .getByRole('button', { name: '打开功能', exact: true }).click();
          await inspect('site-dark-album-actions', '.detail-actions-sheet.is-open');
          const actionColor = await page.locator('.detail-action-tile').first().evaluate(node => getComputedStyle(node).color);
          check(actionColor.match(/[\d.]+/g)?.slice(0, 3).every(channel => Number(channel) > 180),
            `Dark album action text is not readable: ${actionColor}`);
          await page.goto(`${base}/?projectId=9001&photoId=11`);
          const viewer = page.locator('.viewer-overlay'); await viewer.waitFor();
          await page.locator('.viewer-slide.is-active img').first().evaluate(img => img.decode());
          await checkViewerTheme(true);
          await viewer.getByRole('button', { name: '显示设置', exact: true }).click();
          await viewer.getByRole('checkbox', { name: '深色外观', exact: true }).uncheck();
          await viewer.getByRole('button', { name: '显示设置', exact: true }).click();
          await checkViewerTheme(false);
          await viewer.getByRole('button', { name: '显示设置', exact: true }).click();
          await viewer.getByRole('checkbox', { name: '深色外观', exact: true }).check();
          await viewer.getByRole('button', { name: '显示设置', exact: true }).click();
          await checkViewerTheme(true);
          await viewer.getByRole('button', { name: '显示设置', exact: true }).click();
          await inspect('viewer-dark-settings', '.viewer-overlay .glass-settings.is-open');
          await page.keyboard.press('Escape');
          await viewer.getByRole('button', { name: '显示信息', exact: true }).click();
          await inspect('viewer-dark-details', '.viewer-details-panel');
          await inspect('viewer-dark-dock', '.viewer-dock-actions');
          await viewer.getByRole('button', { name: '显示设置', exact: true }).click();
          await viewer.getByRole('checkbox', { name: '深色外观', exact: true }).uncheck();
          await home();
          check(await page.locator('html').getAttribute('data-glass-theme') === 'light', 'Viewer switch did not restore the whole site to light');
          await page.screenshot({ path: path.join(output, `${prefix}-site-restored-light.png`), animations: 'disabled' });
        });
        check(result.surfaces.length === 18, `Expected all 18 material surfaces, got ${result.surfaces.length}`);
        check(result.errors.length === 0, `Page errors: ${JSON.stringify(result.errors)}`);
        check(result.unexpectedRequests.length === 0, `Blocked external requests: ${JSON.stringify(result.unexpectedRequests)}`);
        check(result.writes.length === 0, `Unexpected writes blocked: ${JSON.stringify(result.writes)}`);
        console.log(JSON.stringify({ case: prefix, surfaces: result.surfaces.map(({ name, alpha, rootFallback }) => ({ name, alpha, rootFallback })),
          failures: report.failures.filter(failure => failure.case === prefix).length }));
      } finally { await context.close(); }
    }
    report.passed = report.failures.length === 0;
    console.log(JSON.stringify({ passed: report.passed, browserVersion: report.browserVersion, indexSha256: report.indexSha256, cases: report.cases.length,
      failures: report.failures.length, report: path.join(output, 'report.json'), fixtureOnly: true }));
    if (!report.passed) process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
