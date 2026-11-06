// 推文编辑流程回归：自动保存可见、样式步骤主按钮可见、排版稿导出入口可见、手机端样式抽屉可关闭。
// 先运行 test-news-gallery-browser.cjs 生成共享的 gallery-dist 产物。
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer, output } = require('./serve-news-usability.cjs');
const { chromium } = createRequire(path.join(__dirname, '../../server/package.json'))('playwright');

const inViewport = async (page, locator) => {
  const box = await locator.boundingBox();
  const height = page.viewportSize().height;
  return Boolean(box) && box.y >= 0 && box.y + box.height <= height + 1;
};

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
      // 内容稿：自动保存状态可见，图片数量不再误导为 0 张
      await page.locator('.wechat-autosave').waitFor();
      assert.match(await page.locator('.wechat-autosave').innerText(), /自动保存/);
      assert.match(await page.locator('body').innerText(), /稿件内 \d+ 张图/);
      await page.getByRole('button', { name: '确认内容，选择样式', exact: true }).click();
      // 样式步骤：模板名可见 + 主按钮 sticky 在视口内
      await page.locator('.wechat-layout-templates button .wechat-template-name').first().waitFor();
      const apply = page.getByRole('button', { name: '应用模板，生成排版稿', exact: true });
      assert.equal(await inViewport(page, apply), true, `${width}: 样式步骤主按钮应在首屏可见`);
      await apply.click();
      await page.locator('.cve-canvas').waitFor();
      // 排版稿：导出入口在顶部首屏可见（guided 流程把导出卡提前）
      const copy = page.getByRole('button', { name: '复制到公众号', exact: true });
      assert.equal(await inViewport(page, copy), true, `${width}: 排版稿导出入口应在首屏可见`);
      assert.match(await page.locator('.wechat-autosave').innerText(), /自动保存/);
      // 内容稿修改后确认：默认把改动同步进现有排版稿（保留样式），而不是要求重排
      await page.locator('.wechat-workflow-bar nav button').filter({ hasText: '内容草稿' }).click();
      const paragraph = page.locator('.news-edit-document [role="textbox"]').filter({ hasText: '这是一份用于检查配图排版' }).first();
      await paragraph.click();
      await page.keyboard.type(' 同步测试');
      await page.waitForTimeout(250);
      await page.getByRole('button', { name: '确认内容，选择样式', exact: true }).click();
      const syncDialog = page.getByRole('dialog', { name: '内容稿有改动，如何应用到排版稿？' });
      await syncDialog.waitFor();
      await page.getByRole('button', { name: '同步到现有排版稿', exact: true }).click();
      await page.locator('.cve-canvas').waitFor();
      await page.waitForTimeout(400);
      assert.match(await page.locator('.cve-canvas').innerText(), /同步测试/);
      assert.equal(await page.locator('.wechat-workflow-bar nav button').filter({ hasText: '选择样式' }).isDisabled(), false);
      // 内容没改时确认不应再弹同步框，直接进入选择样式
      await page.locator('.wechat-workflow-bar nav button').filter({ hasText: '内容草稿' }).click();
      await page.getByRole('button', { name: '确认内容，选择样式', exact: true }).click();
      await page.waitForTimeout(300);
      assert.equal(await page.getByRole('dialog', { name: '内容稿有改动，如何应用到排版稿？' }).count(), 0);
      assert.equal(await page.locator('.wechat-layout-selection').isVisible(), true);
      // 排版稿改字后回到内容稿：文字应自动回写，且确认时不再要求重排
      await page.locator('.wechat-workflow-bar nav button').filter({ hasText: '排版稿' }).click();
      await page.locator('.cve-canvas [contenteditable="true"]').first().click();
      await page.keyboard.type(' 回写测试');
      await page.locator('#wxc-title-input').click();
      await page.waitForTimeout(250);
      await page.locator('.wechat-workflow-bar nav button').filter({ hasText: '内容草稿' }).click();
      await page.waitForTimeout(300);
      await page.getByText('排版稿有未回写的文字改动。').first().waitFor();
      await page.getByRole('button', { name: '同步回内容稿', exact: true }).click();
      await page.waitForTimeout(400);
      assert.match(await page.locator('body').innerText(), /回写测试/);
      await page.getByRole('button', { name: '确认内容，选择样式', exact: true }).click();
      await page.waitForTimeout(300);
      assert.equal(await page.getByRole('dialog', { name: '内容稿有改动，如何应用到排版稿？' }).count(), 0);
      assert.equal(await page.locator('.wechat-layout-selection').isVisible(), true);
      // 回到排版稿，准备手机端抽屉断言
      await page.locator('.wechat-workflow-bar nav button').filter({ hasText: '排版稿' }).click();
      // 手机端样式抽屉：打开后必须能通过关闭键/Esc 退出
      if (width < 600) {
        await page.locator('.wxc-lib-toggle-mobile').click();
        await page.locator('.wxc-side-lib.is-open').waitFor();
        await page.locator('.wxc-side-close').click();
        await page.locator('.wxc-side-lib.is-open').waitFor({ state: 'detached' });
        await page.locator('.wxc-lib-toggle-mobile').click();
        await page.locator('.wxc-side-lib.is-open').waitFor();
        await page.keyboard.press('Escape');
        await page.locator('.wxc-side-lib.is-open').waitFor({ state: 'detached' });
      }
      // 撤销栈持久化：刷新后仍能撤销排版稿改动
      await page.locator('.wechat-workflow-bar nav button').filter({ hasText: '排版稿' }).click();
      await page.locator('.cve-canvas [contenteditable="true"]').first().click();
      await page.keyboard.type(' 撤销测试');
      await page.locator('#wxc-title-input').click();
      await page.waitForTimeout(900);
      await page.reload();
      await page.locator('.cve-canvas').waitFor();
      await page.waitForTimeout(700);
      const undo = page.getByRole('button', { name: '撤销', exact: true });
      assert.equal(await undo.isDisabled(), false, `${width}: 刷新后撤销应可用`);
      await undo.click();
      await page.waitForTimeout(300);
      assert.equal((await page.locator('.cve-canvas').innerText()).includes('撤销测试'), false, `${width}: 撤销应回退刷新前的编辑`);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(JSON.stringify({ passed: true }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
