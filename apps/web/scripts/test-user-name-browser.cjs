const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../../server/package.json'))('playwright');
const dist = path.resolve(__dirname, '../dist'), artifacts = process.env.MAMAGE_USER_NAME_QA_DIR;

async function main() {
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer((req, res) => {
    const requested = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const file = requested.startsWith(dist + '/') && fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested : path.join(dist, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch(), base = `http://127.0.0.1:${server.address().port}`, cases = [];
  try {
    for (const width of [320, 390, 1024, 1100, 1440, 1920, 2560]) for (const name of ['李文宇', '欧阳思远', 'Alexandria Montgomery']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const errors = [], writes = [];
      try {
        await context.addInitScript(() => localStorage.setItem('mamage_jwt_token', 'isolated-user-name-fixture'));
        await context.route('**/api/**', route => {
          const req = route.request(), p = new URL(req.url()).pathname, send = json => route.fulfill({ json });
          if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { writes.push(p); return route.abort(); }
          if (p === '/api/users/me') return send({ id: 7, name, displayName: 'Nickname', email: 'student@example.invalid', role: 'admin',
            permissions: ['projects.view', 'projects.create', 'photos.view', 'ai.generate'], workspaceEnabled: true, activeUnitId: 1 });
          if (p === '/api/workspaces') return send({ enabled: true, activeUnitId: 1, units: [{ id: 1, name: '学工与融媒体中心', role: 'manager' }] });
          if (p === '/api/album-desktop') return send({ albums: [], groups: [], sharedAlbums: [], sharedFolders: [], preferences: { pins: [], colors: {} },
            scope: { userId: 7, organizationId: 2, unitId: 1 }, workspaceRevision: 1, userRevision: 1 });
          if (p === '/api/projects/list') return send({ list: [], total: 0, hasMore: false });
          if (p === '/api/projects/import-status') return send({ statuses: {} });
          if (p === '/api/projects/84') return send({ id: 84, name: '测试相册', photos: [], timelineSections: [], permissions: {} });
          return send([]);
        });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        for (const route of ['/', '/?projectId=84']) {
          await page.goto(base + route);
          const mobile = width <= 1024;
          const chip = page.locator('.mamage-user-chip'); await chip.waitFor();
          const label = mobile ? chip : page.locator('.mamage-user-name');
          await page.waitForTimeout(100);
          assert.equal(await label.innerText(), mobile ? Array.from(name)[0] : name);
          assert.equal(await page.locator('.mamage-avatar').count(), 0);
          const geometry = await label.evaluate(el => {
            const rect = el.getBoundingClientRect(), chip = el.closest('.mamage-user-chip').getBoundingClientRect();
            const input = document.querySelector('.mamage-nav-search-input').getBoundingClientRect();
            return { textFits: el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1,
              withinChip: rect.left >= chip.left && rect.right <= chip.right + 1,
              separated: input.right <= chip.left + 1 || input.bottom <= chip.top + 1 || chip.bottom <= input.top + 1,
              viewportFits: document.documentElement.scrollWidth <= innerWidth + 1 };
          });
          assert.deepEqual(geometry, { textFits: true, withinChip: true, separated: true, viewportFits: true }, `${width} ${name} ${route}`);
          if (width > 1024) assert.ok(await page.locator('.mamage-user-chip').evaluate(el => {
            const right = el.getBoundingClientRect().right;
            return innerWidth - right < 40;
          }), 'Account capsule stays at the right edge');
          assert.ok((await page.locator('.mamage-nav-search-group').boundingBox()).width <= 361, 'Search must not fill unused desktop space');
          const closed = await page.locator('.mamage-account-surface').boundingBox();
          const pageTop = await page.locator('.mamage-content').evaluate(el => el.getBoundingClientRect().top);
          await page.locator('.mamage-user-chip').focus(); await page.locator('.mamage-user-chip').press('Enter');
          assert.equal(await page.locator('.mamage-user-chip').evaluate(el => getComputedStyle(el).outlineColor), 'rgba(0, 0, 0, 0.24)');
          await page.getByRole('button', { name: '账户信息', exact: true }).waitFor();
          await page.waitForTimeout(600);
          const opened = await page.locator('.mamage-account-surface').boundingBox();
          if (mobile) {
            assert.equal(await page.locator('.mamage-account-summary .mamage-user-name').innerText(), name);
            assert.ok(await page.locator('.mamage-account-summary .mamage-user-name').evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1));
            assert.ok(Math.abs(opened.height - closed.height) < 1, 'Mobile trigger remains a fixed circle');
            assert.ok((await page.locator('.mamage-user-menu-panel').boundingBox()).height > 100);
          } else {
            assert.ok(opened.height > closed.height + 100, 'The capsule unfolds down into its menu');
            assert.ok(opened.width > closed.width + 20, 'The same capsule stretches horizontally');
          }
          assert.ok(Math.abs(opened.x + opened.width - closed.x - closed.width) < 1, 'Unfolding keeps the right edge anchored');
          const openedPageTop = await page.locator('.mamage-content').evaluate(el => el.getBoundingClientRect().top);
          assert.ok(Math.abs(openedPageTop - pageTop) < 1, `Unfolding must not push content down: ${width} ${name} ${route} ${pageTop} -> ${openedPageTop}`);
          assert.equal(await page.locator('.mamage-user-menu-panel').evaluate(el => getComputedStyle(el).backdropFilter), mobile ? 'blur(20px) saturate(1.45)' : 'none', 'Only mobile renders an independent popover');
          if (artifacts) await page.screenshot({ path: path.join(artifacts, `account-open-${width}-${name.length}-${route === '/' ? 'home' : 'album'}.png`) });
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('.mamage-user-chip').getAttribute('aria-expanded'), 'false');
          assert.equal(await page.locator('.mamage-user-menu .glass-unfold-body').evaluate(el => el.inert), true);
          await page.waitForTimeout(600);
          assert.ok(Math.abs((await page.locator('.mamage-account-surface').boundingBox()).height - closed.height) < 1);
          if (width === 1440 && name === '李文宇' && route === '/') {
            const frames = await page.evaluate(async () => {
              const trigger = document.querySelector('.mamage-user-chip'), surface = document.querySelector('.mamage-account-surface');
              const frames = [];
              for (const duration of [180, 160, 650, 650]) {
                trigger.click();
                const start = performance.now();
                do {
                  await new Promise(requestAnimationFrame);
                  const r = surface.getBoundingClientRect(), css = getComputedStyle(surface);
                  frames.push({ width: r.width, height: r.height, right: r.right, opacity: css.opacity, blur: css.backdropFilter,
                    top: document.querySelector('.mamage-content').getBoundingClientRect().top });
                } while (performance.now() - start < duration);
              }
              return frames;
            });
            assert.ok(frames.some(f => f.width > closed.width + 3 && f.width < opened.width - 3), 'Width interpolates, rather than appearing at its final size');
            assert.ok(frames.some(f => f.height > closed.height + 15 && f.height < opened.height - 15), 'Body is pulled open rather than popping in');
            assert.ok(frames.every(f => f.opacity === '1' && f.blur === 'blur(20px) saturate(1.45)' && Math.abs(f.right - closed.x - closed.width) < 1 && Math.abs(f.top - pageTop) < 1), 'No fade, filter flash, moving anchor or page reflow during rapid reversals');
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.locator('.mamage-user-chip').click();
            assert.equal(await page.locator('.mamage-account-surface').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
            await page.locator('.mamage-brand-button').click();
            assert.equal(await page.locator('.mamage-user-chip').getAttribute('aria-expanded'), 'false', 'Outside click closes the account menu');
            await page.emulateMedia({ reducedMotion: 'no-preference' });
          }
          await page.locator('.mamage-user-chip').evaluate(el => el.blur());
          if (artifacts) await page.screenshot({ path: path.join(artifacts, `header-${width}-${name.length}-${route === '/' ? 'home' : 'album'}.png`) });
          cases.push({ width, name, route });
        }
        assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      } finally { await context.close(); }
    }
    console.log(JSON.stringify({ passed: true, cases: cases.length }));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
