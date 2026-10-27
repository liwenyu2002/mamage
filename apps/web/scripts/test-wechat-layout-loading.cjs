const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer, root, output } = require('./serve-news-usability.cjs');
const { chromium } = createRequire(path.join(root, '../server/package.json'))('playwright');

async function main() {
  const config = require('../webpack.config')({}, { mode: 'development' });
  await new Promise((resolve, reject) => require('webpack')({ ...config, context: root, entry: './scripts/fixtures/news-usability.jsx',
    devtool: false, output: { ...config.output, path: path.join(output, 'dist') }, optimization: { splitChunks: false } }, (error, stats) =>
    error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        await page.addInitScript(() => localStorage.setItem('mamage.aiNewsWriter.draft.v2:900003:900003', JSON.stringify({
          channelContent: { wechat_article: { title: '测试稿', markdownText: '# 测试稿\n\n这是一段用于测试的文字。', photos: [] } },
          activeChannelKey: 'wechat_article', selectedChannels: ['wechat_article'], formValues: { sourceMaterial: '测试材料' },
        })));
        await page.goto(`http://127.0.0.1:${server.address().port}/?channel=wechat`);
        await page.getByRole('button', { name: '确认内容，选择样式', exact: true }).click();
        await page.getByRole('button', { name: 'AI 排版', exact: true }).click();
        await page.getByRole('textbox', { name: '排版风格描述', exact: true }).fill('简洁校园风');
        await page.getByRole('button', { name: 'AI 自动排版', exact: true }).click();
        const status = page.getByRole('status').filter({ hasText: '正在从样式库匹配排版' });
        await status.waitFor();
        const rect = await status.locator('svg').evaluate(element => {
          const box = element.getBoundingClientRect(); return { width: box.width, height: box.height };
        });
        assert.ok(rect.width > 0 && rect.height > 0 && rect.width <= 24 && rect.height <= 24,
          `width ${width}: loading icon must stay within 24px, got ${JSON.stringify(rect)}`);
        assert.ok((await status.boundingBox()).height <= 80, `width ${width}: loading status must not expand vertically`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        console.log(JSON.stringify({ width, icon: rect }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
