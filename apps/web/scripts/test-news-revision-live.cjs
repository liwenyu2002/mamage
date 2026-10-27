// Opt-in synthetic browser checks against the local preview, never the production API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../../server/package.json'))('playwright');
const { output } = require('./serve-news-usability.cjs');
if (process.env.MAMAGE_NEWS_LIVE_BROWSER !== '1') throw Error('Set MAMAGE_NEWS_LIVE_BROWSER=1 to call the live writing model');
const firstText = '学校在报告厅举行学生实践交流。学生介绍了各自的项目，教师在现场进行点评。';
async function selectSchool(page) {
  await page.getByRole('textbox', { name: '正文段落 1', exact: true }).evaluate(element => {
    element.closest('.ProseMirror').focus();
    const range = document.createRange(); range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 2);
    const selected = getSelection(); selected.removeAllRanges(); selected.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.waitForTimeout(180); await page.keyboard.press('Shift');
  await page.getByRole('textbox', { name: '改稿要求', exact: true }).fill('写清楚是什么学校');
  assert.equal(await page.locator('.news-ai-selection').allTextContents().then(parts => parts.join('')), '学校', 'the exact selection remains highlighted while typing in the popup');
  assert.equal(await page.getByRole('textbox', { name: '改稿要求', exact: true }).evaluate(element => document.activeElement === element), true);
  await page.screenshot({ path: path.join(output, `real-selection-input-${page.viewportSize().width}.png`), fullPage: true });
  await page.getByRole('button', { name: '润色', exact: true }).click();
}
async function main() {
  const config = await (await fetch('http://127.0.0.1:5192/__news-qa/config')).json();
  assert.equal(config.liveRevision, true);
  assert.equal(config.liveBackend, true, 'this check requires the actual business backend, not a model-only proxy');
  const ready = await (await fetch('http://127.0.0.1:5192/api/health/ready')).json();
  assert.equal(ready.status, 'ready'); assert.equal(ready.sandbox, true);
  const userId = config.session?.user?.id || 900009, workspaceId = config.session?.workspaceId || 900003;
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const width of [1440, 390]) for (const kind of ['missing', 'known', 'ambiguous']) {
      const context = await browser.newContext({ viewport: { width, height: 960 } });
      try {
        const page = await context.newPage();
        const jobs = [];
        page.on('response', async response => {
          if (response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/wechat-compositions/revision' && response.status() === 202) {
            const value = await response.json(); jobs.push(value.jobId);
          }
        });
        const material = kind === 'known' ? '学校全称是青禾实验中学。' : kind === 'ambiguous'
          ? '青禾实验中学与望川中学共同举办交流，没有记录报告厅属于哪一所学校。' : '同学介绍项目，教师点评。';
        await page.addInitScript(({ firstText, material, userId, workspaceId }) => {
          localStorage.setItem(`mamage.aiNewsWriter.draft.v2:${userId}:${workspaceId}`, JSON.stringify({ channelContent: { wechat_article: {
            title: '学生实践交流', markdownText: '# 学生实践交流\n\n' + firstText + '\n\n交流围绕具体项目展开。', photos: [],
          } }, activeChannelKey: 'wechat_article', selectedChannels: ['wechat_article'], formValues: { sourceMaterial: material } }));
        }, { firstText, material, userId, workspaceId });
        await page.goto(`http://127.0.0.1:5192/?channel=wechat&user=${userId}`);
        await page.getByText(config.liveBackend ? '真实 AI 后端 · 独立测试数据库 · 不写入生产数据' : '示例初稿 · 真实 AI 改稿 · 不写入生产数据', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '查看修改建议', exact: true }).count(), 0);
        const started = Date.now();
        await selectSchool(page);
        let question;
        if (kind !== 'known') {
          await page.locator('.news-chat-question').waitFor({ timeout: 65000 });
          question = await page.locator('.news-chat-question').innerText();
          assert.equal(await page.locator('.news-ai-selection').allTextContents().then(parts => parts.join('')), '学校');
          assert.ok(question.trim());
          assert.equal(await page.getByRole('button', { name: '采用修改', exact: true }).count(), 0);
          assert.equal(await page.getByRole('textbox', { name: '正文段落 1', exact: true }).textContent(), firstText);
          await page.screenshot({ path: path.join(output, `school-${kind}-${width}.png`), fullPage: true });
        }
        if (kind === 'missing') {
          await page.getByRole('textbox', { name: '改稿要求', exact: true }).fill('学校全称是青禾实验中学。');
          await page.getByRole('button', { name: '发送', exact: true }).click();
        }
        if (kind !== 'ambiguous') {
          await page.getByRole('button', { name: '采用修改', exact: true }).waitFor({ timeout: 65000 });
          assert.equal(await page.getByRole('textbox', { name: '正文段落 1', exact: true }).textContent(), firstText, 'a proposal is not applied automatically');
          await page.getByRole('button', { name: '采用修改', exact: true }).click();
          assert.equal(await page.locator('.news-ai-selection').count(), 0);
          await page.waitForFunction(text => document.querySelector('.news-edit-paragraph')?.textContent === text, '青禾实验中学' + firstText.slice(2));
          assert.equal(await page.getByRole('textbox', { name: '正文段落 2', exact: true }).textContent(), '交流围绕具体项目展开。');
          await page.getByRole('button', { name: '撤销编辑', exact: true }).click();
          assert.equal(await page.getByRole('textbox', { name: '正文段落 1', exact: true }).textContent(), firstText);
        }
        assert.equal(await page.locator('.news-chat-message').count(), 0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        assert.ok(jobs.length && jobs.every(job => Number.isInteger(Number(job)) && Number(job) > 0), 'every edit has an actual backend job ID');
        results.push({ width, kind, passed: true, elapsedMs: Date.now() - started, question, jobs });
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(output, 'live-revision-results.json'), JSON.stringify({ passed: true, syntheticOnly: true, productionChanged: false, results }, null, 2));
    console.log(JSON.stringify({ passed: true, results }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
