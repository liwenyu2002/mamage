const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const source = require('../lib/wechat_article_source');

const fixture = '<html><body><h1 id="activity-name">测试文章</h1><div id="js_content"><p>公开正文与排版。</p></div></body></html>';
function response(body = fixture, statusCode = 200, headers = {}) {
  const stream = Readable.from([Buffer.from(body)]); stream.statusCode = statusCode; stream.headers = headers; return stream;
}
test('shared reverse-import source accepts article links only and keeps the existing bounded request contract', async () => {
  let calls = 0;
  const result = await source.fetchWechatArticleHtml('http://mp.weixin.qq.com/s/sample#wechat', { open: async (url, options) => {
    calls++; assert.equal(url, 'https://mp.weixin.qq.com/s/sample'); assert.equal(options.timeoutMs, 10000);
    assert.equal(options.maxRedirects, 5); assert.match(options.userAgent, /Chrome\/124/);
    assert.equal(options.cookie, undefined); assert.equal(options.headers, undefined);
    assert.throws(() => options.validateUrl(new URL('https://127.0.0.1/s/private')), { code: 'INVALID_ARTICLE_URL' });
    return { response: response(), url };
  } });
  assert.equal(calls, 1); assert.equal(result.html, fixture);
  for (const url of ['https://mp.weixin.qq.com.evil.test/s/a', 'https://user:pass@mp.weixin.qq.com/s/a',
    'https://mp.weixin.qq.com:8080/s/a', 'https://mp.weixin.qq.com/cgi-bin/login', 'file:///etc/passwd']) {
    await assert.rejects(source.fetchWechatArticleHtml(url, { open: async () => { throw Error('Invalid sources must not be contacted'); } }), { code: 'INVALID_ARTICLE_URL' });
  }
});
test('verification, access denial and rate limiting are distinct from normal article content', async () => {
  const run = (body, status, headers) => source.fetchWechatArticleHtml('https://mp.weixin.qq.com/s/test', {
    open: async url => ({ url, response: response(body, status, headers) }),
  });
  await assert.rejects(run('<title>环境异常</title><body>完成验证后继续</body>', 200), { code: 'SOURCE_VERIFICATION_REQUIRED' });
  await assert.rejects(run('<body>此内容已被发布者删除</body>', 200), { code: 'ARTICLE_UNAVAILABLE' });
  await assert.rejects(run('', 403), { code: 'SOURCE_ACCESS_DENIED' });
  await assert.rejects(run('', 404), { code: 'SOURCE_NOT_FOUND' });
  await assert.rejects(run('', 429, { 'retry-after': '120' }), error => error.code === 'SOURCE_RATE_LIMITED' && error.retryAfter === 120000);
  await assert.rejects(run('x'.repeat(8 * 1024 * 1024 + 1), 200), { code: 'SOURCE_TOO_LARGE' });
  await assert.rejects(source.fetchWechatArticleHtml('https://mp.weixin.qq.com/s/test', {
    open: async () => { throw Object.assign(Error('network detail must not leak'), { code: 'SOURCE_TIMEOUT' }); },
  }), error => error.code === 'SOURCE_TIMEOUT' && !error.message.includes('network detail'));
});
test('a redirect to the observed WeChat challenge is recorded as verification without following it', async () => {
  let followed = false;
  await assert.rejects(source.fetchWechatArticleHtml('https://mp.weixin.qq.com/s/known', {
    open: async (_url, options) => {
      options.validateUrl(new URL('https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?poc_token=test&target_url=test'));
      followed = true;
    },
  }), { code: 'SOURCE_VERIFICATION_REQUIRED' });
  assert.equal(followed, false);
});
test('public transport preserves its default redirect cap while the existing article importer can follow up to five validated hops', async () => {
  const https = require('node:https'), dns = require('node:dns').promises;
  const originalRequest = https.request, originalLookup = dns.lookup;
  let finalHop = 3, validations = 0;
  dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  https.request = (url, options, callback) => {
    const request = new EventEmitter(); request.setTimeout = () => request;
    request.end = () => queueMicrotask(() => {
      const hop = Number(url.pathname.split('/').at(-1));
      options.lookup(url.hostname, {}, (error, address) => { assert.equal(error, null); assert.equal(address, '93.184.216.34'); });
      callback(response(hop < finalHop ? '' : fixture, hop < finalHop ? 302 : 200, hop < finalHop ? { location: `/s/${hop + 1}` } : {}));
    });
    return request;
  };
  try {
    const { openPublicHttps, readLimitedText } = require('../lib/public_remote_fetch');
    await assert.rejects(openPublicHttps('https://mp.weixin.qq.com/s/0'), { code: 'SOURCE_REDIRECT' });
    const opened = await openPublicHttps('https://mp.weixin.qq.com/s/0', { maxRedirects: 5, validateUrl: async url => {
      validations++; source.assertAllowedWechatUrl(url);
    } });
    assert.equal(validations, 4); assert.equal(await readLimitedText(opened.response), fixture);
    finalHop = 6;
    await assert.rejects(openPublicHttps('https://mp.weixin.qq.com/s/0', { maxRedirects: 5 }), { code: 'SOURCE_REDIRECT' });
  } finally { https.request = originalRequest; dns.lookup = originalLookup; }
});
test('a connection failure immediately after pinned DNS resolution rejects the request instead of crashing the process', () => {
  const script = String.raw`
    const dns = require('node:dns').promises, net = require('node:net');
    dns.lookup = async () => [{address:'93.184.216.34',family:4}];
    const emit = net.Socket.prototype.emit;
    net.Socket.prototype.emit = function(event,...args) {
      if (event==='lookup' && args[1]==='93.184.216.34') {
        this.destroy(Object.assign(Error('injected connect failure'), {code:'ENOMEM'})); return true;
      }
      return emit.call(this,event,...args);
    };
    require('./lib/public_remote_fetch').openPublicHttps('https://news.hit.edu.cn/xxyw/list.htm')
      .then(()=>{process.exitCode=2},error=>{console.log('caught:'+error.code);if(error.code!=='ENOMEM')process.exitCode=3});
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /caught:ENOMEM/);
});
