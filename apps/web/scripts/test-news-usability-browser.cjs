const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer, output, root } = require('./serve-news-usability.cjs');
const { chromium } = createRequire(path.join(root, '../server/package.json'))('playwright');
const draftKey = 'mamage.aiNewsWriter.draft.v2:900003:900003';
const layoutKey = 'wechat-composer-draft.v2:900003:900003:ai';
const textValue = locator => locator.evaluate(element => 'value' in element ? element.value : element.textContent);

async function selectText(page, first, start, last = first, end = start) {
  await first.scrollIntoViewIfNeeded();
  const a = await first.elementHandle(), b = await last.elementHandle();
  await page.evaluate(({ a, b, start, end }) => {
    a.closest('.ProseMirror').focus({ preventScroll: true });
    const range = document.createRange(); range.setStart(a.firstChild || a, start); range.setEnd(b.firstChild || b, end);
    const native = getSelection(); native.removeAllRanges(); native.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { a, b, start, end });
  await page.waitForTimeout(180);
  await page.keyboard.press('Shift');
  if (first === last && start === end) await openBlockAI(page, first);
  else await page.getByRole('dialog', { name: 'AI 就地改稿', exact: true }).waitFor();
}

async function openBlockAI(page, block) {
  const index = Number(await block.getAttribute('data-news-index'));
  const handle = page.getByRole('button', { name: `编辑第 ${index + 1} 个内容块`, exact: true });
  await handle.hover(); await handle.click();
  await page.getByRole('dialog', { name: '段落操作', exact: true }).getByRole('button', { name: 'AI 辅助', exact: true }).click();
  await page.getByRole('dialog', { name: 'AI 就地改稿', exact: true }).waitFor();
}

async function resumeAi(page) {
  if (!await page.getByRole('dialog', { name: 'AI 就地改稿', exact: true }).isVisible()) {
    await page.getByRole('button', { name: /^(查看修改建议|AI 修改中|补充材料)$/ }).click();
  }
}

async function waitForTitle(page, value) {
  await page.waitForFunction(value => {
    const field = [...document.querySelectorAll('[aria-label="稿件标题"]')].find(element => element.offsetParent !== null);
    return field && ('value' in field ? field.value : field.textContent) === value;
  }, value);
}

async function seedDraftOnReload(page, key, draft) {
  const marker = `news-qa-seed-${Date.now()}-${Math.random()}`;
  await page.addInitScript(({ key, draft, marker }) => {
    if (sessionStorage.getItem(marker)) return;
    localStorage.setItem(key, JSON.stringify(draft)); sessionStorage.setItem(marker, '1');
  }, { key, draft, marker });
  await page.reload();
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const config = require('../webpack.config')({}, { mode: 'development' });
  await new Promise((resolve, reject) => require('webpack')({ ...config, context: root, entry: './scripts/fixtures/news-usability.jsx',
    devtool: false, output: { ...config.output, path: path.join(output, 'dist') }, optimization: { splitChunks: false } }, (error, stats) =>
    error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP mamage.test 127.0.0.1', '--no-proxy-server'] });
  const cases = [];
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, permissions: ['clipboard-read', 'clipboard-write'] });
      const errors = [], writes = [];
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      // The fixture has no real API. Observe model submissions without allowing a production request.
      await page.addInitScript(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key.startsWith('news-usability-fixture:')) {
            const calls = JSON.parse(sessionStorage.getItem('fixture-writes') || '[]');
            calls.push(JSON.parse(value).payload);
            original.call(sessionStorage, 'fixture-writes', JSON.stringify(calls));
          }
          return original.call(this, key, value);
        };
      });
      const snapshot = async name => {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: viewport overflow`);
        await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
      };
      try {
        await page.goto(base);
        const material = page.getByRole('textbox', { name: /^(写作材料|详细信息补充)$/ });
        await material.waitFor();
        assert.equal(await page.locator('.news-result-pane').isVisible(), false);
        assert.equal(await page.getByRole('textbox').count(), 1, 'only one required material field is shown');
        await snapshot('start');
        await page.getByRole('button', { name: '生成初稿', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: '再补几句' }).waitFor();
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '写作材料');

        await page.evaluate(() => { window.__newsQaFailAlbumRead = true; });
        await page.getByRole('button', { name: '添加活动照片', exact: true }).click();
        await page.getByRole('dialog').getByRole('alert').waitFor();
        await page.getByRole('dialog').getByRole('button', { name: '重试', exact: true }).click();
        await page.getByRole('button', { name: /学生实践交流/ }).waitFor();
        await page.getByRole('dialog').getByRole('textbox', { name: '搜索活动相册', exact: true }).fill('过期');
        await page.waitForFunction(() => window.__newsQaDelayedRead === true);
        await page.getByRole('dialog').getByRole('button', { name: '中转站', exact: true }).click();
        await page.waitForTimeout(800);
        assert.equal(await page.getByRole('dialog').getByRole('button', { name: /学生实践交流/ }).count(), 0, 'aborted album reads cannot replace a newer source');
        await page.getByRole('dialog').getByRole('button', { name: '相册', exact: true }).click();
        await page.getByRole('button', { name: /学生实践交流/ }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: '选择照片 9201', exact: true }).waitFor();
        assert.equal(await dialog.getByRole('button', { name: '选择照片 9211', exact: true }).count(), 0, 'video is excluded');
        await dialog.getByRole('button', { name: '选择本页', exact: true }).click();
        await dialog.getByRole('status').filter({ hasText: '30 / 30' }).waitFor();
        await dialog.getByRole('button', { name: '加载更多', exact: true }).click();
        await dialog.getByRole('button', { name: '选择照片 9241', exact: true }).waitFor();
        await dialog.getByRole('button', { name: '选择照片 9241', exact: true }).click();
        assert.equal(await dialog.locator('.news-picker-photo[aria-pressed="true"]').count(), 30);
        await dialog.getByRole('button', { name: '清空选择', exact: true }).click();
        await dialog.getByRole('button', { name: '选择照片 9201', exact: true }).click();
        await dialog.getByRole('button', { name: '选择照片 9202', exact: true }).click();
        await snapshot('photos');
        await dialog.getByRole('button', { name: '使用所选照片', exact: true }).click();
        await page.locator('.news-event-context').getByText('学生实践交流').waitFor();
        await page.getByRole('button', { name: '生成初稿', exact: true }).click();
        assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-writes') || '[]').length), 0, 'photos/album title do not substitute for facts');
        await material.fill('今天在报告厅举行学生实践交流，同学介绍项目，教师点评。重点写交流过程。');
        await snapshot('materials');
        await page.getByRole('button', { name: '生成初稿', exact: true }).dblclick();
        await page.getByText('后台生成中', { exact: true }).waitFor();
        await page.waitForFunction(key => Boolean(JSON.parse(localStorage.getItem(key) || '{}').batchId), draftKey);
        await page.reload();
        await page.getByRole('textbox', { name: '稿件标题', exact: true }).waitFor();
        writes.push(...await page.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-writes') || '[]')));
        assert.equal(writes.length, 1, 'refresh and double-click must not enqueue another generation');
        assert.deepEqual(writes[0].form.confirmedParticipantNames, []);
        assert.deepEqual(writes[0].channels, ['press_release']);
        assert.equal(writes[0].selectedPhotos.length, 2);
        assert.equal(await material.isVisible(), false, 'material collapses after generation');
        assert.equal(await page.getByText('段落与来源', { exact: true }).count(), 0, 'the old paragraph panel is removed');
        await page.getByRole('complementary', { name: 'AI 建议补充' }).waitFor();
        await page.locator('.news-edit-photo img').first().evaluate(image => image.decode());
        assert.equal(await page.locator('.news-edit-photo img').first().evaluate(image => image.naturalWidth > 0), true);
        await snapshot('news-draft');
        await page.getByRole('tab', { name: '编辑', exact: true }).click();
        await page.getByRole('textbox', { name: '稿件标题', exact: true }).fill('人工修改的标题');
        await page.getByRole('textbox', { name: '正文段落 1', exact: true }).fill('人工确认：学生在报告厅展示实践成果，教师参与交流。');
        await page.getByRole('textbox', { name: '图片说明', exact: true }).first().fill('人工确认的活动现场');
        assert.equal(await page.getByRole('textbox', { name: '稿件正文', exact: true }).isVisible(), false, 'source is optional, not the main editor');
        await snapshot('news-edit');
        await page.getByRole('button', { name: '补充材料 / 重新生成', exact: true }).click();
        await material.fill('学生在报告厅交流，教师点评，补充报道重点：实践过程。');
        await page.getByRole('button', { name: '重新生成', exact: true }).click();
        assert.equal(await textValue(page.getByRole('textbox', { name: '稿件标题', exact: true })), '人工修改的标题', 'old edits remain visible during regeneration');
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').channelContent?.press_release?.history?.[0]?.title === '人工修改的标题', draftKey);
        await page.getByRole('textbox', { name: '稿件标题', exact: true }).fill('人工修改的标题');

        // Switch immediately, inside the autosave debounce window.
        await page.getByRole('button', { name: '公众号图文', exact: true }).click();
        await page.getByRole('heading', { name: '公众号内容稿', exact: true }).waitFor();
        await material.waitFor();
        assert.match(await material.inputValue(), /补充报道重点/);
        const shared = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), draftKey);
        assert.equal(shared.channelContent.press_release.title, '人工修改的标题');
        await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ messages: [
          { role: 'user', text: '内容太简短了' }, { role: 'user', text: '要写什么学校' },
        ] })), `${draftKey}:wechat_article:chat`);
        await page.getByRole('button', { name: '生成初稿', exact: true }).click();
        await page.getByRole('button', { name: '确认内容，选择样式', exact: true }).waitFor();
        await page.getByRole('button', { name: '复制正文', exact: true }).click();
        await page.getByText('已复制正文', { exact: true }).waitFor();
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        assert.equal(copied.split('学生分享实践项目 师生交流推进思路').length - 1, 1, 'export contains the title once');
        const nav = page.locator('.wechat-workflow-bar nav');
        assert.equal(await nav.getByRole('button', { name: /选择样式/ }).isDisabled(), true, 'confirm content before selecting styles');
        await snapshot('wechat-draft');

        // Dialogue produces a proposal, never an unsolicited content overwrite. Reload recovers its task.
        const firstParagraph = page.getByRole('textbox', { name: '正文段落 1', exact: true });
        assert.equal(await page.getByRole('button', { name: '编辑动作', exact: true }).count(), 0);
        assert.equal(await page.getByText('和 AI 改稿', { exact: true }).count(), 0);
        await firstParagraph.click();
        await openBlockAI(page, firstParagraph);
        await page.getByRole('dialog', { name: 'AI 就地改稿', exact: true }).waitFor();
        assert.equal(await page.locator('.news-chat-message').count(), 0, 'the popup never renders a conversation transcript');
        assert.equal(await page.getByText('内容太简短了', { exact: true }).count(), 0, 'legacy conversation history is not resurrected');
        assert.equal(await page.getByText('要写什么学校', { exact: true }).count(), 0);
        await page.waitForTimeout(400);
        const beforeChat = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).channelContent.wechat_article.markdownText, draftKey);
        await page.evaluate(() => { window.__newsQaTaskSubmitDelay = 450; });
        await page.getByRole('textbox', { name: '改稿要求', exact: true }).fill('导语简短一点，保留所有图片。');
        await page.getByRole('button', { name: '发送', exact: true }).dblclick();
        await page.getByRole('status').filter({ hasText: '后台改稿中' }).waitFor();
        await page.waitForFunction(() => Object.keys(localStorage).some(key => key.includes(':revision:')));
        assert.equal(await page.evaluate(() => Boolean(window.__newsQaTaskEarlyPoll)), false, 'do not query a revision before its initial POST is acknowledged');
        await page.reload();
        await resumeAi(page);
        await page.getByRole('button', { name: '采用修改', exact: true }).waitFor();
        assert.equal(await page.locator('.news-chat-comparison-label').getByText('原文', { exact: true }).count(), 1);
        assert.equal(await page.locator('.news-chat-comparison-label').getByText('建议', { exact: true }).count(), 1);
        assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).channelContent.wechat_article.markdownText, draftKey), beforeChat);
        assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes(':revision:')).length), 1);
        await snapshot('wechat-chat');
        await page.getByRole('textbox', { name: '改稿要求', exact: true }).fill('在这版建议上再简短一点。');
        await page.getByRole('button', { name: '继续调整', exact: true }).click();
        await page.getByRole('status').filter({ hasText: '后台改稿中' }).waitFor();
        await page.getByRole('button', { name: '采用修改', exact: true }).waitFor();
        const roundTwo = await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes(':revision:'))
          .map(key => JSON.parse(localStorage.getItem(key))).find(item => item.payload.instruction.includes('这版建议')));
        assert.equal(roundTwo.payload.source.blocks.find(block => block.type === 'paragraph').text, '学生围绕实践项目分享进展，教师与同学交流。', 'follow-up is based on the latest unaccepted proposal');
        await page.getByRole('button', { name: '采用修改', exact: true }).click();
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).channelContent.wechat_article.history?.[0]?.markdownText.includes('学校在报告厅'), draftKey);
        await page.getByRole('button', { name: '撤销编辑', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.news-edit-paragraph')?.textContent.includes('学校在报告厅'));
        await page.getByRole('button', { name: '重做编辑', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.news-edit-paragraph')?.textContent.includes('学生围绕实践项目'));
        await page.getByRole('tab', { name: '编辑', exact: true }).click();
        assert.match(await textValue(page.getByRole('textbox', { name: '正文段落 1', exact: true })), /学生围绕实践项目/);
        assert.equal(await page.locator('.news-edit-photo').count(), 2);
        await firstParagraph.click();
        await openBlockAI(page, firstParagraph);
        await page.getByRole('textbox', { name: '改稿要求', exact: true }).fill('语气再自然一点。');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        const freshRequest = await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes(':revision:'))
          .map(key => JSON.parse(localStorage.getItem(key)).payload).find(payload => payload.instruction === '语气再自然一点。'));
        assert.deepEqual(freshRequest.conversation, [], 'a new edit does not inherit instructions from earlier edits');
        await page.getByRole('textbox', { name: '正文段落 1', exact: true }).fill('手动修改的新版本，不能被旧建议覆盖。');
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').channelContent?.wechat_article?.markdownText.includes('手动修改的新版本'), draftKey);
        await resumeAi(page);
        await page.getByRole('button', { name: '采用修改', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '采用修改', exact: true }).isDisabled(), true);
        await page.getByRole('button', { name: '放弃建议', exact: true }).click();
        await page.getByRole('textbox', { name: '图片说明', exact: true }).first().click();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '编辑第 4 个内容块', exact: true }).click();
        await page.getByRole('button', { name: '上移内容块 4', exact: true }).click();
        await page.getByRole('button', { name: '备份内容稿', exact: true }).click();
        await page.getByText('内容稿已备份', { exact: true }).waitFor();

        const oldLayout = { title: '先前排版稿', markdown: '# 先前排版稿\n\n保留的旧内容。', digest: '旧稿摘要', meta: { author: '旧稿作者' }, openId: null };
        await page.evaluate(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)), { key: layoutKey, draft: oldLayout });
        await page.getByRole('button', { name: '确认内容，选择样式', exact: true }).click();
        await page.getByRole('heading', { name: '选择样式', exact: true }).waitFor();
        const frozen = await page.evaluate(() => JSON.parse(localStorage.getItem('mamage.wechat.workflow.v1:900003:900003')).confirmed);
        assert.equal(frozen.source.doc.some(block => block.blockId || block.accent), false);
        await snapshot('wechat-styles');
        await page.getByRole('button', { name: '应用模板，生成排版稿', exact: true }).click();
        await page.locator('#wxc-title-input').waitFor();
        assert.equal(await page.locator('#wxc-title-input').inputValue(), '学生分享实践项目 师生交流推进思路');
        assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), `${layoutKey}:previous`), oldLayout);
        assert.equal(await page.locator('#wxc-digest-input').inputValue(), '', 'old summary must not leak into a new article');
        const styled = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), layoutKey);
        assert.deepEqual(styled.doc.map(({ blockId, accent, ...block }) => block), frozen.source.doc, 'applying a template preserves exact content, order and images');
        await snapshot('wechat-layout');
        await page.locator('#wxc-title-input').fill('排版稿单独编辑标题');
        await page.getByRole('button', { name: '备份排版稿', exact: true }).click();
        await page.getByText('排版稿已备份', { exact: true }).waitFor();
        await nav.getByRole('button', { name: /内容草稿/ }).click();
        assert.equal(await textValue(page.getByRole('textbox', { name: '稿件标题', exact: true })), '学生分享实践项目 师生交流推进思路');
        await page.getByRole('textbox', { name: '稿件标题', exact: true }).fill('内容稿第二版');
        assert.equal(await nav.getByRole('button', { name: /选择样式/ }).isDisabled(), true);
        await page.getByRole('button', { name: '确认内容，选择样式', exact: true }).click();
        await page.getByRole('button', { name: 'AI 排版', exact: true }).click();
        await page.getByRole('textbox', { name: '排版风格描述', exact: true }).fill('清爽校园风，绿色点缀，保持正文内容不变。');
        await page.evaluate(() => { window.__wechatQaFailTask = true; });
        await page.getByRole('button', { name: 'AI 自动排版', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: '模拟模型失败' }).waitFor();
        assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).title, layoutKey), '排版稿单独编辑标题', 'failed AI layout cannot damage the prior styled draft');
        await page.evaluate(() => { window.__wechatQaFailTask = false; });
        await page.evaluate(() => { window.__newsQaTaskSubmitDelay = 450; });
        await page.getByRole('button', { name: 'AI 自动排版', exact: true }).dblclick();
        await page.waitForFunction(() => Object.keys(localStorage).filter(key => key.includes(':layout:')).length === 2);
        assert.equal(await page.evaluate(() => Boolean(window.__newsQaTaskEarlyPoll)), false, 'do not query a layout before its initial POST is acknowledged');
        await page.reload();
        await page.waitForFunction(() => document.getElementById('wxc-title-input')?.value === '内容稿第二版');
        assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes(':layout:')).length), 2);
        await snapshot('wechat-ai-layout');

        await page.getByRole('button', { name: '稿件备份', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: '恢复内容稿', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: '确认恢复', exact: true }).click();
        await waitForTitle(page, '学生分享实践项目 师生交流推进思路');
        assert.equal(await textValue(page.getByRole('textbox', { name: '稿件标题', exact: true })), '学生分享实践项目 师生交流推进思路');
        assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).title, layoutKey), '内容稿第二版', 'restoring content leaves styled draft intact');
        await page.getByRole('button', { name: '稿件备份', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: '排版稿', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: '恢复排版稿', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: '确认恢复', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('wxc-title-input')?.value === '排版稿单独编辑标题');
        await nav.getByRole('button', { name: /内容草稿/ }).click();
        assert.equal(await textValue(page.getByRole('textbox', { name: '稿件标题', exact: true })), '学生分享实践项目 师生交流推进思路', 'restoring styled draft leaves source intact');

        const paragraph = page.getByRole('textbox', { name: '正文段落 1', exact: true });
        await paragraph.click();
        await openBlockAI(page, paragraph);
        const sourceBeforePolish = await textValue(paragraph);
        const floating = page.getByRole('dialog', { name: 'AI 就地改稿', exact: true });
        await floating.waitFor();
        assert.equal(await floating.locator('.news-chat-presets button').count(), 5);
        const neutralColors = await floating.evaluate(element => [getComputedStyle(element).backgroundColor,
          getComputedStyle(element.querySelector('.news-chat-presets button')).color]);
        for (const color of neutralColors) {
          const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number);
          assert.equal(channels[0], channels[1], 'writer chrome has no green tint');
          assert.equal(channels[1], channels[2], 'writer chrome is neutral grayscale');
        }
        const bounds = await floating.boundingBox(), targetBounds = await paragraph.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
        assert.ok(Math.abs(bounds.y - targetBounds.y) < 500, 'popup is anchored near the text, not a separate page section');
        await page.getByRole('button', { name: '润色', exact: true }).click();
        await page.getByRole('button', { name: '采用修改', exact: true }).waitFor();
        assert.equal(await textValue(paragraph), sourceBeforePolish);
        await page.getByRole('button', { name: '采用修改', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.news-edit-paragraph')?.textContent.includes('学生围绕实践项目'));
        const beforeCompletion = await textValue(paragraph);
        await selectText(page, paragraph, 1);
        await page.getByRole('button', { name: '补全', exact: true }).click();
        await page.getByRole('button', { name: '采用修改', exact: true }).waitFor();
        await snapshot('context-completion');
        await page.getByRole('button', { name: '采用修改', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.news-edit-paragraph')?.textContent.includes('补全的衔接'));
        assert.equal(await textValue(paragraph), beforeCompletion.slice(0, 1) + '补全的衔接' + beforeCompletion.slice(1), 'completion preserves both sides of the caret');
        const completionRequest = await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes(':revision:'))
          .map(key => JSON.parse(localStorage.getItem(key)).payload).find(payload => payload.mode === 'complete'));
        assert.equal(completionRequest.target.start, 1);
        assert.ok(completionRequest.source.blocks.length >= 5, 'a one-character target still receives the entire document and photo captions');
        await paragraph.click();
        await openBlockAI(page, paragraph);
        await page.getByRole('button', { name: '补段落', exact: true }).click();
        await page.getByRole('button', { name: '采用修改', exact: true }).waitFor();
        await page.getByRole('textbox', { name: '改稿要求', exact: true }).fill('这段再简短一点。');
        await page.getByRole('button', { name: '继续调整', exact: true }).click();
        await page.getByRole('button', { name: '采用修改', exact: true }).waitFor();
        const scopedFollowUp = await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes(':revision:'))
          .map(key => JSON.parse(localStorage.getItem(key)).payload).find(payload => payload.instruction === '这段再简短一点。'));
        assert.equal(scopedFollowUp.mode, 'custom');
        assert.equal(scopedFollowUp.source.blocks.find(block => block.uid === scopedFollowUp.target.uid).text, '新增的活动说明段落。', 'follow-up modifies the inserted suggestion, not the whole manuscript or a second insertion');
        await page.getByRole('button', { name: '采用修改', exact: true }).click();
        await page.waitForFunction(() => [...document.querySelectorAll('.news-edit-paragraph')].some(element => element.textContent === '简短的说明。'));
        const secondParagraph = page.getByRole('textbox', { name: '正文段落 2', exact: true });
        assert.equal(await textValue(secondParagraph), '简短的说明。');

        // A selection spanning paragraphs retains both boundary fragments and does not edit photo captions.
        const firstBeforeRange = await textValue(paragraph), secondBeforeRange = await textValue(secondParagraph);
        const photoCaptions = await page.locator('.news-edit-caption').allTextContents();
        await selectText(page, paragraph, 2, secondParagraph, 3);
        assert.equal(await page.getByRole('button', { name: '补全', exact: true }).isDisabled(), true);
        await page.getByRole('textbox', { name: '改稿要求', exact: true }).fill('保留全文事实，只改我选中的这些文字。');
        await page.getByRole('button', { name: '精简', exact: true }).click();
        await page.getByRole('button', { name: '采用修改', exact: true }).waitFor();
        const ranged = await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes(':revision:'))
          .map(key => JSON.parse(localStorage.getItem(key)).payload).find(payload => payload.instruction === '保留全文事实，只改我选中的这些文字。'));
        assert.equal(ranged.target.ranges.length, 2);
        assert.equal(ranged.target.ranges[0].start, 2);
        assert.equal(ranged.target.ranges[1].end, 3);
        await snapshot('context-multi-paragraph');
        await page.getByRole('button', { name: '采用修改', exact: true }).click();
        await page.waitForTimeout(100);
        assert.ok((await textValue(paragraph)).startsWith(firstBeforeRange.slice(0, 2)));
        assert.ok((await textValue(secondParagraph)).endsWith(secondBeforeRange.slice(3)));
        assert.deepEqual(await page.locator('.news-edit-caption').allTextContents(), photoCaptions);
        await paragraph.click();
        await openBlockAI(page, paragraph);
        await page.getByRole('textbox', { name: '改稿要求', exact: true }).fill('补一段本次负责人在现场说的原话。');
        await page.getByRole('button', { name: '补段落', exact: true }).click();
        await page.getByText('请提供本次负责人的现场发言原文。', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '采用修改', exact: true }).count(), 0, 'missing facts are a clarification, not invented prose');
        await snapshot('context-clarification');
        await page.getByRole('textbox', { name: '改稿要求', exact: true }).fill('负责人说：“大家交流得很充分。”');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        const clarification = await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes(':revision:'))
          .map(key => JSON.parse(localStorage.getItem(key)).payload).find(payload => payload.instruction.startsWith('负责人说')));
        assert.equal(clarification.mode, 'add_paragraph', 'answering the current fact question retains the original editing action');
        assert.ok(clarification.conversation.some(item => item.text === '补一段本次负责人在现场说的原话。'));
        assert.ok(clarification.conversation.some(item => item.text === '请提供本次负责人的现场发言原文。'));
        assert.equal(await page.locator('.news-chat-message').count(), 0, 'current clarification does not restore a transcript');
        await page.getByRole('button', { name: '采用修改', exact: true }).waitFor();
        await page.getByRole('button', { name: '放弃建议', exact: true }).click();
        await paragraph.click();
        await page.keyboard.press('Escape');
        assert.equal(await floating.isVisible(), false);
        await paragraph.click();
        await page.keyboard.type('人工增补');
        assert.equal(await floating.isVisible(), false, 'manual typing dismisses the popup without taking focus');
        await page.keyboard.press('ControlOrMeta+z');
        await page.waitForFunction(() => !document.querySelector('.news-edit-paragraph')?.textContent.includes('人工增补'));
        assert.equal((await textValue(paragraph)).includes('人工增补'), false, 'native editor undo restores text');

        // New accounts and workspaces do not inherit photos, content or layout drafts.
        await page.goto(base + '?user=900004&channel=wechat');
        await material.waitFor();
        assert.equal(await material.inputValue(), '');
        assert.equal(await page.locator('.news-photo-strip figure').count(), 0);
        assert.equal(await page.locator('.news-result-pane').isVisible(), false);
        const credits = page.getByRole('checkbox', { name: '预留初审、终审署名', includeHidden: true });
        assert.equal(await credits.isChecked(), true);
        assert.equal(await credits.isVisible(), false, 'review credits stay in advanced settings');
        assert.equal(await page.getByRole('button', { name: 'AI 生成结构', exact: true }).count(), 0);
        await page.getByText('详细信息补充', { exact: true }).waitFor();
        await page.getByRole('button', { name: '文章类型', exact: true }).waitFor();
        await material.fill('学生进行了现场交流。');
        await page.getByRole('button', { name: '选择参考文章', exact: true }).click();
        const referenceDialog = page.getByRole('dialog').filter({ hasText: '选择参考文章' });
        await referenceDialog.getByRole('checkbox', { name: /校园交流范例/ }).check();
        assert.equal(await referenceDialog.getByRole('checkbox', { name: /未分析的范例/ }).isDisabled(), true);
        await snapshot('wechat-reference');
        await referenceDialog.getByRole('button', { name: '使用参考', exact: true }).click();
        await page.getByRole('button', { name: '选择参考文章', exact: true }).getByText('校园交流范例', { exact: true }).waitFor();
        await page.getByRole('button', { name: '文章类型', exact: true }).click();
        await page.getByRole('option', { name: '讲座交流', exact: true }).click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('mamage.aiNewsWriter.draft.v2:900004:900003') || '{}').formValues?.contentTemplate === 'lecture');
        await page.reload();
        await page.getByRole('button', { name: '文章类型', exact: true }).getByText('讲座交流', { exact: true }).waitFor();
        await page.getByRole('button', { name: '选择参考文章', exact: true }).getByText('校园交流范例', { exact: true }).waitFor();
        assert.equal(await page.getByRole('textbox', { name: '内容结构', exact: true }).count(), 0);
        await page.getByRole('button', { name: '文章类型', exact: true }).click();
        await page.getByRole('option', { name: '自定义结构', exact: true }).click();
        await page.getByRole('textbox', { name: '内容结构', exact: true }).fill('导语\n现场交流\n结尾');
        await page.locator('.news-more-options > summary').click();
        await credits.uncheck();
        await page.getByRole('button', { name: '保存模板', exact: true }).click();
        const templateDialog = page.getByRole('dialog').filter({ hasText: '保存内容模板' });
        await templateDialog.getByPlaceholder('例如：活动报道').fill('校园交流模板');
        await templateDialog.getByRole('checkbox', { name: '共享给当前小组' }).check();
        await templateDialog.getByRole('button', { name: '保存', exact: true }).click();
        await page.getByText('模板已保存', { exact: true }).waitFor();
        await page.waitForFunction(() => {
          const draft = JSON.parse(localStorage.getItem('mamage.aiNewsWriter.draft.v2:900004:900003') || '{}');
          return draft.formValues?.contentTemplate === 'custom' && draft.formValues?.reviewCredits === false;
        });
        await page.reload();
        assert.equal(await page.getByRole('textbox', { name: '内容结构', exact: true }).inputValue(), '导语\n现场交流\n结尾');
        assert.equal(await credits.isChecked(), false);
        await page.getByRole('button', { name: '文章类型', exact: true }).getByText('校园交流模板 · 小组', { exact: true }).waitFor();
        await seedDraftOnReload(page, 'mamage.aiNewsWriter.draft.v2:900004:900003', {
          formValues: { sourceMaterial: '保留的活动材料' }, channelContent: {
            wechat_article: { title: '旧稿独立标题', markdownText: '旧稿正文没有一级标题。', photos: [] },
          }, activeChannelKey: 'wechat_article', selectedChannels: ['wechat_article'],
        });
        await page.getByRole('textbox', { name: '稿件标题', exact: true }).waitFor();
        await page.getByRole('tab', { name: '编辑', exact: true }).click();
        assert.equal(await page.getByRole('textbox', { name: '稿件标题', exact: true }).inputValue(), '旧稿独立标题');
        assert.equal(await textValue(page.getByRole('textbox', { name: '正文段落 1', exact: true })), '旧稿正文没有一级标题。');
        const legacyBody = page.getByRole('textbox', { name: '正文段落 1', exact: true });
        await legacyBody.click();
        await page.locator('.ProseMirror').dispatchEvent('compositionstart', { data: 'zhong' });
        assert.equal(await floating.isVisible(), false, 'composition starts without the AI popup interrupting the editor');
        await page.locator('.ProseMirror').dispatchEvent('compositionend', { data: '中' });
        await page.waitForTimeout(80);
        const beforeEnter = await textValue(legacyBody);
        await selectText(page, legacyBody, 2);
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('.news-edit-paragraph').count(), 2, 'Enter splits a paragraph using the editor transaction');
        await page.keyboard.press('ControlOrMeta+z');
        await page.waitForFunction(() => document.querySelectorAll('.news-edit-paragraph').length === 1);
        assert.equal(await page.locator('.news-edit-paragraph').count(), 1);
        assert.equal(await textValue(legacyBody), beforeEnter);

        // Twelve separate edits retain exactly ten undo steps, including across reloads.
        const isolatedKey = 'mamage.aiNewsWriter.draft.v2:900004:900003';
        for (let index = 1; index <= 6; index++) {
          await legacyBody.fill(`独立正文修改 ${index}`);
          await page.waitForFunction(({ key, value }) => JSON.parse(localStorage.getItem(key) || '{}').channelContent?.wechat_article?.markdownText === value,
            { key: isolatedKey, value: `独立正文修改 ${index}` });
          await page.getByRole('textbox', { name: '稿件标题', exact: true }).fill(`独立标题修改 ${index}`);
          await page.waitForFunction(({ key, value }) => JSON.parse(localStorage.getItem(key) || '{}').channelContent?.wechat_article?.title === value,
            { key: isolatedKey, value: `独立标题修改 ${index}` });
        }
        assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).channelContent.wechat_article.history.length, isolatedKey), 10);
        await page.reload();
        await waitForTitle(page, '独立标题修改 6');
        for (let index = 0; index < 10; index++) {
          await page.getByRole('button', { name: '撤销编辑', exact: true }).click();
          await page.waitForFunction(({ key, length }) => JSON.parse(localStorage.getItem(key) || '{}').channelContent?.wechat_article?.history?.length === length,
            { key: isolatedKey, length: 9 - index });
        }
        assert.equal(await page.getByRole('button', { name: '撤销编辑', exact: true }).isDisabled(), true);
        assert.equal(await textValue(page.getByRole('textbox', { name: '稿件标题', exact: true })), '独立标题修改 1');
        assert.equal(await textValue(page.getByRole('textbox', { name: '正文段落 1', exact: true })), '独立正文修改 1');
        await page.getByRole('button', { name: '重做编辑', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.news-edit-paragraph')?.textContent === '独立正文修改 2');
        await page.getByRole('textbox', { name: '正文段落 1', exact: true }).fill('撤销后开始新的编辑');
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').channelContent?.wechat_article?.redoHistory?.length === 0, isolatedKey);
        assert.equal(await page.getByRole('button', { name: '重做编辑', exact: true }).isDisabled(), true);
        await page.getByRole('textbox', { name: '正文段落 1', exact: true }).fill('');
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').channelContent?.wechat_article?.markdownText === '', isolatedKey);
        assert.equal(await page.getByRole('button', { name: '撤销编辑', exact: true }).isVisible(), true, 'clearing the draft cannot hide its undo control');
        await page.getByRole('button', { name: '撤销编辑', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.news-edit-paragraph')?.textContent === '撤销后开始新的编辑');
        const chatState = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), `${draftKey}:wechat_article:chat`);
        assert.equal(chatState.messages, undefined, 'old transcript is removed from persisted UI state');
        assert.deepEqual(errors, []);
        cases.push({ width, simpleStart: true, photoPicker: true, max30: true, refreshRecovery: true,
          oneSubmission: true, readRetry: true, staleReadProtected: true, explicitNames: true, directEditing: true, regenerationHistory: true,
          fastSwitchSaved: true, layoutBackupRestore: true, isolatedAccounts: true, contentConfirmation: true,
          chatRevision: true, staleProposalProtected: true, aiLayoutRefresh: true, independentDraftRestore: true,
          scopedActions: true, cursorCompletion: true, paragraphInsertion: true, contextFollowUp: true, missingFactsClarification: true,
          contextualPopup: true, multiParagraphSelection: true, manualUndo: true, compositionGuard: true,
          singleEditNoTranscript: true, freshEditIsolated: true, unifiedAiManualUndo: true, exactTenUndoAcrossRefresh: true, redoBranchReset: true });
      } catch (error) {
        await page.screenshot({ path: path.join(output, `failure-${width}.png`), fullPage: true });
        fs.writeFileSync(path.join(output, `failure-state-${width}.json`), JSON.stringify(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))), null, 2));
        throw error;
      } finally { await context.close(); }
    }
    const httpContext = await browser.newContext();
    try {
      const httpPage = await httpContext.newPage();
      const httpBase = base.replace('127.0.0.1', 'mamage.test');
      // Keep a genuinely insecure origin without depending on system DNS/proxy handling.
      await httpPage.route(httpBase + '/**', async route => {
        const response = await route.fetch({ url: route.request().url().replace(httpBase, base) });
        await route.fulfill({ response });
      });
      await httpPage.goto(httpBase + '?channel=wechat');
      assert.equal(await httpPage.evaluate(() => window.isSecureContext), false, 'real non-localhost HTTP origin');
      await seedDraftOnReload(httpPage, draftKey, {
        channelContent: { wechat_article: { title: 'HTTP复制测试', markdownText: '# HTTP复制测试\n\n仅复制已确认的新闻事实。', photos: [] } },
        selectedChannels: ['wechat_article'], activeChannelKey: 'wechat_article', formValues: { sourceMaterial: '已确认的事实' },
      });
      await httpPage.evaluate(() => document.addEventListener('copy', event => {
        window.__newsCopied = { text: event.clipboardData?.getData('text/plain'), html: event.clipboardData?.getData('text/html') };
      }));
      await httpPage.getByRole('button', { name: '确认内容，选择样式', exact: true }).click();
      await httpPage.getByRole('button', { name: '应用模板，生成排版稿', exact: true }).click();
      await httpPage.getByRole('button', { name: '复制到公众号', exact: true }).click();
      await httpPage.getByText(/已复制/).first().waitFor();
      const copied = await httpPage.evaluate(() => window.__newsCopied);
      assert.match(copied.text, /仅复制已确认的新闻事实/);
      assert.match(copied.html, /<section/);
      assert.equal(copied.text.split('HTTP复制测试').length - 1, 1, 'plain-text clipboard fallback includes the title once');
      assert.equal(copied.html.includes('HTTP复制测试'), false, 'rich article body does not duplicate the separate title field');
      assert.equal(await httpPage.locator('#wxc-title-input').inputValue(), 'HTTP复制测试');
      await httpPage.goto(httpBase);
      await seedDraftOnReload(httpPage, draftKey, {
        channelContent: { press_release: { title: 'HTTP新闻稿', markdownText: '# HTTP新闻稿\n\n纯文本复制。', photos: [] } },
        selectedChannels: ['press_release'], activeChannelKey: 'press_release', formValues: { sourceMaterial: '已确认的事实' },
      });
      await httpPage.evaluate(() => document.addEventListener('copy', event => { window.__newsPlainCopied = event.clipboardData?.getData('text/plain'); }));
      await httpPage.getByRole('button', { name: '复制正文', exact: true }).click();
      await httpPage.getByText('已复制正文', { exact: true }).waitFor();
      assert.match(await httpPage.evaluate(() => window.__newsPlainCopied), /纯文本复制/);
      await httpPage.evaluate(() => { document.execCommand = () => false; });
      await httpPage.getByRole('button', { name: '复制正文', exact: true }).click();
      await httpPage.getByText('复制失败', { exact: true }).waitFor();
      cases.push({ insecureHttp: true, richCopy: true, plainCopy: true, titleOnce: true });
    } finally { await httpContext.close(); }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, cases }, null, 2));
    console.log(JSON.stringify({ passed: true, cases }));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
