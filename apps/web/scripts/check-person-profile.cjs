const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.env.MAMAGE_TEST_DIST || path.resolve(__dirname, '../dist');
const photos = Array.from({ length: 246 }, (_, i) => ({ id: String(1000 - i), photoId: String(1000 - i), projectId: 9, projectName: 'Test album',
  url: `https://profiles.test/${i}.svg`, thumbUrl: `https://profiles.test/${i}.svg`, title: `Photo ${i}`, width: 1600, height: 1000 }));
const avatar = color => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${color}"/></svg>`)}`;
const avatarA = avatar('#c86666'), avatarB = avatar('#6699cc');
let releaseAvatar;
const avatarGate = new Promise(resolve => { releaseAvatar = resolve; });
let releaseProfile, profileGate, holdProfile = false;
let deny = false, failNextPage = true, failAvatar = false, structuredConflict = false;
const profileRequests = [], pageRequests = [];
const nameSearches = [], writes = [];
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'index.html');
  res.setHeader('Content-Type', { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' }[path.extname(target)] || 'application/octet-stream');
  res.end(fs.readFileSync(target));
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(12000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem('mamage_jwt_token', 'isolated-person-test'); localStorage.setItem('mamage-entry-pref', 'public'); });
    await page.route('https://profiles.test/**', route => route.fulfill({ contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#c2cbd0"/></svg>' }));
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), endpoint = url.pathname;
      let status = 200, body = {};
      if (endpoint === '/api/users/me') body = { id: 999, name: 'UI test', role: 'superadmin', permissions: ['photos.view', 'photos.update', 'faces.label', 'faces.merge', 'projects.update'] };
      else if (endpoint === '/api/workspaces') body = { enabled: false, units: [] };
      else if (endpoint === '/api/persons/1' && request.method() === 'PATCH') {
        writes.push(request.postDataJSON()); status = 409;
        body = { error: 'person name already exists', ...(structuredConflict ? { message: '该姓名已被其他有效人物使用，请先核对。', existingPersonId: '3' } : {}) };
      } else if (endpoint === '/api/persons') {
        nameSearches.push(url.searchParams.get('q'));
        body = { list: [{ personId: '3', name: '刘恒', faceCount: 4 }], hasMore: false };
      } else if (/\/persons\/[13]\/faces$/.test(endpoint)) body = { faces: [{ faceId: '301', avatarDataUrl: avatarB }], total: 4 };
      else if (endpoint === '/api/projects/9') body = { id: 9, projectName: 'Test album', images: [photos[0]], photos: [photos[0]], photoCount: 1, timelineSections: [] };
      else if (endpoint === '/api/photos/1000') body = photos[0];
      else if (endpoint === '/api/photos/1000/faces') body = { faces: [101, 102].map((id, i) => ({ id, faceId: id, personId: i + 1, personName: i ? 'Person B' : 'Person A', photoId: 1000, faceNo: i + 1, left: .2 + i * .3, top: .25, width: .12, height: .25, unit: 'ratio', imageWidth: 1600, imageHeight: 1000 })) };
      else if (/\/faces\/(101|102)\/person$/.test(endpoint)) {
        profileRequests.push(request.url());
        const second = endpoint.includes('/102/');
        if (holdProfile && !second) {
          await profileGate;
          try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ person: { personId: '1', name: 'Person A' }, relatedPhotos: photos.slice(0, 24), total: 246, page: 1, hasMore: true }) }); } catch (_) { }
          return;
        }
        if (deny) { status = 403; body = { error: 'Access denied' }; }
        else { const compact = url.searchParams.get('compact') === '1'; body = { person: { personId: second ? '2' : '1', name: second ? 'Person B' : 'Person A' }, avatarFaceId: second ? '102' : '101',
          relatedPhotos: photos.slice(0, second ? 2 : compact ? 24 : 246), ...(compact ? { total: second ? 2 : 246, page: 1, pageSize: 24, hasMore: !second } : { avatarDataUrl: avatarA }) }; }
      } else if (endpoint === '/api/faces/101/avatar') {
        if (failAvatar) { await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Avatar unavailable"}' }); return; }
        await avatarGate;
        try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ avatarDataUrl: avatarA }) }); } catch (_) { }
        return;
      } else if (endpoint === '/api/faces/102/avatar') body = { avatarDataUrl: avatarB };
      else if (endpoint === '/api/persons/1/photos') {
        pageRequests.push(Number(url.searchParams.get('page')));
        if (failNextPage) { failNextPage = false; status = 503; body = { error: 'Please retry' }; }
        else body = { photos: photos.slice(24, 48), total: 246, page: 2, pageSize: 24, hasMore: true };
      } else if (endpoint === '/api/projects/import-status') body = { statuses: {} };
      else if (endpoint.startsWith('/api/photos/random')) body = { list: [] };
      else if (request.method() !== 'GET') throw new Error(`Unexpected write: ${request.method()} ${endpoint}`);
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?projectId=9&photoId=1000`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '人脸框', exact: true }).click();
    const faceA = page.locator('.viewer-face-box').filter({ hasText: 'Person A' });
    const faceB = page.locator('.viewer-face-box').filter({ hasText: 'Person B' });
    await faceA.waitFor(); const faceBox = await faceA.boundingBox();
    const started = Date.now(); await faceA.click();
    const panel = page.locator('.person-sheet-modal'); await panel.waitFor();
    await page.waitForFunction(() => !document.querySelector('.person-sheet-progress') && document.querySelector('.person-sheet-stats')?.textContent.includes('246'));
    assert.equal(await panel.locator('.person-sheet-card').count(), 24, 'Opening a person must render only the first page');
    assert.equal(new URL(profileRequests[0]).searchParams.get('compact'), '1');
    assert.equal(new URL(profileRequests[0]).searchParams.get('includeAvatar'), '0');
    assert(Date.now() - started < 1500, 'Slow avatar must not block profile details');
    assert.equal(await panel.locator('.person-sheet-loading').count(), 0);
    await panel.getByRole('button', { name: /加载更多/ }).click(); await panel.getByRole('alert').waitFor();
    assert.equal(await panel.locator('.person-sheet-card').count(), 24, 'Keep existing photos if another page fails');
    await panel.getByRole('button', { name: /加载更多/ }).click(); await page.waitForFunction(() => document.querySelectorAll('.person-sheet-card').length === 48);
    assert.deepEqual(pageRequests, [2, 2]);
    await panel.getByRole('button', { name: '关闭', exact: true }).click(); await faceB.click();
    await page.waitForFunction(() => document.querySelector('.person-sheet-stats')?.textContent.includes('2') && document.querySelector('.person-sheet-avatar img')?.src.includes('6699cc'));
    releaseAvatar(); await page.waitForTimeout(100);
    assert.equal(await panel.locator('.person-sheet-avatar img').getAttribute('src'), avatarB, 'Late avatar must not replace another person');
    await page.screenshot({ path: '/tmp/mamage-person-profile-desktop.png', fullPage: true });
    await panel.getByRole('button', { name: '关闭', exact: true }).click();
    assert.deepEqual(await faceA.boundingBox(), faceBox, 'Opening profiles must not change face box placement');
    profileGate = new Promise(resolve => { releaseProfile = resolve; }); holdProfile = true;
    await faceA.click(); await panel.locator('.person-sheet-progress').waitFor();
    await panel.getByRole('button', { name: '关闭', exact: true }).click(); await faceB.click();
    await page.waitForFunction(() => document.querySelector('.person-sheet-stats')?.textContent.endsWith('2') && document.querySelector('.person-sheet-avatar img')?.src.includes('6699cc'));
    releaseProfile(); holdProfile = false; await page.waitForTimeout(100);
    assert.equal(await panel.locator('.person-sheet-card').count(), 2, 'Late profile must not replace another person');
    assert.equal(await panel.locator('.person-sheet-avatar img').getAttribute('src'), avatarB);
    await panel.getByRole('button', { name: '关闭', exact: true }).click();
    failAvatar = true;
    await page.setViewportSize({ width: 390, height: 844 }); await faceA.click();
    await page.waitForFunction(() => document.querySelectorAll('.person-sheet-card').length === 24);
    assert(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Mobile profile must not overflow');
    await page.screenshot({ path: '/tmp/mamage-person-profile-mobile.png', fullPage: true });
    for (const modern of [false, true]) {
      structuredConflict = modern;
      await panel.getByPlaceholder('输入人物姓名').fill('刘恒');
      await panel.getByRole('button', { name: '保存姓名', exact: true }).click();
      await panel.locator('.person-sheet-error').waitFor();
      const message = await panel.locator('.person-sheet-error').innerText();
      assert.match(message, /姓名.*(存在|使用)|同名/, 'Duplicate names must explain the conflict in Chinese, including legacy responses');
      assert(!message.includes('person name already exists'), 'Do not expose raw server errors');
      assert.equal(await page.locator('.mamage-toast.is-error').count(), 0, 'Name conflict must not duplicate the inline error with floating toasts');
      assert.match(await panel.locator('.person-sheet-stats').innerText(), /246/, 'Name conflict must not hide the loaded photo total');
      if (modern) await page.screenshot({ path: '/tmp/mamage-person-name-conflict-action-mobile.png', fullPage: true });
      await panel.getByRole('button', { name: '查找同名人物', exact: true }).click();
      await panel.getByRole('button', { name: /刘恒.*#3/ }).waitFor();
      assert.equal(await panel.getByRole('textbox', { name: '搜索待合并人物' }).inputValue(), '刘恒');
      assert(nameSearches.includes('刘恒'), 'Search must start with the conflicting name');
      assert.equal(writes.length, modern ? 2 : 1, 'Conflicts must not automatically merge or retry writes');
      assert(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Mobile conflict actions must not overflow');
      if (modern) await page.screenshot({ path: '/tmp/mamage-person-name-conflict-mobile.png', fullPage: true });
      await panel.getByRole('button', { name: '取消', exact: true }).click();
    }
    await panel.getByRole('button', { name: '关闭', exact: true }).click(); deny = true;
    const count = profileRequests.length; await faceA.click(); await panel.locator('.person-sheet-error').waitFor(); await page.waitForTimeout(100);
    assert.equal(profileRequests.length, count + 1, 'Permission errors must not retry every legacy route');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ productionApp: true, fixtureOnly: true, firstPage: 24, total: 246, independentAvatar: true, paginationRetry: true, staleAvatarIgnored: true, staleProfileIgnored: true, nameConflict: true, noAutomaticMerge: true, faceGeometryUnchanged: true, mobile: true, errors }));
  } finally { releaseAvatar(); releaseProfile?.(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
