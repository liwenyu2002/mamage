const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const serverRequire = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = serverRequire('playwright');
const sharp = serverRequire('sharp');
const dist = process.env.MAMAGE_SEARCH_QA_DIST || path.resolve(__dirname, '../dist');
const artifactDir = process.env.MAMAGE_SEARCH_QA_DIR;

async function main() {
  if (artifactDir) fs.mkdirSync(artifactDir, { recursive: true });
  const image = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#becfc4' } }).jpeg().toBuffer();
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture.test').pathname);
    const target = file.startsWith(dist + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const style of ['glass', 'classic']) for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(style => {
        localStorage.setItem('mamage_jwt_token', 'isolated-fixture');
        localStorage.setItem('mamage-folder-style:v1:7', style);
      }, style);
      const actor = { id: 7, role: 'admin', name: '检索验收', activeUnitId: 1,
        permissions: ['photos.view', 'projects.view', 'upload.photo'] };
      const photos = [11, 12, 13, 14].map((id, index) => ({ id, projectId: index === 1 ? 9002 : index === 2 ? 9003 : 9001,
        projectName: index === 1 ? '开幕相册' : index === 2 ? '其他相册' : '活动相册', title: `照片${id}`, type: 'normal',
        url: '/api/image/fixture.jpg', thumbUrl: '/api/image/fixture.jpg', tags: [], aiStatus: 'done', photographerId: 7 }));
      const albums = [9001, 9002, 9003].map(id => ({ id, name: photos.find(photo => photo.projectId === id).projectName,
        images: photos.filter(photo => photo.projectId === id), unitId: 1, adminId: 7, count: 2, createdAt: '2026-10-16T00:00:00Z' }));
      const groups = [{ id: 'events', name: '活动', kind: 'manual', parentId: null, projectIds: [9001] },
        { id: 'opening', name: '开幕', kind: 'manual', parentId: 'events', projectIds: [9002] },
        { id: 'outside', name: '其他', kind: 'manual', parentId: null, projectIds: [9003] },
        { id: 'empty', name: '空文件夹', kind: 'manual', parentId: null, projectIds: [] }];
      const desktop = { albums, groups, scope: { userId: 7, organizationId: 2, unitId: 1 }, preferences: { pins: [], recentItems: [], colors: {}, dismissed: [] },
        canOrganize: false, canDeleteFolders: false, workspaceRevision: 1, userRevision: 1 };
      const requests = [], errors = [];
      let writes = 0, releaseSlow;
      await context.route('**/api/**', async route => {
        const req = route.request(), url = new URL(req.url()), p = url.pathname;
        if (p.startsWith('/api/image/')) return route.fulfill({ contentType: 'image/jpeg', body: image });
        if (req.method() !== 'GET') writes++;
        let data = {};
        if (p === '/api/photos/search') {
          const params = Object.fromEntries(url.searchParams);
          requests.push({ ...params, unitHeader: req.headers()['x-mamage-unit-id'] });
          if (params.q === '慢查询') await new Promise(resolve => { releaseSlow = resolve; });
          const selected = params.projectId ? photos.filter(photo => photo.projectId === Number(params.projectId))
            : params.folderId === 'empty' ? [] : params.folderId === 'opening' ? [photos[1]]
              : params.folderId === 'events' ? [photos[0], photos[1], photos[3]] : photos;
          const page = Number(params.page || 1), batchSize = params.projectId ? 1 : 2;
          const list = page === 1 ? selected.slice(0, batchSize) : selected.slice(batchSize);
          const search = { aiUsed: true, chips: ['人物：甲老师', '内容：发言'], scope: { type: params.folderId ? 'folder' : params.projectId ? 'album' : 'workspace', id: params.folderId || params.projectId } };
          if (params.q === '范围异常') search.scope = { type: 'workspace' };
          const metadata = { page, total: selected.length, hasMore: page === 1 && selected.length > batchSize, search };
          return route.fulfill({ contentType: 'application/x-ndjson', body: [
            { type: 'status', phase: 'understanding' }, { type: 'results', data: { list, search, total: null } },
            { type: 'complete', data: metadata },
          ].map(frame => JSON.stringify(frame) + '\n').join('') });
        }
        if (p === '/api/users/me') data = actor;
        else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 1, units: [{ id: 1, name: '检索测试小组', role: 'editor' }] };
        else if (p === '/api/album-desktop') data = desktop;
        else if (p === '/api/projects/list') data = { list: albums, total: 3, hasMore: false };
        else if (p === '/api/projects') data = albums;
        else if (p === '/api/projects/import-status') data = { statuses: {} };
        else if (/^\/api\/projects\/\d+$/.test(p)) data = albums.find(album => album.id === Number(p.split('/').at(-1))) || {};
        else if (/^\/api\/photos\/\d+$/.test(p)) data = photos.find(photo => photo.id === Number(p.split('/').at(-1))) || {};
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const waitRequest = async (index, predicate) => {
        for (let i = 0; i < 100; i++) {
          if (requests.slice(index).some(predicate)) return requests.slice(index).find(predicate);
          await page.waitForTimeout(25);
        }
        throw Error(`Missing scoped request: ${JSON.stringify(requests.slice(index))}`);
      };
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.locator('.album-desktop').waitFor();
      const openFolder = async name => {
        if (style === 'classic') await page.getByRole('button', { name: `浏览文件夹 ${name}`, exact: true }).first().click();
        else if (name === '活动') await page.getByRole('button', { name: '进入子目录 活动', exact: true }).click();
        else await page.getByRole('button', { name: `打开文件夹 ${name}`, exact: true }).first().click();
      };
      await openFolder('活动');
      const top = page.getByRole('textbox', { name: '当前文件夹内智能检索', exact: true });
      await top.fill('甲老师发言');
      await top.press('Enter');
      const first = await waitRequest(0, request => request.folderId === 'events');
      assert.equal(first.smart, '1'); assert.equal(first.stream, '1'); assert.equal(first.projectId, undefined); assert.equal(first.unitHeader, '1');
      await page.locator('.scoped-search-photo').nth(1).waitFor();
      await page.getByRole('button', { name: '加载更多', exact: true }).click();
      await page.locator('.scoped-search-photo').nth(2).waitFor();
      assert.ok(requests.some(request => request.folderId === 'events' && request.page === '2'));
      assert.equal(await page.locator('.scoped-search-photo').count(), 3);
      assert.ok(await page.locator('.scoped-search').innerText().then(text => text.includes('本文件夹及子文件夹')));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.waitForTimeout(300);
      if (artifactDir) await page.screenshot({ path: path.join(artifactDir, `folder-${style}-${width}.png`) });

      await page.getByRole('button', { name: '打开照片 照片11', exact: true }).click();
      await page.locator('.viewer-topbar-close').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('projectId'), '9001');
      await page.locator('.viewer-topbar-close').click();
      const beforeAlbum = requests.length;
      const albumInput = page.getByRole('textbox', { name: '当前相册内智能检索', exact: true });
      await albumInput.fill('甲老师发言'); await albumInput.press('Enter');
      const albumRequest = await waitRequest(beforeAlbum, request => request.projectId === '9001');
      assert.equal(albumRequest.smart, '1'); assert.equal(albumRequest.folderId, undefined);
      await page.getByText('当前相册内检索', { exact: true }).waitFor();
      await page.getByRole('button', { name: '加载更多检索结果', exact: true }).click();
      await waitRequest(beforeAlbum, request => request.projectId === '9001' && request.page === '2');
      await page.waitForFunction(() => document.querySelectorAll('.detail-photo-item').length === 2);
      assert.equal(new URL(page.url()).searchParams.get('projectId'), '9001');
      if (artifactDir) await page.screenshot({ path: path.join(artifactDir, `album-${style}-${width}.png`) });
      await page.locator('.mamage-search-clear').click();
      await page.waitForTimeout(500);
      assert.equal(await page.locator('.detail-header--search-only').count(), 0);

      await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.locator('.album-desktop').waitFor();
      await openFolder('活动');
      const local = page.getByRole('textbox', { name: '文件夹内智能检索', exact: true });
      const slowStart = requests.length;
      await local.fill('慢查询'); await local.press('Enter');
      await waitRequest(slowStart, request => request.q === '慢查询');
      // Navigate via a fresh root view while an old folder response is still pending.
      await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.locator('.album-desktop').waitFor();
      await openFolder('空文件夹');
      releaseSlow?.();
      const emptyStart = requests.length;
      const emptyInput = page.getByRole('textbox', { name: '文件夹内智能检索', exact: true });
      await emptyInput.fill('甲老师发言'); await emptyInput.press('Enter');
      await waitRequest(emptyStart, request => request.folderId === 'empty');
      await page.getByText('此范围内没有匹配的照片', { exact: true }).waitFor();
      assert.equal(await page.locator('.scoped-search-photo').count(), 0);
      await emptyInput.fill('范围异常'); await emptyInput.press('Enter');
      await page.locator('.scoped-search-error').waitFor();
      assert.equal(await page.locator('.scoped-search-photo').count(), 0, 'an older server ignoring folderId must not display global results');
      assert.deepEqual(errors, []); assert.equal(writes, 0);
      results.push({ style, width, folderScope: true, albumScope: true, pagination: true, openTargetPhoto: true, emptyFolder: true, noWrites: true, noErrors: true });
      await context.close();
    }
    console.log(JSON.stringify({ status: 'passed', cases: results }));
    if (artifactDir) fs.writeFileSync(path.join(artifactDir, 'browser-qa.json'), JSON.stringify(results, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
