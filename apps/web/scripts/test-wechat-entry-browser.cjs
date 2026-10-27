const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module');
const { createServer, root } = require('./serve-news-usability.cjs');
const { chromium } = createRequire(path.join(root, '../server/package.json'))('playwright');
const output = path.resolve(root, '../../.local/wechat-entry-qa');
const manualKey = 'wechat-composer-draft.v2:900003:900003';
const aiKey = `${manualKey}:ai`;
const old = { id: 401, name: '原有推文', title: '原有推文标题', draftKind: 'layout',
  doc: [{ uid: 'old-paragraph', kind: 'para', html: '原有正文不能丢失。' }], updatedAt: new Date().toISOString() };

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const config = require('../webpack.config')({}, { mode: 'development' });
  await new Promise((resolve, reject) => require('webpack')({ ...config, context: root,
    entry: './scripts/fixtures/news-usability.jsx', devtool: false,
    output: { ...config.output, path: path.join(output, 'dist') }, optimization: { splitChunks: false } }, (error, stats) =>
    error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const server = createServer({ distDirectory: path.join(output, 'dist') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 960 } }), page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(old => {
          if (!sessionStorage.getItem('entry-seeded')) {
            localStorage.setItem('news-usability-fixture:900003:900003:backups', JSON.stringify([old]));
            localStorage.setItem('wechat-composer-draft', JSON.stringify({ title: '旧版未保存推文', markdown: '保留旧版未保存的正文。' }));
            sessionStorage.setItem('entry-seeded', '1');
          }
        }, old);
        await page.goto(base + '/?channel=wechat&entry=library');
        const create = page.getByRole('button', { name: '新建推文', exact: true });
        await create.waitFor();
        await page.getByTitle('打开「原有推文」', { exact: true }).click();
        assert.equal(await page.locator('#wxc-title-input').inputValue(), old.title);
        await page.getByRole('button', { name: '← 文件管理', exact: true }).click();
        await create.click();
        const chooser = page.getByRole('dialog', { name: '新建推文', exact: true });
        await chooser.waitFor();
        assert.equal(await chooser.getByRole('button', { name: 'AI 工作流', exact: true }).count(), 1);
        assert.equal(await chooser.getByRole('button', { name: '自定义编辑台', exact: true }).count(), 1);
        assert.ok(await chooser.locator('svg').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().width <= 24)));
        await page.screenshot({ path: path.join(output, `choose-${width}.png`), fullPage: true });
        await chooser.getByRole('button', { name: '自定义编辑台', exact: true }).click();
        await page.locator('#wxc-title-input').fill('手动创建的推文');
        await page.getByRole('button', { name: '保存到文件', exact: true }).click();
        await page.getByRole('dialog', { name: '保存推文文件', exact: true }).getByRole('button', { name: '保存', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('.wxc-dirty-dot'));
        await page.getByRole('button', { name: '← 文件管理', exact: true }).click();
        await page.getByTitle('打开「手动创建的推文」', { exact: true }).waitFor();
        const manual = { v: 4, openId: old.id, title: '自定义草稿保持', doc: old.doc, digest: '' };
        await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: manualKey, value: manual });
        await create.click();
        await chooser.getByRole('button', { name: 'AI 工作流', exact: true }).click();
        await page.getByRole('textbox', { name: '详细信息补充', exact: true }).fill('学校举行学生实践交流，学生分享项目过程，老师现场点评。');
        await page.getByRole('button', { name: '生成初稿', exact: true }).click();
        await page.getByRole('textbox', { name: '稿件标题', exact: true }).waitFor();
        await page.getByRole('button', { name: '确认内容，选择样式', exact: true }).click();
        await page.getByRole('button', { name: '应用模板，生成排版稿', exact: true }).click();
        await page.locator('#wxc-title-input').waitFor();
        assert.equal(await page.locator('#wxc-title-input').inputValue(), '学生分享实践项目 师生交流推进思路');
        assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), manualKey), manual,
          'AI layout must not overwrite the independent custom-editor draft');
        assert.ok(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).doc.length > 0, aiKey));
        await page.reload();
        await page.locator('#wxc-title-input').waitFor();
        await page.getByRole('button', { name: '推文列表', exact: true }).click();
        await create.waitFor();
        await page.getByTitle('打开「原有推文」', { exact: true }).waitFor();
        await page.getByTitle('打开「手动创建的推文」', { exact: true }).waitFor();
        await page.getByRole('button', { name: '导入本机旧草稿', exact: true }).click();
        await page.getByRole('dialog', { name: '导入本机旧草稿？', exact: true }).getByRole('button', { name: '确认导入', exact: true }).click();
        assert.equal(await page.locator('#wxc-title-input').inputValue(), '旧版未保存推文');
        assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('wechat-composer-draft')).markdown.includes('未保存')));
        assert.deepEqual(errors, []);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        console.log(JSON.stringify({ width, originalEntry: true, customSaved: true, aiWorkflow: true,
          independentDrafts: true, reloadAndReturn: true, legacyDraftRetained: true }));
      } catch (error) {
        await page.screenshot({ path: path.join(output, `failure-${width}.png`), fullPage: true });
        console.error(JSON.stringify({ width, dialogs: await page.getByRole('dialog').allTextContents(), errors }));
        throw error;
      } finally { await context.close(); }
    }
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
