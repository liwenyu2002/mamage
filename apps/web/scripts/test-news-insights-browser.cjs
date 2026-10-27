const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer, output, root } = require('./serve-news-usability.cjs');
const { chromium } = createRequire(path.join(root, '../server/package.json'))('playwright');

async function main() {
  const config = require('../webpack.config')({}, { mode: 'development' });
  await new Promise((resolve, reject) => require('webpack')({ ...config, context: root, entry: './scripts/fixtures/news-usability.jsx',
    devtool: false, output: { ...config.output, path: path.join(output, 'dist') }, optimization: { splitChunks: false } }, (error, stats) =>
    error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 1050, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => { if (window !== window.top) return; localStorage.setItem('mamage.aiNewsWriter.draft.v2:900003:900003', JSON.stringify({
          channelContent: { wechat_article: { title: '测试文章', markdownText: '# 测试文章\n\n这是可以继续编辑的内容。', photos: [],
            extra: { reviewNotes: ['确认活动日期', '补充活动地点'] }, references: [{ id: 771, revisionId: 1, title: '校园交流范例' }], sourceJobId: 10 } },
          activeChannelKey: 'wechat_article', selectedChannels: ['wechat_article'],
          formValues: { sourceMaterial: '测试材料', monitorReferences: [{ id: 999, revisionId: 3, title: '后来改选的文章' }] },
        })); });
        await page.goto(`http://127.0.0.1:${server.address().port}/?channel=wechat`);
        const sidebar = page.getByRole('complementary', { name: 'AI 建议补充' });
        await sidebar.getByText('确认活动日期').waitFor();
        assert.equal(await sidebar.getByText('补充活动地点').count(), 1);
        assert.equal(await sidebar.getByText('后来改选的文章').count(), 0, 'a later selection is not attributed to the existing draft');
        await sidebar.getByRole('button', { name: '校园交流范例' }).click();
        const reference = page.getByRole('complementary', { name: '参考文章' });
        await reference.getByText('测试公众号').waitFor();
        const iframe = reference.locator('iframe');
        assert.equal(await iframe.getAttribute('sandbox'), '');
        await iframe.contentFrame().getByText('这是一篇参考推文的原文。').waitFor();
        assert.equal(await page.evaluate(() => Boolean(window.__unsafe)), false);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        if (width >= 1250) {
          const mainBox = await page.locator('.news-document-main').boundingBox();
          const sidebarBox = await sidebar.boundingBox(), refBox = await reference.boundingBox();
          assert.ok(mainBox.x + mainBox.width <= sidebarBox.x + 1 && sidebarBox.x + sidebarBox.width <= refBox.x + 1,
            'desktop reference panel must be a separate right column');
        }
        await page.screenshot({ path: path.join(output, `news-insights-${width}.png`) });
        await reference.getByRole('button', { name: '关闭参考文章' }).click();
        assert.equal(await reference.count(), 0);
        assert.ok(await page.getByRole('textbox', { name: '正文段落 1', exact: true }).isVisible());
        await page.reload();
        await sidebar.getByRole('button', { name: '校园交流范例' }).waitFor();
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ width, sidebar: true, recordedReference: true, safePreview: true }));
      } finally { await context.close(); }
    }
    const old = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await old.addInitScript(() => { if (window !== window.top) return; localStorage.setItem('mamage.aiNewsWriter.draft.v2:900003:900003', JSON.stringify({
        channelContent: { wechat_article: { title: '旧稿', markdownText: '# 旧稿\n\n旧正文', photos: [], extra: {} } },
        activeChannelKey: 'wechat_article', selectedChannels: ['wechat_article'],
        formValues: { monitorReferences: [{ id: 771, revisionId: 1, title: '校园交流范例' }] },
      })); });
      await old.goto(`http://127.0.0.1:${server.address().port}/?channel=wechat`);
      const sidebar = old.getByRole('complementary', { name: 'AI 建议补充' });
      await sidebar.getByText('此稿未记录参考文章').waitFor();
      assert.equal(await sidebar.getByRole('button', { name: '校园交流范例' }).count(), 0);
    } finally { await old.close(); }
    const noMatch = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await noMatch.addInitScript(() => { if (window !== window.top) return; localStorage.setItem('mamage.aiNewsWriter.draft.v2:900003:900003', JSON.stringify({
        channelContent: { wechat_article: { title: '无参考稿', markdownText: '# 无参考稿\n\n正文', photos: [], extra: {}, references: [], referenceStatus: 'no_match' } },
        activeChannelKey: 'wechat_article', selectedChannels: ['wechat_article'], formValues: {},
      })); });
      await noMatch.goto(`http://127.0.0.1:${server.address().port}/?channel=wechat`);
      const references = noMatch.getByRole('region', { name: '文本参考' });
      await references.getByText('暂未匹配到合适的参考文章').waitFor();
      assert.equal((await references.innerText()).includes('0'), false);
    } finally { await noMatch.close(); }
    const recover = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await recover.addInitScript(() => { if (window !== window.top) return; localStorage.setItem('mamage.aiNewsWriter.draft.v2:900003:900003', JSON.stringify({
        channelContent: { wechat_article: { title: '旧稿', markdownText: '# 旧稿\n\n旧正文', photos: [], extra: {}, sourceJobId: 777 } },
        activeChannelKey: 'wechat_article', selectedChannels: ['wechat_article'], formValues: {},
      })); });
      await recover.goto(`http://127.0.0.1:${server.address().port}/?channel=wechat`);
      await recover.getByRole('complementary', { name: 'AI 建议补充' }).getByRole('button', { name: '校园交流范例' }).waitFor();
    } finally { await recover.close(); }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
