const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer, output, root } = require('./serve-news-usability.cjs');
const { chromium } = createRequire(path.join(root, '../server/package.json'))('playwright');
const draftKey = 'mamage.aiNewsWriter.draft.v2:900003:900003';
const markdown = '# 学生实践交流\n\n同学们介绍了项目的观察过程。\n\n教师结合项目进展提出建议。\n\n![活动现场](/__news-qa/images/1681.jpg)';

async function main() {
  const config = require('../webpack.config')({}, { mode: 'development' });
  await new Promise((resolve, reject) => require('webpack')({ ...config, context: root, entry: './scripts/fixtures/news-usability.jsx',
    devtool: false, output: { ...config.output, path: path.join(output, 'dist') }, optimization: { splitChunks: false } }, (error, stats) =>
    error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width === 390, hasTouch: width === 390 });
      const page = await context.newPage(), errors = [];
      page.setDefaultTimeout(7000);
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(({ draftKey, markdown }) => {
          if (sessionStorage.getItem('block-seeded')) return;
          sessionStorage.setItem('block-seeded', '1');
          localStorage.setItem(draftKey, JSON.stringify({ channelContent: { wechat_article: { title: '学生实践交流', markdownText: markdown, photos: [] } },
            activeChannelKey: 'wechat_article', selectedChannels: ['wechat_article'] }));
        }, { draftKey, markdown });
        await page.goto(`http://127.0.0.1:${server.address().port}/?channel=wechat`);
        const editor = page.locator('.news-edit-document');
        await editor.waitFor();
        assert.equal(await page.locator('.news-edit-toolbar').count(), 0, 'block editing has no global format toolbar');
        const paragraph = page.getByRole('textbox', { name: '正文段落 2', exact: true });
        await paragraph.click(); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(180);
        assert.equal(await page.getByRole('dialog', { name: 'AI 就地改稿', exact: true }).count(), 0);

        const handle = page.getByRole('button', { name: '编辑第 2 个内容块', exact: true });
        await handle.hover();
        await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-news-block-handle="1"]')).opacity === '1');
        assert.equal(await handle.evaluate(element => getComputedStyle(element).opacity), '1');
        await handle.click();
        const menu = page.getByRole('dialog', { name: '段落操作', exact: true });
        await menu.waitFor();
        assert.equal(await menu.getByRole('button', { name: '二级标题', exact: true }).count(), 1);
        await page.screenshot({ path: path.join(output, `block-style-menu-${width}.png`) });
        await menu.getByRole('button', { name: '二级标题', exact: true }).click();
        assert.equal(await editor.locator('h2').innerText(), '同学们介绍了项目的观察过程。', 'hovered A is changed even if the caret was in B');
        assert.equal(await editor.locator('.news-edit-paragraph').first().innerText(), '教师结合项目进展提出建议。');
        assert.equal(await editor.locator('.news-edit-photo').count(), 1);
        assert.equal(await page.getByRole('dialog', { name: 'AI 就地改稿', exact: true }).count(), 0);

        for (const [label, tag] of [['三级标题', 'h3'], ['一级标题', 'h1']]) {
          await handle.hover(); await handle.click();
          await menu.getByRole('button', { name: label, exact: true }).click();
          assert.equal(await editor.locator(`[data-news-index="1"]`).evaluate(element => element.tagName.toLowerCase()), tag);
        }
        await handle.hover(); await handle.click(); await menu.getByRole('button', { name: '正文', exact: true }).click();

        await handle.hover(); await handle.click();
        await menu.getByRole('button', { name: 'AI 辅助', exact: true }).click();
        await page.getByRole('dialog', { name: 'AI 就地改稿', exact: true }).waitFor();
        await page.getByRole('button', { name: '润色', exact: true }).click();
        await page.getByRole('button', { name: '采用修改', exact: true }).waitFor();
        await page.getByRole('button', { name: '采用修改', exact: true }).click();
        await editor.locator('[data-news-index="1"]').evaluate(element => {
          element.closest('.ProseMirror').focus();
          const range = document.createRange(); range.setStart(element.firstChild, 1); range.collapse(true);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        });
        await page.keyboard.press('Shift');
        await handle.hover(); await handle.click(); await menu.getByRole('button', { name: 'AI 辅助', exact: true }).click();
        await page.getByRole('button', { name: '补全', exact: true }).click();
        await page.getByRole('button', { name: '采用修改', exact: true }).waitFor();
        await page.getByRole('button', { name: '采用修改', exact: true }).click();
        await editor.locator('[data-news-index="1"]').click();
        await handle.hover(); await handle.click(); await menu.getByRole('button', { name: 'AI 辅助', exact: true }).click();
        await page.getByRole('dialog', { name: 'AI 就地改稿', exact: true }).waitFor();
        await page.getByRole('button', { name: '关闭 AI 浮窗', exact: true }).click();
        await page.getByRole('button', { name: '撤销编辑', exact: true }).click();
        await page.getByRole('button', { name: '撤销编辑', exact: true }).click();

        const gap = page.locator('[data-news-insert-index="2"]');
        await gap.hover();
        await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-news-insert-index="2"] button')).opacity === '1');
        assert.equal(await gap.getByRole('button').evaluate(element => getComputedStyle(element).opacity), '1');
        await page.screenshot({ path: path.join(output, `block-insert-gap-${width}.png`) });
        await gap.getByRole('button').click();
        assert.equal(await editor.locator('[data-news-index="2"]').textContent(), '');
        await page.keyboard.type('这段是在两段之间插入的内容。');
        assert.deepEqual(await editor.locator('.news-edit-paragraph').allTextContents(), ['同学们介绍了项目的观察过程。', '这段是在两段之间插入的内容。', '教师结合项目进展提出建议。']);
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        assert.equal(await page.getByRole('dialog', { name: 'AI 就地改稿', exact: true }).count(), 0);
        const emptyBefore = await editor.locator('[data-news-index]').allTextContents();
        assert.equal(emptyBefore.filter(text => !text).length, 2);
        await page.reload(); await editor.waitFor();
        assert.deepEqual(await editor.locator('[data-news-index]').allTextContents(), emptyBefore, 'inserted empty paragraphs survive reload');
        await page.getByRole('button', { name: '撤销编辑', exact: true }).click();
        assert.equal((await editor.locator('[data-news-index]').allTextContents()).filter(text => !text).length, 1);
        await page.getByRole('button', { name: '重做编辑', exact: true }).click();
        assert.equal((await editor.locator('[data-news-index]').allTextContents()).filter(text => !text).length, 2);

        await handle.hover(); await handle.click();
        const bounds = await menu.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
        await page.keyboard.press('Escape'); assert.equal(await menu.count(), 0);
        await handle.hover(); await handle.click();
        await menu.getByRole('button', { name: 'AI 辅助', exact: true }).click();
        await page.getByRole('dialog', { name: 'AI 就地改稿', exact: true }).waitFor();
        await page.getByRole('button', { name: '关闭 AI 浮窗', exact: true }).click();
        const photo = editor.locator('.news-edit-photo'), caption = photo.locator('.news-edit-caption');
        const originalURL = await photo.locator('img').getAttribute('src');
        const photoIndex = Number(await photo.getAttribute('data-news-index'));
        const photoHandle = page.getByRole('button', { name: `编辑第 ${photoIndex + 1} 个内容块`, exact: true });
        await photoHandle.hover(); await photoHandle.click(); await menu.getByRole('button', { name: '移除图题', exact: true }).click();
        assert.equal(await caption.isVisible(), false);
        assert.equal(await caption.evaluate(element => element.contains(document.activeElement)), false, 'keyboard focus never remains in the removed caption');
        assert.equal(await photo.locator('img').getAttribute('src'), originalURL, 'removing a caption never changes the photo');
        await page.getByRole('button', { name: '撤销编辑', exact: true }).click();
        assert.equal(await caption.innerText(), '活动现场');
        await page.getByRole('button', { name: '重做编辑', exact: true }).click();
        assert.equal(await caption.isVisible(), false);
        await page.reload(); await editor.waitFor();
        assert.equal(await caption.isVisible(), false, 'removed captions stay removed after reload');
        assert.equal(await photo.locator('img').getAttribute('src'), originalURL);
        await photoHandle.hover(); await photoHandle.click();
        await page.screenshot({ path: path.join(output, `block-photo-caption-menu-${width}.png`) });
        await menu.getByRole('button', { name: '添加图题', exact: true }).click();
        assert.equal(await caption.isVisible(), true);
        assert.equal(await caption.evaluate(element => element.closest('.news-edit-photo').getAttribute('data-caption-editing')), 'true');
        await editor.locator('[data-news-index="1"]').click();
        await caption.waitFor({ state: 'hidden' });
        await photoHandle.hover(); await photoHandle.click(); await menu.getByRole('button', { name: '添加图题', exact: true }).click();
        assert.equal(await caption.isVisible(), true);
        await page.keyboard.type('新的现场图题');
        assert.equal(await caption.innerText(), '新的现场图题');
        await page.reload(); await editor.waitFor();
        assert.equal(await caption.innerText(), '新的现场图题');
        assert.equal(await photo.locator('img').getAttribute('src'), originalURL);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ width, passed: true, blockMenu: true, hoveredTargetOnly: true, gapInsertion: true, blankReload: true, undoRedo: true, photoCaptionToggle: true }));
      } catch (error) {
        await page.screenshot({ path: path.join(output, `block-controls-failure-${width}.png`), fullPage: true }); throw error;
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
