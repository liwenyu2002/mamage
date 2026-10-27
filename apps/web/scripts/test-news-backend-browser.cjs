// Explicit opt-in: real API routes, isolated MySQL and actual writing-model requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { root, output, createServer } = require('./serve-news-usability.cjs');
const serverRequire = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = serverRequire('playwright');
if (process.env.MAMAGE_NEWS_BACKEND_TEST !== '1') throw Error('Set MAMAGE_NEWS_BACKEND_TEST=1 to run live backend integration checks');
let base = 'http://127.0.0.1:5192';
let draftKey, layoutKey, workflowKey;
const text = locator => locator.evaluate(element => 'value' in element ? element.value : element.textContent);
const responseFor = (page, endpoint) => page.waitForResponse(response => response.url().endsWith(endpoint)
  && response.request().method() === 'POST', { timeout: 65000 });
async function generate(page, label) {
  const response = responseFor(page, '/api/ai/news/generate/batch');
  await page.getByRole('button', { name: /^(生成初稿|重新生成)$/, exact: false }).click();
  const submitted = await response;
  assert.ok(submitted.ok(), `${label}: ${await submitted.text()}`);
  const batch = await submitted.json();
  await page.getByRole('textbox', { name: '稿件标题', exact: true }).waitFor({ timeout: 90000 });
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').batchStatus === 'succeeded', draftKey, { timeout: 90000 });
  return batch.jobs.map(job => Number(job.jobId));
}
async function main() {
  const initialConfig = await (await fetch(base + '/__news-qa/config')).json();
  assert.equal(initialConfig.liveBackend, true, 'refuse the mock or model-only preview');
  const health = await (await fetch(base + '/api/health/ready')).json();
  assert.equal(health.sandbox, true);
  const settings = JSON.parse(fs.readFileSync(path.resolve(root, '../../.local/news-live-backend-20261025/sandbox.private.json')));
  assert.equal(settings.database, 'mamage_news_sandbox');
  const database = await serverRequire('mysql2/promise').createConnection({ host: '127.0.0.1', port: 13362,
    user: 'news_sandbox', password: settings.password, database: settings.database });
  let actor;
  try {
    const nonce = serverRequire('node:crypto').randomUUID();
    await database.beginTransaction();
    const [created] = await database.query(`INSERT INTO users (student_no,name,email,role,password_hash,organization_id,active_unit_id)
      SELECT ?,'独立写作验收',?,'admin',password_hash,organization_id,active_unit_id FROM users WHERE id=900003`,
    [`qa${nonce.replaceAll('-', '').slice(0, 12)}`, `${nonce}@sandbox.invalid`]);
    assert.ok(created.insertId); actor = Number(created.insertId);
    await database.query("INSERT INTO organization_unit_memberships (unit_id,user_id,role) VALUES (900003,?,'manager')", [actor]);
    await database.commit();
  } catch (error) { await database.rollback(); throw error; } finally { await database.end(); }
  const token = serverRequire('jsonwebtoken').sign({ id: actor, role: 'admin' }, settings.jwt, { expiresIn: '30m' });
  const preview = createServer({ backendURL: 'http://127.0.0.1:18192',
    session: { user: { id: actor }, workspaceId: 900003, token } });
  await new Promise(resolve => preview.listen(0, '127.0.0.1', resolve));
  preview.unref();
  base = `http://127.0.0.1:${preview.address().port}`;
  const config = await (await fetch(base + '/__news-qa/config')).json();
  draftKey = `mamage.aiNewsWriter.draft.v2:${actor}:900003`;
  layoutKey = `wechat-composer-draft.v2:${actor}:900003:ai`;
  workflowKey = `mamage.wechat.workflow.v1:${actor}:900003`;
  assert.equal((await fetch(base + '/api/wechat-compositions')).status, 401, 'real routes require authentication');
  fs.mkdirSync(output, { recursive: true });
  const webpackConfig = require('../webpack.config')({}, { mode: 'development' });
  await new Promise((resolve, reject) => require('webpack')({ ...webpackConfig, context: root, entry: './scripts/fixtures/news-usability.jsx',
    devtool: false, output: { ...webpackConfig.output, path: path.join(output, 'dist') }, optimization: { splitChunks: false } }, (error, stats) =>
    error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const browser = await chromium.launch();
  const cases = [], jobIds = [];
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 960 } });
      const page = await context.newPage(), failures = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if (new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 400) failures.push({ path: new URL(response.url()).pathname, status: response.status() });
      });
      try {
        await page.goto(base + '/?channel=wechat');
        await page.getByText('真实 AI 后端 · 独立测试数据库 · 不写入生产数据', { exact: true }).waitFor();
        const material = page.getByRole('textbox', { name: /^(写作材料|详细信息补充)$/ });
        await material.fill('青禾实验中学于10月25日在报告厅举行星河项目分享会。学生介绍校园观察记录和整理资料的过程，教师现场点评，师生讨论下一步如何改进记录方法。不要虚构人数、领导讲话或获奖成果。');
        await page.getByRole('button', { name: '选择参考文章', exact: true }).click();
        const references = page.getByRole('dialog').filter({ hasText: '选择参考文章' });
        await references.locator('input[type=checkbox]:not(:disabled)').first().check();
        await references.getByRole('button', { name: '使用参考', exact: true }).click();
        assert.equal(await page.getByRole('button', { name: 'AI 生成结构', exact: true }).count(), 0);
        assert.equal(await page.getByRole('textbox', { name: '内容结构', exact: true }).count(), 0);
        await page.getByRole('button', { name: '文章类型', exact: true }).click();
        await page.getByRole('option', { name: '活动报道', exact: true }).click();
        await page.getByRole('button', { name: '添加活动照片', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: /学生实践交流（测试）/ }).click();
        await page.getByRole('button', { name: '选择照片 9201', exact: true }).click();
        await page.getByRole('button', { name: '选择照片 9202', exact: true }).click();
        await page.getByRole('button', { name: '使用所选照片', exact: true }).click();
        jobIds.push(...await generate(page, 'wechat generation'));
        const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).channelContent.wechat_article, draftKey);
        assert.match(saved.markdownText, /星河/);
        assert.match(saved.markdownText, /青禾实验中学/);
        assert.match(saved.markdownText, /初审：待填写/);
        assert.match(saved.markdownText, /终审：待填写/);
        assert.equal(saved.references.length, 1, 'generated result records the references supplied with that batch');
        const referenceRecord = await page.request.get(base + `/api/ai/news/jobs/${saved.sourceJobId}/references`, {
          headers: { Authorization: `Bearer ${config.session.token}`, 'X-Mamage-Unit-Id': '900003' } });
        assert.equal(referenceRecord.status(), 200);
        assert.deepEqual((await referenceRecord.json()).references, saved.references);
        const insights = page.getByRole('complementary', { name: 'AI 建议补充' });
        await insights.getByRole('button', { name: saved.references[0].title, exact: true }).click();
        const referencePanel = page.getByRole('complementary', { name: '参考文章' });
        await referencePanel.locator('iframe').waitFor();
        await referencePanel.getByRole('button', { name: '关闭参考文章' }).click();
        await page.getByRole('button', { name: '补充材料 / 重新生成', exact: true }).click();
        await page.getByRole('button', { name: '选择参考文章', exact: true }).click();
        const changedReferences = page.getByRole('dialog').filter({ hasText: '选择参考文章' });
        await changedReferences.locator('input[type=checkbox]:checked').first().uncheck();
        await changedReferences.getByRole('button', { name: '使用参考', exact: true }).click();
        await insights.getByRole('button', { name: saved.references[0].title, exact: true }).waitFor();
        await page.getByRole('button', { name: '收起材料', exact: true }).click();
        assert.notEqual(saved.title, '学生分享实践项目 师生交流推进思路', 'no fixed fixture generation');
        const photo = page.locator('.news-edit-photo img').first();
        await photo.evaluate(image => image.decode());
        assert.ok(await photo.evaluate(image => image.naturalWidth > 0));
        const paragraph = page.locator('.news-edit-paragraph').filter({ hasText: '星河' }).first();
        const before = await paragraph.textContent(), start = before.indexOf('星河');
        assert.ok(start >= 0);
        await paragraph.scrollIntoViewIfNeeded();
        await paragraph.evaluate((element, start) => {
          element.closest('.ProseMirror').focus({ preventScroll: true });
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let node, offset = 0, from, to;
          while ((node = walker.nextNode())) {
            if (!from && offset + node.length > start) from = { node, offset: start - offset };
            if (offset + node.length >= start + 2) { to = { node, offset: start + 2 - offset }; break; }
            offset += node.length;
          }
          const range = document.createRange(); range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
        }, start);
        await page.waitForTimeout(180); await page.keyboard.press('Shift');
        await page.getByRole('textbox', { name: '改稿要求', exact: true }).fill('将选中文字替换为“星河校园观察”，其他文字不变。');
        assert.deepEqual(await page.locator('.news-ai-selection').allTextContents(), ['星河']);
        const revisionResponse = responseFor(page, '/api/wechat-compositions/revision');
        await page.getByRole('button', { name: '润色', exact: true }).click();
        const revisionSubmitted = await revisionResponse;
        const revision = await revisionSubmitted.json(); jobIds.push(Number(revision.jobId));
        const replayHeaders = { Authorization: `Bearer ${config.session.token}`, 'X-Mamage-Unit-Id': '900003' };
        const revisionReplay = await page.request.post(base + '/api/wechat-compositions/revision', { headers: replayHeaders, data: revisionSubmitted.request().postDataJSON() });
        assert.ok(revisionReplay.ok()); assert.equal((await revisionReplay.json()).jobId, revision.jobId);
        await page.getByRole('button', { name: '采用修改', exact: true }).waitFor({ timeout: 65000 });
        assert.equal(await paragraph.textContent(), before);
        await page.getByRole('button', { name: '采用修改', exact: true }).click();
        assert.equal(await page.locator('.news-ai-selection').count(), 0);
        await page.waitForFunction(expected => [...document.querySelectorAll('.news-edit-paragraph')].some(element => element.textContent === expected), before.slice(0, start) + '星河校园观察' + before.slice(start + 2));
        await page.getByRole('button', { name: '撤销编辑', exact: true }).click();
        assert.equal(await paragraph.textContent(), before);
        await page.getByRole('button', { name: '重做编辑', exact: true }).click();
        const hierarchical = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).channelContent.wechat_article.markdownText, draftKey);
        await page.getByText('源码与导出', { exact: true }).click();
        await page.getByRole('textbox', { name: '稿件正文', exact: true }).fill(hierarchical + '\n\n# 现场记录\n\n## 项目交流\n\n### 讨论要点\n\n围绕原有活动材料整理。');
        await page.getByRole('button', { name: '备份内容稿', exact: true }).click();
        await page.getByText('内容稿已备份', { exact: true }).waitFor();
        await page.getByRole('button', { name: '确认内容，选择样式', exact: true }).click();
        const frozen = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).confirmed, workflowKey);
        assert.deepEqual(frozen.source.doc.filter(block => block.headingLevel).slice(-3).map(block => block.headingLevel), [1, 2, 3]);
        await page.getByRole('button', { name: 'AI 排版', exact: true }).click();
        await page.getByRole('textbox', { name: '排版风格描述', exact: true }).fill('黑白简洁的校园纪实风，正文留白适中，不修改任何文字和图片顺序。');
        const layoutResponse = responseFor(page, '/api/wechat-compositions/layout');
        await page.getByRole('button', { name: 'AI 自动排版', exact: true }).click();
        const layoutSubmitted = await layoutResponse;
        const layout = await layoutSubmitted.json(); jobIds.push(Number(layout.jobId));
        assert.deepEqual(layoutSubmitted.request().postDataJSON().source.doc.filter(block => block.headingLevel).slice(-3).map(block => block.headingLevel), [1, 2, 3]);
        const layoutReplay = await page.request.post(base + '/api/wechat-compositions/layout', { headers: replayHeaders, data: layoutSubmitted.request().postDataJSON() });
        assert.ok(layoutReplay.ok()); assert.equal((await layoutReplay.json()).jobId, layout.jobId);
        await page.reload();
        await page.locator('#wxc-title-input').waitFor({ timeout: 65000 });
        await page.getByRole('button', { name: '复制到公众号', exact: true }).click();
        await page.getByText(/请先处理待补项：.*初审.*终审/).waitFor();
        const styled = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), layoutKey);
        assert.equal(styled.title, frozen.source.title);
        assert.deepEqual(styled.doc.map(({ blockId, accent, ...block }) => block), frozen.source.doc, 'AI layout preserves exact confirmed text and images');
        await page.getByRole('button', { name: '备份排版稿', exact: true }).click();
        await page.getByText('排版稿已备份', { exact: true }).waitFor();
        await page.screenshot({ path: path.join(output, `real-backend-wechat-${width}.png`), fullPage: true });
        await page.getByRole('button', { name: '稿件备份', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: '内容稿', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: '恢复内容稿', exact: true }).first().click();
        await page.getByRole('dialog').getByRole('button', { name: '确认恢复', exact: true }).click();
        await page.getByRole('textbox', { name: '稿件标题', exact: true }).waitFor();
        assert.equal(await text(page.getByRole('textbox', { name: '稿件标题', exact: true })), frozen.source.title);
        await page.getByRole('button', { name: '新闻稿', exact: true }).click();
        if (!await material.isVisible()) await page.getByRole('button', { name: '补充材料 / 重新生成', exact: true }).click();
        await material.fill('青禾实验中学10月25日举办月影基础科学与人工智能论坛，师生围绕人工智能和光计算芯片展开交流。只写已经确认的经过，不编人数和发言。');
        jobIds.push(...await generate(page, 'news generation'));
        const news = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).channelContent.press_release, draftKey);
        assert.match(news.markdownText, /月影/);
        assert.notEqual(news.title, saved.title);
        assert.equal(news.referenceStatus, 'automatic');
        assert.ok(news.references.length > 0, 'unselected draft automatically uses a relevant library reference');
        assert.match(news.references[0].title, /基础科学与人工智能论坛/);
        await page.getByRole('complementary', { name: 'AI 建议补充' }).getByText('自动匹配', { exact: true }).waitFor();
        assert.equal(await page.locator('.news-paragraph-tools').count(), 0);
        await page.screenshot({ path: path.join(output, `real-backend-news-${width}.png`), fullPage: true });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        assert.deepEqual(errors, []); assert.deepEqual(failures, []);
        cases.push({ width, generatedWechat: true, generatedNews: true, scopedRevision: true, undoRedo: true,
          realPhotos: true, realBackups: true, idempotentRetry: true, layoutRefreshRecovery: true, immutableLayoutContent: true, headingHierarchy: true });
      } catch (error) {
        await page.screenshot({ path: path.join(output, `real-backend-failure-${width}.png`), fullPage: true });
        const state = await page.evaluate(key => { const draft = JSON.parse(localStorage.getItem(key) || '{}');
          return { batchStatus: draft.batchStatus, activeChannelKey: draft.activeChannelKey, channels: Object.keys(draft.channelContent || {}) }; }, draftKey);
        console.error(JSON.stringify({ failures, errors, state })); throw error;
      } finally { await context.close(); }
    }
    const db = await serverRequire('mysql2/promise').createConnection({ host: '127.0.0.1', port: 13362, user: 'news_sandbox', password: settings.password, database: 'mamage_news_sandbox' });
    let rows;
    try { [rows] = await db.query('SELECT j.id,j.status,j.unit_id,j.tokens_used,COUNT(r.id) AS results FROM ai_jobs j LEFT JOIN ai_results r ON r.job_id=j.id WHERE j.id IN (?) GROUP BY j.id', [jobIds]); }
    finally { await db.end(); }
    assert.equal(rows.length, jobIds.length);
    for (const row of rows) { assert.equal(row.status, 'succeeded'); assert.equal(row.unit_id, 900003); assert.equal(Number(row.results), 1); assert.ok(row.tokens_used > 0); }
    const report = { passed: true, isolatedDatabase: true, productionChanged: false, cases, persistedModelJobs: rows };
    fs.writeFileSync(path.join(output, 'real-backend-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); preview.closeAllConnections(); await new Promise(resolve => preview.close(resolve)); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
