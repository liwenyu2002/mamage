const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.env.MAMAGE_TEST_DIST || path.resolve(__dirname, '../dist');
const picture = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#a1adb7"/></svg>';
const avatar = `data:image/svg+xml,${encodeURIComponent(picture)}`;
const photos = [1000, 1001, 1002].map(id => ({ id: String(id), photoId: String(id), projectId: 9,
  url: 'https://profiles.test/photo.svg', thumbUrl: 'https://profiles.test/photo.svg', width: 1600, height: 1000 }));
const faces = [101, 102, 103].map((id, index) => ({ faceId: String(id), photoId: String(1000 + index), avatarDataUrl: avatar }));
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'index.html');
  res.setHeader('Content-Type', { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(target)] || 'application/octet-stream');
  res.end(fs.readFileSync(target));
});

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(8000);
      const errors = [], writes = [], nativeDialogs = [];
      let rejectSplit = true, releaseSplit;
      const splitGate = new Promise(resolve => { releaseSplit = resolve; });
      page.on('pageerror', error => errors.push(error.message));
      // Embedded browsers may suppress native confirm; it must not silently block this workflow.
      page.on('dialog', async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
      await page.addInitScript(() => {
        localStorage.setItem('mamage_jwt_token', 'isolated-split-test');
        localStorage.setItem('mamage-entry-pref', 'public');
      });
      await page.route('https://profiles.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: picture }));
      await page.route('**/api/**', async route => {
        const request = route.request(), endpoint = new URL(request.url()).pathname;
        let body = {}, status = 200;
        if (endpoint === '/api/users/me') body = { id: 999, role: 'superadmin', name: 'Split test', permissions: ['photos.view', 'faces.label', 'faces.merge'] };
        else if (endpoint === '/api/workspaces') body = { enabled: false, units: [] };
        else if (endpoint === '/api/projects/9') body = { id: 9, projectName: 'Split test', images: [photos[0]], photos: [photos[0]], photoCount: 1, timelineSections: [] };
        else if (endpoint === '/api/photos/1000') body = photos[0];
        else if (endpoint === '/api/photos/1000/faces') body = { faces: [{ faceId: 101, id: 101, photoId: 1000, personId: 1, personName: 'Person A', faceNo: 1,
          left: .2, top: .25, width: .12, height: .25, unit: 'ratio', imageWidth: 1600, imageHeight: 1000 }] };
        else if (endpoint === '/api/faces/101/person' || endpoint === '/api/persons/1') body = {
          person: { personId: '1', name: 'Person A' }, avatarFaceId: '101', relatedPhotos: photos, total: 3, page: 1, hasMore: false };
        else if (endpoint === '/api/faces/101/avatar') body = { avatarDataUrl: avatar };
        else if (endpoint === '/api/persons/1/faces') body = { faces, total: 3, hasMore: false };
        else if (endpoint === '/api/persons/1/split-preview') body = { stats: width === 320 ? {} : { totalFaces: 3 }, moveFaces: [faces[0]], keepFaces: faces.slice(1), undecidedFaces: [] };
        else if (endpoint === '/api/persons/1/split') {
          writes.push(request.postDataJSON());
          if (rejectSplit) { status = 409; body = { error: 'person name already exists', message: '该姓名已被其他有效人物使用，请核对后重试。' }; }
          else { await splitGate; body = { ok: true, movedFaces: 1, newPersonId: '4' }; }
        } else if (endpoint === '/api/projects/import-status') body = { statuses: {} };
        else if (endpoint.startsWith('/api/photos/random')) body = { list: [] };
        else if (request.method() !== 'GET') throw new Error(`Unexpected write: ${request.method()} ${endpoint}`);
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      });
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/?projectId=9&photoId=1000`);
        await page.getByTitle('显示人脸框', { exact: true }).click();
        await page.locator('.viewer-face-box').filter({ hasText: 'Person A' }).click();
        const panel = page.locator('.person-sheet-modal');
        await panel.getByRole('button', { name: '拆分人物', exact: true }).click();
        await panel.locator('.person-split-chip').first().click();
        await panel.getByRole('button', { name: '智能拆分预览', exact: true }).click();
        await panel.getByTitle('照片 1001', { exact: true }).click();
        await panel.getByTitle('照片 1002', { exact: true }).click();
        await panel.getByRole('button', { name: '确认拆分', exact: true }).click();
        assert.match(await panel.locator('.person-split-error').innerText(), /至少保留一张/);
        assert.equal(writes.length, 0, 'Cannot move every face away from the original person');
        await panel.getByTitle('照片 1001', { exact: true }).click();
        await panel.getByTitle('照片 1002', { exact: true }).click();
        await panel.getByRole('button', { name: '确认拆分', exact: true }).click();
        assert.deepEqual(nativeDialogs, [], 'Confirm split must not depend on a dismissible/suppressed native confirm');
        const confirmation = panel.getByRole('alertdialog', { name: '确认拆分' });
        await confirmation.waitFor();
        assert.equal(writes.length, 0, 'No write before the in-page confirmation');
        await confirmation.getByRole('button', { name: '返回检查', exact: true }).click();
        assert.equal(writes.length, 0, 'Cancel must not split any faces');
        await panel.getByRole('button', { name: '确认拆分', exact: true }).click();
        await confirmation.getByRole('button', { name: '确认并保存', exact: true }).click();
        await panel.locator('.person-split-error').waitFor();
        assert.match(await panel.locator('.person-split-error').innerText(), /姓名.*使用/);
        assert(!(await panel.locator('.person-split-error').innerText()).includes('{'), 'Render the message, not raw JSON');
        assert.deepEqual(errors, [], 'Structured API errors must not crash the person panel');
        rejectSplit = false;
        await panel.getByRole('button', { name: '确认拆分', exact: true }).click();
        await page.screenshot({ path: `/tmp/mamage-person-split-${width}.png`, fullPage: true });
        await confirmation.getByRole('button', { name: '确认并保存', exact: true }).evaluate(button => { button.click(); button.click(); });
        await page.waitForFunction(() => document.querySelector('[role="alertdialog"] button:disabled'));
        assert.equal(writes.length, 2);
        assert.deepEqual(writes[1].moveFaceIds, [101]);
        assert.deepEqual(writes[1].seedFaceIds, ['101']);
        assert(await confirmation.getByRole('button', { name: '返回检查', exact: true }).isDisabled());
        assert(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Split panel must not overflow');
        releaseSplit();
        await panel.getByRole('button', { name: '拆分人物', exact: true }).waitFor();
        assert.equal(writes.length, 2, 'One accepted request per confirmation');
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ width, splitSucceeded: true, cancelSafe: true, structuredError: true, nativeDialogs: 0, fixtureOnly: true }));
      } finally { releaseSplit(); await page.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
