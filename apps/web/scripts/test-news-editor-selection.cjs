const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer, output, root } = require('./serve-news-usability.cjs');
const { chromium } = createRequire(path.join(root, '../server/package.json'))('playwright');
const draftKey = 'mamage.aiNewsWriter.draft.v2:900003:900003';
const first = '学校在报告厅举行学生实践交流。';
const second = '教师结合项目进展提出建议，师生共同讨论下一步。';
const markdown = '# 学生实践交流\n\n' + first + '\n\n![活动现场](/__news-qa/images/1681.jpg)\n\n' + second;

async function select(page, start, end, crossParagraph = false) {
  await page.getByRole('textbox', { name: '正文段落 1', exact: true }).scrollIntoViewIfNeeded();
  await page.evaluate(({ start, end, crossParagraph }) => {
    const paragraphs = document.querySelectorAll('.news-edit-paragraph');
    const point = (element, offset) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (offset <= node.length) return [node, offset];
        offset -= node.length;
      }
      throw Error('Selection offset outside paragraph');
    };
    paragraphs[0].closest('.ProseMirror').focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(...point(paragraphs[0], start));
    range.setEnd(...point(paragraphs[crossParagraph ? 1 : 0], end));
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { start, end, crossParagraph });
  await page.waitForTimeout(180); await page.keyboard.press('Shift');
  await page.getByRole('dialog', { name: 'AI 就地改稿', exact: true }).waitFor();
}

async function main() {
  const config = require('../webpack.config')({}, { mode: 'development' });
  await new Promise((resolve, reject) => require('webpack')({ ...config, context: root, entry: './scripts/fixtures/news-usability.jsx',
    devtool: false, output: { ...config.output, path: path.join(output, 'dist') }, optimization: { splitChunks: false } }, (error, stats) =>
    error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 960 } });
      try {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(({ draftKey, markdown, width }) => {
          if (sessionStorage.getItem('seeded')) return;
          sessionStorage.setItem('seeded', '1');
          localStorage.setItem('news-preview-real-backend:900003:900003', '1');
          localStorage.setItem('news-preview-live-revision:900003:900003', '1');
          localStorage.setItem(draftKey, JSON.stringify({ channelContent: { wechat_article: { title: '学生实践交流', markdownText: markdown, photos: [] } },
            activeChannelKey: 'wechat_article', selectedChannels: ['wechat_article'] }));
          // Legacy mock results may have exactly the same manuscript signature.
          localStorage.setItem(draftKey + ':wechat_article:chat', JSON.stringify({ version: 2, execution: width === 390 ? 'sandbox-api' : undefined, proposal: {
            title: '旧模拟建议', markdown: '不应恢复', base: { title: '学生实践交流', markdown }, changes: [{ text: '旧模拟建议' }],
          } }));
        }, { draftKey, markdown, width });
        await page.goto(`http://127.0.0.1:${server.address().port}/?channel=wechat`);
        await page.getByRole('textbox', { name: '正文段落 1', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '查看修改建议', exact: true }).count(), 0, 'old unscoped mock suggestions are not resumed');
        const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).channelContent.wechat_article, draftKey);
        assert.equal(saved.markdownText, markdown, 'cache migration preserves the manuscript');
        const highlight = page.locator('.news-ai-selection');
        await page.getByRole('textbox', { name: '正文段落 1', exact: true }).click();
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(200);
        assert.equal(await page.getByRole('dialog', { name: 'AI 就地改稿', exact: true }).count(), 0, 'ordinary clicks and caret movement never open AI');
        await select(page, 0, 2);
        await page.getByRole('textbox', { name: '改稿要求', exact: true }).fill('写清楚是什么学校');
        assert.deepEqual(await highlight.allTextContents(), ['学校']);
        assert.equal(await highlight.evaluate(element => getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)'), false);
        await page.screenshot({ path: path.join(output, `selection-input-${width}.png`), fullPage: true });
        await page.getByRole('button', { name: '关闭 AI 浮窗', exact: true }).click();
        assert.equal(await highlight.count(), 0);
        assert.equal(await page.getByRole('textbox', { name: '正文段落 1', exact: true }).textContent(), first);
        assert.equal(await page.getByRole('button', { name: '撤销编辑', exact: true }).isDisabled(), true, 'selection paint never enters undo history');

        await select(page, 2, 3, true);
        await page.getByRole('textbox', { name: '改稿要求', exact: true }).fill('精简选中内容');
        assert.deepEqual(await highlight.allTextContents(), [first.slice(2), second.slice(0, 3)]);
        assert.equal(await page.locator('.news-edit-photo .news-ai-selection').count(), 0, 'cross-photo selections never paint excluded captions');
        await page.getByRole('button', { name: '精简', exact: true }).click();
        assert.equal(await highlight.count(), 2, 'pending requests keep the original target highlighted');
        await page.reload();
        await page.getByRole('button', { name: '采用修改', exact: true }).waitFor();
        assert.deepEqual(await highlight.allTextContents(), [first.slice(2), second.slice(0, 3)], 'the same execution can resume its real selection snapshot');
        await page.getByRole('button', { name: '放弃建议', exact: true }).click();
        assert.equal(await highlight.count(), 0);

        await select(page, 0, 2);
        await page.getByRole('button', { name: '润色', exact: true }).click();
        await page.getByRole('button', { name: '采用修改', exact: true }).waitFor();
        await page.getByRole('button', { name: '采用修改', exact: true }).click();
        assert.equal(await highlight.count(), 0);
        await page.getByRole('button', { name: '撤销编辑', exact: true }).click();
        assert.equal(await page.getByRole('textbox', { name: '正文段落 1', exact: true }).textContent(), first);
        assert.equal(await highlight.count(), 0);

        await select(page, 0, 2);
        await page.keyboard.press('Escape');
        assert.equal(await highlight.count(), 0);
        await select(page, 0, 2);
        await page.keyboard.type('本校');
        assert.equal(await highlight.count(), 0, 'manual editing invalidates the previous target');
        assert.equal(await page.getByRole('dialog', { name: 'AI 就地改稿', exact: true }).isVisible(), false);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ width, passed: true, legacySuggestionDiscarded: true, persistentSelection: true }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
