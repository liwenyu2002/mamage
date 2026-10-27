const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer, root } = require('./serve-news-usability.cjs');
const { chromium } = createRequire(path.join(root, '../server/package.json'))('playwright');
const output = path.resolve(root, '../../.local/wechat-monitor-qa');
const dimensions = { headline: '标题策略', lead: '导语与切口', narrative: '叙事与视角', paragraphs: '段落层级', language: '语言修辞', images: '图文编排', ending: '结尾互动', editorial: '品牌辨识' };
const evidence = '从一个问题开始，再用行动回应';
const analysis = { summary: '以问题引出实践行动，邀请读者分享自己的观察。', dimensions: Object.fromEntries(Object.keys(dimensions).map(key => [key, { finding: '先引出问题，再交代行动。', evidence: [evidence] }])),
  lessons: [{ principle: '问题与行动对应', application: '实践活动报道', caveat: '不能移植其他学校事实', evidence: [evidence] }], visualLimitation: '仅分析 HTML/CSS，未识别图片画面' };
const articles = [1, 2].map(id => ({ id, title: `观察计划｜测试内容 ${id}`, author: '测试公众号', sourceUrl: `https://mp.weixin.qq.com/s/fixture-${id}`,
  publishedAt: 1711929600000 + id * 86400000, revisionId: id, identityStatus: 'name_matched', analysisState: 'ready', summary: analysis.summary, scene: 'events', analysis,
  blocks: [`<p>${evidence}</p><img src="/__news-qa/images/1681.jpg"><script>window.parent.__unsafe=true</script>`], styleBlocks: [],
  relations: [{ id: id === 1 ? 2 : 1, title: '相关测试文章', summary: '问题与行动结构在两篇文章中重复出现。', evidence: { kind: 'writing_pattern', low: [evidence], high: [evidence] } }] }));
const months = [{ from: '2024-01-01', count: 0, state: 'unverified' }, { from: '2024-04-01', count: 2, state: 'partial' }];
const account = { id: 1, name: '测试公众号 A', enabled: true, state: 'watching', articleCount: 2, analyzedCount: 2, since: '2024-01-01',
  candidateLinks: 3, restrictedFetches: 1,
  intervalSeconds: 1800, earliestAt: articles[0].publishedAt, latestAt: articles[1].publishedAt, lastCheckedAt: Date.now(), error: '', monthlyCoverage: months,
  sogou: { url: 'https://weixin.sogou.com/weixin?type=2&query=test', state: 'policy_disallowed' } };
const failedFixture = { ...articles[0], id: 4, title: '分析失败的测试文章', summary: '', analysis: null, analysisState: 'failed',
  analysisError: { code: 'ANALYSIS_INVALID', message: '测试：分析证据不合格，已停止重试' } };
async function main() {
  process.chdir(root);
  const config = require('../webpack.config')({}, { mode: 'development' });
  await new Promise((resolve, reject) => require('webpack')({ ...config, context: root, entry: './scripts/fixtures/wechat-monitor.jsx', devtool: false,
    output: { ...config.output, path: path.join(output, 'dist') }, optimization: { splitChunks: false } }, (error, stats) =>
    error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const server = createServer({ distDirectory: path.join(output, 'dist') }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width === 390, isMobile: width === 390 });
      const page = await context.newPage(), errors = [], writes = [], taskRequests = [];
      await page.clock.install();
      page.setDefaultTimeout(7000);
      page.on('pageerror', error => errors.push(error.message));
      let allowed = true, enabled = true, additionalArticle = false, failOverview = false, failedArticle = false, articleReads = 0, newerJobs = false;
      const taskRows = Array.from({ length: 75 }, (_, index) => ({ id: 75 - index, accountId: 1, kind: 'fetch', status: 'blocked', attempts: 1,
        error: index === 0 ? '来源要求验证，已暂停此项采集' : `历史任务 ${75 - index} 的来源验证记录`, errorCode: 'SOURCE_VERIFICATION_REQUIRED' }));
      await page.route('**/api/wechat-monitor/**', async route => {
        const request = route.request(), url = new URL(request.url()), pathname = url.pathname.replace('/api/wechat-monitor', '');
        assert.equal(request.headers()['x-mamage-unit-id'], '900043');
        if (request.method() !== 'GET') {
          if (pathname === '/accounts/1' && typeof request.postDataJSON().enabled === 'boolean') enabled = request.postDataJSON().enabled;
          writes.push({ path: pathname, body: request.postDataJSON() }); return route.fulfill({ json: { queued: true } });
        }
        if (pathname === '/overview' && failOverview) return route.fulfill({ status: 503, json: { message: '本地测试连接暂时断开' } });
        if (pathname === '/overview') return route.fulfill({ json: { accounts: [{ ...account, enabled, articleCount: additionalArticle ? 3 : 2 }, { ...account, id: 2, name: '测试公众号 B' }], canManage: allowed,
          engineEnabled: true, budget: { paused: false, unlimited: true, usedTokens: 9000000, limitTokens: null, resetAt: null },
          scenes: { events: '活动报道' }, dimensions, jobs: [{ status: 'blocked', count: newerJobs ? 76 : 75 }] } });
        if (pathname === '/articles') { articleReads++; return route.fulfill({ json: { items: [...articles,
          ...(additionalArticle ? [{ ...articles[0], id: 3, title: '后台新增的测试文章' }] : []), ...(failedArticle ? [failedFixture] : [])], hasMore: false } }); }
        if (pathname.startsWith('/articles/')) return route.fulfill({ json: [...articles, failedFixture].find(article => String(article.id) === pathname.split('/').at(-1)) });
        if (pathname === '/groups') return route.fulfill({ json: { items: [{ id: 3, kind: 'series', name: '观察计划', state: 'supported', count: 2, summary: { summary: analysis.summary } },
          { id: 4, kind: 'series', name: 'AI共创营', state: 'candidate', count: 1, summary: null }] } });
        if (pathname === '/groups/4') return route.fulfill({ json: { id: 4, name: 'AI共创营', kind: 'series', state: 'candidate', count: 1,
          summary: null, summaryCurrent: false, members: articles.slice(0, 1) } });
        if (pathname === '/groups/3') return route.fulfill({ json: { id: 3, name: '观察计划', kind: 'series', count: 2, summaryCurrent: true,
          summary: { summary: analysis.summary, patterns: [{ principle: '问题回应结构', application: '活动报道', caveat: '样本有限', support: articles.map(item => ({ articleId: item.id, quote: evidence })) }], differences: ['细节场景不同'] }, members: articles } });
        if (pathname === '/jobs') {
          taskRequests.push({ before: url.searchParams.get('before'), status: url.searchParams.get('status') });
          const before = Number(url.searchParams.get('before')) || Infinity;
          const all = [...(newerJobs ? [{ ...taskRows[0], id: 76, error: '新任务 76 的来源验证记录' }] : []), ...taskRows]
            .filter(item => item.id < before).map(item => newerJobs && item.id === 1
              ? { ...item, error: '历史任务 1 的来源验证记录（已刷新）' } : item);
          return route.fulfill({ json: { items: all.slice(0, 50), hasMore: all.length > 50 } });
        }
        if (pathname === '/jobs/75/events') return route.fulfill({ json: { items: [{ attempt: 1, status: 'blocked', createdAt: Date.now(), error: '测试来源验证，已停止自动重试' }] } });
        throw Error('Unexpected request: ' + pathname);
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.getByText('1 项正文任务受限或失败，目录检查正常不代表正文已收录。', { exact: true }).first().waitFor();
      await page.getByRole('button', { name: /观察计划｜测试内容 1/ }).click();
      await page.getByRole('heading', { name: '标题策略', exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `monitor-analysis-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: '逆向原文', exact: true }).click();
      const frame = page.frameLocator('iframe[title="逆向文章预览"]');
      await frame.getByText(evidence, { exact: true }).waitFor();
      await frame.locator('img').evaluate(image => image.decode());
      assert.ok(await frame.locator('img').evaluate(image => image.naturalWidth > 0));
      await page.screenshot({ path: path.join(output, `monitor-original-${width}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => Boolean(window.__unsafe)), false);
      await page.getByRole('button', { name: '相似文章 1', exact: true }).click();
      await page.getByRole('button', { name: '相关测试文章', exact: true }).click();
      await page.getByRole('heading', { name: '观察计划｜测试内容 2', exact: true }).waitFor();
      await page.getByRole('button', { name: '返回', exact: true }).click();
      await page.getByRole('button', { name: '系列与场景', exact: true }).click();
      await page.getByRole('button', { name: /多篇支持.*观察计划/ }).click();
      await page.getByRole('heading', { name: '问题回应结构', exact: true }).waitFor();
      await page.getByRole('button', { name: '观察计划｜测试内容 1', exact: true }).first().click();
      await page.getByRole('heading', { name: '标题策略', exact: true }).waitFor();
      await page.getByRole('button', { name: '返回', exact: true }).click();
      await page.getByRole('button', { name: '系列与场景', exact: true }).click();
      await page.getByRole('button', { name: /系列候选.*AI共创营/ }).click();
      await page.getByText(/等待独立样本交叉核验/).waitFor();
      assert.equal(await page.getByText('总结等待更新', { exact: true }).count(), 0);
      await page.getByRole('button', { name: '返回', exact: true }).click();
      await page.getByRole('button', { name: '后台任务', exact: true }).click();
      await page.getByText('来源要求验证，已暂停此项采集', { exact: false }).waitFor();
      await page.locator('.wxm-pagination').getByRole('button').last().click();
      await page.getByText('历史任务 1 的来源验证记录', { exact: false }).waitFor();
      newerJobs = true; await page.clock.runFor(15001);
      await page.getByText('历史任务 1 的来源验证记录（已刷新）', { exact: false }).waitFor();
      assert.equal(await page.getByText('新任务 76 的来源验证记录', { exact: false }).count(), 0,
        'polling new jobs preserves the older cursor page instead of replacing it with the latest page');
      await page.screenshot({ path: path.join(output, `monitor-task-history-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: '上一页任务', exact: true }).click();
      await page.getByText('新任务 76 的来源验证记录', { exact: false }).waitFor();
      await page.getByRole('button', { name: '下一页任务', exact: true }).click();
      await page.getByText('历史任务 1 的来源验证记录（已刷新）', { exact: false }).waitFor();
      await page.getByRole('combobox', { name: '筛选任务状态', exact: true }).selectOption('blocked');
      await page.getByText('新任务 76 的来源验证记录', { exact: false }).waitFor();
      assert.equal(await page.getByRole('button', { name: '上一页任务', exact: true }).isEnabled(), false);
      assert.deepEqual(taskRequests.at(-1), { before: null, status: 'blocked' }, 'a changed task filter resets the pagination boundary');
      await page.getByText('来源要求验证，已暂停此项采集', { exact: false }).locator('..').getByRole('button', { name: '执行记录', exact: true }).click();
      await page.getByText('测试来源验证，已停止自动重试', { exact: true }).waitFor();
      await page.getByText('来源要求验证，已暂停此项采集', { exact: false }).locator('..').getByRole('button', { name: '重新检查', exact: true }).click();
      assert.ok(writes.some(item => item.path === '/jobs/75/retry'));
      await page.getByRole('button', { name: '导入原文链接', exact: true }).click();
      await page.getByRole('combobox', { name: '导入目标公众号', exact: true }).selectOption('2');
      await page.getByRole('textbox', { name: '微信原文链接', exact: true }).fill('https://mp.weixin.qq.com/s/test');
      await page.getByRole('button', { name: '加入采集队列', exact: true }).click();
      assert.deepEqual(writes.at(-1), { path: '/accounts/2/import', body: { urls: ['https://mp.weixin.qq.com/s/test'] } });
      await page.getByRole('checkbox', { name: '启用测试公众号 A监控', exact: true }).uncheck();
      assert.ok(writes.some(item => item.path === '/accounts/1' && item.body.enabled === false));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.getByRole('button', { name: '文章', exact: true }).click();
      await page.getByRole('button', { name: /观察计划｜测试内容 1/ }).waitFor();
      additionalArticle = true;
      await page.clock.runFor(15001);
      await page.getByRole('button', { name: /后台新增的测试文章/ }).waitFor();
      failOverview = true; await page.clock.runFor(15001);
      await page.getByRole('alert').filter({ hasText: '本地测试连接暂时断开' }).waitFor();
      const previousReads = articleReads;
      failOverview = false; await page.clock.runFor(15001);
      await page.getByRole('alert').filter({ hasText: '本地测试连接暂时断开' }).waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: /后台新增的测试文章/ }).waitFor();
      assert.ok(articleReads > previousReads, 'reconnection reloads the list even if counts did not change');
      failedArticle = true; await page.getByRole('button', { name: '刷新', exact: true }).click();
      const failedRow = page.getByRole('button', { name: /分析失败的测试文章/ });
      await failedRow.getByText('分析未完成，可在后台任务查看原因', { exact: true }).waitFor();
      assert.equal(await failedRow.getByText('后台正在分析文风与结构', { exact: true }).count(), 0);
      await failedRow.click();
      await page.getByRole('alert').filter({ hasText: '测试：分析证据不合格' }).waitFor();
      allowed = false; await page.getByRole('button', { name: '刷新', exact: true }).click();
      assert.equal(await page.getByText(/今日学习预算已用完/).count(), 0, 'high token usage does not display an allowance pause');
      await page.getByRole('button', { name: '导入原文链接', exact: true }).waitFor({ state: 'hidden' });
      assert.equal(await page.getByRole('checkbox', { name: '启用测试公众号 A监控', exact: true }).count(), 0);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ width, passed: true, scopedRequests: true, articleAndOriginal: true, relatedNavigation: true,
        groupToArticle: true, retryAndImport: true, administratorControls: true, safePreview: true, noOverflow: true, liveArticlesAppear: true, reconnectRecovery: true,
        stableTaskCursorDuringPolling: true }));
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
