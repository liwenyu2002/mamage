const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const serverRequire = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = serverRequire('playwright'), sharp = serverRequire('sharp');
const dist = process.env.MAMAGE_SHARE_FOLDER_QA_DIST || path.resolve(__dirname, '../dist');
const artifactDir = process.env.MAMAGE_SHARE_FOLDER_QA_DIR;
(async () => {
  if (artifactDir) fs.mkdirSync(artifactDir, { recursive: true });
  const image = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#789b8e' } }).jpeg().toBuffer();
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture.test').pathname);
    const target = file.startsWith(dist + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch(), results = [];
  try {
    for (const style of ['glass', 'classic']) for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        await context.addInitScript(style => {
          localStorage.setItem('mamage_jwt_token', 'isolated-fixture'); localStorage.setItem('mamage-folder-style:v1:67', style);
          Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
        }, style);
        const actor = { id: 67, role: 'admin', name: '共享验收', activeUnitId: 2, metadataEditScope: 'own',
          permissions: ['photos.view', 'projects.view', 'projects.update', 'photos.edit', 'upload.photo'] };
        const state = { groups: [{ id: 'business', name: '本组活动', kind: 'manual', createdBy: 67, canEdit: true, parentId: null, projectIds: [81] },
          { id: 'peer', name: '其他人文件夹', kind: 'manual', createdBy: 68, canEdit: false, parentId: null, projectIds: [] }],
          revision: 1, userRevision: 1, count: 2, name: '共享原相册', active: true, conflict: false, preferences: { pins: [], recentItems: [], colors: {}, dismissed: [] } };
        const original = () => ({ id: 76, name: state.name, projectName: state.name, title: state.name, count: state.count,
          canEdit: false, isShared: true, unitId: 1, adminId: 44, shareMode: 'read', year: '2026',
          originLabel: '学院 / 来源部门', image: '/api/image/fixture.jpg', createdAt: '2026-10-01',
          photos: Array.from({ length: state.count }, (_, i) => ({ id: i + 1, projectId: 76, title: `原片${i + 1}`, type: 'normal',
            url: '/api/image/fixture.jpg', thumbUrl: '/api/image/fixture.jpg', photographerId: 44, canEdit: false, tags: [], aiStatus: 'done' })) });
        const copy = { id: 81, name: '活动副本', title: '活动副本', count: 1, createdAt: '2026-09-01', image: '/api/image/fixture.jpg' };
        const writes = [], errors = [], searches = [];
        await context.route('**/api/**', async route => {
          const req = route.request(), url = new URL(req.url()), p = url.pathname;
          if (p.startsWith('/api/image/')) return route.fulfill({ contentType: 'image/jpeg', body: image });
          if (req.method() !== 'GET') {
            assert.equal(p, '/api/album-desktop/state'); assert.equal(req.method(), 'PUT');
            const body = req.postDataJSON(); writes.push(body);
            assert.equal(body.sharedReferencesVersion, 1); assert.deepEqual(body.scope, { userId: 67, organizationId: 2, unitId: 2 });
            if (state.conflict) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '文件夹已在其他页面更新' }) });
            if (body.groups) { assert.equal(body.workspaceRevision, state.revision); state.groups = body.groups; state.revision++; }
            if (body.preferences) { state.preferences = body.preferences; state.userRevision++; }
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ workspaceRevision: state.revision, userRevision: state.userRevision }) });
          }
          let data = {};
          if (p === '/api/users/me') data = actor;
          else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 2, units: [{ id: 2, name: '接收部门', role: 'editor' }] };
          else if (p === '/api/album-desktop') data = {
            albums: [copy, ...(state.active && state.groups.some(g => g.projectIds.includes(76)) ? [original()] : [])],
            sharedAlbums: state.active ? [original()] : [], groups: state.groups.map(g => ({ ...g, projectIds: g.projectIds.filter(id => id !== 76 || state.active) })),
            scope: { userId: 67, organizationId: 2, unitId: 2 }, preferences: state.preferences,
            canOrganize: true, canDeleteFolders: false, workspaceRevision: state.revision, userRevision: state.userRevision,
          };
          else if (p === '/api/projects/list') data = { list: [copy], total: 1, hasMore: false };
          else if (p === '/api/projects') data = [copy];
          else if (p === '/api/projects/import-status') data = { statuses: {} };
          else if (p === '/api/projects/76') data = original();
          else if (p === '/api/photos/search') {
            searches.push(Object.fromEntries(url.searchParams));
            data = { list: original().photos, total: state.count, hasMore: false, search: { scope: { type: 'folder', id: url.searchParams.get('folderId'), includeDescendants: true } } };
          }
          else if (/^\/api\/photos\/\d+$/.test(p)) data = original().photos.find(photo => photo.id === Number(p.split('/').at(-1))) || {};
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        const home = async () => { await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.locator('.album-desktop').waitFor(); };
        const picker = () => page.getByRole('dialog').last();
        const save = async () => { await picker().getByRole('button', { name: '保存', exact: true }).click(); await picker().waitFor({ state: 'hidden' }); };
        const openFolder = async name => {
          if (style === 'classic') await page.getByRole('button', { name: `浏览文件夹 ${name}`, exact: true }).first().click();
          else {
            if (width < 800) await page.getByRole('button', { name: '打开相册目录', exact: true }).click();
            const directory = width < 800 ? page.getByRole('dialog').last() : page.locator('.acp-sidebar');
            await directory.locator('.acp-folder-link').filter({ hasText: name }).click();
          }
        };
        await home();
        await page.getByRole('button', { name: '添加到本组织文件夹 共享原相册', exact: true }).click();
        assert.equal(await picker().getByRole('checkbox', { name: '其他人文件夹' }).isDisabled(), true);
        await picker().getByRole('checkbox', { name: '本组活动', exact: true }).check();
        assert.ok((await picker().innerText()).includes('访问权限不变'));
        await save(); assert.deepEqual(state.groups[0].projectIds, [81, 76]);
        assert.equal(state.groups.flatMap(g => g.projectIds).filter(id => id === 76).length, 1);
        await openFolder('本组活动');
        const sourceEntry = style === 'classic' ? page.getByRole('button', { name: '预览相册 共享原相册', exact: true })
          : page.getByRole('button', { name: '进入相册 共享原相册', exact: true });
        await sourceEntry.waitFor();
        if (style === 'classic') {
          await sourceEntry.click(); await page.getByRole('button', { name: '打开相册 共享原相册', exact: true }).click();
        } else await sourceEntry.click();
        await page.waitForFunction(() => document.querySelectorAll('.detail-photo-item').length === 2);
        assert.equal(new URL(page.url()).searchParams.get('projectId'), '76');
        state.count = 3; state.name = '原册新标题';
        await home(); await openFolder('本组活动');
        await (style === 'classic' ? page.getByRole('button', { name: '预览相册 原册新标题', exact: true })
          : page.getByRole('button', { name: '进入相册 原册新标题', exact: true })).waitFor();
        assert.equal(copy.count, 1);
        if (artifactDir) await page.screenshot({ path: path.join(artifactDir, `saved-${style}-${width}.png`), animations: 'disabled' });
        await home(); await page.getByRole('button', { name: '整理共享相册 原册新标题', exact: true }).click();
        await picker().getByRole('checkbox', { name: '本组活动', exact: true }).uncheck(); await save();
        assert.deepEqual(state.groups[0].projectIds, [81]);
        await page.getByRole('button', { name: '添加到本组织文件夹 原册新标题', exact: true }).click();
        await picker().getByRole('textbox', { name: '新建目标文件夹名称', exact: true }).fill('共享资料');
        await save();
        const created = state.groups.find(g => g.name === '共享资料');
        assert.ok(created, JSON.stringify({ style, width, groups: state.groups, submittedGroups: writes.map(body => body.groups) }));
        assert.deepEqual(created.projectIds, [76]);
        const before = writes.length;
        await page.getByRole('button', { name: '整理共享相册 原册新标题', exact: true }).click(); await save();
        assert.equal(writes.length, before, 'Saving the same placement must be idempotent');
        state.active = false; await home(); await openFolder('共享资料');
        assert.equal(await page.getByRole('button', { name: /(?:进入相册|预览相册) 原册新标题/ }).count(), 0);
        assert.equal(await page.getByRole('region', { name: '与我共享', exact: true }).count(), 0);
        assert.deepEqual(created.projectIds, [76]);
        state.active = true; await home(); await openFolder('共享资料');
        await (style === 'classic' ? page.getByRole('button', { name: '预览相册 原册新标题', exact: true })
          : page.getByRole('button', { name: '进入相册 原册新标题', exact: true })).waitFor();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        if (style === 'glass' && width === 1440) {
          await home(); await page.getByRole('button', { name: '整理共享相册 原册新标题', exact: true }).click();
          await picker().getByRole('checkbox', { name: '共享资料', exact: true }).uncheck(); state.conflict = true;
          await picker().getByRole('button', { name: '保存', exact: true }).click();
          await picker().getByRole('alert').waitFor();
          assert.equal(await picker().getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
          assert.deepEqual(state.groups.find(g => g.id === created.id).projectIds, [76]);
          state.conflict = false; await home();
        }
        assert.deepEqual(errors, []);
        results.push({ style, width, add: true, newFolder: true, refresh: true, currentTitleAndCount: true, removeOnlyReference: true, revokedHidden: true, idempotent: true });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  console.log(JSON.stringify({ passed: true, cases: results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
