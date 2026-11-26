const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const serverRequire = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = serverRequire('playwright');
const sharp = serverRequire('sharp');

const output = path.resolve(__dirname, '../../../.local/college-window-qa');
const base = new URL(process.env.MAMAGE_LOCAL_WEB || 'http://127.0.0.1:5300');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Run against the local UI only');
const sample = { photoId: 71, id: '71aabbcc-0000-0000-0000-000000000000', albumName: '校园活动',
  peopleNames: ['已确认人物'], description: '校园活动现场', publishedAt: '2026-11-26T00:00:00Z' };

async function check(browser, width, jpeg) {
  const context = await browser.newContext({ viewport: { width, height: 850 } });
  const page = await context.newPage();
  const errors = [];
  let queries = 0;
  let stationAdds = 0;
  let released = false;
  const candidates = [71, 72, 73, 74, 75].map((photoId, index) => ({
    photoId, albumName: ['校园活动', '不选这张', '第二页照片', '中转站单张', '中转站整批'][index],
    thumbUrl: '/api/test-image' }));
  const galleryPhotos = [74, 75, 76].map(id => ({
    id, projectId: 9001, unitId: 1, url: '/api/test-image?id=' + id, thumbUrl: '/api/test-image?id=' + id,
    type: 'normal', aiStatus: 'skipped',
  }));
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(photos => {
    localStorage.setItem('mamage_jwt_token', 'test-operator');
    if (photos.length) localStorage.setItem('photo-transfer-selection', JSON.stringify(photos));
  }, width > 1024 ? [] : galleryPhotos);
  await page.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  await page.route('**/api/**', async route => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json = value => route.fulfill({ json: value });
    if (p === '/api/users/me') return json({ id: 7, name: '本地测试', activeUnitId: 1,
      canManageCollegeWindow: true, permissions: ['photos.view'], workspaceEnabled: true });
    if (p === '/api/workspaces') return json({ enabled: true, units: [{ id: 1, name: '学工与融媒体中心', role: 'manager' }], activeUnitId: 1 });
    if (p === '/api/projects/9001') return json({ id: 9001, name: '测试相册', title: '测试相册',
      unitId: 1, images: galleryPhotos, count: galleryPhotos.length });
    if (p === '/api/photos') return json({ list: galleryPhotos, total: galleryPhotos.length });
    if (/^\/api\/photos\/\d+$/.test(p)) return json(galleryPhotos.find(photo => photo.id === Number(p.split('/').at(-1))) || {});
    if (p === '/api/test-image' || p.endsWith('/published/' + sample.id + '/image')) {
      return route.fulfill({ body: jpeg, contentType: 'image/jpeg' });
    }
    if (p.endsWith('/college-window/candidates')) {
      assert.equal(request.headers()['x-mamage-unit-id'], '1');
      queries += 1;
      const data = request.postDataJSON();
      if (queries === 1) {
        assert.equal(data.mode, 'ai');
        assert.equal(data.page, 1);
        return json({ photos: candidates.slice(0, 2), total: 3, nextPage: 2, aiUsed: true });
      }
      assert.equal(queries, 2);
      assert.equal(data.mode, 'ai');
      assert.equal(data.page, 2);
      assert.deepEqual(data.exclude, [], 'Dismissed and already loaded cards cannot change the original offsets');
      return json({ photos: candidates.slice(2, 3), total: 3, nextPage: null, aiUsed: true });
    }
    if (p.endsWith('/college-window/candidates/from-station')) {
      assert.equal(request.headers()['x-mamage-unit-id'], '1');
      const { photoIds } = request.postDataJSON();
      const expected = width > 1024 ? [[74], [75, 76], [76]] : [[74, 75, 76], [76]];
      assert.deepEqual(photoIds, expected[stationAdds]);
      stationAdds += 1;
      const photos = candidates.filter(photo => photoIds.includes(photo.photoId));
      return json({ photos, skipped: photoIds.length - photos.length });
    }
    const preview = p.match(/\/candidates\/(\d+)\/preview$/);
    if (preview) return json({ ...sample, id: undefined, photoId: Number(preview[1]), jpeg: jpeg.toString('base64'), review: 'a'.repeat(64) });
    if (p.endsWith('/college-window/publish')) {
      assert.deepEqual(request.postDataJSON(), { photos: [71, 73, 74, 75].map(photoId => ({ photoId, review: 'a'.repeat(64) })) });
      released = true;
      return json({ photos: [sample] });
    }
    if (p.endsWith('/college-window/published')) return json({ photos: released ? [sample] : [], nextCursor: null });
    if (p.endsWith('/college-window/published/' + sample.id) && request.method() === 'DELETE') {
      released = false;
      return route.fulfill({ status: 204 });
    }
    return json({ list: [], items: [], total: 0, pendingCount: 0 });
  });
  try {
    await page.goto(new URL('/college-window', base).href);
    await page.getByRole('heading', { name: '学院窗供图' }).waitFor();
    await page.getByRole('textbox', { name: '选图需求' }).fill('挑两张适合相框展示的校园活动照片');
    await page.getByRole('button', { name: 'AI 选图', exact: true }).click();
    await page.getByRole('button', { name: '预览 不选这张', exact: true }).waitFor();
    await page.getByText('本轮匹配 3 张，已加载 2 张', { exact: true }).waitFor();
    await page.getByRole('article').filter({ hasText: '不选这张' }).getByRole('button', { name: '排除候选' }).click();
    const more = page.getByRole('button', { name: '加载更多候选', exact: true });
    await more.click();
    await page.getByRole('button', { name: '预览 第二页照片', exact: true }).waitFor();
    await page.getByText('本轮匹配 3 张，已加载 3 张', { exact: true }).waitFor();
    await more.waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: '手动搜索', exact: true }).count(), 0);
    const target = page.getByRole('group', { name: '中转站照片' });
    if (width > 1024) {
      const visit = target => page.evaluate(url => {
        history.pushState(null, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, target);
      await visit('/?projectId=9001');
      const station = page.locator('[data-transfer-station-root="1"]').first();
      for (const id of [74, 75, 76]) {
        await page.locator(`[data-photo-id="${id}"] .detail-photo-img`).dragTo(station.getByTitle('中转站', { exact: true }));
        await page.waitForFunction(photoId => JSON.parse(localStorage.getItem('photo-transfer-selection') || '[]')
          .some(photo => Number(photo.id) === photoId), id);
      }
      await visit('/college-window');
      await page.getByText('本轮匹配 3 张，已加载 3 张', { exact: true }).waitFor();
      const trigger = station.getByTitle('中转站', { exact: true });
      await trigger.waitFor();
      assert.equal(await trigger.getAttribute('draggable'), 'true');
      const expand = station.getByTitle('展开中转预览');
      if (!await expand.isVisible()) await trigger.click();
      await expand.click();
      await station.locator('.transfer-media-item').first().dragTo(target);
      await page.getByRole('button', { name: '预览 中转站单张', exact: true }).waitFor();
      await trigger.dragTo(target);
    } else {
      assert.equal(await page.getByRole('button', { name: '中转站菜单' }).count(), 0);
      await target.getByRole('button', { name: '添加中转站照片', exact: true }).click();
    }
    await page.getByRole('button', { name: '预览 中转站整批', exact: true }).waitFor();
    await page.getByText(/另有 1 张不符合供图范围/).waitFor();
    await target.getByRole('button', { name: '添加中转站照片', exact: true }).click();
    await page.getByText(/没有可添加的照片/).waitFor();
    assert.equal(stationAdds, width > 1024 ? 3 : 2);
    assert.equal(await page.getByText('不选这张').count(), 0);
    await page.screenshot({ path: path.join(output, 'candidates-' + width + '.png'), fullPage: true });
    await page.getByRole('button', { name: '预览 校园活动', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '确认供图' });
    await modal.getByText('校园活动现场', { exact: true }).waitFor();
    await modal.getByRole('button', { name: '确认并看下一张' }).click();
    await modal.getByRole('button', { name: '确认并看下一张' }).click();
    await modal.getByRole('button', { name: '确认并看下一张' }).click();
    await modal.getByRole('button', { name: '确认这张', exact: true }).click();
    await page.getByRole('button', { name: '发布 4 张', exact: true }).click();
    await page.getByText('已发布 4 张照片。').waitFor();
    await page.getByRole('button', { name: '已发布', exact: true }).click();
    await page.getByRole('button', { name: '预览已发布照片 校园活动' }).click();
    await page.getByRole('dialog', { name: '已发布照片' }).getByRole('img').waitFor();
    await page.screenshot({ path: path.join(output, 'preview-' + width + '.png'), fullPage: false });
    await page.getByRole('dialog', { name: '已发布照片' }).getByRole('button', { name: '关闭' }).click();
    await page.getByRole('button', { name: '撤回', exact: true }).click();
    await page.getByRole('dialog', { name: '撤回这张照片？' }).getByRole('button', { name: '撤回照片' }).click();
    await page.getByText('暂无已发布照片').waitFor();
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    console.log('College Window UI passed at ' + width + 'px.');
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure-' + width + '.png'), fullPage: true });
    console.error(errors);
    throw error;
  } finally { await context.close(); }
}

async function checkBulk(browser, width, jpeg) {
  const context = await browser.newContext({ viewport: { width, height: 850 } });
  const page = await context.newPage();
  const searchId = 'aabaa001-0000-0000-0000-000000000000';
  const planId = 'aabaa002-0000-0000-0000-000000000000';
  const errors = [];
  const candidateQueries = [];
  let submitted = 0;
  let job = null;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('mamage_jwt_token', 'test-operator'));
  await page.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  await page.route('**/api/**', route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = value => route.fulfill({ json: value });
    if (path === '/api/users/me') return json({ id: 7, name: '本地测试', activeUnitId: 1, canManageCollegeWindow: true,
      permissions: ['photos.view'], workspaceEnabled: true });
    if (path === '/api/workspaces') return json({ enabled: true, units: [{ id: 1, name: '学工与融媒体中心', role: 'manager' }], activeUnitId: 1 });
    if (path === '/api/test-image') return route.fulfill({ body: jpeg, contentType: 'image/jpeg' });
    if (path.endsWith('/college-window/candidates')) {
      candidateQueries.push(req.postDataJSON());
      assert.equal(candidateQueries.length, 1, 'Bulk selection must not fetch hundreds of previews or pages');
      assert.equal(candidateQueries[0].capture, true);
      return json({ photos: [71, 72].map(id => ({ photoId: id, albumName: id === 71 ? '校园景色' : '手动排除',
        thumbUrl: '/api/test-image' })), total: 772, scanned: 2, nextPage: 2, searchId, contentFilter: 'no-faces' });
    }
    if (path.endsWith('/college-window/bulk/prepare')) {
      const selection = req.postDataJSON();
      assert.deepEqual(selection.excluded, [72]);
      if (selection.mode === 'candidates') {
        assert.deepEqual(selection.photoIds, [71]);
        return json({ id: 'aabaa003-0000-0000-0000-000000000000', mode: 'candidates', count: 1 });
      }
      assert.deepEqual(selection, { mode: 'matches', searchId, excluded: [72] });
      return json({ id: planId, count: 771, mode: 'matches', contentFilter: 'no-faces' });
    }
    if (path.endsWith('/college-window/bulk') && req.method() === 'POST') {
      assert.deepEqual(req.postDataJSON(), { planId });
      submitted++;
      job = { id: planId, status: 'running', total: 771, processed: 80, published: 78, skipped: 1, failed: 1 };
      return json(job);
    }
    if (path.endsWith('/college-window/bulk')) return json({ job });
    return json({ list: [], items: [], total: 0, pendingCount: 0 });
  });
  try {
    await page.goto(new URL('/college-window', base).href);
    await page.getByLabel('选图需求').fill('无人脸照片');
    await page.getByRole('button', { name: 'AI 选图' }).click();
    await page.getByText(/本轮匹配 772 张，已加载 2 张/).waitFor();
    await page.locator('article').filter({ hasText: '手动排除' }).getByRole('button', { name: '排除候选' }).click();
    await page.getByRole('button', { name: '批量发布', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '批量发布照片' });
    await dialog.getByRole('button', { name: '确认发布 1 张' }).waitFor();
    await dialog.getByRole('radio', { name: /本轮全部匹配/ }).check();
    const confirm = dialog.getByRole('button', { name: '确认发布 771 张' });
    await confirm.waitFor();
    assert.equal(submitted, 0, 'No publishing until the confirmed count is accepted');
    await page.screenshot({ path: path.join(output, 'batch-' + width + '.png'), fullPage: false });
    await confirm.click();
    await page.getByRole('progressbar', { name: '发布进度' }).waitFor();
    assert.equal(submitted, 1);
    await page.reload();
    await page.getByRole('button', { name: '停止剩余发布' }).waitFor();
    job = { ...job, status: 'done', processed: 771, published: 769, skipped: 1, failed: 1 };
    await page.getByText('批量发布完成', { exact: true }).waitFor();
    await page.getByText('已发布 769 张 · 跳过 1 张 · 失败 1 张', { exact: true }).waitFor();
    assert.equal(submitted, 1, 'Restoring job progress does not resubmit it');
    assert.equal(candidateQueries.length, 1);
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    console.log('College Window batch UI passed at ' + width + 'px.');
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'batch-failure-' + width + '.png'), fullPage: true });
    console.error(errors);
    throw error;
  } finally { await context.close(); }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const pixels = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><rect width="360" height="240" fill="#a6c0c3"/><path d="M0 240v-46l110-106 67 84 75-54 108 66v56" fill="#548369"/><path d="M0 206l103-51 83 46 109-29 65 32v36H0" fill="#253b38"/></svg>');
  const jpeg = await sharp(pixels).jpeg().toBuffer();
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 1100, 390]) await check(browser, width, jpeg);
    for (const width of [1440, 390]) await checkBulk(browser, width, jpeg);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
