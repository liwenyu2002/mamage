const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright');
const sharp = runtime('sharp');
const { userAccessProfile } = require('../../server/lib/access_policy');
const dist = path.resolve(process.env.MAMAGE_DETAIL_QA_DIST || path.join(__dirname, '../dist'));
const output = path.resolve(process.env.MAMAGE_DETAIL_QA_DIR || path.join(__dirname, '../../../.local/project-detail-integration-qa'));

async function assertLayout(page, locator) {
  const box = await locator.boundingBox(), viewport = page.viewportSize();
  assert.ok(box && box.width > 100 && box.height > 30, 'Surface must be nonblank and measurable');
  assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1
    && box.y + box.height <= viewport.height + 1, `Surface must fit viewport: ${JSON.stringify(box)}`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const picture = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#638d83' } }).jpeg().toBuffer();
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.png') ? 'image/png' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch(), results = [];
  try {
    const widths = process.env.MAMAGE_DETAIL_QA_WIDTH ? [Number(process.env.MAMAGE_DETAIL_QA_WIDTH)] : [1440, 390];
    const scopes = process.env.MAMAGE_DETAIL_QA_SCOPE ? [process.env.MAMAGE_DETAIL_QA_SCOPE] : ['own', 'unit', 'organization', 'none'];
    for (const width of widths) for (const scope of scopes) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const errors = [], unexpected = [], writes = [], visualFindings = [];
      const timeline = scope === 'unit';
      const workspace = { userId: 7, orgId: 2, enabled: true, unitId: 1,
        userRole: scope === 'organization' ? 'superadmin' : scope === 'none' ? 'visitor' : 'admin',
        role: scope === 'unit' ? 'manager' : scope === 'none' ? 'viewer' : 'editor', collegeAdmin: scope === 'organization' };
      const access = userAccessProfile(workspace, ['projects.view', 'photos.view', 'photos.zip'], { search: false, manage: false });
      const user = { id: 7, name: 'Integration user', role: workspace.userRole, organization_id: 2, activeUnitId: 1,
        workspaceEnabled: true, unitRole: workspace.role, collegeAdmin: workspace.collegeAdmin, ...access };
      let photos = [
        { id: 11, photographerId: 7, type: 'normal', title: 'Own photo' },
        { id: 12, photographerId: 8, type: 'normal', title: 'Peer photo' },
        { id: 13, photographerId: 7, type: 'video', title: 'Own video', processingStatus: 'failed' },
        { id: 14, photographerId: 8, type: 'video', title: 'Peer video', processingStatus: 'failed' },
        { id: 15, photographerId: null, type: 'normal', title: 'Unknown owner' },
      ].map(photo => ({ ...photo, projectId: 9001, unitId: 1, url: `/api/image/${photo.id}.jpg`,
        thumbUrl: `/api/image/${photo.id}.jpg`, aiStatus: 'skipped', ...(timeline ? { timelineSectionId: 21 } : {}) }));
      let project = { id: 9001, title: 'Integration album', name: 'Integration album', adminId: 7, unitId: 1,
        description: 'Original description', eventDate: '2026-10-30', tags: ['original'], timelineEnabled: timeline,
        timelineSections: timeline ? [{ id: 21, name: 'Opening', sortOrder: 0 }, { id: 22, name: 'Closing', sortOrder: 1 }] : [] };
      let rejectDelete = false, holdUpload = null, holdVideo = null, holdEdit = null, page;
      const base = `http://127.0.0.1:${server.address().port}`;
      const snapshot = () => ({ ...project, images: photos, count: photos.length });
      try {
        await context.addInitScript(() => {
          localStorage.setItem('mamage_jwt_token', 'isolated-project-detail-integration');
          window.__MAMAGE_DISABLE_DIRECT_UPLOAD__ = true;
        });
        await context.route('**/*', async route => {
          const req = route.request(), url = new URL(req.url()), p = url.pathname;
          if (url.origin !== base) { unexpected.push(`External request ${url.origin}`); return route.abort(); }
          if (!p.startsWith('/api/')) return route.continue();
          const send = json => route.fulfill({ json });
          if (p.startsWith('/api/image/')) return route.fulfill({ contentType: 'image/jpeg', body: picture });
          if (req.method() === 'POST' && p === '/api/photos/delete') {
            const body = req.postDataJSON(); writes.push({ kind: 'delete', path: p, method: req.method(), body });
            if (rejectDelete) { rejectDelete = false; return route.fulfill({ status: 403, json: { error: 'PHOTO_DELETE_FORBIDDEN' } }); }
            photos = photos.filter(photo => !body.photoIds.includes(photo.id));
            return send({ deletedIds: body.photoIds });
          }
          if (req.method() === 'POST' && p === '/api/projects/9001/update') {
            const body = req.postDataJSON(); writes.push({ kind: 'edit', path: p, method: req.method(), body, authorization: req.headers().authorization });
            if (holdEdit) await holdEdit.promise;
            project = { ...project, ...body, title: body.projectName, name: body.projectName };
            return send({ ok: true });
          }
          if (req.method() === 'POST' && p === '/api/upload/video/direct/init') {
            writes.push({ kind: 'video-init', path: p, method: req.method(), body: req.postDataJSON() });
            return route.fulfill({ status: 409, json: { error: 'DIRECT_UPLOAD_UNAVAILABLE' } });
          }
          if (req.method() === 'POST' && ['/api/upload/photo', '/api/upload/video'].includes(p)) {
            const form = await new Response(req.postDataBuffer(), { headers: { 'Content-Type': req.headers()['content-type'] } }).formData();
            const fields = Object.fromEntries([...form.entries()].filter(([key]) => key !== 'file'));
            const file = form.get('file');
            writes.push({ kind: 'upload', path: p, method: req.method(), fields, name: file.name, size: file.size,
              authorization: req.headers().authorization, unit: req.headers()['x-mamage-unit-id'] });
            if (holdUpload) await holdUpload.promise;
            const video = p.endsWith('/video');
            if (video && holdVideo) await holdVideo.promise;
            const photo = { id: video ? 92 : 91, projectId: 9001, unitId: 1, photographerId: 7,
              type: video ? 'video' : 'normal', title: file.name, ...(video ? { processingStatus: 'failed' } : {}),
              url: '/api/image/91.jpg', thumbUrl: '/api/image/91.jpg', aiStatus: 'skipped' };
            photos = [photo, ...photos]; return send(photo);
          }
          if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
            unexpected.push(`${req.method()} ${p}`); return route.fulfill({ status: 500, json: { error: 'UNEXPECTED_WRITE' } });
          }
          if (p === '/api/users/me') return send(user);
          if (p === '/api/workspaces') return send({ enabled: true, activeUnitId: 1, collegeAdmin: workspace.collegeAdmin,
            units: [{ id: 1, name: 'Integration group', role: workspace.role }], shareTargets: [] });
          if (p === '/api/projects/9001') return send(snapshot());
          if (p === '/api/photos') return send({ list: photos, total: photos.length });
          if (/^\/api\/photos\/\d+$/.test(p)) return send(photos.find(photo => photo.id === Number(p.split('/').at(-1))) || {});
          if (p === '/api/projects/import-status') return send({ statuses: {} });
          if (p === '/api/similarity/groups/simple') return send({ groups: [], photos: {} });
          return send([]);
        });
        page = await context.newPage(); page.setDefaultTimeout(8000);
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/?projectId=9001');
        const dock = page.getByRole('navigation', { name: '相册底部操作', exact: true });
        await dock.waitFor();
        await page.locator('[data-photo-id="11"]').waitFor();
        assert.ok((await dock.getAttribute('class')).includes('detail-bottom-nav--adaptive'));
        await assertLayout(page, dock);
        const rendered = await sharp(await dock.screenshot({ animations: 'disabled' })).stats();
        assert.ok(rendered.channels.some(channel => channel.stdev > 5), 'Dock screenshot must have visible controls');
        const select = () => dock.getByRole('button', { name: /^选择$|^完成选择/ });
        const check = id => {
          const label = page.locator(`[data-photo-id="${id}"] .detail-photo-select`), input = label.locator('input');
          const set = async value => {
            if (await input.isChecked() !== value) await label.click();
            assert.equal(await input.isChecked(), value);
          };
          return { check: () => set(true), uncheck: () => set(false), isChecked: () => input.isChecked() };
        };
        const remove = dock.getByRole('button', { name: '删除所选内容', exact: true });
        await select().click();
        assert.equal(await remove.isDisabled(), true);
        await check(12).check();
        assert.equal(await remove.isEnabled(), ['unit', 'organization'].includes(scope), 'Peer photo deletion follows scope');
        await check(11).check();
        assert.equal(await remove.isEnabled(), ['unit', 'organization'].includes(scope), 'Mixed selection cannot expand own-only access');
        await check(12).uncheck();
        assert.equal(await remove.isEnabled(), scope !== 'none');
        await check(13).check();
        assert.equal(await remove.isEnabled(), scope !== 'none', 'Own video has the same permission as own photo');
        await check(14).check();
        assert.equal(await remove.isEnabled(), ['unit', 'organization'].includes(scope), 'Peer video cannot bypass ownership');
        await check(14).uncheck();
        await check(15).check();
        assert.equal(await remove.isEnabled(), ['unit', 'organization'].includes(scope), 'Missing uploader fails closed for ordinary users');
        await check(15).uncheck();
        if (['unit', 'organization'].includes(scope)) { await check(12).check(); await check(14).check(); }
        await page.screenshot({ path: path.join(output, `${scope}-${width}-selection.png`), animations: 'disabled' });
        if (scope !== 'none') {
          const ids = ['unit', 'organization'].includes(scope) ? [11, 12, 13, 14] : [11, 13];
          await remove.click();
          const confirmation = page.getByRole('dialog', { name: '确认删除所选照片', exact: true });
          await confirmation.waitFor();
          assert.equal(writes.length, 0, 'Opening confirmation does not delete');
          await confirmation.getByRole('button', { name: '取消', exact: true }).click();
          assert.equal(writes.length, 0, 'Cancelling does not delete');
          rejectDelete = true;
          await remove.click(); await confirmation.getByRole('button', { name: '确定', exact: true }).click();
          await confirmation.waitFor({ state: 'hidden' });
          assert.equal(writes.length, 1, '403 must not retry through a legacy endpoint');
          assert.deepEqual(writes[0], { kind: 'delete', path: '/api/photos/delete', method: 'POST', body: { photoIds: ids } });
          assert.equal(photos.length, 5, 'Rejected deletion preserves media');
          assert.equal(await check(11).isChecked(), true, 'Rejected deletion preserves selection');
          await remove.click(); await confirmation.getByRole('button', { name: '确定', exact: true }).click();
          await confirmation.waitFor({ state: 'hidden' });
          await page.locator('[data-photo-id="11"]').waitFor({ state: 'detached' });
          assert.deepEqual(writes[1].body, { photoIds: ids });
        } else await select().click();

        const upload = dock.locator('.detail-bottom-upload');
        if (scope === 'none') {
          assert.equal(await upload.isDisabled(), true);
          await dock.getByRole('button', { name: '打开功能', exact: true }).click();
          assert.equal(await page.getByRole('button', { name: '修改相册信息', exact: true }).count(), 0);
          assert.deepEqual(writes, []);
        } else {
          await upload.click();
          const dialog = page.getByRole('dialog', { name: '上传照片与视频', exact: true });
          await dialog.waitFor();
          await page.waitForFunction(() => document.getElementById('root').inert);
          assert.equal(await dock.isVisible(), false, 'Dock is hidden under the upload dialog');
          assert.equal(await dialog.getByRole('button', { name: '确认上传', exact: true }).isDisabled(), true);
          await assertLayout(page, dialog);
          await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
          await page.waitForFunction(() => !document.getElementById('root').inert && document.body.style.overflow !== 'hidden');
          await upload.click(); await dialog.waitFor();
          if (timeline) await dialog.getByRole('radio', { name: 'Opening', exact: true }).click();
          const chooser = page.waitForEvent('filechooser');
          await dialog.locator('.detail-upload-dropzone').click();
          await (await chooser).setFiles([{ name: 'integration.jpg', mimeType: 'image/jpeg', buffer: picture },
            { name: 'integration.mp4', mimeType: 'video/mp4', buffer: Buffer.from('isolated-video-fixture') }]);
          await dialog.getByRole('button', { name: '确认上传', exact: true }).waitFor();
          await page.waitForFunction(() => {
            const preview = document.querySelector('.detail-upload-preview-media');
            return preview && preview.complete && preview.naturalWidth > 0;
          });
          const videoCard = dialog.locator('.detail-upload-preview-item.is-video');
          await videoCard.locator('.detail-upload-preview-video-badge').waitFor();
          for (const card of await dialog.locator('.detail-upload-preview-item').all()) {
            const controls = [];
            for (const name of ['video-badge', 'section', 'remove']) {
              const control = card.locator(`.detail-upload-preview-${name}`);
              if (await control.count()) {
                const box = await control.boundingBox();
                assert.ok(box, `${name} must be visible`);
                controls.push({ name, ...box });
              }
            }
            for (let i = 0; i < controls.length; i += 1) for (let j = i + 1; j < controls.length; j += 1) {
              const a = controls[i], b = controls[j];
              if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) {
                visualFindings.push({ issue: `${a.name} overlaps ${b.name}`, first: a, second: b });
              }
            }
          }
          await page.screenshot({ path: path.join(output, `${scope}-${width}-upload.png`), animations: 'disabled' });
          assert.deepEqual(visualFindings, [], 'Preview badge, section selector and remove button must not overlap');
          await videoCard.getByRole('button', { name: '移除媒体', exact: true }).click();
          await videoCard.waitFor({ state: 'detached' });
          const reselect = page.waitForEvent('filechooser');
          await dialog.locator('.detail-upload-dropzone').click();
          await (await reselect).setFiles([{ name: 'integration.mp4', mimeType: 'video/mp4', buffer: Buffer.from('isolated-video-fixture') }]);
          await videoCard.waitFor();
          assert.equal(writes.filter(write => write.kind === 'upload').length, 0, 'Staging files never writes');
          holdUpload = gate();
          holdVideo = gate();
          await dialog.getByRole('button', { name: '确认上传', exact: true }).click();
          await poll(() => writes.some(write => write.kind === 'upload'));
          await dialog.getByRole('button', { name: '取消', exact: true }).click();
          await page.keyboard.press('Escape');
          assert.equal(await dialog.isVisible(), true, 'An in-flight upload cannot be dismissed');
          holdUpload.resolve();
          await poll(() => writes.filter(write => write.kind === 'upload').length === 2);
          await videoCard.locator('.detail-upload-preview-status').waitFor();
          assert.equal(await videoCard.locator('.detail-upload-preview-video-badge').count(), 0, 'Upload status replaces the video badge');
          assert.equal(await videoCard.getByRole('button', { name: '移除媒体', exact: true }).isDisabled(), true);
          const uploads = writes.filter(write => write.kind === 'upload');
          for (const sent of uploads) {
            assert.deepEqual(sent.fields, { projectId: '9001', ...(timeline ? { timelineSectionId: '21' } : {}) });
            assert.equal(sent.authorization, 'Bearer isolated-project-detail-integration');
          }
          const photoUpload = uploads.find(write => write.path === '/api/upload/photo');
          const videoUpload = uploads.find(write => write.path === '/api/upload/video');
          assert.equal(photoUpload.name, 'integration.jpg'); assert.equal(photoUpload.size, picture.length);
          assert.equal(videoUpload.name, 'integration.mp4');
          assert.deepEqual(writes.find(write => write.kind === 'video-init').body, {
            projectId: '9001', ...(timeline ? { timelineSectionId: '21' } : {}), type: 'video',
            fileName: 'integration.mp4', fileSize: 22, mimeType: 'video/mp4', clientProtocol: 'http:',
          });
          holdVideo.resolve();
          await dialog.waitFor({ state: 'hidden' });
          await page.waitForFunction(() => !document.getElementById('root').inert);
          await page.locator('[data-photo-id="91"]').waitFor();
          await page.locator('[data-photo-id="92"]').waitFor();

          await dock.getByRole('button', { name: '打开功能', exact: true }).click();
          await page.getByRole('button', { name: '修改相册信息', exact: true }).click();
          const edit = page.getByRole('dialog', { name: '编辑相册', exact: true });
          await edit.waitFor(); await assertLayout(page, edit);
          assert.equal(await dock.isVisible(), false);
          await edit.locator('.mamage-dtp-trigger').click();
          const calendar = page.getByRole('dialog', { name: '选择日期时间', exact: true });
          await calendar.waitFor(); await assertLayout(page, calendar);
          await calendar.getByRole('button', { name: '完成', exact: true }).click();
          await calendar.waitFor({ state: 'hidden' });
          await edit.getByRole('textbox', { name: /^相册名称/ }).fill('Updated album');
          await edit.getByRole('textbox', { name: /^相册描述/ }).fill('Updated description');
          holdEdit = gate();
          await edit.getByRole('button', { name: '保存', exact: true }).click();
          await poll(() => writes.some(write => write.kind === 'edit'));
          await edit.getByRole('button', { name: '取消', exact: true }).click();
          assert.equal(await edit.isVisible(), true, 'An in-flight edit cannot be dismissed');
          const saved = writes.find(write => write.kind === 'edit');
          assert.deepEqual(saved.body, { projectName: 'Updated album', description: 'Updated description', eventDate: '2026-10-30', tags: ['original'] });
          assert.equal(saved.authorization, 'Bearer isolated-project-detail-integration');
          holdEdit.resolve(); await edit.waitFor({ state: 'hidden' });
          await page.waitForFunction(() => !document.getElementById('root').inert);
          await assertLayout(page, dock);
        }
        assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
        results.push({ width, scope, timeline, passed: true, visualFindings, writes });
        console.log(JSON.stringify({ width, scope, passed: true, visualFindings }));
      } catch (error) {
        results.push({ width, scope, timeline, passed: false, error: error.message, errors, unexpected, visualFindings, writes });
        console.log(JSON.stringify({ width, scope, passed: false, error: error.message }));
        if (page) await page.screenshot({ path: path.join(output, `${scope}-${width}-failure.png`), animations: 'disabled' }).catch(() => {});
      } finally {
        holdUpload?.resolve(); holdVideo?.resolve(); holdEdit?.resolve(); await context.close();
      }
    }
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  const result = { passed: results.every(item => item.passed), visualPassed: results.every(item => !item.visualFindings.length), results };
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  assert.equal(result.passed, true, 'See per-scenario findings in results.json');
  assert.equal(result.visualPassed, true, 'See visual findings in results.json');
}

function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function poll(predicate) {
  const deadline = Date.now() + 8000;
  while (!predicate()) { if (Date.now() > deadline) throw Error('Expected API request was not observed'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
