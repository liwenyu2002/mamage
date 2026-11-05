const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer, root, output } = require('./serve-news-usability.cjs');
const { chromium } = createRequire(path.join(root, '../server/package.json'))('playwright');

async function main() {
  const config = require('../webpack.config')({}, { mode: 'development' });
  await new Promise((resolve, reject) => require('webpack')({ ...config, context: root, entry: './scripts/fixtures/news-gallery.jsx',
    devtool: false, output: { ...config.output, path: path.join(output, 'gallery-dist') }, optimization: { splitChunks: false } }, (error, stats) =>
    error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const { buildObservedLibrary } = require('../../server/lib/wechat_observed_styles');
  const articles = process.env.MAMAGE_NEWS_OBSERVED_ARTICLES ? JSON.parse(fs.readFileSync(process.env.MAMAGE_NEWS_OBSERVED_ARTICLES, 'utf8'))
    .filter(row => row.account === '北京中关村学院') : [{ id: 12, current_revision_id: 12, title: '论坛组图样式', published_at: 1,
      blocks: ['<section style="display:flex"><section style="width:50%"><section style="width:94%"><img src="/photo/a"></section></section><section style="width:50%"><section style="width:94%"><img src="/photo/b"></section></section></section>'],
      style_blocks: [{ type: 'h2', htmlTemplate: '<strong>{{content}}</strong>' }, { type: 'imageCard', htmlTemplate: '<img src="{{src}}">' }] }];
  const library = buildObservedLibrary(articles, []);
  assert(library.templates.some(template => template.imageGroup?.columns === 2));
  fs.writeFileSync(path.join(output, 'gallery-dist/observed-library.json'), JSON.stringify(library));
  const server = createServer({ distDirectory: path.join(output, 'gallery-dist') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  fs.mkdirSync(path.join(output, 'gallery-shots'), { recursive: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, isMobile: width === 390, hasTouch: width === 390 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/?channel=wechat`);
        const draft = page.locator('.news-edit-document');
        await draft.waitFor();
        assert.equal(await draft.locator('.news-edit-gallery-header').count(), 3);
        assert.equal(await draft.locator('.news-edit-photo img').count(), 30);
        const photos = draft.locator('.news-edit-photo');
        await photos.nth(4).scrollIntoViewIfNeeded();
        const index = await photos.nth(4).getAttribute('data-news-index');
        await page.locator(`[data-news-block-handle="${index}"]`).click({ force: true });
        await page.getByRole('button', { name: '在此图后拆分', exact: true }).click();
        assert.equal(await draft.locator('.news-edit-gallery-header').count(), 4);
        await draft.locator('.news-edit-gallery-header').first().getByRole('button', { name: '双列', exact: true }).click();
        assert.equal(await photos.first().getAttribute('data-gallery-columns'), '2');
        assert.equal(await photos.nth(5).getAttribute('data-gallery-columns'), '3');
        await page.getByRole('button', { name: '备份内容稿', exact: true }).click();
        await page.reload();
        await draft.waitFor();
        assert.equal(await draft.locator('.news-edit-gallery-header').count(), 4);
        await page.getByRole('tab', { name: '预览', exact: true }).click();
        const preview = page.locator('.news-article-preview');
        await preview.waitFor();
        assert.equal(await preview.locator('.news-draft-image-group').count(), 4);
        assert.equal(await preview.locator('img').count(), 30);
        assert.equal(await preview.locator('.news-draft-image-group').first().getAttribute('data-gallery-columns'), '2');
        assert.equal(await preview.locator('.news-draft-image-group').nth(1).getAttribute('data-gallery-columns'), '3');
        assert.equal((await preview.innerText()).includes('mamage-image-group'), false);
        await page.getByRole('tab', { name: '编辑', exact: true }).click();
        await photos.first().scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll('.news-edit-photo img')].slice(0, 5).every(img => img.complete && img.naturalWidth > 0));
        await page.screenshot({ path: path.join(output, `gallery-shots/${width}-content-groups.png`) });
        const firstBox = await photos.first().boundingBox(), secondBox = await photos.nth(1).boundingBox();
        assert(Math.abs(firstBox.y - secondBox.y) < 2 && firstBox.x + firstBox.width <= secondBox.x, 'content group shows two columns');
        const headerBox = await draft.locator('.news-edit-gallery-header').nth(1).boundingBox();
        assert(headerBox.y >= (await photos.nth(4).boundingBox()).y + (await photos.nth(4).boundingBox()).height, 'adjacent group has a separate header');
        await draft.locator('.news-edit-gallery-header').first().getByRole('button', { name: '合并下一组' }).click();
        assert.equal(await draft.locator('.news-edit-gallery-header').count(), 3);
        await page.getByRole('button', { name: '撤销编辑', exact: true }).click();
        assert.equal(await draft.locator('.news-edit-gallery-header').count(), 4);
        await page.getByRole('button', { name: '确认内容，选择样式', exact: true }).click();
        await page.locator('.wechat-layout-templates button').filter({ hasText: '双列组图' }).first().click();
        await page.getByRole('button', { name: '应用模板，生成排版稿', exact: true }).click();
        const canvas = page.locator('.cve-canvas');
        await canvas.waitFor();
        assert.equal(await canvas.locator('.cve-image-group img').count(), 30);
        assert.equal(await canvas.locator('.cve-image-group').count(), 4);
        assert.equal(await canvas.locator('.cve-image-group').nth(1).evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 3);
        assert.equal(await canvas.locator('.cve-image-group').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 2);
        await page.waitForFunction(() => [...document.querySelectorAll('.cve-image-group img')].every(img => img.complete && img.naturalWidth > 0));
        const cells = canvas.locator('.cve-image-group').first().locator('.cve-block');
        assert.equal(await cells.first().evaluate(el => parseFloat(getComputedStyle(el).paddingLeft) > 0), true);
        await cells.nth(1).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `gallery-shots/${width}-observed.png`) });
        await cells.nth(1).scrollIntoViewIfNeeded();
        await cells.nth(1).locator('[data-cve-slot="caption"]').click();
        const toolbar = canvas.locator('.cve-toolbar');
        await toolbar.waitFor();
        const bounds = await toolbar.boundingBox();
        assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `toolbar outside viewport ${width}: ${JSON.stringify(bounds)}`);
        await toolbar.getByRole('button', { name: '三列', exact: true }).click();
        assert.equal(await cells.first().evaluate(el => getComputedStyle(el.parentElement).gridTemplateColumns.split(' ').length), 3);
        await page.screenshot({ path: path.join(output, `gallery-shots/${width}-editor.png`) });
        await toolbar.getByRole('button', { name: '删除', exact: true }).click();
        assert.equal(await canvas.locator('.cve-image-group img').count(), 29);
        await page.getByRole('button', { name: '备份排版稿', exact: true }).click();
        await page.reload();
        await canvas.waitFor();
        assert.equal(await canvas.locator('.cve-image-group img').count(), 29);
        assert.equal(await canvas.locator('.cve-image-group').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 3);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        assert.deepEqual(errors, []);
        assert.equal(await canvas.locator('.cve-image-group').count(), 4);
        console.log(JSON.stringify({ width, initialImages: 30, afterDeleteAndReload: 29, groups: 4, contentSplitMergeUndo: true, contentColumnsPreserved: true, toolbarInViewport: true }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
