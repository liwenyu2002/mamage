const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer, output, root } = require('./serve-news-usability.cjs');
const { chromium } = createRequire(path.join(root, '../server/package.json'))('playwright');

async function main() {
  const live = process.env.MAMAGE_NEWS_BACKEND_TEST === '1';
  const config = require('../webpack.config')({}, { mode: 'development' });
  await new Promise((resolve, reject) => require('webpack')({ ...config, context: root, entry: './scripts/fixtures/news-usability.jsx',
    devtool: false, output: { ...config.output, path: path.join(output, 'dist') }, optimization: { splitChunks: false } }, (error, stats) =>
    error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  let server;
  if (!live) { server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); }
  const base = live ? 'http://127.0.0.1:5192' : `http://127.0.0.1:${server.address().port}`;
  if (live) {
    assert.equal((await (await fetch(`${base}/__news-qa/config`)).json()).liveBackend, true);
    assert.equal((await (await fetch(`${base}/api/health/ready`)).json()).sandbox, true);
  }
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      try {
        await context.addInitScript(() => localStorage.setItem('mamage.wechat.content-template-job:900003:900003', JSON.stringify({
          pending: { clientRequestId: 'older-pending-template-request', material: '旧的材料' },
        })));
        const page = await context.newPage(), structureRequests = [], errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (/\/api\/wechat-compositions\/content-template(?:\/|$)/.test(new URL(request.url()).pathname)) structureRequests.push(request.url()); });
        await page.goto(`${base}/?channel=wechat`);
        const material = page.getByRole('textbox', { name: '详细信息补充', exact: true });
        await material.waitFor();
        assert.equal(await page.getByRole('button', { name: 'AI 生成结构', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: '采用结构', exact: true }).count(), 0);
        assert.equal(await page.getByRole('checkbox', { name: '预留初审、终审署名' }).isVisible(), false);
        const choices = page.locator('.news-draft-choices');
        assert.equal(await choices.getByRole('button', { name: '选择参考文章' }).count(), 1);
        assert.equal(await choices.getByRole('button', { name: '文章类型' }).count(), 1);
        await page.screenshot({ path: path.join(output, `wechat-draft-setup-${live ? 'live' : 'fixture'}-${width}.png`), fullPage: true });
        await choices.getByRole('button', { name: '选择参考文章' }).click();
        const dialog = page.getByRole('dialog').filter({ hasText: '选择参考文章' });
        await dialog.locator('input[type=checkbox]:not(:disabled)').first().check();
        await dialog.getByRole('button', { name: '使用参考', exact: true }).click();
        await choices.getByRole('button', { name: '文章类型' }).click();
        await page.getByRole('option', { name: '讲座交流', exact: true }).click();
        await material.fill('青禾实验中学10月25日在报告厅举行人工智能主题交流，同学展示了项目，教师现场点评。只写已确认内容，不编人数和发言。');
        const draftKey = 'mamage.aiNewsWriter.draft.v2:900003:900003';
        await page.waitForFunction(key => {
          const form = JSON.parse(localStorage.getItem(key) || '{}').formValues;
          return form?.contentTemplate === 'lecture' && form?.monitorReferences?.length === 1 && form?.sourceMaterial?.includes('青禾实验中学');
        }, draftKey);
        await page.reload();
        await choices.getByRole('button', { name: '文章类型' }).getByText('讲座交流', { exact: true }).waitFor();
        assert.match(await material.inputValue(), /青禾实验中学/);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        let submitted;
        if (live) {
          const response = page.waitForResponse(response => response.url().endsWith('/api/ai/news/generate/batch') && response.request().method() === 'POST');
          await page.getByRole('button', { name: '生成初稿', exact: true }).click();
          const request = await response;
          assert.equal(request.status(), 202); submitted = request.request().postDataJSON();
        } else await page.getByRole('button', { name: '生成初稿', exact: true }).click();
        await page.getByRole('textbox', { name: '稿件标题', exact: true }).waitFor({ timeout: 90000 });
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').batchStatus === 'succeeded', draftKey, { timeout: 90000 });
        const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), draftKey);
        if (submitted) {
          assert.equal(submitted.form.contentTemplate, 'lecture');
          assert.equal(submitted.form.monitorReferences.length, 1);
          assert.match(submitted.referenceArticle, /写法综述/);
        }
        assert.ok(saved.channelContent.wechat_article.markdownText.trim());
        assert.equal(structureRequests.length, 0, 'neither a new nor old structure job is submitted or polled');
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ width, liveBackend: live, twoChoices: true, refreshPreserved: true, generated: true, noStructureTask: true }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
