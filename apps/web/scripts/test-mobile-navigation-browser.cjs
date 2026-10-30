const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../../server/package.json'))('playwright');
const base = process.env.MAMAGE_NAV_TEST_URL || 'http://127.0.0.1:5197';
const artifacts = process.env.MAMAGE_NAV_QA_DIR;
async function main() {
  const browser = await chromium.launch();
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const results = [];
  try {
    for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
      for (const albumView of [true, false]) {
        const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width <= 430, hasTouch: width <= 430 });
        const errors = [], requests = [];
        try {
          await context.addInitScript(() => localStorage.setItem('mamage_jwt_token', 'mobile-nav-isolated-test'));
          await context.route('**/api/**', route => {
            const req = route.request(), url = new URL(req.url()), p = url.pathname;
            requests.push({ p, method: req.method(), q: url.searchParams.get('q') });
            const album = { id: 9001, name: 'AI青年说：人工智能与未来校园创新实践交流系列活动', images: [], count: 0, unitId: 1, adminId: 7, canEdit: true };
            let data = {};
            if (p === '/api/users/me') data = { id: 7, name: '李文宇', role: 'admin', activeUnitId: 1, permissions: ['projects.view', 'projects.create', 'photos.view'] };
            else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 1, units: [{ id: 1, name: '学工与融媒体中心', role: 'manager' }] };
            else if (p === '/api/album-desktop') data = { albums: [album], groups: [], sharedAlbums: [], sharedFolders: [], preferences: { pins: [], colors: {} }, scope: { userId: 7, organizationId: 2, unitId: 1 }, workspaceRevision: 1, userRevision: 1 };
            else if (p === '/api/projects/9001') data = album;
            else if (p === '/api/photos') data = { list: [], total: 0, hasMore: false };
            else if (p === '/api/projects/list') data = { list: [album], total: 1, hasMore: false };
            return route.fulfill({ json: data });
          });
          const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
          await page.goto(base + (albumView ? '/?projectId=9001' : '/'));
          await page.locator('.mamage-user-chip').waitFor();
          if (albumView && width <= 1024) await page.locator('.mamage-project-title-text').filter({ hasText: 'AI青年说' }).waitFor();
          await page.waitForTimeout(700);
          const header = page.locator('.mamage-header'), topbar = page.locator('.mamage-topbar');
          const height = (await topbar.boundingBox()).height;
          if (artifacts) await page.screenshot({ path: path.join(artifacts, `${albumView ? 'album' : 'home'}-${width}.png`) });
          if (width <= 1024) {
            assert.ok(height <= 48, `Mobile header wraps: ${width}px ${albumView ? 'album' : 'home'} height=${height}`);
            const controls = await page.locator('.mamage-nav-brand-group, .mamage-nav-search-group, .mamage-account-group > .glass-settings-slot, .mamage-account-group > .mamage-user-menu').evaluateAll(els => els.map(e => {
              const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
            }));
            assert.ok(controls.every(r => Math.abs(r.y + r.height / 2 - (controls[0].y + controls[0].height / 2)) < 2), JSON.stringify(controls));
            assert.equal(await page.locator('.mamage-user-chip').innerText(), '李');
            assert.ok(controls.every(r => r.x >= 0 && r.x + r.width <= width + 1));
            const searchBefore = await page.locator('.mamage-nav-search-group').boundingBox();
            if (albumView) {
              assert.equal(await page.locator('.mamage-menu-trigger.is-home').evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
              const title = page.locator('.mamage-brand-button.is-project-title'), before = await page.locator('.mamage-nav-brand-group').boundingBox();
              const contentTop = await page.locator('.mamage-content').evaluate(el => el.getBoundingClientRect().top);
              const frames = await page.locator('.mamage-nav-search-group').evaluate(async el => {
                const values = [], start = performance.now();
                document.querySelector('.mamage-brand-button.is-project-title').click();
                do {
                  await new Promise(requestAnimationFrame);
                  const surface = document.querySelector('.mamage-nav-brand-group'), r = surface.getBoundingClientRect(), css = getComputedStyle(surface);
                  values.push({ width: Math.round(el.getBoundingClientRect().width), height: Math.round(r.height), x: r.x, y: r.y, blur: css.backdropFilter, opacity: css.opacity });
                } while (performance.now() - start < 1000);
                return values;
              });
              assert.ok(new Set(frames.map(f => f.width)).size >= 4, `Search must animate shorter, not jump: ${width}px ${JSON.stringify(frames.filter((_, i) => i % 5 === 0))}`);
              assert.ok(new Set(frames.map(f => f.height)).size >= 4, 'Album surface must unfold down rather than pop in');
              assert.ok(frames.every(f => Math.abs(f.x - before.x) < 1 && Math.abs(f.y - before.y) < 1 && f.opacity === '1' && f.blur === frames[0].blur), 'Surface keeps its anchor and glass material while opening');
              assert.ok((await page.locator('.mamage-nav-brand-group').boundingBox()).width > before.width + 10);
              assert.ok((await page.locator('.mamage-nav-search-group').boundingBox()).width < searchBefore.width - 10);
              assert.ok((await topbar.boundingBox()).height <= 48);
              assert.ok(await page.locator('.mamage-project-info-panel').isVisible());
              const expanded = await page.locator('.mamage-nav-brand-group').boundingBox();
              const info = await page.locator('.mamage-project-info-panel').boundingBox();
              assert.ok(expanded.height > before.height + 50);
              assert.ok(info.y >= expanded.y && info.y + info.height <= expanded.y + expanded.height + 1, 'Details stay within the same expanded surface');
              assert.equal(await page.locator('.mamage-project-info-title').count(), 0, 'Do not repeat the title in a second panel');
              assert.equal(await page.locator('.mamage-project-info-panel').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
              assert.ok(await title.evaluate(el => el.scrollHeight <= el.clientHeight + 1), 'Expanded title is fully readable');
              assert.ok(Math.abs(await page.locator('.mamage-content').evaluate(el => el.getBoundingClientRect().top) - contentTop) < 1, 'Opening must not shift page content');
              if (artifacts) await page.screenshot({ path: path.join(artifacts, `title-open-${width}.png`) });
              await title.click(); await page.waitForTimeout(600);
              assert.ok(Math.abs((await page.locator('.mamage-nav-brand-group').boundingBox()).height - before.height) < 1);
              assert.equal(await page.locator('.mamage-project-info-panel').evaluate(el => el.inert), true);
              if (width === 390) {
                const reversals = await title.evaluate(async trigger => {
                  const frames = [];
                  for (const duration of [120, 100, 160, 650]) {
                    trigger.click(); const start = performance.now();
                    do {
                      await new Promise(requestAnimationFrame);
                      const surface = document.querySelector('.mamage-nav-brand-group'), r = surface.getBoundingClientRect();
                      frames.push({ height: r.height, x: r.x, y: r.y, opacity: getComputedStyle(surface).opacity, top: document.querySelector('.mamage-content').getBoundingClientRect().top });
                    } while (performance.now() - start < duration);
                  }
                  return frames;
                });
                assert.ok(reversals.every(f => f.opacity === '1' && Math.abs(f.x - before.x) < 1 && Math.abs(f.y - before.y) < 1 && Math.abs(f.top - contentTop) < 1));
                assert.ok(Math.abs(reversals.at(-1).height - before.height) < 1, 'Rapid reversals return to the closed height');
                await page.emulateMedia({ reducedMotion: 'reduce' });
                await title.click(); await page.waitForTimeout(100);
                assert.equal(await page.locator('.mamage-nav-brand-group').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
                assert.ok((await page.locator('.mamage-nav-brand-group').boundingBox()).height > 90);
                await title.click(); await page.waitForTimeout(100);
                await page.emulateMedia({ reducedMotion: 'no-preference' });
              }
              await title.click(); await page.waitForTimeout(900);
              await page.locator('.mamage-search-submit').click(); await page.waitForTimeout(650);
              assert.equal(await page.locator('.mamage-nav-search-input').evaluate(el => el === document.activeElement), true);
              await page.locator('.mamage-nav-search-input').press('Escape');
              await page.keyboard.press('Escape');
            }
            await page.locator('.mamage-user-chip').click(); await page.waitForTimeout(650);
            assert.ok((await topbar.boundingBox()).height <= 48);
            const account = page.locator('.mamage-user-menu-panel');
            await account.getByText('学工与融媒体中心', { exact: true }).first().waitFor();
            const ar = await account.boundingBox(); assert.ok(ar.x >= 0 && ar.x + ar.width <= width + 1);
            assert.ok(await account.getByRole('button', { name: '账户信息', exact: true }).evaluate(el => {
              const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
            }), 'Account menu items must receive pointer input');
            if (artifacts) await page.screenshot({ path: path.join(artifacts, `account-open-${albumView ? 'album' : 'home'}-${width}.png`) });
            await header.getByRole('button', { name: '显示设置', exact: true }).click(); await page.waitForTimeout(650);
            assert.equal(await page.locator('.mamage-user-chip').getAttribute('aria-expanded'), 'false');
            const settings = await header.locator('.glass-settings').boundingBox();
            assert.ok(settings.x >= 0 && settings.x + settings.width <= width + 1);
            assert.ok((await topbar.boundingBox()).height <= 48);
            if (artifacts) await page.screenshot({ path: path.join(artifacts, `settings-open-${albumView ? 'album' : 'home'}-${width}.png`) });
            await page.keyboard.press('Escape');
            const input = page.locator('.mamage-nav-search-input');
            await input.focus(); await input.fill('拿话筒的人'); await page.waitForTimeout(650);
            assert.ok((await page.locator('.mamage-nav-search-group').boundingBox()).width >= searchBefore.width);
            await input.press('Enter'); await page.waitForTimeout(150);
            assert.equal(await input.inputValue(), '拿话筒的人');
            if (artifacts) await page.screenshot({ path: path.join(artifacts, `search-${albumView ? 'album' : 'home'}-${width}.png`) });
            await input.press('Escape'); await page.waitForTimeout(650);
          }
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          assert.deepEqual(errors, []);
          results.push({ width, albumView, height });
        } finally { await context.close(); }
      }
    }
    console.log(JSON.stringify({ passed: true, cases: results, productionRequests: 0 }));
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
