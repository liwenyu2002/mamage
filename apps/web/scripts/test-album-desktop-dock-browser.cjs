const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../../server/package.json'))('playwright');
const dist = path.resolve(process.env.MAMAGE_DESKTOP_DOCK_DIST || path.join(__dirname, '../dist'));
const artifacts = process.env.MAMAGE_DESKTOP_DOCK_QA_DIR;

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
  const results = [];
  try {
    for (const style of ['glass', 'classic']) for (const width of [1440, 390]) {
      if (process.env.MAMAGE_DESKTOP_DOCK_CASE && process.env.MAMAGE_DESKTOP_DOCK_CASE !== `${style}-${width}`) continue;
      const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: width === 390 ? 'no-preference' : 'reduce', serviceWorkers: 'block' });
      const errors = [], unexpected = [], writes = [], deletes = [], creates = [], uploads = [];
      let releaseUpload;
      const albums = Array.from({ length: 29 }, (_, index) => ({ id: index + 1, name: `Album ${index + 1}`, title: `Album ${index + 1}`,
        count: 0, createdAt: '2026-10-01', eventDate: '2026-10-01', canEdit: true, ...(index === 26 ? { isShared: true, shareMode: 'collaborate' } : {}) }));
      const groups = [
        { id: 'root', name: 'Root Folder', projectIds: Array.from({ length: 27 }, (_, index) => index + 1) },
        { id: 'child', name: 'Child Folder', parentId: 'root', projectIds: [29] },
        { id: 'other', name: 'Other Folder', projectIds: [] },
        { id: 'depth3', name: 'Depth 3', parentId: 'child', projectIds: [] },
        { id: 'depth4', name: 'Depth 4', parentId: 'depth3', projectIds: [] },
        { id: 'depth5', name: 'Depth 5', parentId: 'depth4', projectIds: [] },
      ].map(group => ({ parentId: null, kind: 'manual', createdBy: 7, canEdit: true, ...group }));
      const state = { albums, groups, sharedAlbums: [], sharedFolders: [], preferences: { pins: ['album:1'], colors: {}, recentItems: [] },
        workspaceRevision: 1, userRevision: 1, scope: { userId: 7, organizationId: 2, unitId: 1 }, canOrganize: true, canDeleteFolders: true };
      let failSaves = false, failDelete = null, failSavesAfterDelete = false, allowAlbum = true;
      try {
        await context.addInitScript(style => {
          localStorage.setItem('mamage_jwt_token', 'isolated-desktop-dock-fixture');
          localStorage.setItem('mamage-folder-style:v1:7', style);
        }, style);
        await context.route('**/*', async route => {
          const req = route.request(), url = new URL(req.url()), p = url.pathname;
          if (!p.startsWith('/api/')) {
            if (url.origin === base) return route.continue();
            unexpected.push(req.url()); return route.abort();
          }
          if (p === '/api/album-desktop/state' && req.method() === 'PUT') {
            const body = req.postDataJSON(); writes.push(body);
            if (failSaves) return route.fulfill({ status: 503, json: { message: 'fixture save failure' } });
            if (body.groups) { state.groups = body.groups; state.workspaceRevision++; }
            if (body.preferences) { state.preferences = body.preferences; state.userRevision++; }
            return route.fulfill({ json: { workspaceRevision: state.workspaceRevision, userRevision: state.userRevision } });
          }
          if (p === '/api/projects' && req.method() === 'POST') {
            const body = req.postDataJSON(); creates.push(body);
            const album = { id: 100 + creates.length, name: body.projectName, title: body.projectName, createdAt: '2026-11-02', count: 0, canEdit: true };
            state.albums.push(album); return route.fulfill({ json: album });
          }
          if (p === '/api/upload/photo/direct/init' && req.method() === 'POST') {
            return route.fulfill({ status: 409, json: { error: 'DIRECT_UPLOAD_UNAVAILABLE' } });
          }
          if (p === '/api/upload/photo' && req.method() === 'POST') {
            uploads.push(req.postDataBuffer().toString());
            await new Promise(resolve => { releaseUpload = resolve; });
            const album = state.albums.find(album => album.id === 102);
            album.photoCount = 1; album.photos = [{ id: 301 }];
            return route.fulfill({ json: { id: 301, projectId: 102 } });
          }
          if (/^\/api\/projects\/\d+$/.test(p) && req.method() === 'DELETE') {
            const id = Number(p.split('/').at(-1)); deletes.push(id);
            assert.equal(req.headers()['x-mamage-unit-id'], '1');
            if (id === failDelete) return route.fulfill({ status: 403, json: { message: 'fixture deletion denied' } });
            state.albums = state.albums.filter(album => album.id !== id);
            if (failSavesAfterDelete) failSaves = true;
            return route.fulfill({ json: { success: true } });
          }
          if (req.method() !== 'GET') { unexpected.push(`${req.method()} ${p}`); return route.abort(); }
          let data = {};
          if (p === '/api/users/me') data = { id: 7, name: 'Fixture', role: 'admin', activeUnitId: 1,
            permissions: ['projects.view', 'photos.view', 'projects.update', 'projects.delete', ...(allowAlbum ? ['projects.create', 'upload.photo'] : [])] };
          else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 1, units: [{ id: 1, name: 'Fixture Workspace', role: state.canDeleteFolders ? 'manager' : 'editor' }] };
          else if (p === '/api/album-desktop') data = state;
          else if (p === '/api/projects/list') data = { list: state.albums, total: state.albums.length, hasMore: false };
          else if (p === '/api/projects/import-status') data = { statuses: {} };
          else if (/^\/api\/projects\/\d+$/.test(p)) data = state.albums.find(album => album.id === Number(p.split('/').at(-1))) || {};
          else if (/\/previews$/.test(p)) data = { list: [] };
          else if (p === '/api/photos') data = { list: [], total: 0, hasMore: false };
          return route.fulfill({ json: data });
        });
        const page = await context.newPage(); page.setDefaultTimeout(12000);
        page.on('pageerror', error => errors.push(error.message));
        const dock = () => page.locator('.detail-bottom-nav--adaptive');
        const go = async folder => { await page.goto(base + (folder ? `/?folder=${folder}` : '')); await dock().waitFor(); };
        const openCreate = async () => {
          await page.waitForFunction(() => !document.querySelector('.detail-bottom-nav--adaptive')?.classList.contains('is-morphing'));
          await dock().evaluate(node => Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
          const origin = await dock().getByRole('button', { name: '新建相册或文件夹' }).boundingBox();
          await dock().getByRole('button', { name: '新建相册或文件夹' }).click();
          const modal = page.getByRole('dialog', { name: '新建', exact: true }); await modal.waitFor();
          assert.equal(await dock().getAttribute('inert'), ''); assert.equal(await dock().isVisible(), false);
          const originWidth = await modal.evaluate(node => Number.parseFloat(node.style.getPropertyValue('--album-dock-scale-x')) * node.offsetWidth);
          assert.ok(Math.abs(originWidth - origin.width) < 1, `form animation uses the actual primary button ref: ${JSON.stringify({ originWidth, origin })}`);
          return modal;
        };
        const closeCreate = async modal => {
          await modal.getByRole('button', { name: '取消', exact: true }).click();
          if (width === 390) {
            await page.locator('.album-form-modal.is-leaving').waitFor();
            assert.equal(await page.locator('#root').evaluate(node => node.inert), true, 'page remains locked during the exit animation');
          }
          await modal.waitFor({ state: 'detached' }); await dock().waitFor();
          assert.equal(await page.locator('#root').evaluate(node => node.inert), false);
        };
        const choose = async (kind, name) => {
          const role = style === 'glass' ? 'checkbox' : 'button';
          const item = page.getByRole(role, { name: `选择${kind} ${name}`, exact: true });
          if (role === 'checkbox') await item.check(); else await item.click();
        };
        await go(); await page.waitForTimeout(450); assert.deepEqual(writes, []);
        assert.equal(await dock().getByRole('button').count(), 2);
        assert.equal(await page.locator('.acp-page-heading, .acp-column-toolbar').getByRole('button', { name: /新建/ }).count(), 0);
        let modal = await openCreate();
        assert.match(await modal.innerText(), /创建到.*小组空间/s);
        await closeCreate(modal);
        await dock().getByRole('button', { name: '选择', exact: true }).click();
        assert.ok(await dock().getByRole('button', { name: '删除所选内容' }).isDisabled());
        await choose('文件夹', 'Root Folder');
        await dock().getByRole('button', { name: '完成选择，已选 1 项' }).waitFor();
        await dock().getByRole('button', { name: '删除所选内容' }).click();
        assert.match(await page.getByRole('dialog').innerText(), /不会删除相册或照片/);
        assert.deepEqual(deletes, []);
        failSaves = true;
        await page.getByRole('dialog').getByRole('button', { name: '确认删除文件夹', exact: true }).click();
        await page.getByRole('dialog').getByRole('alert').waitFor();
        assert.ok(state.groups.some(group => group.id === 'root'));
        const rootSelection = page.getByRole(style === 'glass' ? 'checkbox' : 'button', { name: '选择文件夹 Root Folder', exact: true });
        assert.equal(await rootSelection.count(), 1, 'failed folder saves must retain the visible folder');
        if (style === 'glass') assert.ok(await rootSelection.isChecked());
        else assert.equal(await rootSelection.getAttribute('aria-pressed'), 'true');
        assert.deepEqual(deletes, [], 'folder deletion must never request album DELETE');
        await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
        await dock().getByRole('button', { name: '完成选择，已选 1 项' }).waitFor();
        failSaves = false;
        await dock().getByRole('button', { name: /完成选择/ }).click();

        modal = await openCreate();
        await modal.getByRole('button', { name: '文件夹', exact: true }).click();
        await modal.getByRole('textbox', { name: /文件夹名称/ }).fill('Retry Folder');
        failSaves = true;
        await modal.getByRole('button', { name: '创建文件夹', exact: true }).click();
        await page.getByText('文件夹尚未保存，请重试保存或重新加载，勿重复新建', { exact: true }).waitFor();
        assert.ok(await modal.isVisible());
        const attemptedIds = writes.flatMap(write => (write.groups || []).filter(group => group.name === 'Retry Folder').map(group => group.id));
        assert.equal(new Set(attemptedIds).size, 1);
        failSaves = false;
        await modal.getByRole('button', { name: '创建文件夹', exact: true }).click();
        await modal.waitFor({ state: 'detached' }); await dock().waitFor();
        assert.equal(state.groups.filter(group => group.name === 'Retry Folder').length, 1);
        assert.equal(state.groups.find(group => group.name === 'Retry Folder').parentId, null);

        await go(); modal = await openCreate();
        await modal.getByRole('textbox', { name: /相册名称/ }).fill('Root Album');
        await modal.getByRole('button', { name: '创建', exact: true }).click();
        await modal.waitFor({ state: 'detached' }); await dock().waitFor();
        assert.equal(creates.at(-1).projectName, 'Root Album');
        assert.ok(state.groups.every(group => !group.projectIds.includes(101)), 'root albums are unfiled');

        await go('root'); modal = await openCreate();
        assert.match(await modal.innerText(), /Root Folder/);
        await modal.getByRole('textbox', { name: /相册名称/ }).fill('Nested Album');
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
        await modal.locator('input[type=file]').setInputFiles({ name: 'nested-upload.png', mimeType: 'image/png', buffer: png });
        await modal.getByRole('button', { name: '创建', exact: true }).click();
        await page.waitForResponse(response => response.url().includes('/api/album-desktop/state') && response.request().method() === 'PUT');
        for (let i = 0; i < 100 && !releaseUpload; i++) await page.waitForTimeout(50);
        assert.ok(releaseUpload, 'staged media must reach the upload endpoint after album creation');
        assert.ok(await modal.isVisible(), 'creation updates must not unmount the selected upload');
        assert.ok(await modal.getByRole('button', { name: /创建/, exact: false }).last().isDisabled());
        assert.match(uploads[0], /nested-upload\.png/);
        assert.match(uploads[0], /name="projectId"\r\n\r\n102/);
        releaseUpload(); releaseUpload = null;
        await modal.waitFor({ state: 'detached' }); await dock().waitFor();
        assert.ok(state.groups.find(group => group.id === 'root').projectIds.includes(102));
        assert.equal(uploads.length, 1); assert.equal(creates.filter(item => item.projectName === 'Nested Album').length, 1);
        await go('depth5'); modal = await openCreate();
        await modal.getByRole('button', { name: '文件夹', exact: true }).click();
        await modal.getByRole('textbox', { name: /文件夹名称/ }).fill('Forbidden Sixth Level');
        const beforeDepth = writes.length;
        await modal.getByRole('button', { name: '创建文件夹', exact: true }).click();
        await page.getByText('最多支持 5 级文件夹', { exact: true }).waitFor();
        assert.equal(writes.length, beforeDepth); await closeCreate(modal);

        await go('root');
        await dock().getByRole('button', { name: '选择', exact: true }).click();
        await page.getByRole('toolbar', { name: '所选内容操作' }).getByRole('button', { name: '全选', exact: true }).click();
        const expected = style === 'glass' ? 25 : 29;
        await dock().getByRole('button', { name: `完成选择，已选 ${expected} 项` }).waitFor();
        if (style === 'glass') {
          await page.getByRole('button', { name: '加载更多', exact: true }).click();
          await dock().getByRole('button', { name: '完成选择，已选 25 项' }).waitFor();
          await page.getByRole('toolbar').getByRole('button', { name: '全选', exact: true }).click();
        }
        assert.ok(await dock().getByRole('button', { name: '删除所选内容' }).isDisabled(), 'shared albums cannot be deleted even by an administrator');
        await dock().getByRole('button', { name: /完成选择/ }).click();
        await dock().getByRole('button', { name: '选择', exact: true }).click();
        await choose('相册', 'Album 1'); await choose('相册', 'Album 2'); await choose('文件夹', 'Child Folder');
        failDelete = 2;
        await dock().getByRole('button', { name: '删除所选内容' }).click();
        modal = page.getByRole('dialog', { name: '确认删除相册' });
        await modal.getByRole('button', { name: '确认删除所选内容' }).click();
        await modal.getByRole('alert').waitFor();
        assert.deepEqual(deletes, [1, 2]);
        assert.ok(!state.albums.some(album => album.id === 1));
        assert.ok(state.albums.some(album => album.id === 2));
        assert.ok(state.albums.some(album => album.id === 27));
        assert.ok(state.groups.some(group => group.id === 'child'));
        assert.equal(state.groups.find(group => group.id === 'depth3').parentId, 'child');
        assert.ok(state.albums.some(album => album.id === 29));
        assert.equal(await modal.getByText('Album 1', { exact: true }).count(), 0, 'successful deletions are not retried');
        for (const [kind, name] of [['相册', 'Album 2'], ['文件夹', 'Child Folder']]) {
          const retained = page.getByRole(style === 'glass' ? 'checkbox' : 'button', { name: `选择${kind} ${name}`, exact: true });
          if (style === 'glass') assert.ok(await retained.isChecked(), 'failed entries stay selected');
          else assert.equal(await retained.getAttribute('aria-pressed'), 'true', 'failed entries stay selected');
        }
        failDelete = null;
        failSavesAfterDelete = true;
        await modal.getByRole('button', { name: '确认删除所选内容' }).click();
        modal = page.getByRole('dialog', { name: '删除文件夹', exact: true });
        await modal.getByRole('alert').waitFor();
        assert.deepEqual(deletes, [1, 2, 2]);
        assert.ok(!state.albums.some(album => album.id === 2), 'successful album DELETE is irreversible even when desktop save fails');
        assert.ok(state.groups.some(group => group.id === 'child'));
        assert.equal(state.groups.find(group => group.id === 'depth3').parentId, 'child');
        const childSelection = page.getByRole(style === 'glass' ? 'checkbox' : 'button', { name: '选择文件夹 Child Folder', exact: true });
        assert.equal(await childSelection.count(), 1, 'failed mixed save must retain the visible folder');
        if (style === 'glass') assert.ok(await childSelection.isChecked());
        else assert.equal(await childSelection.getAttribute('aria-pressed'), 'true');
        assert.equal(await page.getByRole(style === 'glass' ? 'checkbox' : 'button', { name: '选择相册 Album 2', exact: true }).count(), 0);
        failSavesAfterDelete = false; failSaves = false;
        await modal.getByRole('button', { name: '确认删除所选内容' }).click();
        await modal.waitFor({ state: 'detached' }); await dock().waitFor();
        assert.deepEqual(deletes, [1, 2, 2]);
        assert.ok(!state.groups.some(group => group.id === 'child'));
        assert.equal(state.groups.find(group => group.id === 'depth3').parentId, 'root');
        assert.ok(state.albums.some(album => album.id === 29), 'folder deletion never deletes contained albums');

        await go();
        if (style === 'glass' && width < 821) await page.getByRole('button', { name: '打开相册目录' }).click();
        const directory = style === 'classic' ? page.locator('.acp-column-utility') : width < 821 ? page.getByRole('dialog') : page.locator('.acp-sidebar');
        await directory.getByRole('button', { name: /未归类/ }).click();
        await dock().waitFor(); modal = await openCreate();
        assert.match(await modal.innerText(), /创建到.*小组空间/s); await closeCreate(modal);
        await dock().getByRole('button', { name: '选择', exact: true }).click();
        await choose('相册', 'Root Album');
        await dock().getByRole('button', { name: '完成选择，已选 1 项' }).waitFor();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow');
        if (style === 'classic') {
          const bottom = await page.locator('.acp-column-path').evaluate(node => node.getBoundingClientRect().bottom);
          const controls = await page.getByRole('toolbar', { name: '所选内容操作' }).boundingBox();
          assert.ok(bottom <= controls.y, 'column navigation must remain above the selection toolbar');
        }
        if (artifacts) await page.screenshot({ path: path.join(artifacts, `unfiled-${style}-${width}.png`) });

        state.canDeleteFolders = false;
        state.groups.find(group => group.id === 'other').canEdit = false;
        state.groups.find(group => group.id === 'other').createdBy = 8;
        await go('other'); modal = await openCreate();
        assert.equal(await modal.getByRole('group', { name: '新建类型' }).count(), 0, 'cannot create albums inside an uneditable parent');
        await modal.getByRole('textbox', { name: /文件夹名称/ }).fill('Own Child Folder');
        await modal.getByRole('button', { name: '创建文件夹', exact: true }).click();
        await modal.waitFor({ state: 'detached' }); await dock().waitFor();
        assert.equal(state.groups.find(group => group.name === 'Own Child Folder').parentId, 'other', 'existing collaborator folder creation rules are preserved');
        allowAlbum = false;
        await go(); modal = await openCreate();
        assert.equal(await modal.getByRole('group', { name: '新建类型' }).count(), 0);
        await modal.getByRole('textbox', { name: /文件夹名称/ }).waitFor(); await closeCreate(modal);
        await dock().getByRole('button', { name: '选择', exact: true }).click();
        await choose('文件夹', 'Root Folder');
        assert.ok(await dock().getByRole('button', { name: '删除所选内容' }).isDisabled(), 'a forged projects.delete permission does not grant workspace admin rights');
        state.canOrganize = false; await go();
        assert.ok(await dock().getByRole('button', { name: '新建相册或文件夹' }).isDisabled());
        assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
        results.push({ style, width, rootFolderUnfiledDock: true, creationRetry: true, stagedUploadRetained: true, depthLimit: true, selectionScope: true, partialDeleteSafety: true, failedFolderSaveRetainsSelection: true, failedMixedSaveRetainsFolder: true, permissions: true });
      } catch (error) {
        if (artifacts && context.pages()[0]) await context.pages()[0].screenshot({ path: path.join(artifacts, `failure-${style}-${width}.png`), fullPage: true });
        console.error({ style, width, errors, unexpected, deletes }); throw error;
      } finally { releaseUpload?.(); await context.close(); }
    }
    console.log(JSON.stringify({ passed: true, fixtureOnly: true, results }));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
