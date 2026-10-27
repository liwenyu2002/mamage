const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../../server/package.json'))('playwright');
const { userAccessProfile } = require('../../server/lib/access_policy');
const dist = path.resolve(process.env.MAMAGE_SEARCH_QA_DIST || path.join(__dirname, '../dist'));
const suggestions = ['拿话筒的邹欣', '刘铁岩单人照', '举奖杯的人', '王婧琦的单人照', '穿白衣服的人', '多人合影'];
const suggestionKey = 'mamage-search-suggestion:v1';

async function main() {
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile()
      ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch();
  const access = userAccessProfile({ userId: 47, orgId: 2, userRole: 'admin', enabled: true,
    unitId: 1, role: 'manager', collegeAdmin: false }, ['projects.view', 'photos.view'], { search: true, manage: false });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const searches = [], errors = [], writes = [];
        await context.addInitScript(() => {
          localStorage.setItem('mamage_jwt_token', 'isolated-search-fixture');
          Math.random = () => Number(sessionStorage.getItem('qa-suggestion-random') || 0);
        });
        await context.route('**/api/**', route => {
          const req = route.request(), url = new URL(req.url()), p = url.pathname;
          if (p === '/api/album-desktop/state' && req.method() === 'PUT') return route.fulfill({ json: { workspaceRevision: 2, userRevision: 2 } });
          if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { writes.push(p); return route.abort(); }
          const send = json => route.fulfill({ json });
          if (p === '/api/users/me') return send({ id: 47, name: '测试用户', role: 'admin', workspaceEnabled: true,
            activeUnitId: 1, collegeAdmin: false, unitRole: 'manager', ...access });
          if (p === '/api/workspaces') return send({ enabled: true, activeUnitId: 1, access: access.access,
            units: [{ id: 1, name: '测试小组', role: 'manager' }], shareTargets: [] });
          if (p === '/api/album-desktop') return send({ albums: [],
            groups: [{ id: 'fixture', name: '测试文件夹', kind: 'manual', projectIds: [], parentId: null }],
            sharedAlbums: [], sharedFolders: [], preferences: { pins: [], colors: {}, recentItems: [] },
            scope: { userId: 47, organizationId: 2, unitId: 1 }, workspaceRevision: 1, userRevision: 1 });
          if (p === '/api/projects/list') return send({ list: [], total: 0, hasMore: false });
          if (p === '/api/projects/import-status') return send({ statuses: {} });
          if (p === '/api/projects/84') return send({ id: 84, name: '测试相册', photos: [], timelineSections: [], permissions: {} });
          if (p === '/api/photos/search') { searches.push(Object.fromEntries(url.searchParams));
            return send({ list: [], total: 0, page: 1, hasMore: false, search: { matchType: 'strict' } }); }
          return send([]);
        });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.goto(base);
        const input = page.locator('.mamage-nav-search-input');
        const firstSuggestion = (await input.getAttribute('placeholder')).replace('试试：', '');
        assert.ok(suggestions.includes(firstSuggestion));
        await page.reload();
        const suggestion = (await input.getAttribute('placeholder')).replace('试试：', '');
        assert.ok(suggestions.includes(suggestion));
        assert.notEqual(suggestion, firstSuggestion, 'refresh must not repeat the previous suggestion');
        await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
        assert.equal(searches.length, 0);
        for (const [query, submit] of [['', 'enter'], ['多人', 'enter'], ['   ', 'click']]) {
          await input.fill(query);
          const request = page.waitForRequest(req => new URL(req.url()).pathname === '/api/photos/search');
          if (submit === 'enter') await input.press('Enter'); else await page.locator('.mamage-search-submit').click();
          const sent = new URL((await request).url()).searchParams;
          assert.equal(sent.get('q'), query.trim() || suggestion);
          assert.equal(await input.inputValue(), query.trim() || suggestion);
          assert.equal(await input.getAttribute('placeholder'), `试试：${suggestion}`, 'ordinary rerenders must not change the suggestion');
        }
        await page.locator('.mamage-nav-search-field').getByRole('button', { name: '清空搜索', exact: true }).click();
        assert.equal(await input.inputValue(), '');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        if (process.env.MAMAGE_SEARCH_QA_DIR) {
          fs.mkdirSync(process.env.MAMAGE_SEARCH_QA_DIR, { recursive: true });
          await page.screenshot({ path: path.join(process.env.MAMAGE_SEARCH_QA_DIR, `search-${width}.png`) });
        }
        for (const [index, expected] of suggestions.entries()) {
          await page.evaluate(({ key, random }) => { sessionStorage.removeItem(key); sessionStorage.setItem('qa-suggestion-random', String(random)); },
            { key: suggestionKey, random: (index + 0.5) / suggestions.length });
          await page.reload();
          assert.equal(await input.getAttribute('placeholder'), `试试：${expected}`);
          const request = page.waitForRequest(req => new URL(req.url()).pathname === '/api/photos/search');
          await input.press('Enter');
          assert.equal(new URL((await request).url()).searchParams.get('q'), expected);
        }
        for (const [url, placeholder] of [['/?folder=fixture', '在「测试文件夹」内搜索'], ['/?projectId=84', '在当前相册内搜索']]) {
          await page.goto(base + url);
          await page.locator('.mamage-nav-search-input').waitFor();
          await page.waitForFunction(expected => document.querySelector('.mamage-nav-search-input')?.placeholder === expected, placeholder);
          const count = searches.length;
          await input.press('Enter');
          await page.waitForTimeout(150);
          assert.equal(searches.length, count, 'empty scoped searches must not run the global recommendation');
          assert.equal(await input.inputValue(), '');
        }
        assert.deepEqual(errors, []); assert.deepEqual(writes, []);
        console.log(JSON.stringify({ width, suggestions: suggestions.length, refreshChangesSuggestion: true,
          recommendedEnter: true, explicitQuery: true, compositionSafe: true, scopedEmptyUnchanged: true }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
