const assert = require('node:assert/strict');
const { test } = require('node:test');
const { officialAccounts, createOfficialClient, classifyErrcode } = require('../lib/wechat_official_api');

const APPID = 'wx' + 'a'.repeat(16), SECRET = 'b'.repeat(32);
const account = { key: 'bjzgca', appid: APPID, secret: SECRET };
const tokenDoc = { access_token: 'tok-1', expires_in: 7200 };
const news = (url, title = '文章', extra = {}) => ({ title, url, is_deleted: false, ...extra });

function fakeFetch(handler) {
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body });
    const value = handler(url, options, calls);
    if (value instanceof Response) return value;
    return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { request, calls };
}

test('公众号官方 API 凭据支持分账号变量与 JSON 配置，非法配置不静默', () => {
  const accounts = officialAccounts({
    WECHAT_OFFICIAL_BJZGCA_APPID: APPID, WECHAT_OFFICIAL_BJZGCA_SECRET: SECRET,
    WECHAT_OFFICIAL_ACCOUNTS: JSON.stringify([{ key: 'hit', appid: APPID, secret: SECRET }]),
  });
  assert.deepEqual(accounts.map(item => item.key).sort(), ['bjzgca', 'hit']);
  assert.equal(accounts.find(item => item.key === 'bjzgca').secret, SECRET);
  const codeOf = action => { try { action(); } catch (error) { return error.code; } return null; };
  assert.equal(codeOf(() => officialAccounts({ WECHAT_OFFICIAL_ACCOUNTS: '{bad json' })), 'WECHAT_API_CONFIG_INVALID');
  assert.equal(codeOf(() => officialAccounts({ WECHAT_OFFICIAL_ACCOUNTS: JSON.stringify([{ key: 'Bad Key', appid: APPID, secret: SECRET }]) })),
    'WECHAT_API_CONFIG_INVALID');
  assert.deepEqual(officialAccounts({}), []);
});

test('获取已发布列表：token 缓存、URL 过滤去重、分页停止', async () => {
  const pages = {
    0: { total_count: 40, item: [{ article_id: 'a1', update_time: 100, content: { news_item: [
      news('https://mp.weixin.qq.com/s?__biz=x&mid=1&idx=1'),
      news('https://mp.weixin.qq.com/s?__biz=x&mid=1&idx=1'), // 重复 URL
      news('https://mp.weixin.qq.com/s?__biz=x&mid=2', '已删除', { is_deleted: true }),
      news('https://example.com/not-wechat'),
    ] } }] },
    20: { total_count: 40, item: [{ article_id: 'a2', update_time: 200, content: { news_item: [
      news('https://mp.weixin.qq.com/s/abc123', '第二页文章'),
    ] } }] },
  };
  const fetcher = fakeFetch((url, options) => {
    if (url.includes('/cgi-bin/token')) return tokenDoc;
    const body = JSON.parse(options.body);
    return pages[body.offset] || { total_count: 40, item: [] };
  });
  const client = createOfficialClient({ request: fetcher.request, now: () => 1000 });
  const first = await client.recentArticles(account, { pages: 2, pageSize: 20 });
  assert.equal(first.total, 40);
  assert.deepEqual(first.items.map(item => item.url), [
    'https://mp.weixin.qq.com/s?__biz=x&mid=1&idx=1',
    'https://mp.weixin.qq.com/s/abc123',
  ]);
  const tokenCalls = fetcher.calls.filter(call => call.url.includes('/cgi-bin/token')).length;
  assert.equal(tokenCalls, 1);
  const batchCalls = fetcher.calls.filter(call => call.url.includes('/freepublish/batchget')).length;
  assert.equal(batchCalls, 2);
  // token 仍在缓存期：第二次调用不再请求 token
  await client.recentArticles(account, { pages: 1, pageSize: 20 });
  assert.equal(fetcher.calls.filter(call => call.url.includes('/cgi-bin/token')).length, 1);
});

test('官方 API 错误码映射：未授权/IP 未白名单/token 失效刷新一次/忙', async () => {
  assert.equal(classifyErrcode(48001), 'WECHAT_API_UNAUTHORIZED');
  assert.equal(classifyErrcode(40164), 'WECHAT_API_IP_NOT_ALLOWED');
  assert.equal(classifyErrcode(40001), 'WECHAT_API_TOKEN_INVALID');
  assert.equal(classifyErrcode(45009), 'WECHAT_API_BUSY');
  assert.equal(classifyErrcode(99999), 'WECHAT_API_ERROR');

  const rejectsWithCode = (promise, code) => assert.rejects(promise, error => { assert.equal(error.code, code); return true; });
  const unauthorized = fakeFetch(url => url.includes('/cgi-bin/token') ? tokenDoc : { errcode: 48001, errmsg: 'api unauthorized' });
  await rejectsWithCode(createOfficialClient({ request: unauthorized.request }).recentArticles(account), 'WECHAT_API_UNAUTHORIZED');

  const ipDenied = fakeFetch(url => url.includes('/cgi-bin/token') ? tokenDoc : { errcode: 40164, errmsg: 'invalid ip' });
  await rejectsWithCode(createOfficialClient({ request: ipDenied.request }).recentArticles(account), 'WECHAT_API_IP_NOT_ALLOWED');

  // 第一次 batchget 返回 token 失效，刷新后重试成功
  let batch = 0;
  const refresh = fakeFetch((url) => {
    if (url.includes('/cgi-bin/token')) return { access_token: 'tok-' + (batch + 1), expires_in: 7200 };
    batch += 1;
    if (batch === 1) return { errcode: 40001, errmsg: 'invalid credential' };
    return { total_count: 1, item: [{ article_id: 'a', update_time: 1, content: { news_item: [news('https://mp.weixin.qq.com/s/ok')] } }] };
  });
  const result = await createOfficialClient({ request: refresh.request }).recentArticles(account);
  assert.deepEqual(result.items.map(item => item.url), ['https://mp.weixin.qq.com/s/ok']);
  assert.equal(refresh.calls.filter(call => call.url.includes('/cgi-bin/token')).length, 2);
});

test('官方 API 非 JSON/HTTP 失败按来源不可用处理', async () => {
  const broken = fakeFetch(url => url.includes('/cgi-bin/token') ? new Response('not json', { status: 200 })
    : { total_count: 0, item: [] });
  const rejectsWithCode = (promise, code) => assert.rejects(promise, error => { assert.equal(error.code, code); return true; });
  await rejectsWithCode(createOfficialClient({ request: broken.request }).recentArticles(account), 'WECHAT_API_INVALID_RESPONSE');
  const http500 = fakeFetch(() => new Response('oops', { status: 500 }));
  await rejectsWithCode(createOfficialClient({ request: http500.request }).recentArticles(account), 'WECHAT_API_UNAVAILABLE');
});
