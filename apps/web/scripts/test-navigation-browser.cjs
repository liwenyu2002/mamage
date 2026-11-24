const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const runtime = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = runtime('playwright');
const { PNG } = runtime('pngjs');
const sharp = runtime('sharp');
const { loadObservedStyleLibrary } = require('../../server/lib/wechat_observed_styles');
const { templateFromSource } = require('../../server/lib/wechat_observed_gallery_templates');
const dist = path.resolve(__dirname, '../dist');

async function main() {
  const image = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#859da9' } }).jpeg().toBuffer();
  const layoutLibrary = await loadObservedStyleLibrary({ query: async () => [[]] }, { enabled: true, orgId: 1, unitId: 1 });
  const brandArtwork = layoutLibrary.templates.find(template => template.id === 'curated-ai-young-voices').brandCandidates;
  const tracks = Array.from({ length: 9 }, (_, index) =>
    `<image href="https://mmbiz.qpic.cn/example/${index % 8}" x="${640 * index}" y="0" width="640" height="480"></image>`).join('');
  const carousel = templateFromSource(`<svg viewBox="0 0 640 480"><g><animateTransform attributeName="transform" type="translate"
    values="0 0;-5120 0" begin="0s" dur="24s" repeatCount="indefinite"></animateTransform>${tracks}</g></svg>`,
  { id: 32, current_revision_id: 1, title: '轮播测试' }, 'carousel');
  layoutLibrary.blocks.push(carousel);
  const photos = Array.from({ length: 80 }, (_, i) => ({ id: 101 + i, projectId: 1, title: `Photo ${i + 1}`,
    projectName: 'Campus Album', type: 'normal', url: '/api/image/test.jpg', thumbUrl: '/api/image/test.jpg',
    width: 640, height: 480, unitId: 1, photographerId: 7, aiStatus: 'done' }));
  const album = { id: 1, name: 'Campus Album', title: 'Campus Album', count: photos.length,
    unitId: 1, adminId: 7, canEdit: true, groups: ['events'], images: photos, coverThumbUrl: '/api/image/test.jpg' };
  const groups = [{ id: 'campus', name: 'Campus Folder', parentId: null, projectIds: [] },
    { id: 'events', name: 'Events Folder', parentId: 'campus', projectIds: [1] }]
    .map(g => ({ ...g, kind: 'manual', createdBy: 7, canEdit: true }));
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch();
  const results = [];
  const screenshotDir = path.resolve(__dirname, '../../../.local/navigation-qa');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const openWechatDraft = async page => {
    await page.goto(base + '/function/wechat-composer');
    await page.getByRole('button', { name: '新建推文', exact: true }).click();
    await page.getByRole('button', { name: 'AI 工作流', exact: true }).click();
    await page.getByRole('heading', { name: '公众号内容稿', exact: true }).waitFor();
  };
  const checks = {
    async folders(page) {
      await page.goto(base);
      await page.getByRole('button', { name: '打开文件夹 Campus Folder', exact: true }).click();
      await page.getByRole('button', { name: '打开文件夹 Events Folder', exact: true }).click();
      await page.goBack();
      await page.waitForFunction(() => new URL(location.href).searchParams.get('folder') === 'campus'
        && document.querySelector('.acp-page-heading h1')?.textContent.includes('Campus Folder'));
      await page.goBack();
      await page.getByRole('heading', { name: /小组空间/, level: 1 }).waitFor();
      await page.goForward();
      await page.getByRole('heading', { name: /Campus Folder/, level: 1 }).waitFor();
    },
    async viewer(page) {
      await page.goto(base + '/?folder=events');
      await page.locator('.desktop-album .project-card').first().click();
      await page.locator('[data-photo-id="101"] img').first().click();
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.goBack();
      await page.waitForFunction(() => !document.querySelector('.viewer-overlay') && document.querySelector('.detail-gallery'));
      assert.equal(new URL(page.url()).searchParams.get('projectId'), '1');
      await page.goForward();
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.locator('.viewer-topbar-close').click();
      await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
      await page.goBack();
      await page.getByRole('heading', { name: /Events Folder/, level: 1 }).waitFor();
    },
    async search(page) {
      await page.goto(base);
      const input = page.locator('.mamage-nav-search-input');
      await input.fill('拿话筒'); await input.press('Enter');
      await page.locator('.app-photo-search-card').first().waitFor();
      await page.locator('.app-photo-search-card').first().getByText('Campus Album', { exact: true }).click();
      await page.locator('.detail-gallery').waitFor();
      await page.goBack();
      await page.getByText('“拿话筒”的搜索结果', { exact: true }).waitFor();
      await page.locator('.app-photo-search-card').first().waitFor();
      assert.equal(await input.inputValue(), '拿话筒');
    },
    async albumBack(page) {
      await page.goto(base + '/?folder=events');
      await page.locator('.desktop-album .project-card').first().click();
      await page.locator('.detail-gallery').waitFor();
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.getByRole('heading', { name: /Events Folder/, level: 1 }).waitFor();
      await page.goForward();
      await page.locator('.detail-gallery').waitFor();
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.getByRole('heading', { name: /Events Folder/, level: 1 }).waitFor();
    },
    async directPhoto(page) {
      await page.goto(base + '/?folder=events&projectId=1&photoId=101');
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.getByRole('button', { name: '下一张', exact: true }).last().click();
      await page.waitForURL('**photoId=102');
      await page.reload();
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.goBack();
      await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
      assert.equal(new URL(page.url()).searchParams.get('projectId'), '1');
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.getByRole('heading', { name: /Events Folder/, level: 1 }).waitFor();
    },
    async searchPreview(page) {
      await page.goto(base + '/?q=speaker');
      await page.locator('.app-photo-search-card').first().getByTitle('点击预览大图').click();
      await page.waitForFunction(() => new URL(location.href).searchParams.has('previewId'));
      await page.goBack();
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('previewId'));
      await page.getByText('“speaker”的搜索结果', { exact: true }).waitFor();
    },
    async folderSearch(page) {
      await page.goto(base + '/?folder=events');
      const input = page.locator('.mamage-nav-search-input');
      await input.fill('speaker'); await input.press('Enter');
      await page.locator('.scoped-search-photo').first().click();
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.goBack();
      await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.locator('.scoped-search-photo').first().waitFor();
      assert.equal(new URL(page.url()).searchParams.get('folder'), 'events');
      assert.equal(await input.inputValue(), 'speaker');
      await page.goBack();
      await page.locator('.scoped-search').waitFor({ state: 'detached' });
      await page.getByRole('heading', { name: /Events Folder/, level: 1 }).waitFor();
    },
    async albumSearch(page) {
      await page.goto(base + '/?projectId=1');
      await page.locator('.detail-gallery').waitFor();
      const input = page.locator('.mamage-nav-search-input');
      await input.fill('speaker'); await input.press('Enter');
      await page.locator('.detail-search-input input').waitFor();
      await page.locator('[data-photo-id="101"] img').first().click();
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.goBack();
      await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
      assert.equal(await input.inputValue(), 'speaker');
      await page.goBack();
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('q'));
      assert.equal(await input.inputValue(), '');
      await page.locator('.detail-gallery').waitFor();
    },
    async albumSearchFailure(page) {
      await page.goto(base + '/?projectId=1');
      await page.locator('.detail-gallery').waitFor();
      const input = page.locator('.mamage-nav-search-input');
      await input.fill('speaker'); await input.press('Enter');
      await page.locator('.detail-search-error').waitFor();
      await page.goBack();
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('q'));
      await page.locator('.detail-gallery').waitFor();
    },
    async scrollRestore(page) {
      await page.goto(base + '/?projectId=1');
      await page.locator('[data-photo-id="125"]').scrollIntoViewIfNeeded();
      const y = await page.evaluate(() => scrollY);
      assert.ok(y > 100);
      await page.locator('[data-photo-id="125"] img').first().evaluate(image => image.click());
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.goBack();
      await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
      await page.waitForFunction(y => Math.abs(scrollY - y) < 3, y).catch(async error => {
        throw new Error(`Viewer scroll restore: expected ${y}, actual ${await page.evaluate(() => JSON.stringify({ y: scrollY, state: history.state }))}; ${error.message}`);
      });
      await page.evaluate(() => document.querySelector('.mamage-nav-link:last-child').click());
      await page.waitForURL('**/about');
      await page.goBack();
      await page.waitForFunction(y => Math.abs(scrollY - y) < 3, y).catch(async error => {
        throw new Error(`Album scroll restore: expected ${y}, actual ${await page.evaluate(() => JSON.stringify({ y: scrollY, state: history.state }))}; ${error.message}`);
      });
    },
    async unsaved(page) {
      await page.goto(base + '/?projectId=1&photoId=101');
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.locator('.viewer-details-panel textarea').fill('Unsaved edit');
      page.once('dialog', dialog => dialog.dismiss());
      await page.goBack();
      await page.waitForFunction(() => new URL(location.href).searchParams.has('photoId'));
      await page.locator('.viewer-overlay.is-open').waitFor();
      assert.equal(await page.locator('.viewer-details-panel textarea').inputValue(), 'Unsaved edit');
      page.once('dialog', dialog => dialog.accept());
      await page.locator('.viewer-topbar-close').click();
      await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
    },
    async filterRestore(page) {
      await page.goto(base + '/?projectId=1');
      await page.locator('.detail-gallery').waitFor();
      await page.getByRole('button', { name: '打开功能', exact: true }).click();
      await page.getByRole('checkbox', { name: '只看我上传的', exact: true }).check();
      await page.locator('.mamage-nav-link').filter({ hasText: '关于' }).click();
      await page.waitForURL('**/about');
      await page.goBack();
      await page.locator('.detail-gallery').waitFor();
      await page.getByRole('button', { name: '打开功能', exact: true }).click();
      assert.equal(await page.getByRole('checkbox', { name: '只看我上传的', exact: true }).isChecked(), true);
      await page.locator('.detail-media-filter-btn').filter({ hasText: '只看照片' }).click();
      await page.reload();
      await page.locator('.detail-gallery').waitFor();
      await page.getByRole('button', { name: '打开功能', exact: true }).click();
      assert.equal(await page.getByRole('checkbox', { name: '只看我上传的', exact: true }).isChecked(), true);
      assert.equal(await page.locator('.detail-media-filter-btn').filter({ hasText: '只看照片' }).getAttribute('aria-pressed'), 'true');
    },
    async paginationRestore(page) {
      await page.goto(base + '/?folder=events');
      await page.getByRole('button', { name: '按活动日期排序', exact: true }).click();
      await page.getByRole('option', { name: '活动日期 · 旧到新' }).click();
      await page.getByRole('button', { name: '加载更多', exact: true }).click();
      assert.equal(await page.locator('.acp-albums .desktop-album').count(), 26);
      await page.locator('.acp-folder-breadcrumb').getByRole('button', { name: 'Campus Folder', exact: true }).click();
      await page.getByRole('heading', { name: /Campus Folder/, level: 1 }).waitFor();
      await page.goBack();
      await page.getByRole('heading', { name: /Events Folder/, level: 1 }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('.acp-albums .desktop-album').length === 26);
      assert.match(await page.getByRole('button', { name: '按活动日期排序', exact: true }).textContent(), /旧到新/);
    },
    async galleryPaginationRestore(page) {
      await page.goto(base + '/?projectId=1');
      await page.getByRole('button', { name: /加载更多照片/ }).evaluate(button => button.click());
      await page.waitForFunction(() => document.querySelectorAll('.detail-gallery [data-photo-id]').length === 160);
      const input = page.locator('.mamage-nav-search-input');
      await input.fill('speaker'); await input.press('Enter');
      await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'speaker'
        && document.querySelectorAll('.detail-gallery [data-photo-id]').length === 96);
      await page.goBack();
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('q')
        && document.querySelectorAll('.detail-gallery [data-photo-id]').length === 160);
      assert.equal(await page.evaluate(() => history.state.mamageNavigation.views.galleryLimit), 160);
    },
    async sharedFolder(page) {
      await page.goto(base + '/?sharedFolder=5');
      await page.getByRole('button', { name: '打开文件夹 Events Folder', exact: true }).click();
      await page.locator('.shared-folder-view .project-card').first().click();
      await page.locator('.detail-gallery').waitFor();
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.locator('.shared-folder-view h1').filter({ hasText: 'Events Folder' }).waitFor();
      await page.goBack();
      await page.locator('.shared-folder-view h1').filter({ hasText: 'Campus Folder' }).waitFor();
    },
    async classic(page) {
      await page.addInitScript(() => localStorage.setItem('mamage-folder-style:v1:7', 'classic'));
      await page.goto(base);
      await page.getByRole('button', { name: '浏览文件夹 Campus Folder', exact: true }).click();
      await page.getByRole('button', { name: '浏览文件夹 Events Folder', exact: true }).click();
      await page.getByRole('button', { name: '预览相册 Campus Album', exact: true }).click();
      await page.getByRole('button', { name: '打开相册 Campus Album', exact: true }).click();
      await page.locator('.detail-gallery').waitFor();
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.locator('.acp-column-inspector').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('folder'), 'events');
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.locator('.acp-column-inspector').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.waitForFunction(() => new URL(location.href).searchParams.get('folder') === 'campus');
    },
    async publicAlbum(page) {
      await page.goto(base + '/share/album-test');
      await page.locator('.share-photo').first().click();
      await page.locator('.sv-viewer').waitFor();
      await page.keyboard.press('ArrowRight');
      await page.waitForURL('**previewId=102');
      await page.keyboard.press('ArrowRight');
      await page.waitForURL('**previewId=103');
      await page.keyboard.press('ArrowLeft');
      await page.waitForURL('**previewId=102');
      await page.goBack();
      await page.locator('.sv-viewer').waitFor({ state: 'detached' });
      await page.locator('.share-photo').first().waitFor();
      await page.goForward();
      await page.locator('.sv-viewer').waitFor();
      await page.reload();
      await page.locator('.sv-viewer').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('.sv-viewer').waitFor({ state: 'detached' });
      assert.equal(new URL(page.url()).pathname, '/share/album-test');
    },
    async publicFolder(page) {
      await page.goto(base + '/share/folder-test');
      await page.getByRole('button', { name: '打开文件夹 Events Folder', exact: true }).click();
      await page.locator('.shared-folder-view .project-card').first().click();
      await page.locator('.share-photo').first().click();
      await page.locator('.sv-viewer').waitFor();
      await page.goBack();
      await page.locator('.sv-viewer').waitFor({ state: 'detached' });
      assert.equal(new URL(page.url()).searchParams.get('projectId'), '1');
      await page.goBack();
      await page.locator('.shared-folder-view h1').filter({ hasText: 'Events Folder' }).waitFor();
      await page.goBack();
      await page.locator('.shared-folder-view h1').filter({ hasText: 'Campus Folder' }).waitFor();
    },
    async mobile(page) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(base + '/?folder=events');
      await page.locator('.desktop-album .project-card').first().click();
      await page.locator('[data-photo-id="101"] img').first().click();
      await page.locator('.viewer-overlay.is-open').waitFor();
      await page.locator('.viewer-overlay').evaluate(async element => {
        await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
      });
      await page.screenshot({ path: path.join(screenshotDir, 'mobile-viewer.png') });
      await page.goBack();
      await page.locator('.viewer-overlay').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.getByRole('heading', { name: /Events Folder/, level: 1 }).waitFor();
      await page.screenshot({ path: path.join(screenshotDir, 'mobile-returned-folder.png') });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    },
    async mediaStudio(page) {
      const routes = [
        ['推文', 'wechat-composer', '.wechat-workspace .wxc-manager'],
        ['小红书', 'xiaohongshu', '.news-writer'],
        ['新闻稿', 'news', '.news-writer'],
        ['工作简报', 'brief', '.news-writer'],
        ['视频剪辑', 'video', '.video-editor'],
        ['微博', 'weibo', '.news-writer'],
      ];
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(base + '/function/weibo');
        const nav = page.locator('.media-studio-nav');
        const trigger = nav.getByRole('button', { name: /切换编辑类型/ });
        const menu = page.getByRole('menu', { name: '切换编辑类型', exact: true });
        const workspace = page.locator('.media-studio-workspace');
        await workspace.locator('.news-writer').waitFor();
        const y = (await workspace.boundingBox()).y;
        assert.ok((await nav.boundingBox()).height <= 40);
        assert.equal(await menu.isVisible(), false);
        await trigger.press('Enter');
        assert.equal(await menu.getByRole('menuitemradio').count(), routes.length);
        assert.equal(await menu.getByRole('menuitemradio', { checked: true }).innerText(), '微博');
        assert.equal((await workspace.boundingBox()).y, y);
        const bounds = await menu.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
        await page.keyboard.press('Escape');
        assert.equal(await menu.isVisible(), false);
        assert.ok(await trigger.evaluate(button => button === document.activeElement));
        for (const [label, slug, editor] of routes) {
          await trigger.click();
          await menu.getByRole('menuitemradio', { name: label, exact: true }).click();
          await page.waitForURL('**/function/' + slug);
          await nav.getByRole('button', { name: '切换编辑类型，当前' + label, exact: true }).waitFor();
          await workspace.locator(editor).waitFor();
          assert.equal(await menu.isVisible(), false);
        }
      }
    },
    async stationPhotoDrop(page) {
      await openWechatDraft(page);
      const trigger = page.locator('[data-transfer-station-root] [title="中转站"]');
      const sourcePane = page.locator('.news-source-pane');
      const count = sourcePane.locator('.news-attachment-count');
      const articleType = page.getByRole('button', { name: '文章类型' });
      await trigger.waitFor();
      assert.equal(await trigger.getAttribute('draggable'), 'true');
      await trigger.click();
      await page.getByTitle('展开中转预览').click();
      await page.locator('.transfer-preview-panel .transfer-media-item').first().dragTo(articleType);
      await count.getByText('1 张', { exact: true }).waitFor();
      await trigger.dragTo(articleType);
      await count.getByText('30 张', { exact: true }).waitFor();
      await trigger.dragTo(articleType);
      assert.equal(await count.innerText(), '30 张');
      assert.equal(await sourcePane.getAttribute('data-photo-drag-over'), null);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('mamage.aiNewsWriter.draft.v2:7:1') || '{}').selectedPhotos?.length === 30);
      const persisted = await page.evaluate(() => ({
        attached: JSON.parse(localStorage.getItem('mamage.aiNewsWriter.draft.v2:7:1')).selectedPhotos,
        station: JSON.parse(localStorage.getItem('photo-transfer-selection')).length,
      }));
      assert.deepEqual(persisted.attached.map(photo => photo.id), Array.from({ length: 30 }, (_, i) => i + 101));
      assert.equal(persisted.attached[0].projectTitle, 'Campus Album');
      assert.deepEqual(persisted.attached[0].tags, ['exchange']);
      assert.equal(persisted.station, 33);
      await page.reload();
      await count.getByText('30 张', { exact: true }).waitFor();
    },
    async stationPhotoMobile(page) {
      await page.setViewportSize({ width: 390, height: 860 });
      await openWechatDraft(page);
      const trigger = page.getByRole('button', { name: '中转站菜单' });
      await trigger.waitFor();
      assert.notEqual(await trigger.getAttribute('draggable'), 'true');
      const addPhotos = page.getByRole('button', { name: '添加活动照片' });
      assert.equal(await addPhotos.evaluate(node => getComputedStyle(node).borderTopStyle), 'solid');
      await addPhotos.click();
      const picker = page.getByRole('dialog').filter({ hasText: '选择活动照片' });
      await picker.getByRole('button', { name: '中转站', exact: true }).click();
      await picker.getByRole('button', { name: '选择照片 101', exact: true }).click();
      await picker.getByRole('button', { name: '使用所选照片', exact: true }).click();
      await page.locator('.news-attachment-count').getByText('1 张', { exact: true }).waitFor();
    },
    async draftRecovery(page) {
      await page.goto(base + '/function/wechat-composer');
      const grid = page.locator('.wxc-manager-grid');
      const card = name => grid.locator('.wxc-manager-card').filter({ has: page.getByText(name, { exact: true }) });
      const open = name => card(name).locator('.wxc-manager-card-open').click();
      const confirmDelete = async name => {
        await card(name).getByRole('button', { name: '删除草稿', exact: true }).click();
        return page.getByRole('dialog', { name: '删除草稿' });
      };
      const remove = async name => {
        const dialog = await confirmDelete(name);
        await dialog.getByRole('button', { name: '删除', exact: true }).click();
        await card(name).waitFor({ state: 'detached' });
      };
      const recoveredName = '从线上找回的稿件';
      const pendingName = '后台生成中的稿件';
      const savedName = '已保存的推文';
      const localName = '仅存在本机的草稿';
      const archiveName = '不再需要的草稿';
      await card(archiveName).waitFor();
      await card(savedName).waitFor();
      assert.equal(await page.getByRole('heading', { name: '未保存稿件', exact: true }).count(), 0);
      assert.deepEqual(await grid.locator('.wxc-manager-card-name').allTextContents(),
        [localName, pendingName, savedName, recoveredName, archiveName]);
      await card(pendingName).getByText('生成中', { exact: true }).waitFor();
      const cancelDialog = await confirmDelete(localName);
      await cancelDialog.getByRole('button', { name: '取消', exact: true }).click();
      await cancelDialog.waitFor({ state: 'detached' });
      await card(localName).waitFor();
      await remove(localName);
      await remove(archiveName);
      await page.reload();
      await card(recoveredName).waitFor();
      assert.equal(await card(localName).count(), 0);
      assert.equal(await card(archiveName).count(), 0);
      await open(recoveredName);
      await page.getByRole('button', { name: '立即重连', exact: true }).click();
      const title = page.getByRole('textbox', { name: '稿件标题', exact: true });
      await title.waitFor();
      assert.equal((await title.innerText()).trim(), '从线上找回的稿件');
      assert.equal(await page.locator('.news-edit-photo img').count(), 1);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('mamage.aiNewsWriter.draft.v2:7:1') || '{}').batchStatus === 'succeeded');
      await page.reload();
      await title.waitFor();
      assert.equal((await title.innerText()).trim(), '从线上找回的稿件');
      await page.getByRole('button', { name: '推文列表', exact: true }).click();
      await card(pendingName).waitFor();
      assert.equal(await card(recoveredName).count(), 1);
      await open(pendingName);
      await page.getByText('正在生成初稿', { exact: true }).waitFor();
      await page.getByRole('button', { name: '推文列表', exact: true }).click();
      await open(recoveredName);
      await title.waitFor();
      assert.equal((await title.innerText()).trim(), '从线上找回的稿件');
      await page.getByRole('button', { name: '推文列表', exact: true }).click();
      await page.setViewportSize({ width: 390, height: 860 });
      assert.equal(await grid.evaluate(node => node.scrollWidth <= node.clientWidth), true);
      await remove(pendingName);
      await remove(recoveredName);
      await page.reload();
      await card(savedName).waitFor();
      assert.equal(await grid.locator('.wxc-manager-card.is-draft').count(), 0);
      assert.equal(await page.evaluate(() => ['mamage.aiNewsWriter.draft.v2:7:1', 'mamage.aiNewsWriter.draft.v2:7:1:before-recovery']
        .some(key => Boolean(JSON.parse(localStorage.getItem(key) || '{}').batchId))), false);
    },
    async draftPhotoDrag(page) {
      await page.setViewportSize({ width: 1440, height: 1440 });
      await page.goto(base + '/function/wechat-composer');
      const editor = page.locator('.news-edit-document');
      const a = editor.getByRole('img', { name: '照片甲', exact: true });
      const b = editor.getByRole('img', { name: '照片乙', exact: true });
      const visibleIndicator = page.locator('.news-photo-drop-indicator:not([hidden])');
      const groupIds = () => editor.locator('.news-edit-photo').evaluateAll(photos => photos.map(photo => photo.dataset.galleryId));
      const blocks = () => editor.locator('[data-news-index]').allTextContents();
      const start = async (source, at, mode) => {
        const box = await source.boundingBox();
        const from = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
        const sourceTag = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, from);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(at.x, at.y, { steps: 6 });
        await page.locator(`.news-photo-drop-indicator[data-mode="${mode}"]:not([hidden])`).waitFor().catch(async () => {
          throw Error(`Expected ${mode} from ${sourceTag} ${JSON.stringify(from)} to ${JSON.stringify(at)}; indicator=${await visibleIndicator.count() ? await visibleIndicator.getAttribute('data-mode') : 'none'}, blocks=${JSON.stringify(await blocks())}`);
        });
      };
      const finish = async () => {
        await page.mouse.up();
        await visibleIndicator.waitFor({ state: 'hidden' });
      };
      await a.waitFor();
      await b.waitFor();
      await b.scrollIntoViewIfNeeded();
      const box = await a.boundingBox();
      const original = await blocks();
      const sameRow = { x: box.x + 0.75 * box.width, y: box.y + 0.5 * box.height };
      await start(b, sameRow, 'group');
      assert.deepEqual(await blocks(), original, 'hovering the target does not mutate the draft');
      await page.keyboard.press('Escape');
      await finish();
      assert.deepEqual(await blocks(), original);
      await start(b, sameRow, 'group');
      await finish();
      const [first, second] = await groupIds();
      assert.ok(first);
      assert.equal(first, second);
      assert.deepEqual(await blocks(), ['照片拖拽测试', '开场', '照片甲', '照片乙', '第一段', '第二段']);
      await page.getByRole('button', { name: '撤销编辑', exact: true }).click();
      assert.deepEqual(await blocks(), original);
      await page.getByRole('button', { name: '重做编辑', exact: true }).click();
      const grouped = await a.boundingBox();
      await start(b, { x: grouped.x + grouped.width * 0.5, y: grouped.y + grouped.height - 4 }, 'move');
      await finish();
      assert.notEqual(...await groupIds(), 'photo edge drops never combine photos');
      await page.reload();
      await b.waitFor();
      assert.notEqual(...await groupIds(), 'edge moves survive reload without regrouping');
      await editor.getByText('第二段', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const upper = await editor.getByText('第一段', { exact: true }).boundingBox();
      const lower = await editor.getByText('第二段', { exact: true }).boundingBox();
      await start(b, { x: upper.x + upper.width * 0.5, y: (upper.y + upper.height + lower.y) / 2 }, 'move');
      await finish();
      assert.deepEqual(await blocks(), ['照片拖拽测试', '开场', '照片甲', '第一段', '照片乙', '第二段']);
      await page.reload();
      await b.waitFor();
      assert.deepEqual(await blocks(), ['照片拖拽测试', '开场', '照片甲', '第一段', '照片乙', '第二段']);
    },
    async templateCarousel(page) {
      await page.goto(base + '/function/wechat-composer');
      const editor = page.locator('.news-edit-document');
      await editor.getByRole('group', { name: '8 图组', exact: true }).waitFor();
      await editor.getByRole('group', { name: '3 图组', exact: true }).waitFor();
      assert.equal(await editor.getByRole('button', { name: /单列|双列|三列/ }).count(), 0);
      const review = editor.locator('.news-edit-paragraph').filter({ hasText: '初审：甲' });
      assert.match(await review.innerText(), /初审：甲 *\n终审：乙/);
      const clearCaptions = page.getByRole('button', { name: '清空图题', exact: true });
      const getPhotos = () => editor.locator('.news-edit-photo').evaluateAll(photos => photos.map(photo => ({
        src: photo.querySelector('img').getAttribute('src'), group: photo.dataset.galleryId,
        caption: photo.querySelector('figcaption').textContent,
      })));
      const originalPhotos = await getPhotos();
      const source = page.getByRole('textbox', { name: '稿件正文', exact: true, includeHidden: true });
      const originalMarkdown = await source.inputValue();
      assert.equal(await clearCaptions.isEnabled(), true);
      await page.setViewportSize({ width: 390, height: 860 });
      await clearCaptions.scrollIntoViewIfNeeded();
      assert.equal(await clearCaptions.evaluate(button => {
        const { left, right } = button.getBoundingClientRect();
        return left >= 0 && right <= innerWidth;
      }), true);
      await page.locator('.news-result-heading').screenshot({ caret: 'initial',
        path: path.join(screenshotDir, 'wechat-clear-captions-mobile.png') });
      assert.equal(await source.inputValue() === originalMarkdown, true, 'Changing viewport must not change the draft');
      await clearCaptions.click();
      assert.deepEqual(await getPhotos(), originalPhotos.map(photo => ({ ...photo, caption: '' })));
      const clearedMarkdown = await source.inputValue();
      assert.equal(clearedMarkdown === originalMarkdown.replace(/!\[样图 \d+\]/g, '![]'), true,
        `Clearing captions must leave the rest of the source unchanged: ${JSON.stringify(clearedMarkdown.slice(-90))}`);
      assert.equal(await clearCaptions.isDisabled(), true);
      await page.getByRole('button', { name: '撤销编辑', exact: true }).click();
      assert.deepEqual(await getPhotos(), originalPhotos);
      const undoneMarkdown = await source.inputValue();
      assert.equal(undoneMarkdown === originalMarkdown, true, `Undo must restore the exact source: ${JSON.stringify(undoneMarkdown.slice(-90))}`);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole('button', { name: '确认内容，选择样式', exact: true }).click();
      await page.getByRole('button', { name: /AI青年说 · 人物专访/ }).click();
      const cover = page.getByRole('checkbox', { name: 'AI 青年说首图', exact: true });
      const footer = page.getByRole('checkbox', { name: '融媒体末图', exact: true });
      assert.equal(await cover.isChecked(), true);
      assert.equal(await footer.isChecked(), true);
      await footer.uncheck();
      assert.equal(await cover.isChecked(), true);
      await footer.check();
      for (const asset of brandArtwork) {
        const thumbnail = page.getByRole('region', { name: '模板首尾图' }).locator(`img[src="${asset.src}"]`);
        assert.equal(await thumbnail.evaluate(img => img.decode().then(() => img.naturalWidth)), 640);
      }
      await page.getByRole('button', { name: '应用模板，生成排版稿', exact: true }).click();
      const canvas = page.locator('.cve-canvas');
      await canvas.getByText('PART 01', { exact: true }).waitFor();
      await canvas.getByText('PART 02', { exact: true }).waitFor();
      await canvas.getByText('栏目介绍', { exact: true }).waitFor();
      const compact = canvas.locator('[data-cve-slot="content"]').filter({ hasText: '初审：甲' });
      assert.equal(await compact.evaluate(node => getComputedStyle(node).fontSize), '12px');
      assert.match(await compact.innerHTML(), /初审：甲<br>终审：乙/);
      const blocks = canvas.locator('.cve-block');
      assert.equal(await blocks.first().locator('img').getAttribute('src'), brandArtwork[0].src);
      assert.equal(await blocks.last().locator('img').getAttribute('src'), brandArtwork[1].src);

      await canvas.locator('.cve-gallery-tools').filter({ hasText: '3 图组' })
        .getByRole('button', { name: '组图样式', exact: true }).click();
      await page.locator(`[data-style-id="db-${carousel.id}"]`).click();
      const preview = page.getByRole('dialog', { name: '应用此样式？' });
      const slots = locator => locator.locator('[data-gallery-slot]').evaluateAll(nodes => [...new Set(nodes.map(node => node.dataset.gallerySlot))]);
      assert.deepEqual(await slots(preview), ['0', '1', '2']);
      await preview.getByRole('button', { name: '应用样式', exact: true }).click();
      const rendered = canvas.locator('.cve-observed-original');
      await rendered.locator('svg').waitFor();
      assert.deepEqual(await slots(rendered), ['0', '1', '2']);
      const motion = await rendered.locator('svg').evaluate(svg => {
        svg.pauseAnimations();
        const track = svg.querySelector('g');
        svg.setCurrentTime(0);
        const start = track.transform.animVal.getItem(0).matrix.e;
        svg.setCurrentTime(3.1);
        return { start, moved: track.transform.animVal.getItem(0).matrix.e };
      });
      assert.deepEqual(motion, { start: 0, moved: -640 });
      await page.setViewportSize({ width: 390, height: 860 });
      const closeLibrary = page.getByRole('button', { name: '关闭样式面板', exact: true });
      if (await closeLibrary.isVisible()) await closeLibrary.click();
      await rendered.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      const pixels = PNG.sync.read(await rendered.locator('svg').screenshot());
      const center = (Math.floor(pixels.height / 2) * pixels.width + Math.floor(pixels.width / 2)) * 4;
      assert.deepEqual([...pixels.data.subarray(center, center + 3)].map((value, index) =>
        Math.abs(value - [133, 157, 169][index]) < 4), [true, true, true], 'the active SVG frame visibly loads a photo');
      await page.screenshot({ path: path.join(screenshotDir, 'wechat-template-carousel-mobile.png') });

      await page.evaluate(() => {
        navigator.clipboard.write = async items => { window.fixtureCopy = await (await items[0].getType('text/html')).text(); };
      });
      await page.getByRole('button', { name: '复制到公众号', exact: true }).click();
      await page.waitForFunction(() => window.fixtureCopy);
      const copy = await page.evaluate(() => {
        const body = new DOMParser().parseFromString(window.fixtureCopy, 'text/html');
        return { images: [...body.querySelectorAll('img')].map(img => img.getAttribute('src')),
          svg: body.querySelectorAll('svg').length, credits: [...body.querySelectorAll('section')].some(el => el.innerHTML === '初审：甲<br>终审：乙') };
      });
      const original = asset => new URL(asset.src, base).searchParams.get('url');
      assert.equal(copy.images[0], original(brandArtwork[0]));
      assert.equal(copy.images.at(-1), original(brandArtwork[1]));
      assert.deepEqual(copy.images.slice(1, -1).map(src => new URL(src, base).searchParams.get('frame')),
        Array.from({ length: 11 }, (_, i) => String(i)));
      assert.equal(copy.svg, 0);
      assert.equal(copy.credits, true);
    },
    async composerToolRail(page) {
      await page.goto(base + '/function/wechat-composer');
      const rail = page.getByRole('complementary', { name: '排版工具栏', exact: true });
      const dock = rail.locator('.ctr-dock');
      const editing = rail.getByRole('group', { name: '编辑工具', exact: true });
      const publishing = rail.getByRole('group', { name: '发布操作', exact: true });
      await publishing.getByRole('button', { name: '复制到公众号', exact: true }).waitFor();
      assert.equal(await editing.getByRole('button').count(), 4);
      assert.equal(await publishing.getByRole('button').count(), 4);
      assert.equal(await page.locator('.wxc-export-card').count(), 0);

      await page.getByRole('button', { name: '样式面板', exact: true }).click();
      const sidebar = page.locator('.wxc-side-lib');
      await sidebar.waitFor();
      const scrollTo = y => page.evaluate(value => window.scrollTo(0, value), y);
      await scrollTo(0);
      const initialSidebar = await sidebar.boundingBox();
      const masthead = await page.locator('.wxc-page-header').boundingBox();
      const canvasTop = await page.locator('.wxc-canvas-region').boundingBox();
      const stickyTop = await sidebar.evaluate(node => parseFloat(getComputedStyle(node).top));
      assert.ok(initialSidebar.y >= masthead.y + masthead.height, 'the sidebar starts below the title and summary');
      assert.equal(initialSidebar.y, canvasTop.y);
      assert.ok(initialSidebar.x + initialSidebar.width < canvasTop.x, 'the styles use their own column');
      assert.ok(initialSidebar.y > stickyTop + 12);
      await scrollTo(Math.floor((initialSidebar.y - stickyTop) / 2));
      const approaching = await sidebar.boundingBox();
      assert.ok(approaching.y < initialSidebar.y && approaching.y > stickyTop, 'the sidebar initially scrolls with the canvas');
      const hitCanvas = Math.ceil(initialSidebar.y - stickyTop);
      for (const extra of [30, 90]) {
        await scrollTo(hitCanvas + extra);
        const pinned = await sidebar.boundingBox();
        assert.ok(Math.abs(pinned.y - stickyTop) <= 2, `sidebar pinned at ${pinned.y}, expected ${stickyTop}`);
      }
      await scrollTo(0);
      assert.deepEqual(await sidebar.boundingBox(), initialSidebar, 'scrolling back removes the sticky offset');
      await page.screenshot({ caret: 'initial', path: path.join(screenshotDir, 'wechat-sidebar-at-canvas.png') });
      await page.getByRole('button', { name: '收起样式面板', exact: true }).click();
      await sidebar.waitFor({ state: 'hidden' });

      const desktop = await dock.boundingBox();
      const workarea = await page.locator('.wxc-workarea').boundingBox();
      const station = page.locator('[data-transfer-station-root="1"]').first();
      assert.ok(desktop.x >= workarea.x + workarea.width, 'the rail does not cover the canvas');
      if (await station.isVisible()) assert.ok(desktop.x + desktop.width <= (await station.boundingBox()).x, 'the rail leaves the transfer station reachable');

      const blocks = page.locator('.cve-canvas .cve-block');
      const top = (await blocks.first().boundingBox()).y;
      await blocks.last().scrollIntoViewIfNeeded();
      assert.ok((await blocks.first().boundingBox()).y < top);
      assert.deepEqual(await dock.boundingBox(), desktop, 'the combined rail stays fixed while the canvas scrolls');
      await page.screenshot({ caret: 'initial', path: path.join(screenshotDir, 'wechat-publish-rail-desktop.png') });
      const layout = editing.getByRole('button', { name: '布局模式', exact: true });
      await layout.click();
      assert.equal(await layout.getAttribute('aria-pressed'), 'true');
      await layout.click();
      const stats = editing.getByRole('button', { name: '全文统计', exact: true });
      await stats.click();
      await rail.getByText('预计阅读', { exact: true }).waitFor();

      const more = publishing.getByRole('button', { name: '更多', exact: true });
      const menu = rail.getByRole('menu', { name: '更多发布操作', exact: true });
      await more.press('Enter');
      assert.equal(await stats.getAttribute('aria-expanded'), 'false');
      await menu.waitFor();
      const desktopMenu = await menu.boundingBox();
      assert.ok(desktopMenu.x + desktopMenu.width <= desktop.x, 'the menu opens toward the canvas');
      await page.keyboard.press('Escape');
      assert.equal(await menu.isVisible(), false);
      assert.equal(await more.evaluate(button => button === document.activeElement), true);
      await page.evaluate(() => { navigator.clipboard.writeText = async text => { window.fixtureMarkdown = text; }; });
      await more.press('Enter');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.fixtureMarkdown?.includes('秋日的香山'));
      await more.click();
      const download = page.waitForEvent('download');
      await menu.getByRole('menuitem', { name: '下载图片包', exact: true }).click();
      assert.match((await download).suggestedFilename(), /图1\.jpg$/);

      await publishing.getByRole('button', { name: '手机预览', exact: true }).click();
      const qrDialog = page.getByRole('dialog', { name: '手机预览', exact: true });
      await qrDialog.locator('.wxc-qr-code svg').waitFor();
      assert.equal(await qrDialog.locator('.wxc-qr-url').textContent(), base + '/wechat-preview/rail-fixture');
      await qrDialog.getByRole('button', { name: '关闭', exact: true }).click();

      await page.setViewportSize({ width: 1024, height: 560 });
      const compactDesktop = await dock.boundingBox();
      assert.ok(compactDesktop.y >= 136 && compactDesktop.y + compactDesktop.height < 560);
      await page.setViewportSize({ width: 390, height: 844 });
      const mobile = await dock.boundingBox();
      assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 390 && mobile.y + mobile.height <= 844);
      const mobileStation = await station.boundingBox();
      if (mobileStation) assert.ok(mobileStation.y + mobileStation.height <= mobile.y || mobileStation.x >= mobile.x + mobile.width);
      await more.click();
      const mobileMenu = await menu.boundingBox();
      assert.ok(mobileMenu.x >= 0 && mobileMenu.x + mobileMenu.width <= 390 && mobileMenu.y + mobileMenu.height <= mobile.y);
      if (mobileStation) assert.ok(mobileMenu.x + mobileMenu.width <= mobileStation.x, 'the menu clears the transfer station');
      await page.screenshot({ caret: 'initial', path: path.join(screenshotDir, 'wechat-publish-rail-mobile.png') });
    },
    async articlePreviewDisclosure(page) {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto(base + '/function/wechat-composer');
      const open = page.getByRole('button', { name: /推文预览/ });
      await open.click();
      const dialog = page.getByRole('dialog', { name: '推文预览', exact: true });
      const screen = dialog.getByRole('region', { name: '手机文章预览', exact: true });
      const details = dialog.locator('.wx-preview-details');
      const toggle = dialog.getByRole('button', { name: '推文信息', exact: true });
      const settle = () => dialog.evaluate(panel => Promise.allSettled(panel.getAnimations({ subtree: true })
        .map(animation => animation.finished)).then(() => {}));
      const centeredPhone = async () => {
        const phone = await screen.boundingBox();
        assert.ok(Math.abs(phone.x + phone.width / 2 - page.viewportSize().width / 2) <= 2, 'collapsed phone preview is centered');
        return phone;
      };
      await screen.getByRole('heading', { name: /香山研学/ }).waitFor();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await details.isVisible(), false);
      assert.equal(await dialog.getByRole('textbox').count(), 0, 'hidden fields are not in the tab order');
      const closed = await centeredPhone();
      await dialog.screenshot({ caret: 'initial', path: path.join(screenshotDir, 'wechat-phone-preview-closed.png') });
      await dialog.getByRole('button', { name: '夜间', exact: true }).click();
      assert.equal(await screen.getAttribute('data-mode'), 'night');
      await screen.evaluate(node => { node.scrollTop = 160; });
      assert.equal(await screen.evaluate(node => node.scrollTop), 160);

      await toggle.press('Enter');
      await details.waitFor();
      await settle();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      const expanded = await screen.boundingBox();
      assert.ok(expanded.x < closed.x - 100, 'opening the right panel moves the phone left');
      assert.equal(expanded.width, closed.width);
      assert.equal(expanded.height, closed.height);
      assert.equal(await screen.evaluate(node => node.scrollTop), 160);
      const sidebar = await details.boundingBox();
      assert.ok(sidebar.x > expanded.x + expanded.width);
      assert.equal(await screen.getAttribute('data-mode'), 'night');
      await dialog.getByRole('button', { name: '日间', exact: true }).click();
      await details.getByRole('textbox', { name: '公众号名称', exact: true }).fill('校园融媒体');
      await details.getByRole('textbox', { name: '作者', exact: true }).fill('编辑部');
      await details.getByRole('textbox', { name: '发布时间', exact: true }).fill('2026-11-25 10:00');
      assert.equal(await screen.locator('.wx-preview-account').textContent(), '校园融媒体');
      assert.match(await screen.locator('.wx-preview-byline').textContent(), /编辑部·2026-11-25 10:00/);

      const bigCard = details.getByRole('group', { name: '单图文分享卡片', exact: true });
      const smallCard = details.getByRole('group', { name: '次条列表卡片', exact: true });
      const cover = details.getByRole('button', { name: '更换大图封面', exact: true });
      assert.equal(await smallCard.locator('img').getAttribute('src'), await bigCard.locator('img').getAttribute('src'));
      await cover.click();
      const picker = page.getByRole('dialog', { name: '选择照片（替换当前图片）', exact: true });
      await picker.waitFor();
      await page.keyboard.press('Escape');
      await picker.waitFor({ state: 'hidden' });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'Escape only dismisses the frontmost photo picker');
      await cover.click();
      await picker.getByRole('button', { name: '中转站封面', exact: true }).click();
      const replacement = await bigCard.locator('img').getAttribute('src');
      assert.match(replacement, /replacement/);
      assert.equal(await smallCard.locator('img').getAttribute('src'), replacement);

      await details.getByRole('button', { name: '裁剪大图封面', exact: true }).click();
      const crop = page.locator('.wie-panel');
      await crop.getByRole('button', { name: '应用', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await crop.waitFor({ state: 'hidden' });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'Escape only dismisses the cover cropper');
      await details.getByRole('button', { name: '裁剪大图封面', exact: true }).click();
      await crop.getByRole('button', { name: '应用', exact: true }).click();
      await crop.waitFor({ state: 'hidden' });
      assert.match(await bigCard.locator('img').getAttribute('src'), /^data:image\//);
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await page.getByText('已应用封面编辑', { exact: true }).waitFor({ state: 'hidden' });
      await screen.evaluate(node => { node.scrollTop = 0; });
      await details.evaluate(node => { node.scrollTop = 0; });
      await dialog.screenshot({ caret: 'initial', path: path.join(screenshotDir, 'wechat-phone-preview-open.png') });

      await page.setViewportSize({ width: 1024, height: 720 });
      await settle();
      assert.equal(await dialog.evaluate(panel => {
        const rect = panel.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
      }), true);
      await dialog.screenshot({ caret: 'initial', path: path.join(screenshotDir, 'wechat-phone-preview-laptop.png') });
      await screen.evaluate(node => { node.scrollTop = 160; });
      await toggle.click();
      await settle();
      assert.equal(await details.isVisible(), false);
      await centeredPhone();
      assert.equal(await screen.evaluate(node => node.scrollTop), 160);

      await toggle.click();
      await settle();
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await open.click();
      await screen.getByText('校园融媒体', { exact: true }).waitFor();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'every new opening starts with the phone only');
      await centeredPhone();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    },
    async about(page) {
      await page.goto(base);
      await page.locator('.mamage-nav-link').filter({ hasText: '关于' }).click();
      await page.waitForURL('**/about');
      await page.goBack();
      await page.locator('.album-desktop').waitFor();
      await page.goForward();
      await page.waitForFunction(() => document.querySelector('.mamage-nav-link.is-active')?.textContent === '关于');
      await page.reload();
      await page.waitForFunction(() => document.querySelector('.mamage-nav-link.is-active')?.textContent === '关于');
    },
  };
  try {
    for (const [name, check] of Object.entries(checks)) {
      if (process.env.NAV_CASE && process.env.NAV_CASE !== name) continue;
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce',
        serviceWorkers: 'block', hasTouch: name === 'stationPhotoMobile' });
      const errors = [], writes = [];
      const discardedDrafts = new Set();
      let recoveryPolls = 0;
      let previewRequests = 0;
      const testPhotos = name === 'galleryPaginationRestore'
        ? [...photos, ...photos.map(photo => ({ ...photo, id: photo.id + 80 }))] : photos;
      const testAlbum = { ...album, images: testPhotos, count: testPhotos.length };
      const testAlbums = name === 'paginationRestore'
        ? Array.from({ length: 26 }, (_, i) => ({ ...album, id: i + 1, name: `Album ${i + 1}`, eventDate: `2026-10-${String(i + 1).padStart(2, '0')}` }))
        : [testAlbum];
      const testGroups = groups.map(group => group.id === 'events' ? { ...group, projectIds: testAlbums.map(item => item.id) } : group);
      await context.addInitScript(() => { try { localStorage.setItem('mamage_jwt_token', 'isolated-navigation-fixture'); } catch {} });
      if (name === 'stationPhotoDrop' || name === 'stationPhotoMobile') {
        const station = photos.slice(0, 32).map(photo => ({ ...photo, projectTitle: album.title, tags: ['exchange'] }));
        station.splice(1, 0, { id: 800, mediaType: 'video', url: '/api/image/video.mp4' });
        await context.addInitScript(items => localStorage.setItem('photo-transfer-selection', JSON.stringify(items)), station);
      }
      if (name === 'draftRecovery') await context.addInitScript(() => {
        const key = 'mamage.wechat.workflow.v1:7:1';
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ mode: 'ai', stage: 'content' }));
        if (!sessionStorage.getItem('draft-recovery-fixture-seeded')) {
          sessionStorage.setItem('draft-recovery-fixture-seeded', '1');
          localStorage.setItem('mamage.aiNewsWriter.draft.v2:7:1:before-recovery', JSON.stringify({
            savedAt: Date.parse('2026-11-24T11:03:00Z'), selectedChannels: ['wechat_article'],
            formValues: { sourceMaterial: '仅存在本机的草稿' },
          }));
        }
      });
      if (name === 'draftPhotoDrag') await context.addInitScript(() => {
        if (sessionStorage.getItem('photo-drag-fixture-seeded')) return;
        sessionStorage.setItem('photo-drag-fixture-seeded', '1');
        localStorage.setItem('mamage.wechat.workflow.v1:7:1', JSON.stringify({ mode: 'ai', stage: 'content' }));
        localStorage.setItem('mamage.aiNewsWriter.draft.v2:7:1', JSON.stringify({ activeChannelKey: 'wechat_article',
          selectedChannels: ['wechat_article'], channelContent: { wechat_article: {
            title: '照片拖拽测试', markdownText: '# 照片拖拽测试\n\n开场\n\n![照片甲](/api/image/test.jpg?first)\n\n第一段\n\n第二段\n\n![照片乙](/api/image/test.jpg?second)',
          } } }));
      });
      if (name === 'templateCarousel') await context.addInitScript(() => {
        const photos = Array.from({ length: 11 }, (_, index) => `![样图 ${index + 1}](/api/image/test.jpg?frame=${index})`);
        const markdownText = ['# 访谈样稿', '本期访谈提要。', '## 研究经历', ...photos.slice(0, 8),
          '## 校园交流', ...photos.slice(8), '初审：甲', '终审：乙'].join('\n\n');
        localStorage.setItem('mamage.wechat.workflow.v1:7:1', JSON.stringify({ mode: 'ai', stage: 'content' }));
        localStorage.setItem('mamage.aiNewsWriter.draft.v2:7:1', JSON.stringify({ activeChannelKey: 'wechat_article',
          selectedChannels: ['wechat_article'], channelContent: { wechat_article: { title: '访谈样稿', markdownText } } }));
      });
      if (['articlePreviewDisclosure', 'composerToolRail'].includes(name)) await context.addInitScript(() => {
        const styled = { title: '香山研学：在红叶与古建间上一堂行走的课', themeKey: 'minimal',
          meta: { wxName: '学院公众号', author: '通讯员', publishTime: '', coverBig: '/api/image/test.jpg?wide' },
          doc: [{ uid: 'header-image', kind: 'styled', type: 'imageCard', src: '/api/image/test.jpg?header', caption: '' },
            ...Array.from({ length: 12 }, (_, index) => ({ uid: `p${index}`, kind: 'para',
              html: '秋日的香山，红叶漫山，古建静立。一群年轻人走进这座承载历史与自然双重记忆的公园，在行走中展开研学。' }))],
        };
        localStorage.setItem('mamage.wechat.workflow.v1:7:1', JSON.stringify({ mode: 'ai', stage: 'styled', styled }));
        localStorage.setItem('photo-transfer-selection', JSON.stringify([
          { id: 801, url: '/api/image/test.jpg?replacement', description: '中转站封面' },
        ]));
      });
      await context.route('**/*', route => {
        const req = route.request(), url = new URL(req.url()), p = url.pathname;
        if (p.startsWith('/api/image/')) return route.fulfill({ contentType: 'image/jpeg', body: image });
        if (name === 'templateCarousel' && brandArtwork.some(asset => asset.src === p + url.search)) {
          return route.fulfill({ contentType: 'image/jpeg', body: image });
        }
        if (p.startsWith('/api/')) {
          if (name === 'composerToolRail' && p === '/api/wechat-preview' && req.method() === 'POST') {
            previewRequests++;
            const data = req.postDataJSON();
            if (!data.title?.startsWith('香山研学') || !data.html?.includes('秋日的香山')) return route.fulfill({ status: 400 });
            return route.fulfill({ json: { path: '/wechat-preview/rail-fixture' } });
          }
          if (name === 'draftRecovery' && req.method() === 'DELETE' && /^\/api\/ai\/news\/recoverable-drafts\/50[1-3]$/.test(p)) {
            discardedDrafts.add(Number(p.split('/').at(-1)));
            return route.fulfill({ status: 204 });
          }
          if (req.method() !== 'GET') { writes.push(p); return route.abort(); }
          if (p === '/api/photos/search' && name === 'albumSearchFailure') {
            return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Fixture search unavailable' });
          }
          let data = {};
          if (p === '/api/users/me') data = { id: 7, name: 'Test User', role: 'admin', activeUnitId: 1, metadataEditScope: 'own',
            permissions: ['projects.view', 'projects.create', 'photos.view', 'photos.edit', 'ai.generate'] };
          else if (p === '/api/workspaces') data = { enabled: true, activeUnitId: 1, units: [{ id: 1, name: 'Test Workspace', role: 'manager' }] };
          else if (name === 'templateCarousel' && ['/api/wechat-style/monitor-templates', '/api/wechat-style/blocks'].includes(p)) data = layoutLibrary;
          else if (name === 'draftRecovery' && p === '/api/wechat-compositions') data = { items: [
            { id: 401, name: '已保存的推文', draftKind: 'layout', updatedAt: '2026-11-24T11:01:00Z' },
          ] };
          else if (name === 'draftRecovery' && p === '/api/ai/news/recoverable-drafts') data = { items: [
            { batchId: 501, jobId: 601, title: '从线上找回的稿件', status: 'succeeded', createdAt: '2026-11-24T11:00:00Z' },
            { batchId: 502, jobId: 602, title: '后台生成中的稿件', status: 'running', createdAt: '2026-11-24T11:02:00Z' },
            { batchId: 503, jobId: 603, title: '不再需要的草稿', status: 'succeeded', createdAt: '2026-11-24T10:58:00Z' },
          ].filter(item => !discardedDrafts.has(item.batchId)) };
          else if (name === 'draftRecovery' && ['/api/ai/news/batches/501', '/api/ai/news/batches/502'].includes(p)) {
            const batchId = Number(p.split('/').at(-1));
            const recovering = url.searchParams.get('recover') === '1';
            const ready = batchId === 501;
            if (ready && !recovering && recoveryPolls++ === 0) return route.fulfill({ status: 500, json: { message: 'Temporary status failure' } });
            const status = ready ? 'succeeded' : 'running';
            data = { batchId, status, createdAt: '2026-11-24T11:00:00Z', jobs: [{ jobId: batchId + 100, channelKey: 'wechat_article', status,
              result: ready ? { title: '从线上找回的稿件', photos: [{ id: 101, url: null }], markdown: '# 从线上找回的稿件\n\n正文。\n\n![活动](PHOTO:101)' } : null }],
              ...(recovering ? { recovery: { form: { sourceMaterial: '原始活动材料' }, selectedPhotoIds: ready ? [101] : [] } } : {}) };
          }
          else if (p === '/api/album-desktop') data = { albums: testAlbums, groups: testGroups, sharedAlbums: [], sharedFolders: [],
            preferences: { pins: [], recentItems: [], colors: {} }, scope: { userId: 7, unitId: 1 },
            workspaceRevision: 1, userRevision: 1, canOrganize: true, canDeleteFolders: true };
          else if (p === '/api/projects/list') data = { list: [album], total: 1, hasMore: false };
          else if (p === '/api/projects/1') data = testAlbum;
          else if (p === '/api/folder-shares/5') data = { share: { id: 5, folderId: 'campus', originLabel: 'Another Workspace', mode: 'readonly' }, groups, albums: [album] };
          else if (p.startsWith('/api/share/')) data = p.endsWith('/folder-test') && !url.searchParams.has('projectId')
            ? { title: 'Campus Folder', folder: { share: { folderId: 'campus', originLabel: 'Test Workspace', mode: 'readonly' }, groups, albums: [album] } }
            : { projectId: 1, title: 'Campus Album', photos, total: photos.length, hasMore: false };
          else if (p === '/api/photos/search' || p === '/api/photos') data = { list: testPhotos, total: testPhotos.length, hasMore: false,
            search: { scope: { type: url.searchParams.has('folderId') ? 'folder' : 'project', id: url.searchParams.get('folderId') || '1' } } };
          else if (p === '/api/photos/101') data = photos[0];
          return route.fulfill({ json: data });
        }
        return url.origin === base ? route.continue() : route.abort();
      });
      const page = await context.newPage(); page.setDefaultTimeout(5000);
      page.on('pageerror', e => errors.push(e.message));
      try {
        await check(page);
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        if (name === 'composerToolRail') assert.equal(previewRequests, 1);
        if (name === 'draftRecovery') assert.deepEqual([...discardedDrafts], [503, 502, 501]);
        results.push({ name, passed: true });
      }
      catch (error) { results.push({ name, passed: false, error: error.message.split('\n').slice(0, 4).join('\n'), url: page.url(), errors }); }
      finally { await context.close(); }
    }
    console.log(JSON.stringify(results, null, 2));
    assert.ok(results.length && results.every(r => r.passed), 'All navigation paths must restore the expected page');
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
