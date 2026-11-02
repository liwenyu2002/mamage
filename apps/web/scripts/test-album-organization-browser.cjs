const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright');
const sharp = runtime('sharp');
const dist = path.resolve(process.env.MAMAGE_ORGANIZATION_DIST || path.join(__dirname, '../dist'));
const artifacts = process.env.MAMAGE_ORGANIZATION_QA_DIR;

async function main() {
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const image = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#728d80' } }).jpeg().toBuffer();
  const results = [];
  const noSuggestions = async page => {
    assert.equal(await page.locator('[class*="acp-suggestion"], .acp-review-actions').count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), /整理建议|查看建议|确认归类/);
  };
  const chooseSort = async (page, label) => {
    await page.getByRole('button', { name: '按活动日期排序', exact: true }).click();
    const listbox = page.getByRole('listbox', { name: '按活动日期排序' });
    await listbox.waitFor();
    assert.ok(await listbox.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth + 1;
    }), 'shared glass select menu stays inside the viewport');
    await listbox.getByRole('option', { name: label, exact: true }).click();
    await listbox.waitFor({ state: 'detached' });
  };
  try {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const errors = [], writes = [], external = [];
      try {
        const dates = ['2026-10-10', '2025-01-01', null, '2026-10-10', 'invalid', '2026-02-02', '2027-01-01', '2026-11-01', '2023-01-01'];
        const albums = dates.map((eventDate, index) => ({ id: index + 1, name: `Campus Album ${index + 1}`, title: `Campus Album ${index + 1}`,
          eventDate, createdAt: `2026-01-${String(index + 1).padStart(2, '0')}`, updatedAt: '2026-10-01', year: '2026',
          count: 1, image: '/api/image/fixture.jpg', canEdit: true, unitId: 1 }));
        const groups = [
          { id: 'empty', name: 'Empty Folder', projectIds: [] },
          { id: 'campus', name: 'Campus Folder', projectIds: [1, 2, 3, 4, 5] },
          { id: 'other', name: 'Other Folder', projectIds: [8] },
          { id: 'new-child', name: 'New Child', parentId: 'campus', projectIds: [7] },
          { id: 'old-child', name: 'Old Child', parentId: 'campus', projectIds: [9] },
        ].map(group => ({ parentId: null, kind: 'manual', createdBy: 7, canEdit: true, ...group }));
        const state = { albums, groups, sharedAlbums: [], sharedFolders: [], preferences: {
          pins: ['album:2'], recentItems: [], colors: {}, dismissed: [3],
        }, workspaceRevision: 1, userRevision: 1, scope: { userId: 7, organizationId: 2, unitId: 1 }, canOrganize: true, canDeleteFolders: true };
        await context.addInitScript(() => {
          localStorage.setItem('mamage_jwt_token', 'isolated-organization-fixture');
          localStorage.setItem('mamage-folder-style:v1:7', 'glass');
        });
        await context.route('**/*', async route => {
          const req = route.request(), url = new URL(req.url()), p = url.pathname;
          if (p.startsWith('/api/image/')) return route.fulfill({ contentType: 'image/jpeg', body: image });
          if (p.startsWith('/api/')) {
            let data = {};
            if (req.method() !== 'GET') {
              if (p !== '/api/album-desktop/state' || req.method() !== 'PUT') {
                external.push(`${req.method()} ${p}`); return route.abort();
              }
              const body = req.postDataJSON(); writes.push(body);
              if (body.groups) { state.groups = body.groups; state.workspaceRevision++; }
              if (body.preferences) { state.preferences = body.preferences; state.userRevision++; }
              return route.fulfill({ json: { workspaceRevision: state.workspaceRevision, userRevision: state.userRevision } });
            }
            if (p === '/api/users/me') data = { id: 7, name: 'Fixture', role: 'admin', activeUnitId: 1,
              permissions: ['projects.view', 'projects.create', 'projects.update', 'photos.view', 'upload.photo'] };
            else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 1, units: [{ id: 1, name: 'Fixture Workspace', role: 'manager' }] };
            else if (p === '/api/album-desktop') data = state;
            else if (p === '/api/projects/list') data = { list: albums, total: albums.length, hasMore: false };
            else if (p === '/api/projects/import-status') data = { statuses: {} };
            else if (/\/previews$/.test(p)) data = { list: [] };
            else if (/^\/api\/projects\/\d+$/.test(p)) data = { ...albums.find(a => a.id === Number(p.split('/').at(-1))), photos: [] };
            else if (p === '/api/photos') data = { list: [], total: 0, hasMore: false };
            return route.fulfill({ json: data });
          }
          if (url.origin === base) return route.continue();
          external.push(req.url()); return route.abort();
        });
        const page = await context.newPage(); page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base);
        await page.locator('.album-desktop .acp-page-heading').waitFor();
        await page.waitForTimeout(650);
        assert.deepEqual(writes, [], 'mounting with legacy preferences must not write');
        await noSuggestions(page);
        const heading = page.locator('.acp-page-heading');
        assert.equal(await heading.getByRole('button', { name: '新建文件夹', exact: true }).count(), 0);
        assert.equal(await heading.locator('select').count(), 0, 'sorting uses GlassSelect, not a native select');
        const rootFolders = () => page.locator('#collections .acp-all-collections > .acp-collection').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
        assert.deepEqual(await rootFolders(), ['Empty Folder', 'Campus Folder', 'Other Folder']);
        await chooseSort(page, '活动日期 · 新到旧');
        assert.deepEqual(await rootFolders(), ['Campus Folder', 'Other Folder', 'Empty Folder']);
        await chooseSort(page, '活动日期 · 旧到新');
        assert.deepEqual(await rootFolders(), ['Other Folder', 'Campus Folder', 'Empty Folder']);
        await chooseSort(page, '默认顺序');
        assert.deepEqual(await rootFolders(), ['Empty Folder', 'Campus Folder', 'Other Folder']);
        await chooseSort(page, '活动日期 · 新到旧');
        if (artifacts) await page.screenshot({ path: path.join(artifacts, `root-${width}.png`), animations: 'disabled' });
        await page.getByRole('button', { name: '打开文件夹 Campus Folder', exact: true }).click();
        await page.waitForURL(url => url.searchParams.get('folder') === 'campus');
        const albumIds = () => page.locator('.acp-folder-albums .desktop-album').evaluateAll(nodes => nodes.map(node => Number(node.dataset.albumId)));
        assert.deepEqual(await albumIds(), [1, 4, 2, 3, 5]);
        await chooseSort(page, '活动日期 · 旧到新');
        assert.deepEqual(await albumIds(), [2, 1, 4, 3, 5]);
        assert.deepEqual(await page.locator('.acp-subfolders .acp-collection').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), ['Old Child', 'New Child']);
        assert.equal(await heading.getByRole('button', { name: '新建文件夹', exact: true }).count(), 0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no overflow at ${width}px`);
        assert.ok(await heading.evaluate(node => {
          const title = node.querySelector('h1').getBoundingClientRect();
          const actions = node.querySelector('.acp-heading-actions').getBoundingClientRect();
          return title.right <= actions.left + 1 || title.bottom <= actions.top + 1;
        }), 'heading title and sorting must not overlap');
        if (artifacts) await page.screenshot({ path: path.join(artifacts, `folder-${width}.png`), animations: 'disabled' });
        if (width < 821) await page.getByRole('button', { name: '打开相册目录' }).click();
        const directory = width < 821 ? page.getByRole('dialog').getByRole('navigation', { name: '相册目录' }) : page.locator('.acp-sidebar').getByRole('navigation', { name: '相册目录' });
        await noSuggestions(page);
        await directory.getByRole('button', { name: /未归类/ }).click();
        await page.getByRole('heading', { name: /未归类/, level: 1 }).waitFor();
        assert.deepEqual(await page.locator('.desktop-album').evaluateAll(nodes => nodes.map(node => Number(node.dataset.albumId))), [6]);
        await page.waitForTimeout(350);
        assert.deepEqual(writes, [], 'sorting, navigation and unfiled filtering must be display-only');
        await page.getByRole('button', { name: '更多操作 Campus Album 6', exact: true }).click();
        await page.getByRole('menuitem', { name: '整理到文件夹', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('checkbox', { name: 'Campus Folder', exact: true }).check();
        await dialog.getByRole('button', { name: '保存', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        assert.ok(state.groups.find(group => group.id === 'campus').projectIds.includes(6), 'manual filing still persists');
        assert.ok(writes.every(write => !write.preferences || !Object.hasOwn(write.preferences, 'dismissed')));
        assert.deepEqual(state.preferences.pins, ['album:2']);
        await noSuggestions(page);
        const writesBeforeReload = writes.length;
        state.canOrganize = false; state.canDeleteFolders = false;
        await page.goto(base);
        await page.locator('.album-desktop .acp-page-heading').waitFor();
        await chooseSort(page, '活动日期 · 旧到新');
        assert.deepEqual(await rootFolders(), ['Other Folder', 'Campus Folder', 'Empty Folder']);
        await page.waitForTimeout(350);
        assert.equal(writes.length, writesBeforeReload, 'read-only viewers can sort without persisting');
        assert.deepEqual(errors, []); assert.deepEqual(external, []);
        results.push({ width, suggestionsRemoved: true, rootAndFolderSort: true, emptyDatesLast: true, stableTies: true, unfiledFilter: true, manualFiling: true, noUnpromptedWrites: true });
      } catch (error) {
        if (artifacts && context.pages()[0]) await context.pages()[0].screenshot({ path: path.join(artifacts, `failure-${width}.png`) });
        console.error({ width, errors, external }); throw error;
      } finally { await context.close(); }
    }
    if (process.env.MAMAGE_ORGANIZATION_PROTOTYPE === '1') {
      for (const width of [1440, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
        const errors = [], api = [];
        try {
          await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.pathname.startsWith('/api/')) { api.push(url.pathname); return route.abort(); }
            if (url.origin === base) return route.continue();
            return route.fulfill({ contentType: 'image/jpeg', body: image });
          });
          const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
          await page.goto(base + '/__prototype/album-collections');
          await page.locator('.acp-main').waitFor();
          await noSuggestions(page);
          if (width === 390) await page.getByRole('button', { name: '打开相册目录' }).click();
          const directory = width === 390 ? page.getByRole('dialog') : page.locator('.acp-sidebar');
          await directory.getByRole('button', { name: /未归类/ }).click();
          assert.equal(await page.locator('.acp-main .acp-album').count(), 2);
          await noSuggestions(page);
          assert.deepEqual(errors, []); assert.deepEqual(api, []);
          results.push({ prototype: true, width, suggestionsRemoved: true, unfiledFilter: true });
        } finally { await context.close(); }
      }
    }
    console.log(JSON.stringify({ passed: true, fixtureOnly: true, results }));
  } finally {
    await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
