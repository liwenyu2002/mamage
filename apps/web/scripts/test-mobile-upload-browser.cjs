const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright');
const root = path.resolve(__dirname, '..');
const dist = path.resolve(process.env.MAMAGE_MOBILE_UPLOAD_DIST || path.join(root, 'dist'));
const output = process.env.MAMAGE_MOBILE_UPLOAD_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'mamage-mobile-upload-'));
const png = fs.readFileSync(path.join(root, 'public/favicon.png'));
const media = [{ name: 'fixture.png', mimeType: 'image/png', buffer: png },
  { name: 'fixture.mp4', mimeType: 'video/mp4', buffer: Buffer.from('local video fixture') }];

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const index = fs.readFileSync(path.join(dist, 'index.html'));
  let server, browser;
  const results = [];
  try {
    server = http.createServer((req, res) => {
      const pathname = new URL(req.url, 'http://fixture').pathname;
      if (pathname.startsWith('/api/')) { res.writeHead(500); res.end('Unmocked fixture API'); return; }
      const requested = path.join(dist, pathname);
      const file = requested.startsWith(dist + '/') && fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(dist, 'index.html');
      res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      if (file === path.join(dist, 'index.html')) { res.end(index); return; }
      fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
    const widths = process.env.MAMAGE_MOBILE_UPLOAD_WIDTH ? [Number(process.env.MAMAGE_MOBILE_UPLOAD_WIDTH)] : [390, 320, 1440];
    for (const width of widths) for (const dark of (process.env.MAMAGE_MOBILE_UPLOAD_THEME
      ? [process.env.MAMAGE_MOBILE_UPLOAD_THEME === 'dark'] : width <= 768 ? [false, true] : [false])) {
      const mobile = width <= 768;
      const label = `${width}-${dark ? 'dark' : 'light'}`;
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: mobile, hasTouch: mobile,
        reducedMotion: 'reduce', serviceWorkers: 'block' });
      const errors = [], unexpected = [], uploads = [], creates = [];
      let timeline = false, releaseUploads = null, uploadGate = null;
      const sections = [{ id: 21, name: 'Opening', sortOrder: 0 }, { id: 22, name: 'Closing', sortOrder: 1 }];
      let photos = [{ id: 11, projectId: 9001, unitId: 1, photographerId: 7, type: 'normal',
        url: '/api/image/fixture.png', thumbUrl: '/api/image/fixture.png', aiStatus: 'skipped' }];
      const projects = [{ id: 9001, name: 'Upload fixture', title: 'Upload fixture', adminId: 7, unitId: 1, canEdit: true }];
      const album = () => ({ ...projects[0], images: photos, count: photos.length, timelineEnabled: timeline, timelineSections: timeline ? sections : [] });
      try {
        await context.addInitScript(dark => {
          localStorage.setItem('mamage_jwt_token', 'isolated-mobile-upload-fixture');
          localStorage.setItem('mamage-folder-style:v1:7', 'glass');
          localStorage.setItem('mamage-viewer-appearance', JSON.stringify({ dark, blur: 20 }));
        }, dark);
        await context.route('**/*', async route => {
          const req = route.request(), url = new URL(req.url()), p = url.pathname;
          if (url.origin !== base) { unexpected.push(`${req.method()} ${url.origin}${p}`); return route.abort(); }
          if (!p.startsWith('/api/')) return route.continue();
          const send = json => route.fulfill({ json });
          if (p === '/api/projects' && req.method() === 'POST') {
            const body = req.postDataJSON(); creates.push(body);
            const project = { id: 9100, name: body.projectName, title: body.projectName, adminId: 7, unitId: 1, canEdit: true,
              timelineEnabled: body.timelineEnabled, timelineSections: (body.timelineSections || []).map((section, index) => ({ ...section, id: 201 + index })) };
            projects.push(project); return send(project);
          }
          if (/^\/api\/upload\/(photo|video)\/direct\/init$/.test(p)) return route.fulfill({ status: 409, json: { error: 'DIRECT_UPLOAD_UNAVAILABLE' } });
          if (['/api/upload/photo', '/api/upload/video'].includes(p) && req.method() === 'POST') {
            const form = await new Response(req.postDataBuffer(), { headers: { 'Content-Type': req.headers()['content-type'] } }).formData();
            const file = form.get('file');
            const fields = Object.fromEntries([...form.entries()].filter(([key]) => key !== 'file'));
            uploads.push({ path: p, name: file.name, ...fields });
            if (uploadGate) await uploadGate;
            const photo = { id: 100 + uploads.length, projectId: Number(fields.projectId), unitId: 1, photographerId: 7,
              type: p.endsWith('video') ? 'video' : 'normal', processingStatus: 'failed', title: file.name,
              timelineSectionId: Number(fields.timelineSectionId) || undefined, url: '/api/image/fixture.png', thumbUrl: '/api/image/fixture.png', aiStatus: 'skipped' };
            if (photo.projectId === 9001) photos.push(photo);
            return send(photo);
          }
          if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { unexpected.push(`${req.method()} ${p}`); return route.abort(); }
          if (p.startsWith('/api/image/')) return route.fulfill({ contentType: 'image/png', body: png });
          if (p === '/api/users/me') return send({ id: 7, name: 'Fixture', role: 'admin', activeUnitId: 1, workspaceEnabled: true, unitRole: 'manager',
            metadataEditScope: 'unit', photoDeleteScope: 'unit', permissions: ['projects.view', 'projects.create', 'projects.update', 'photos.view', 'photos.edit', 'photos.zip', 'upload.photo', 'tags.edit'] });
          if (p === '/api/workspaces') return send({ enabled: true, activeUnitId: 1, units: [{ id: 1, name: 'Fixture workspace', role: 'manager' }] });
          if (p === '/api/album-desktop') return send({ albums: [album()], groups: [], sharedAlbums: [], sharedFolders: [],
            preferences: { pins: [], colors: {}, recentItems: [] }, canOrganize: true, canDeleteFolders: true,
            scope: { userId: 7, organizationId: 2, unitId: 1 }, workspaceRevision: 1, userRevision: 1 });
          if (p === '/api/projects/9001') return send(album());
          if (p === '/api/projects/9100') return send({ ...projects.at(-1), photoCount: uploads.filter(item => item.projectId === '9100').length });
          if (p === '/api/projects/list') return send({ list: projects, total: projects.length, hasMore: false });
          if (p === '/api/photos') return send({ list: photos, total: photos.length, hasMore: false });
          if (p === '/api/projects/import-status') return send({ statuses: {} });
          if (p === '/api/similarity/groups/simple') return send({ groups: [], photos: {} });
          if (p.endsWith('/previews')) return send({ list: [] });
          return send({});
        });
        const page = await context.newPage(); page.setDefaultTimeout(12000);
        page.on('pageerror', error => errors.push(error.message));
        const chooseFiles = async (button, files) => {
          const chooser = page.waitForEvent('filechooser'); await button.click(); await (await chooser).setFiles(files);
        };
        let drag;
        const addDragFile = async (mixed = false) => {
          await drag?.dispose();
          drag = await page.evaluateHandle(({ data, mixed }) => {
            const transfer = new DataTransfer();
            transfer.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], 'drag.png', { type: 'image/png' }));
            if (mixed) transfer.items.add(new File(['local video fixture'], 'drag.mp4', { type: 'video/mp4' }));
            return transfer;
          }, { data: png.toString('base64'), mixed });
        };
        const noDropPresentation = async surface => {
          assert.doesNotMatch(await surface.innerText(), /拖入|拖拽|松手|松开/);
          const dashed = await surface.evaluate(node => [node, ...node.querySelectorAll('*')].filter(element => {
            const rect = element.getBoundingClientRect(), css = getComputedStyle(element);
            return rect.width && rect.height && css.visibility !== 'hidden' && ['dashed', 'dotted'].includes(css.borderTopStyle);
          }).map(element => element.className));
          assert.deepEqual(dashed, [], 'Mobile upload must not look like a drop area');
        };
        await page.goto(base);
        await page.getByRole('button', { name: '新建相册或文件夹', exact: true }).click();
        let modal = page.getByRole('dialog', { name: '新建', exact: true }); await modal.waitFor();
        const theme = await page.locator('html').getAttribute('data-glass-theme');
        if (dark) assert.equal(theme, 'dark'); else assert.ok(theme === null || theme === 'light');
        const add = modal.getByRole('button', { name: '添加照片或视频', exact: true });
        if (mobile) {
          await noDropPresentation(modal);
          const bounds = await add.boundingBox(); assert.ok(bounds.height >= 44 && bounds.height <= 56, 'Mobile picker is a tap button, not a dropzone');
        }
        await addDragFile(!mobile);
        await modal.locator('.cam-upload-group').first().dispatchEvent('dragover', { dataTransfer: drag });
        assert.equal(await modal.locator('.cam-upload-group.is-drag-over').count(), mobile ? 0 : 1);
        await modal.locator('.cam-upload-group').first().dispatchEvent('drop', { dataTransfer: drag });
        assert.equal(await modal.locator('.cam-preview-item').count(), mobile ? 0 : 2);
        if (!mobile) { await modal.getByRole('button', { name: '移除媒体' }).first().click(); await modal.getByRole('button', { name: '移除媒体' }).click(); }
        await chooseFiles(add, media);
        assert.equal(await modal.locator('.cam-preview-item').count(), 2);
        if (width === 390 && !dark) {
          await page.setViewportSize({ width: 769, height: 900 });
          await modal.locator('.cam-upload-block:not(.is-mobile-upload)').waitFor();
          assert.equal(await modal.locator('.cam-preview-item').count(), 2);
          await page.setViewportSize({ width: 768, height: 900 });
          await modal.locator('.cam-upload-block.is-mobile-upload').waitFor();
          assert.equal(await modal.locator('.cam-preview-item').count(), 2);
          await page.setViewportSize({ width, height: 900 });
        }
        const accept = await modal.locator('input[type=file]').getAttribute('accept');
        if (mobile) assert.equal(accept, 'image/*,video/*'); else assert.match(accept, /\.heic/);
        await modal.getByRole('textbox', { name: /相册名称/ }).fill('Created upload fixture');
        await modal.getByRole('button', { name: '时间轴', exact: true }).click();
        await modal.locator('.cam-timeline-toggle input[type=checkbox]').check();
        await modal.getByPlaceholder('环节 1', { exact: true }).fill('Opening');
        await modal.getByRole('button', { name: '添加环节', exact: true }).click();
        await modal.getByPlaceholder('环节 2', { exact: true }).fill('Closing');
        await modal.locator('.cam-preview-section').first().selectOption('1');
        await modal.locator('.cam-preview-section').last().selectOption('2');
        await modal.getByRole('button', { name: '移除媒体' }).last().click();
        const closing = modal.locator('.cam-upload-group').filter({ has: page.locator('.cam-upload-group-title', { hasText: 'Closing' }) });
        await chooseFiles(closing.getByRole('button', { name: '添加', exact: true }), [media[1]]);
        assert.equal(await modal.locator('.cam-preview-item').count(), 2);
        if (mobile) await noDropPresentation(modal);
        await page.screenshot({ path: path.join(output, `create-staged-${label}.png`) });
        uploadGate = new Promise(resolve => { releaseUploads = resolve; });
        await modal.getByRole('button', { name: '创建', exact: true }).click();
        for (let i = 0; i < 150 && !uploads.length; i++) await page.waitForTimeout(50);
        assert.ok(uploads.length > 0); assert.ok(await modal.getByRole('button', { name: /创建/ }).last().isDisabled());
        releaseUploads(); uploadGate = null; releaseUploads = null;
        await modal.waitFor({ state: 'detached' });
        assert.equal(creates.length, 1);
        assert.deepEqual(uploads.map(item => [item.name, item.projectId, item.timelineSectionId]), [['fixture.png', '9100', '201'], ['fixture.mp4', '9100', '202']]);

        for (timeline of [false, true]) {
          const before = uploads.length;
          await page.goto(`${base}/?projectId=9001`);
          const dock = page.getByRole('navigation', { name: '相册底部操作', exact: true }); await dock.waitFor();
          if (mobile) assert.doesNotMatch(await dock.locator('.detail-bottom-upload').getAttribute('title'), /拖|松/);
          await addDragFile(); await page.locator('body').dispatchEvent('dragenter', { dataTransfer: drag });
          assert.equal(await page.locator('.detail-file-drop-overlay').count(), mobile ? 0 : 1);
          await page.locator('body').dispatchEvent('dragleave', { dataTransfer: drag });
          if (mobile) { await page.locator('body').dispatchEvent('drop', { dataTransfer: drag }); assert.equal(uploads.length, before); }
          await dock.getByRole('button', { name: '上传照片或视频', exact: true }).click();
          modal = page.getByRole('dialog', { name: '上传照片与视频', exact: true }); await modal.waitFor();
          if (mobile) { await noDropPresentation(modal); assert.equal(await modal.locator('.detail-upload-dropzone').count(), 0); }
          else assert.equal(await modal.locator('.detail-upload-dropzone').count(), 1);
          if (timeline) await modal.getByRole('radio', { name: 'Opening', exact: true }).click();
          const picker = modal.locator('.detail-upload-picker, .detail-upload-dropzone');
          if (mobile) {
            await picker.dispatchEvent('dragover', { dataTransfer: drag });
            await picker.dispatchEvent('drop', { dataTransfer: drag });
            assert.equal(await modal.locator('.detail-upload-preview-item').count(), 0);
            assert.equal(uploads.length, before);
          }
          await chooseFiles(picker, media);
          assert.equal(await modal.locator('.detail-upload-preview-item').count(), 2);
          const retainedPreview = await modal.locator('.detail-upload-preview-media').getAttribute('src');
          await modal.locator('.detail-upload-preview-media').evaluate(image => image.decode());
          if (mobile) {
            await modal.locator('.detail-upload-section-group').first().dispatchEvent('drop', { dataTransfer: drag });
            assert.equal(await modal.locator('.detail-upload-preview-item').count(), 2);
            assert.equal(uploads.length, before, 'Accidental mobile drop cannot auto-upload');
            const ink = await picker.evaluate(node => getComputedStyle(node).color.match(/[\d.]+/g).slice(0, 3).map(Number));
            assert.ok(dark ? ink.every(channel => channel > 160) : ink.every(channel => channel < 100), 'Picker text follows global theme');
          }
          await modal.getByRole('button', { name: '移除媒体', exact: true }).last().click();
          if (timeline) await modal.getByRole('radio', { name: 'Closing', exact: true }).click();
          await chooseFiles(picker, [media[1]]);
          if (timeline) {
            await modal.locator('.detail-upload-preview-section').first().selectOption('22');
            await modal.locator('.detail-upload-preview-section').first().selectOption('21');
          }
          assert.ok(await page.evaluate(async src => {
            try { return (await fetch(src)).ok; } catch (_) { return false; }
          }, retainedPreview), 'Removing another file must not revoke the retained photo preview');
          await modal.locator('.detail-upload-preview-media').evaluate(image => image.decode());
          if (mobile) await noDropPresentation(modal);
          await page.screenshot({ path: path.join(output, `project-${timeline ? 'timeline' : 'plain'}-${label}.png`) });
          await modal.getByRole('button', { name: '确认上传', exact: true }).click();
          await modal.waitFor({ state: 'detached' });
          const uploaded = uploads.slice(before);
          assert.equal(uploaded.length, 2);
          assert.deepEqual(uploaded.map(item => item.name).sort(), ['fixture.mp4', 'fixture.png']);
          assert.ok(uploaded.every(item => item.projectId === '9001'));
          if (timeline) assert.deepEqual(uploaded.map(item => [item.name, item.timelineSectionId]).sort(), [['fixture.mp4', '22'], ['fixture.png', '21']]);
        }
        if (!mobile) {
          const before = uploads.length;
          await addDragFile(true);
          const target = page.locator('.detail-timeline-section').filter({ has: page.locator('.detail-timeline-title', { hasText: 'Opening' }) });
          await target.dispatchEvent('dragenter', { dataTransfer: drag });
          await target.dispatchEvent('dragover', { dataTransfer: drag });
          await target.dispatchEvent('drop', { dataTransfer: drag });
          for (let i = 0; i < 150 && uploads.length < before + 2; i++) await page.waitForTimeout(50);
          assert.equal(uploads.length, before + 2, 'Desktop mixed-media drop uploads exactly once');
          assert.deepEqual(uploads.slice(before).map(item => [item.name, item.timelineSectionId]).sort(), [['drag.mp4', '21'], ['drag.png', '21']]);
          await page.getByRole('dialog', { name: '上传照片与视频', exact: true }).waitFor({ state: 'hidden' });
        }
        assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
        results.push({ width, dark, mobile, createAndProject: true, multiMedia: true, removal: true, timelineAssignment: true, uploads: uploads.length, desktopDragRetained: !mobile });
        await drag.dispose();
      } catch (error) {
        if (context.pages()[0]) await context.pages()[0].screenshot({ path: path.join(output, `failure-${label}.png`) }).catch(() => {});
        console.error({ width, dark, errors, unexpected, uploads }); throw error;
      } finally { releaseUploads?.(); await context.close(); }
    }
    console.log(JSON.stringify({ passed: true, results, output, dist, indexSha256: createHash('sha256').update(index).digest('hex'), fixtureOnly: true, buildRun: false }));
  } finally {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
