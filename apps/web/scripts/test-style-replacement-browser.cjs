// Run test-news-gallery-browser.cjs first to build the shared local fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer, root, output } = require('./serve-news-usability.cjs');
const { chromium } = createRequire(path.join(root, '../server/package.json'))('playwright');

const readDoc = page => page.evaluate(() => JSON.parse(localStorage.getItem(
  Object.keys(localStorage).find(key => key.startsWith('wechat-composer-draft.v2:') && key.endsWith(':ai')))).doc);

async function main() {
  const server = createServer({ distDirectory: path.join(output, 'gallery-dist') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  fs.mkdirSync(path.join(output, 'style-replacement-shots'), { recursive: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 960 } });
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
        const target = original.find(block => block.type === 'h2');
        const block = page.locator(`[data-cve-uid="${target.uid}"]`);
        await block.locator('[data-cve-slot="content"]').click();
        await page.getByRole('button', { name: '替换样式', exact: true }).click();
        const style = page.locator(`.wxc-lib-block:not([data-style-id="${target.blockId}"])`).first();
        const styleId = await style.getAttribute('data-style-id');
        await style.click();
        const confirm = page.getByRole('dialog', { name: '应用此样式？' });
        await confirm.waitFor();
        assert((await confirm.locator('.wxc-style-confirm-preview').innerText()).includes(target.content));
        assert.deepEqual(await readDoc(page), original, 'preview cannot mutate the draft');
        await page.waitForFunction(() => document.querySelectorAll('.mamage-toast').length === 0);
        await page.screenshot({ path: path.join(output, `style-replacement-shots/${width}-confirm.png`) });
        await confirm.getByRole('button', { name: '取消', exact: true }).click();
        assert.deepEqual(await readDoc(page), original);
        await style.click();
        await confirm.getByRole('button', { name: '应用样式', exact: true }).click();
        await page.waitForFunction(({ uid, id }) => JSON.parse(localStorage.getItem(Object.keys(localStorage)
          .find(key => key.startsWith('wechat-composer-draft.v2:') && key.endsWith(':ai')))).doc.find(b => b.uid === uid).blockId === id,
        { uid: target.uid, id: styleId });
        assert.deepEqual(await readDoc(page), original.map(item => item.uid === target.uid ? { ...item, blockId: styleId } : item));
        await page.locator('.wxc-undo-group').getByRole('button', { name: '撤销', exact: true }).click();
        assert.deepEqual(await readDoc(page), original);

        // A regular paragraph can also use a body style without losing inline formatting.
        const paragraph = original.find(item => item.kind === 'para');
        await page.locator(`[data-cve-uid="${paragraph.uid}"] .cve-block-body`).click();
        await page.getByRole('button', { name: '替换样式', exact: true }).click();
        await page.locator(`.wxc-lib-block:not([data-style-id="${paragraph.blockId}"])`).first().click();
        await confirm.getByRole('button', { name: '应用样式', exact: true }).click();
        assert.equal((await readDoc(page)).find(item => item.uid === paragraph.uid).html, paragraph.html);
        await page.locator('.wxc-undo-group').getByRole('button', { name: '撤销', exact: true }).click();

        if (width > 968) {
          await page.locator('.wxc-lib-tab').getByText('标题', { exact: true }).click();
          await block.scrollIntoViewIfNeeded();
          const drag = async (source, destination) => {
            await source.scrollIntoViewIfNeeded();
            const a = await source.boundingBox(); const b = await destination.boundingBox();
            await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
            await page.mouse.down();
            await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
          };
          const source = page.locator(`.wxc-lib-block[data-style-id="${styleId}"]`);
          await drag(source, block);
          await page.locator('.cve-style-drop-target:not(.is-incompatible)').waitFor();
          await page.screenshot({ path: path.join(output, 'style-replacement-shots/1440-drag.png') });
          await page.mouse.up();
          await confirm.waitFor();
          assert.deepEqual(await readDoc(page), original);
          await confirm.getByRole('button', { name: '应用样式', exact: true }).click();
          assert.equal((await readDoc(page)).find(item => item.uid === target.uid).blockId, styleId);
          await page.locator('.wxc-undo-group').getByRole('button', { name: '撤销', exact: true }).click();

          const photo = original.find(item => item.type === 'imageCard');
          const photoEl = page.locator(`[data-cve-uid="${photo.uid}"]`);
          await photoEl.scrollIntoViewIfNeeded();
          await drag(source, photoEl);
          await page.locator('.cve-style-drop-target.is-incompatible').waitFor();
          await page.mouse.up();
          await page.getByText('样式类型不匹配，请选择同类型的样式', { exact: true }).waitFor();
          assert.equal(await confirm.count(), 0);
          assert.deepEqual(await readDoc(page), original, 'incompatible drop must not insert or replace');

          await page.locator('.wxc-lib-tab').getByText('图片卡', { exact: true }).click();
          const imageStyle = page.locator(`.wxc-lib-block:not([data-style-id="${photo.blockId}"])`).first();
          await drag(imageStyle, photoEl);
          await page.mouse.up();
          await confirm.waitFor();
          assert.equal(await confirm.locator('img').getAttribute('src'), photo.src);
          assert((await confirm.locator('.wxc-style-confirm-preview').innerText()).includes(photo.caption));
          await page.waitForFunction(() => document.querySelectorAll('.mamage-toast').length === 0);
          await page.screenshot({ path: path.join(output, 'style-replacement-shots/1440-photo-preview.png') });
          await confirm.getByRole('button', { name: '应用样式', exact: true }).click();
          const updated = (await readDoc(page)).find(item => item.uid === photo.uid);
          assert.deepEqual({ ...updated, blockId: photo.blockId }, photo, 'image, caption and grouping preserved');
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ width, confirmCancel: true, clickReplace: true, undo: true, paragraph: true, drag: width > 968 }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
