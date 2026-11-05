const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer, root, output } = require('./serve-news-usability.cjs');
const { chromium } = createRequire(path.join(root, '../server/package.json'))('playwright');

async function main() {
  const server = createServer({ distDirectory: path.join(output, 'gallery-dist') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, isMobile: width === 390, hasTouch: width === 390 });
      try {
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/?channel=wechat&user=900008`);
        await page.getByRole('button', { name: '添加活动照片', exact: true }).click();
        await page.getByRole('button', { name: /学生实践交流/ }).click();
        for (let id = 9201; id <= 9208; id++) await page.getByRole('dialog').getByRole('button', { name: `选择照片 ${id}`, exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: '使用所选照片', exact: true }).click();
        await page.getByRole('textbox', { name: '详细信息补充', exact: true }).fill('学校在报告厅举行学生实践交流，同学展示项目，教师现场点评。请保留全部配图。');
        await page.getByRole('button', { name: '生成初稿', exact: true }).click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('mamage.aiNewsWriter.draft.v2:900008:900003') || '{}').batchStatus === 'succeeded');
        await page.locator('.news-edit-document').waitFor();
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mamage.aiNewsWriter.draft.v2:900008:900003')));
        assert.equal(saved.channelContent.wechat_article.photos.length, 8);
        assert.equal(await page.locator('.news-edit-photo img').count(), 8, 'all 8 selected images must be in the generated draft');
        await page.reload();
        await page.locator('.news-edit-document').waitFor();
        assert.equal(await page.locator('.news-edit-photo img').count(), 8);
        console.log(JSON.stringify({ width, selected: 8, generated: 8, afterReload: 8 }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
