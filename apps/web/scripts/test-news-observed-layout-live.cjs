// Real observed styles and editor against the isolated local sandbox.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { root, output } = require('./serve-news-usability.cjs');
const { chromium } = createRequire(path.resolve(__dirname, '../../server/package.json'))('playwright');
if (process.env.MAMAGE_NEWS_BACKEND_TEST !== '1') throw Error('Live sandbox test requires explicit opt-in');
async function main() {
  const base = 'http://127.0.0.1:5192';
  const config = await (await fetch(`${base}/__news-qa/config`)).json();
  const health = await (await fetch(`${base}/api/health/ready`)).json();
  assert.equal(config.liveBackend, true); assert.equal(health.sandbox, true);
  const compiler = require('webpack'), webpackConfig = require('../webpack.config')({}, { mode: 'development' });
  await new Promise((resolve, reject) => compiler({ ...webpackConfig, context: root, entry: './scripts/fixtures/news-usability.jsx', devtool: false,
    output: { ...webpackConfig.output, path: path.join(output, 'dist') }, optimization: { splitChunks: false } }, (error, stats) =>
    error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      try {
        await page.addInitScript(() => {
          localStorage.setItem('mamage.aiNewsWriter.draft.v2:900003:900003', JSON.stringify({
            channelContent: { wechat_article: { title: '测试活动', markdownText: '# 测试活动\n\n## 活动现场\n\n师生开展交流。', photos: [], extra: {} } },
            activeChannelKey: 'wechat_article', selectedChannels: ['wechat_article'], formValues: {},
          }));
        });
        await page.goto(`${base}/?channel=wechat`);
        await page.getByRole('button', { name: '确认内容，选择样式', exact: true }).click();
        const cards = page.locator('.wechat-layout-templates > button');
        await cards.first().waitFor();
        assert.ok(await cards.count() > 0);
        assert.match(await cards.first().innerText(), /北京中关村学院/);
        assert.equal(await page.locator('.wechat-layout-templates').getByText('简约', { exact: true }).count(), 0);
        await cards.first().click();
        const candidates = page.getByRole('region', { name: '候选固定图' });
        let brandSelected = false;
        if (await candidates.count()) {
          await candidates.locator('img').first().waitFor({ state: 'attached' }).catch(() => {});
          await page.waitForTimeout(1500);
          const checkbox = candidates.getByRole('checkbox').first();
          if (await checkbox.isEnabled()) { await checkbox.check(); brandSelected = true; }
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: path.join(output, `observed-layout-${width}.png`), fullPage: true });
        await page.getByRole('button', { name: '应用模板，生成排版稿', exact: true }).click();
        await page.locator('#wxc-title-input').waitFor();
        const styled = await page.evaluate(() => JSON.parse(localStorage.getItem('wechat-composer-draft.v2:900003:900003:ai')));
        assert.equal(styled.title, '测试活动');
        assert.ok(styled.doc.some(block => block.content === '活动现场'));
        assert.ok(styled.doc.some(block => block.blockId?.startsWith('db-monitor-')));
        assert.ok(Object.keys(styled.sourceDocument.styleBlocks).some(id => id.startsWith('db-monitor-')));
        if (brandSelected) assert.equal(styled.sourceDocument.brandAssets.length, 1);
        await page.reload();
        await page.locator('#wxc-title-input').waitFor();
        const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('wechat-composer-draft.v2:900003:900003:ai')));
        assert.deepEqual(restored.sourceDocument.brandAssets || [], styled.sourceDocument.brandAssets || []);
        console.log(JSON.stringify({ sandbox: true, width, templateCount: await cards.count().catch(() => 0), contentPreserved: true, styleSnapshot: true, brandSelected }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
