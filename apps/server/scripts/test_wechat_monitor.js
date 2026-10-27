const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const content = require('../lib/wechat_monitor_content');
const sources = require('../lib/wechat_monitor_discovery');
const learning = require('../lib/wechat_monitor_learning');
const { retryPlan, safeErrorMessage } = require('../lib/wechat_monitor_worker');
const { makeStore } = require('../lib/wechat_monitor_store');
const account = { biz: null, expected_names: '["测试官微"]', since_date: '2024-01-01' };
const paragraph = '同学们带着观察记录来到报告厅。讲述从一个问题开始，再用具体行动回应。';
function html({ date = 1711929600, author = '测试官微', idx = 1, text = paragraph } = {}) {
  return `<html><head><meta property="og:title" content="观察计划｜从问题到行动"></head><body><h1 id="activity-name">观察计划｜从问题到行动</h1>
    <a id="js_name">${author}</a><div id="js_content"><p style="font-size:16px;color:#123456">${text}</p>
    <img data-src="https://mmbiz.qpic.cn/test.jpg"><p>欢迎同学们留下自己的观察。</p></div>
    <script>var ct = "${date}"; var biz = "TEST_BIZ"; var appmsgid = "123456"; var idx = "${idx}";</script></body></html>`;
}
const source = () => content.parseArticle(html(), 'https://mp.weixin.qq.com/s/valid', account, Date.parse('2026-10-25'));
function analysis() {
  return { summary: '以问题引入具体行动，段落简短，邀请读者交流。', scene: 'events', sceneConfidence: 0.9, sceneEvidence: ['来到报告厅'],
    dimensions: Object.fromEntries(Object.keys(learning.DIMENSIONS).map(key => [key, { finding: '先提出问题，再交代行动。', evidence: ['讲述从一个问题开始'] }])),
    lessons: [{ principle: '问题与行动对应', application: '用于实践活动报道', caveat: '不替换真实活动事实', evidence: ['再用具体行动回应'] }],
    seriesCandidates: [{ name: '观察计划', confidence: 0.9, evidence: ['观察计划｜从问题到行动'] }], related: [] };
}
test('monitor usage remains measurable without imposing a daily allowance, including stale finite configuration', async () => {
  const previous = process.env.WECHAT_MONITOR_DAILY_TOKENS;
  try {
    const store = makeStore({ query: async () => [[{ tokens: 9000000 }]] }, () => Date.parse('2026-10-26T17:00:00+08:00'));
    for (const configured of [undefined, '1000', '400000']) {
      if (configured === undefined) delete process.env.WECHAT_MONITOR_DAILY_TOKENS;
      else process.env.WECHAT_MONITOR_DAILY_TOKENS = configured;
      const usage = await store.modelBudget();
      assert.equal(usage.usedTokens, 9000000);
      assert.equal(usage.limitTokens, null);
      assert.equal(usage.unlimited, true);
      assert.equal(usage.paused, false);
      assert.equal(usage.resetAt, null);
    }
  } finally {
    if (previous === undefined) delete process.env.WECHAT_MONITOR_DAILY_TOKENS;
    else process.env.WECHAT_MONITOR_DAILY_TOKENS = previous;
  }
});
test('article parsing reuses reverse import, checks target/date, retains visual evidence and deduplicates tracking aliases', () => {
  const parsed = source();
  assert.equal(parsed.author, '测试官微'); assert.equal(parsed.publishedAt, 1711929600000);
  assert.match(parsed.blocks.join(''), /https:\/\/mmbiz.qpic.cn\/test.jpg/); assert.ok(parsed.text.includes(paragraph));
  assert.ok(parsed.visualFeatures.palette.some(item => item.value === '#123456'));
  const long = 'https://mp.weixin.qq.com/s?__biz=TEST_BIZ&mid=123456&idx=1&sn=known&scene=1';
  assert.equal(content.parseArticle(html(), long, account, Date.parse('2026-10-25')).canonicalKey, parsed.canonicalKey);
  assert.notEqual(content.parseArticle(html({ idx: 2 }), long, account, Date.parse('2026-10-25')).canonicalKey, parsed.canonicalKey);
  assert.throws(() => content.parseArticle(html({ author: '其他账号' }), long, account), { code: 'ACCOUNT_MISMATCH' });
  assert.throws(() => content.parseArticle(html({ date: 1640995200 }), long, account), { code: 'BEFORE_HISTORY_START' });
  assert.throws(() => content.parseArticle(html().replace('var ct = "1711929600";', ''), long, account), { code: 'PUBLICATION_DATE_UNKNOWN' });
  const dayOnly = html().replace('var ct = "1711929600";', '') + '<span id="publish_time">2024年4月1日</span>';
  assert.equal(content.parseArticle(dayOnly, long, account).metadata.datePrecision, 'day', 'unknown clock time is not presented as a verified midnight timestamp');
  assert.throws(() => content.parseArticle('<h1>环境异常，请完成验证</h1>', long, account), { code: 'SOURCE_VERIFICATION_REQUIRED' });
  assert.equal(content.parseArticle(html(), long, { ...account, biz: 'TEST_BIZ' }).identityStatus, 'biz_verified');
  assert.throws(() => content.parseArticle(html(), long, { ...account, biz: 'DIFFERENT' }), { code: 'ACCOUNT_MISMATCH' });
});
test('article URLs and public source allowlists reject SSRF, credential injection and non-article paths', () => {
  for (const url of ['https://mp.weixin.qq.com@127.0.0.1/s/a', 'https://mp.weixin.qq.com.evil.test/s/a',
    'file:///etc/passwd', 'https://mp.weixin.qq.com:444/s/a', 'https://mp.weixin.qq.com/cgi-bin/login', 'https://mp.weixin.qq.com/s?scene=1']) assert.throws(() => content.canonicalUrl(url));
  assert.equal(content.canonicalUrl('http://mp.weixin.qq.com/s/short?scene=1#wechat'), 'https://mp.weixin.qq.com/s/short');
  assert.match(content.canonicalUrl('https://mp.weixin.qq.com/s?src=11&timestamp=1&ver=2&signature=public-signature&new=1'), /signature=public-signature/);
  for (const url of ['https://www.bza.edu.cn/admin', 'https://www.bza.edu.cn/detail/x/admin', 'https://news.hit.edu.cn/admin',
    'https://weixin.sogou.com/../../private', 'https://localhost/s']) assert.throws(() => sources.sourceUrl(url));
  assert.equal(sources.sourceUrl('http://weixin.sogou.com/link?url=known').protocol, 'https:');
});
test('robots policy honors the longest path rule, exact user-agent and allow ties; Sogou automation is disabled', async () => {
  assert.equal(sources.robotsAllowed('User-agent: *\nDisallow: /', '/weixin?query=x'), false);
  assert.equal(sources.robotsAllowed('User-agent: *\nDisallow: /\nAllow: /public', '/public/index'), true);
  assert.equal(sources.robotsAllowed('User-agent: *\nDisallow: /x*\nAllow: /x*', '/xyz'), true);
  assert.equal(sources.robotsAllowed('User-agent: *\nDisallow: /\nUser-agent: MaMage-WeChatMonitor\nAllow: /', '/news'), true);
  let called = false;
  await assert.rejects(sources.fetchPage('https://weixin.sogou.com/weixin?type=2&query=test', { open: () => { called = true; } }), { code: 'SOURCE_POLICY_DISALLOWED' });
  assert.equal(called, false, 'policy-disallowed search pages are never fetched by the background worker');
});
test('discovery uses published official links and JSON only, filters account hosts and never executes scripts', () => {
  const page = '<a href="https://mp.weixin.qq.com/s/article">文章</a><a href="/xxyw/list2.htm">下一页</a><a href="https://evil.test">忽略</a>';
  const found = sources.parseOfficialIndex(page, 'https://news.hit.edu.cn/xxyw/list.htm', 'hit');
  assert.equal(found.articles[0].url, 'https://mp.weixin.qq.com/s/article');
  assert.deepEqual(found.pages, ['https://news.hit.edu.cn/xxyw/list2.htm']);
  assert.throws(() => sources.parseOfficialIndex(page, 'https://news.hit.edu.cn/xxyw/list.htm', 'bjzgca'), { code: 'ACCOUNT_SOURCE_MISMATCH' });
  const nuxt = '<script id="__NUXT_DATA__" type="application/json">["https://mp.weixin.qq.com/s/bza","https://www.bza.edu.cn/detail/123"]</script>';
  assert.equal(sources.parseOfficialIndex(nuxt, 'https://www.bza.edu.cn/news/', 'bjzgca').articles.length, 1);
  assert.throws(() => sources.parseOfficialIndex('<html>新版本页面</html>', 'https://www.bza.edu.cn/news/', 'bjzgca'), { code: 'SOURCE_FORMAT_CHANGED' });
  const search = sources.searchUrl('哈尔滨工业大学', { from: '2024-01-01', to: '2024-01-31' });
  assert.equal(new URL(search).searchParams.has('tsn'), false, 'unverified date-filter parameters are never presented as a supported API');
});
test('official discovery accepts published underscore article ids and deduplicates directory aliases', () => {
  const sitemap = 'https://www.bza.edu.cn/detail/cnews_abc123\nhttps://www.bza.edu.cn/detail/culture_def456';
  assert.deepEqual(sources.parseOfficialIndex(sitemap, 'https://www.bza.edu.cn/sitemap.txt', 'bjzgca').pages, sitemap.split('\n'));
  const aliases = '<a href="/news#info">学院动态</a><a href="/news/#video">视频</a><a href="https://mp.weixin.qq.com/s/known">原文</a>';
  assert.deepEqual(sources.parseOfficialIndex(aliases, 'https://www.bza.edu.cn/news/', 'bjzgca').pages, []);
  for (const url of ['https://www.bza.edu.cn/detail/../admin', 'https://www.bza.edu.cn/detail/cnews_abc/admin',
    'https://www.bza.edu.cn/detail/a%2fb', 'https://www.bza.edu.cn/api/article?type=private&page=1&limit=5',
    'https://www.bza.edu.cn/api/article?type=school&page=0&limit=5',
    'https://www.bza.edu.cn/api/article?type=school&page=1&limit=500',
    'https://www.bza.edu.cn/api/article?type=school&page=1&limit=5&url=http://localhost']) assert.throws(() => sources.sourceUrl(url));
});
test('school public pagination discovers article links without mixing website text into the WeChat corpus', () => {
  const url = 'https://www.bza.edu.cn/api/article?type=school&page=2&limit=5';
  const response = { data: [
    { uuid: 'cnews_abc', title: '已公开的原文', date: '2025-10-01T00:00:00.000Z', link: 'https://mp.weixin.qq.com/s/candidate?scene=1' },
    { uuid: 'culture_def', title: '官网正文不是官微原文', date: '2025-09-01T00:00:00.000Z', content: '<p>正文</p><a href="https://mp.weixin.qq.com/s/linked">原文</a>' },
  ], pagination: { current: 2, total: 13 } };
  const found = sources.parseOfficialIndex(JSON.stringify(response), url, 'bjzgca');
  assert.deepEqual(found.articles.map(item => item.url), ['https://mp.weixin.qq.com/s/candidate', 'https://mp.weixin.qq.com/s/linked']);
  assert.ok(found.pages.includes('https://www.bza.edu.cn/api/article?type=school&page=3&limit=5'));
  assert.equal(found.coverage, 'official_index_partial');
  assert.throws(() => sources.parseOfficialIndex('{"error":"unavailable"}', url, 'bjzgca'), { code: 'SOURCE_FORMAT_CHANGED' });
  assert.throws(() => sources.parseOfficialIndex(JSON.stringify({ ...response, pagination: { current: 1, total: 13 } }), url, 'bjzgca'), { code: 'SOURCE_FORMAT_CHANGED' });
  const older = { data: [{ uuid: 'old', title: '历史', date: '2023-12-01T00:00:00.000Z', link: 'https://mp.weixin.qq.com/s/old' }], pagination: { current: 2, total: 20 } };
  assert.deepEqual(sources.parseOfficialIndex(JSON.stringify(older), url, 'bjzgca', { since: '2024-01-01' }).pages, []);
});
test('HIT history follows the article list and next page rather than sidebar aliases and the last page', () => {
  const html = '<div class="col-slide"><a href="/2026/1027/c11508a999/page.htm">侧栏</a></div>'
    + '<div class="col_news_con"><div id="wp_news_w13"><a href="https://mp.weixin.qq.com/s/real">文章</a>'
    + '<a href="/2026/1027/c1510a1000/page.htm">详情</a></div>'
    + '<div id="wp_paging_w13"><a class="prev" href="/xxyw/list.htm">上一页</a>'
    + '<a class="next" href="/xxyw/list3.htm">下一页</a><a class="last" href="/xxyw/list406.htm">尾页</a></div></div>';
  const found = sources.parseOfficialIndex(html, 'https://news.hit.edu.cn/xxyw/list2.htm', 'hit');
  assert.deepEqual(found.pages, ['https://news.hit.edu.cn/2026/1027/c1510a1000/page.htm', 'https://news.hit.edu.cn/xxyw/list3.htm']);
  assert.equal(found.articles.length, 1);
  const older = '<div class="col_news_con"><div id="wp_news_w13"><a href="/hgdqmt/list.htm">分类</a>'
    + '<a href="https://news.hit.edu.cn/2023/1231/c1510a1000/page.htm">旧文章</a></div>'
    + '<div id="wp_paging_w13"><a class="next" href="/xxyw/list30.htm">下一页</a></div></div>';
  assert.deepEqual(sources.parseOfficialIndex(older, 'https://news.hit.edu.cn/xxyw/list29.htm', 'hit').pages, [],
    'category navigation must not keep pre-2024 history traversal alive');
});
test('the university homepage is a first-class official WeChat discovery source', () => {
  const page = '<a href="https://mp.weixin.qq.com/s/official-feature">官微精选</a>'
    + '<a href="https://news.hit.edu.cn/xxyw/list.htm">新闻网</a><a href="/admin">忽略</a>';
  const found = sources.parseOfficialIndex(page, 'https://www.hit.edu.cn/', 'hit');
  assert.equal(found.articles[0].url, 'https://mp.weixin.qq.com/s/official-feature');
  assert.deepEqual(found.pages, ['https://news.hit.edu.cn/xxyw/list.htm']);
  assert.throws(() => sources.parseOfficialIndex(page, 'https://www.hit.edu.cn/', 'bjzgca'), { code: 'ACCOUNT_SOURCE_MISMATCH' });
  assert.throws(() => sources.sourceUrl('https://www.hit.edu.cn/admin'));
});
test('search discovery reads the observed publisher span and never treats missing attribution as a target match', () => {
  const row = (title, footer) => `<li><h3><a href="https://mp.weixin.qq.com/s/${title}">${title}</a></h3>${footer}</li>`;
  const html = '<ul class="news-list">' + row('target', '<div class="s-p"><span class="all-time-y2">哈尔滨工业大学</span></div>')
    + row('other-campus', '<div class="s-p"><span class="all-time-y2">哈尔滨工业大学深圳校区</span></div>')
    + row('missing', '') + '</ul>';
  const found = sources.parseSearch(html, sources.searchUrl('哈尔滨工业大学'), '哈尔滨工业大学');
  assert.deepEqual(found.articles.map(article => article.title), ['target']);
  assert.equal(found.articles[0].account, '哈尔滨工业大学');
  const legacy = '<ul class="news-list">' + row('legacy', '<div class="s-p"><a class="account">哈尔滨工业大学</a></div>') + '</ul>';
  assert.equal(sources.parseSearch(legacy, sources.searchUrl('哈尔滨工业大学'), '哈尔滨工业大学').articles.length, 1);
});
test('official history follows HIT legacy pagination redirects without admitting arbitrary PSP endpoints', async () => {
  const original = 'https://news.hit.edu.cn/hgdqmt/list11.htm';
  const destination = 'https://news.hit.edu.cn/hgdqmt/list11.psp';
  const checked = [];
  const page = await sources.fetchPage(original, {
    checkRobots: async url => { checked.push(url.href); },
    open: async (_url, options) => {
      await options.validateUrl(new URL(destination));
      const response = Readable.from([Buffer.from('<a href="/hgdqmt/list12.psp">下一页</a>')]);
      response.statusCode = 200; response.headers = {};
      return { response, url: destination };
    },
  });
  assert.deepEqual(checked, [original, destination]);
  assert.deepEqual(sources.parseOfficialIndex(page.html, page.finalUrl, 'hit').pages,
    ['https://news.hit.edu.cn/hgdqmt/list12.psp']);
  assert.equal(sources.sourceUrl('https://news.hit.edu.cn/xxyw/list406.psp').pathname, '/xxyw/list406.psp');
  assert.equal(sources.sourceUrl('https://news.hit.edu.cn/2024/0117/c11819a235170/page.psp').pathname,
    '/2024/0117/c11819a235170/page.psp');
  for (const url of ['https://news.hit.edu.cn/admin.psp', 'https://news.hit.edu.cn/hgdqmt/edit.psp',
    'https://news.hit.edu.cn/xxyw/list11.psp/admin', 'https://news.hit.edu.cn/2024/0117/c11819a235170/edit.psp',
    'https://evil.test/hgdqmt/list11.psp']) assert.throws(() => sources.sourceUrl(url));
});
test('source transport detects challenges and rate limits without turning either into empty results', async () => {
  const fake = (body, statusCode = 200) => { const response = Readable.from([Buffer.from(body)]); response.statusCode = statusCode; response.headers = {}; return response; };
  await assert.rejects(sources.fetchPage('https://mp.weixin.qq.com/s/post', { checkRobots: async () => {},
    open: async () => ({ response: fake('<title>环境异常</title><p>完成验证后继续</p>'), url: 'https://mp.weixin.qq.com/s/post' }) }), { code: 'SOURCE_VERIFICATION_REQUIRED' });
  await assert.rejects(sources.fetchPage('https://mp.weixin.qq.com/s/post', { checkRobots: async () => {},
    open: async () => ({ response: fake('', 429), url: 'https://mp.weixin.qq.com/s/post' }) }), { code: 'SOURCE_RATE_LIMITED' });
  await assert.rejects(sources.fetchPage('https://mp.weixin.qq.com/s/post', { checkRobots: async () => {},
    open: async () => ({ response: fake('', 403), url: 'https://mp.weixin.qq.com/s/post' }) }), { code: 'SOURCE_ACCESS_DENIED' });
  const checked = [];
  await assert.rejects(sources.fetchPage('https://news.hit.edu.cn/xxyw/list.htm', {
    checkRobots: async url => {
      checked.push(url.hostname);
      if (url.hostname === 'mp.weixin.qq.com') throw content.invalid('SOURCE_ROBOTS_DISALLOWED', '测试跳转目标禁止采集', 422);
    },
    open: async (_url, options) => {
      await options.validateUrl(new URL('https://mp.weixin.qq.com/s/redirected'));
      throw Error('Redirected content must not be requested');
    },
  }), { code: 'SOURCE_ROBOTS_DISALLOWED' });
  assert.deepEqual(checked, ['news.hit.edu.cn', 'mp.weixin.qq.com'], 'redirect destinations must have their own robots policy checked');
  await assert.rejects(require('../lib/public_remote_fetch').openPublicHttps('https://news.hit.edu.cn/xxyw/list.htm', {
    validateUrl: async () => { throw content.invalid('TEST_POLICY_DENIED', '异步来源规则拒绝'); },
  }), { code: 'TEST_POLICY_DENIED' }, 'the shared transport awaits asynchronous policy validation before resolving or contacting the source');
});
test('analysis validates every dimension, quotations, series evidence and authorized comparison scope', () => {
  const article = source(), raw = analysis();
  assert.equal(learning.validateAnalysis(raw, article).seriesCandidates[0].status, 'candidate');
  raw.dimensions.lead.evidence = ['原文中没有的证据'];
  assert.throws(() => learning.validateAnalysis(raw, article), { code: 'ANALYSIS_UNGROUNDED' });
  const invented = analysis(); invented.seriesCandidates[0].name = '自造品牌';
  assert.throws(() => learning.validateAnalysis(invented, article), { code: 'ANALYSIS_UNGROUNDED' });
  const foreign = analysis(); foreign.related = [{ articleId: 999, kind: 'writing_pattern' }];
  assert.throws(() => learning.validateAnalysis(foreign, article), { code: 'ANALYSIS_INVALID' });
  const omitted = analysis(); delete omitted.dimensions.language;
  assert.throws(() => learning.validateAnalysis(omitted, article), { code: 'ANALYSIS_INVALID' });
  const verbalConfidence = analysis(); verbalConfidence.sceneConfidence = 'high';
  assert.throws(() => learning.validateAnalysis(verbalConfidence, article), { code: 'ANALYSIS_INVALID' });
  const punctuation = analysis(); punctuation.dimensions.lead.evidence = ['讲述从一个问题开始。'];
  assert.equal(learning.validateAnalysis(punctuation, article).dimensions.lead.evidence[0], '讲述从一个问题开始');
  punctuation.dimensions.lead.evidence = ['讲述从一个错误观点开始。'];
  assert.throws(() => learning.validateAnalysis(punctuation, article), { code: 'ANALYSIS_UNGROUNDED' });
  const metric = analysis(); metric.dimensions.images = { finding: 'HTML 中未提取到图像内容理解结果。', evidence: [], visualEvidence: ['imageCount', 'limitation'], notObserved: true };
  const grounded = learning.validateAnalysis(metric, article).dimensions.images;
  assert.equal(grounded.metrics.imageCount, article.visualFeatures.imageCount);
  assert.equal(grounded.notObserved, true);
  metric.dimensions.images.visualEvidence = ['inventedMetric'];
  assert.throws(() => learning.validateAnalysis(metric, article), { code: 'ANALYSIS_INVALID' });
});
test('numbered brand installments remain series candidates without promoting generic topics or annual dates', () => {
  const check = (title, name) => {
    const article = { ...source(), title };
    const raw = analysis(); raw.seriesCandidates = [{ name, confidence: 0.9, evidence: [title] }];
    return learning.validateAnalysis(raw, article).seriesCandidates[0];
  };
  const candidate = check('北京中关村学院AI共创营（第二期）报名开启', 'AI共创营');
  assert.equal(candidate.eligibleForGrouping, true);
  assert.equal(candidate.status, 'candidate', 'one article never establishes an actual series');
  assert.equal(check('北京中关村学院第2期AI共创营报名开启', 'AI共创营').eligibleForGrouping, true);
  assert.equal(check('青年说 Vol. 12：从问题到行动', '青年说').eligibleForGrouping, true);
  assert.equal(check('学校要闻（第二期）', '学校要闻').eligibleForGrouping, false);
  assert.equal(check('哈工大2024年新年献词', '新年献词').eligibleForGrouping, false);
  assert.equal(check('AI共创营介绍：参与第二期校内交流', 'AI共创营').eligibleForGrouping, false);
  assert.equal(check('科研进展（第3期）', '科研进展').eligibleForGrouping, false);
});
test('group fingerprints invalidate summaries after a new analysis or a publication-date correction', () => {
  const members = [{ id: 1, revisionId: 3, analysisId: 5, published_at: 1711929600000 }];
  const fingerprint = learning.groupFingerprint(members);
  assert.notEqual(learning.groupFingerprint([{ ...members[0], analysisId: 6 }]), fingerprint);
  assert.notEqual(learning.groupFingerprint([{ ...members[0], published_at: 1712016000000 }]), fingerprint);
});
test('explicitly mislabeled narrative pronouns are rejected across quote styles and receive one bounded repair', async () => {
  for (const text of ['以第二人称复数“我们”叙述', '以第二人称复数‘我们’叙述', '第一人称（你们）贯穿全文']) {
    const raw = analysis(); raw.summary = text;
    assert.throws(() => learning.validateAnalysis(raw, source()), { code: 'ANALYSIS_INCONSISTENT', field: 'summary' });
  }
  const correct = analysis(); correct.summary = '集体第一人称“我们”与面向读者的第二人称“你们”交替。';
  assert.equal(learning.validateAnalysis(correct, source()).summary, correct.summary);
  correct.summary = '这是第一人称“我们”，并非第二人称“我们”的称呼。';
  assert.equal(learning.validateAnalysis(correct, source()).summary, correct.summary);
  correct.dimensions.narrative.finding = '以第三人称“你们”展开';
  assert.throws(() => learning.validateAnalysis(correct, source()), { code: 'ANALYSIS_INCONSISTENT', field: 'dimensions.narrative.finding' });
  let calls = 0;
  const result = await learning.analyzeArticle(source(), [], { request: async input => {
    calls++; const raw = analysis();
    if (calls === 1) raw.summary = '以第二人称复数‘我们’和机构自称交替叙述。';
    else {
      const repair = JSON.parse(input.prompt);
      assert.equal(repair.validationField, 'summary');
      assert.match(repair.validationError, /我们.*第一人称/);
      raw.summary = '机构第三人称叙述与集体第一人称“我们”的号召交替。';
    }
    return { raw, tokens: 10 };
  } });
  assert.equal(calls, 2); assert.equal(result.tokens, 20);
  assert.equal(retryPlan({ code: 'ANALYSIS_INCONSISTENT' }, 1, 1000).status, 'failed');
});
test('long grounded excerpts are shortened only after checking the entire quote against its source', () => {
  const article = { ...source(), text: paragraph.repeat(5) };
  const raw = analysis(); raw.dimensions.lead.evidence = [paragraph.repeat(4)];
  const excerpt = learning.validateAnalysis(raw, article).dimensions.lead.evidence[0];
  assert.ok(excerpt.length <= 80); assert.ok(article.text.includes(excerpt));
  raw.dimensions.lead.evidence = [paragraph.repeat(4) + '这里是编造的结尾'];
  assert.throws(() => learning.validateAnalysis(raw, article), { code: 'ANALYSIS_UNGROUNDED' });
});
test('comparison excludes duplicate content; group patterns require two independent article quotes', async () => {
  const article = { ...source(), id: 1 };
  assert.equal(learning.selectCandidates(article, [{ ...article, id: 2 }]).length, 0);
  const members = [1, 2].map(id => ({ id, revisionId: id, title: article.title, text: article.text, analysis: analysis() }));
  const result = await learning.summarizeGroup({ name: '活动报道', kind: 'scene' }, members, { request: async () => ({ tokens: 100,
    raw: { summary: '以问题组织活动叙事。', patterns: [{ principle: '问题回应', application: '实践交流', caveat: '不要虚构行动',
      support: members.flatMap(item => [{ articleId: item.id, quote: '具体行动回应' }, { articleId: item.id, quote: '讲述从一个问题开始' }]) }], differences: ['样本数量有限，不能证明全场景有效。'] } }) });
  assert.equal(result.summary.patterns[0].support.length, 4, 'multiple grounded quotes from each of two independent articles are valid');
  await assert.rejects(learning.summarizeGroup({ name: '测试' }, members, { request: async () => ({ raw: { summary: '不充分',
    patterns: [{ support: [{ articleId: 1, quote: '讲述从一个问题开始' }] }], differences: [] } }) }), { code: 'ANALYSIS_UNGROUNDED' });
});
test('group repair identifies the exact malformed JSON field and does not accept missing arrays', async () => {
  const article = { ...source(), id: 1 };
  const members = [1, 2].map(id => ({ id, revisionId: id, title: article.title, text: article.text, analysis: analysis() }));
  let calls = 0;
  const result = await learning.summarizeGroup({ name: '测试场景', kind: 'scene' }, members, { request: async input => {
    calls++;
    if (calls === 1) return { raw: { summary: '有共同结构，但未按协议返回数组。', patterns: [], differences: null }, tokens: 10 };
    const repair = JSON.parse(input.prompt);
    assert.equal(repair.validationField, 'differences');
    return { raw: { summary: '相同的写作问题需要对照独立文章核验。', patterns: [], differences: ['样本过少，未作风格泛化。'] }, tokens: 10 };
  } });
  assert.equal(calls, 2); assert.equal(result.tokens, 20);
});
test('a single bounded repair corrects fabricated evidence, preserves the article and accounts for both model calls', async () => {
  const article = source(); let calls = 0;
  const result = await learning.analyzeArticle(article, [], { request: async input => {
    const raw = analysis(); calls++;
    if (calls === 1) raw.dimensions.lead.evidence = ['编造的证据'];
    else { const repair = JSON.parse(input.prompt); assert.equal(repair.invalidEvidence, '编造的证据'); assert.ok(repair.original.text.includes(paragraph)); }
    return { raw, tokens: 100 };
  } });
  assert.equal(calls, 2); assert.equal(result.tokens, 200); assert.equal(article.text.includes(paragraph), true);
  let rejected = 0;
  await assert.rejects(learning.analyzeArticle(article, [], { request: async () => {
    rejected++; const raw = analysis(); raw.sceneEvidence = ['仍然编造']; return { raw, tokens: 100 };
  } }), { code: 'ANALYSIS_UNGROUNDED' });
  assert.equal(rejected, 2, 'invalid output never triggers an unbounded repair loop');
});
test('history windows are truthful calendar ranges and transient failures back off without retrying captcha', () => {
  assert.deepEqual(sources.historicalWindows('2024-01-01', Date.parse('2024-02-20T12:00:00+08:00')), [
    { from: '2024-02-01', to: '2024-02-20' }, { from: '2024-01-01', to: '2024-01-31' }]);
  assert.throws(() => content.dateTimestamp('2024-02-30'));
  assert.deepEqual(retryPlan({ code: 'SOURCE_VERIFICATION_REQUIRED' }, 1, 1000), { status: 'blocked', at: 1000 });
  assert.equal(retryPlan({ code: 'SOURCE_ACCESS_DENIED' }, 1, 1000).status, 'blocked');
  assert.equal(retryPlan({ code: 'ANALYSIS_UNGROUNDED' }, 1, 1000).status, 'failed', 'a rejected analysis already exhausted its one bounded repair and must not trigger ten costly model calls');
  assert.equal(retryPlan({ code: 'ECONNRESET' }, 2, 1000).at, 121000);
  assert.equal(retryPlan({ code: 'ECONNRESET' }, 5, 1000).status, 'failed');
  assert.equal(safeErrorMessage(Error('sk-sensitive123 https://source.test/?token=secret Bearer credential')), '[redacted-key] [source-url] Bearer [redacted]');
});
module.exports = { html, analysis, account };
