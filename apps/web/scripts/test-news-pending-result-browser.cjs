// AI 生成期间手改草稿：结果不得静默覆盖，应进入「待采用」，可选择采用或保留修改。
// 先运行 test-news-gallery-browser.cjs 生成共享的 gallery-dist 产物。
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer, output } = require('./serve-news-usability.cjs');
const { chromium } = createRequire(path.join(__dirname, '../../server/package.json'))('playwright');

const titleValue = page => page.getByRole('textbox', { name: '稿件标题', exact: true }).innerText();

(async () => {
  const server = createServer({ distDirectory: path.join(output, 'gallery-dist') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/?channel=wechat`;
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 960 }, hasTouch: width < 600 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      await page.waitForTimeout(1200);
      await page.evaluate(() => { window.__newsQaTaskSubmitDelay = 1500; });
      await page.getByRole('button', { name: '补充材料 / 重新生成', exact: true }).click();
      await page.getByRole('button', { name: '重新生成', exact: true }).click();
      await page.getByRole('textbox', { name: '稿件标题', exact: true }).fill('生成期间手改标题');
      await page.getByText(/AI 生成结果待采用/).first().waitFor({ timeout: 30000 });
      assert.equal(await titleValue(page), '生成期间手改标题', `${width}: 结果不得覆盖生成期间的手改`);
      await page.getByRole('button', { name: '保留我的修改', exact: true }).click();
      await page.getByText(/AI 生成结果待采用/).first().waitFor({ state: 'detached' });
      assert.equal(await titleValue(page), '生成期间手改标题', `${width}: 保留修改后标题不变`);

      // 第二次：采用生成结果（材料面板可能仍开着，避免重复点击把它收起）
      await page.evaluate(() => { window.__newsQaTaskSubmitDelay = 1200; });
      if (await page.getByRole('button', { name: '补充材料 / 重新生成', exact: true }).count()) {
        await page.getByRole('button', { name: '补充材料 / 重新生成', exact: true }).click();
      }
      await page.getByRole('button', { name: '重新生成', exact: true }).click();
      await page.getByRole('textbox', { name: '稿件标题', exact: true }).fill('第二次手改');
      await page.getByText(/AI 生成结果待采用/).first().waitFor({ timeout: 30000 });
      await page.getByRole('button', { name: '采用生成结果', exact: true }).click();
      await page.getByText(/AI 生成结果待采用/).first().waitFor({ state: 'detached' });
      assert.notEqual(await titleValue(page), '第二次手改', `${width}: 采用后应换成生成结果标题`);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(JSON.stringify({ passed: true }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
