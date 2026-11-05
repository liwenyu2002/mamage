// Run test-news-gallery-browser.cjs first to build the shared local fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer, root, output } = require('./serve-news-usability.cjs');
const { chromium } = createRequire(path.join(root, '../server/package.json'))('playwright');
const readDoc = page => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage)
  .find(key => key.startsWith('wechat-composer-draft.v2:') && key.endsWith(':ai')))).doc);

async function main() {
  const server = createServer({ distDirectory: path.join(output, 'gallery-dist') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  const shots = path.join(output, 'gallery-style-shots');
  fs.mkdirSync(shots, { recursive: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, hasTouch: width < 600 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/?channel=wechat`);
        await page.getByRole('button', { name: '确认内容，选择样式', exact: true }).click();
        await page.locator('.wechat-layout-templates button').filter({ hasText: '双列组图' }).first().click();
        await page.getByRole('button', { name: '应用模板，生成排版稿', exact: true }).click();
        await page.locator('.cve-canvas').waitFor();
        const original = await readDoc(page);
        const photos = original.filter(block => block.type === 'imageCard');
        const target = photos[0];
        const groupIds = photos.filter(block => block.galleryId === target.galleryId).map(block => block.uid);
        assert.equal(groupIds.length, 10);
        await page.getByRole('button', { name: '组图样式', exact: true }).first().click();
        const cards = page.locator('.wxc-lib-block--gallery');
        assert.equal(await cards.count(), 2);
        const ids = await cards.evaluateAll(elements => elements.map(element => element.dataset.styleId));
        await page.screenshot({ path: path.join(shots, `${width}-library.png`) });
        const confirm = page.getByRole('dialog', { name: '应用此样式？' });
        for (const id of ids) {
          await page.locator(`[data-style-id="${id}"]`).click();
          await confirm.waitFor();
          assert.equal(await confirm.locator('[data-gallery-slot]').evaluateAll(elements => new Set(elements.map(el => el.dataset.gallerySlot)).size), 10, 'preview keeps the entire group, including SVG background photos');
          assert.deepEqual(await readDoc(page), original, 'preview does not alter the draft');
          await confirm.getByRole('button', { name: '取消', exact: true }).click();
        }
        const carouselId = ids.find(id => id.includes('observed-gallery'));
        const secondId = ids.find(id => id !== carouselId);
        await page.locator(`[data-style-id="${carouselId}"]`).click();
        await confirm.getByRole('button', { name: '应用样式', exact: true }).click();
        const expected = await readDoc(page);
        assert.deepEqual(expected.map(({ galleryStyle, galleryTemplate, ...block }) => block), original, 'all photo IDs, URLs, captions and adjacent groups are retained');
        assert(expected.filter(block => groupIds.includes(block.uid)).every(block => block.galleryStyle === carouselId && block.galleryTemplate?.slots === 8));
        assert(expected.filter(block => !groupIds.includes(block.uid)).every(block => !block.galleryStyle));
        const gallery = page.locator(`.cve-image-group[data-gallery-style="${carouselId}"]`);
        assert.equal(await gallery.locator('.cve-observed-images [data-cve-uid]').count(), 10);
        await gallery.locator('.cve-gallery-tools').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => document.querySelectorAll('.mamage-toast').length === 0);
        await page.screenshot({ path: path.join(shots, `${width}-applied.png`) });
        await page.locator('.wxc-undo-group').getByRole('button', { name: '撤销', exact: true }).click();
        assert.deepEqual(await readDoc(page), original);
        await page.locator('.wxc-undo-group').getByRole('button', { name: '重做', exact: true }).click();
        assert.deepEqual(await readDoc(page), expected);

        await gallery.locator('summary').click();
        const slot = page.locator(`.cve-observed-images [data-cve-uid="${target.uid}"]`);
        await slot.locator('img').click();
        const picker = page.getByRole('dialog', { name: '选择照片（替换当前图片）' });
        await picker.getByRole('tab', { name: 'AI 搜图', exact: true }).click();
        await picker.locator('.ppk-search-input').fill('活动');
        await picker.getByRole('button', { name: 'AI 搜图', exact: true }).click();
        await picker.locator('.wxc-photopick-thumb').nth(1).click();
        const replaced = await readDoc(page);
        assert.equal(replaced.find(block => block.uid === target.uid).src, '/__news-qa/images/1682.jpg?original=1');
        assert.deepEqual(replaced, expected.map(block => block.uid === target.uid
          ? { ...block, src: '/__news-qa/images/1682.jpg?original=1' } : block), 'slot replacement preserves captions, styles and all other images');
        await page.reload();
        await page.locator('.cve-canvas').waitFor();
        assert.deepEqual(await readDoc(page), replaced);
        assert.equal((await readDoc(page)).filter(block => block.type === 'imageCard').length, 30);
        assert.equal(await gallery.locator('.cve-observed-original [data-gallery-slot]').evaluateAll(elements => new Set(elements.map(el => el.dataset.gallerySlot)).size), 10);

        // 复制到公众号：轮播照片是 CSS 背景图 + SVG，微信粘贴会剥掉 → 导出必须展平成块级 <img>。
        // 拦截 navigator.clipboard.write 读最终导出 HTML（Async Clipboard 路径），断言 30 张配图都在。
        await page.evaluate(() => {
          const clipboard = navigator.clipboard;
          if (!clipboard || !clipboard.write) return;
          const original = clipboard.write.bind(clipboard);
          clipboard.write = async (items) => {
            for (const item of items) {
              if (item.types.includes('text/html')) window.__copiedWechatHtml = await (await item.getType('text/html')).text();
            }
            return original(items);
          };
        });
        const copyButton = page.getByRole('button', { name: '复制到公众号', exact: true });
        await copyButton.scrollIntoViewIfNeeded();
        await copyButton.click();
        await page.getByText(/已复制正文/).first().waitFor();
        const copied = await page.evaluate(() => window.__copiedWechatHtml || '');
        assert(copied.length > 0, 'wechat copy produces html');
        assert.equal((copied.match(/<svg\b/gi) || []).length, 0, 'svg carousel is flattened out of the wechat copy');
        assert(!/background-image\s*:\s*url\([^)]*__news-qa\/images/i.test(copied), 'gallery photos are not left as css backgrounds in the wechat copy');
        assert.equal((copied.match(/<img\b/gi) || []).length, 30, 'all 30 photos are copied as <img>');
        const copiedImgSrcs = [...copied.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map(match => match[1]);
        for (const src of ['/__news-qa/images/1681.jpg', '/__news-qa/images/1682.jpg']) {
          assert(copiedImgSrcs.some(value => value.includes(src)), `carousel photo ${src} survives the wechat copy`);
        }

        if (width > 968) {
          await page.getByRole('button', { name: '组图样式', exact: true }).first().click();
          const source = page.locator(`[data-style-id="${secondId}"]`);
          await source.scrollIntoViewIfNeeded();
          await gallery.locator('summary').click();
          await slot.scrollIntoViewIfNeeded();
          const a = await source.boundingBox(); const b = await slot.boundingBox();
          await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
          await page.mouse.down();
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
          await page.locator('.cve-style-drop-target:not(.is-incompatible)').waitFor();
          await page.mouse.up();
          await confirm.waitFor();
          assert.equal(await confirm.locator('[data-gallery-slot]').count(), 10);
          await confirm.getByRole('button', { name: '应用样式', exact: true }).click();
          const afterDrop = await readDoc(page);
          assert(afterDrop.filter(block => groupIds.includes(block.uid)).every(block => block.galleryStyle === secondId && block.galleryTemplate.slots === 4));
          assert.deepEqual(afterDrop.map(({ galleryStyle, galleryTemplate, ...block }) => block), replaced.map(({ galleryStyle, galleryTemplate, ...block }) => block));
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ width, styles: ids.length, preview: 10, totalPhotos: 30, undo: true, replaceSlot: true, reload: true, copyFlatten: true, drag: width > 968 }));
      } catch (error) {
        await page.screenshot({ path: path.join(shots, `${width}-failure.png`) });
        throw error;
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
