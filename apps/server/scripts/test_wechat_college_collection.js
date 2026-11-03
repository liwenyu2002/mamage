const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { DIRECTORY, TARGETS, directoryUrl, readDirectory, parseDirectory, reverseArticle, collectCollege } = require('../lib/wechat_college_collection');
const { canonicalUrl } = require('../lib/wechat_monitor_content');
const { sourceUrl } = require('../lib/wechat_monitor_discovery');
const { isPublicIp } = require('../lib/public_remote_fetch');
const now = Date.parse('2026-11-03T12:00:00+08:00');
const articleUrl = (target = TARGETS[0], mid = '123') => `https://mp.weixin.qq.com/s?__biz=${encodeURIComponent(target.biz)}&mid=${mid}&idx=1&sn=verified`;
const row = (target = TARGETS[0], mid = '123', href = articleUrl(target, mid), label = target.name) =>
  `<a class="news-row" href="${href.replaceAll('&', '&amp;')}"><time datetime="2026-10-30"></time><strong>交流活动 ${mid}</strong><span class="news-tag">${label}</span></a>`;
const directory = (rows = row(), links = '', total = 1) =>
  `<p class="list-summary">共 <b>${total}</b> 篇</p><ol class="news-list">${rows}</ol><nav class="news-pager">${links}</nav>`;
const article = (target = TARGETS[0], mid = '123', name = target.name) =>
  `<html><head><meta property="og:title" content="实践交流活动"></head><body><a id="js_name">${name}</a>
  <div id="js_content"><p style="font-size:16px;color:#123456">师生共同交流实践项目的进展，分享遇到的问题和下一步计划。</p>
  <img data-src="https://mmbiz.qpic.cn/test.jpg"><p>文：同学甲。初审：老师乙。终审：老师丙。</p></div>
  <script>var biz = "${target.biz}"; var ct = "1793318400"; var appmsgid = "${mid}"; var idx = "1";</script></body></html>`;
async function temp(t) {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'mamage-college-'));
  t.after(() => fs.rm(output, { recursive: true, force: true })); return output;
}
const dependencies = extra => ({ sleep: async () => {}, clock: () => now,
  readDirectory: async url => url.endsWith('/robots.txt') ? '' : directory(), ...extra });

test('LAN collector is exact-origin/path allowlisted and never relaxes public SSRF restrictions', async () => {
  assert.equal(directoryUrl(DIRECTORY + '?page=1'), DIRECTORY);
  assert.equal(directoryUrl(DIRECTORY + '?page=11'), DIRECTORY + '?page=11');
  for (const url of ['http://10.1.131.37/college', 'http://127.0.0.1/college', 'http://10.1.131.10:5050/college',
    'http://user@10.1.131.10/college', 'http://10.1.131.10/college/other', 'https://10.1.131.10/college',
    DIRECTORY + '?url=http://127.0.0.1', DIRECTORY + '?page=0', DIRECTORY + '?page=1&page=2', DIRECTORY + '#x']) {
    await assert.rejects(readDirectory(url, { request: () => { assert.fail('must reject before HTTP'); } }), { code: 'INVALID_DIRECTORY_URL' });
  }
  assert.equal(isPublicIp('10.1.131.10'), false);
  assert.throws(() => sourceUrl(DIRECTORY));
});

function mockRequest(status, body = '', headers = {}) {
  return (url, options, done) => {
    assert.equal(options.method, 'GET'); assert.equal(options.headers.Cookie, undefined);
    const req = new EventEmitter(); req.destroy = error => req.emit('error', error);
    req.end = () => { const response = Readable.from([Buffer.from(body)]); Object.assign(response, { statusCode: status, headers }); done(response); };
    return req;
  };
}
test('directory transport rejects redirects/auth errors and bounds response size', async () => {
  assert.equal(await readDirectory(DIRECTORY, { request: mockRequest(200, 'ok') }), 'ok');
  assert.equal(await readDirectory('http://10.1.131.10/robots.txt', { request: mockRequest(404) }), '');
  for (const [status, code] of [[302, 'SOURCE_REDIRECT_REJECTED'], [403, 'SOURCE_ACCESS_DENIED'], [429, 'SOURCE_RATE_LIMITED']]) {
    await assert.rejects(readDirectory(DIRECTORY, { request: mockRequest(status, '', { location: 'http://127.0.0.1' }) }), { code });
  }
  await assert.rejects(readDirectory(DIRECTORY, { request: mockRequest(200, 'x'.repeat(8 * 1024 * 1024 + 1)) }), { code: 'SOURCE_TOO_LARGE' });
});
test('directory parsing includes short links as unverified candidates and does not trust labels as publishers', () => {
  const parsed = parseDirectory(directory(row(TARGETS[1], '456', articleUrl(TARGETS[1], '456'), TARGETS[0].name)
    + row(TARGETS[0], '123', 'https://mp.weixin.qq.com/s/short') + row(TARGETS[0], '9', 'https://evil.test/s/x'),
  '<a href="/college?page=2">Next</a><a href="/college?page=2">2</a>', 3), DIRECTORY);
  assert.equal(parsed.rows.length, 2); assert.equal(parsed.rejected.length, 1);
  assert.equal(parsed.rows[0].accountKey, TARGETS[1].key); assert.equal(parsed.rows[0].directoryLabelMatches, false);
  assert.equal(parsed.rows[1].identityEvidence, 'directory_label_only_unverified');
  assert.deepEqual(parsed.pages, [DIRECTORY + '?page=2']);
  assert.throws(() => parseDirectory('<html>Login</html>', DIRECTORY), { code: 'SOURCE_FORMAT_CHANGED' });
  assert.throws(() => parseDirectory(directory(row(), '<a href="http://127.0.0.1/college?page=2">Next</a>'), DIRECTORY), { code: 'INVALID_DIRECTORY_URL' });
});
test('reverse extraction preserves content, original images, styles and rejects publisher/date/ID mismatch', () => {
  const entry = parseDirectory(directory(), DIRECTORY).rows[0];
  const result = reverseArticle(article(), entry.url, entry, '2024-01-01', now);
  assert.equal(result.author, TARGETS[0].name); assert.ok(result.blocks.length > 0);
  assert.match(result.blocks.join(''), /mmbiz.qpic.cn/); assert.ok(result.styleBlocks.length > 0);
  assert.ok(result.text.includes('下一步计划')); assert.equal(result.metadata.provenance.originalPublisherVerified, true);
  assert.throws(() => reverseArticle(article(TARGETS[1]), entry.url, entry, '2024-01-01', now), { code: 'ACCOUNT_MISMATCH' });
  assert.throws(() => reverseArticle(article(TARGETS[0], '123', '目录写错的公众号'), entry.url, entry, '2024-01-01', now), { code: 'ACCOUNT_MISMATCH' });
  assert.throws(() => reverseArticle(article().replace(/var biz = [^;]+;/, ''), entry.url, entry, '2024-01-01', now), { code: 'ARTICLE_IDENTITY_UNVERIFIED' });
  assert.throws(() => reverseArticle(article(TARGETS[0], '999'), entry.url, entry, '2024-01-01', now), { code: 'ARTICLE_IDENTITY_MISMATCH' });
  assert.throws(() => reverseArticle(article().replace('1793318400', '1672444800'), entry.url, entry, '2024-01-01', now), { code: 'BEFORE_HISTORY_START' });
  const short = { ...entry, url: 'https://mp.weixin.qq.com/s/short' };
  assert.equal(reverseArticle(article(), short.url, short, '2024-01-01', now).biz, TARGETS[0].biz);
});
test('observed pagination is exhausted, tracking aliases deduplicate, and completed articles never refetch', async t => {
  const output = await temp(t); let fetches = 0; const seen = [];
  const read = async url => {
    seen.push(url); if (url.endsWith('/robots.txt')) return '';
    const page = Number(new URL(url).searchParams.get('page') || 1);
    const next = page < 11 ? `<a href="/college?page=${page + 1}">Next</a>` : '';
    return directory(row(TARGETS[0], String(page)) + row(TARGETS[0], String(page), articleUrl(TARGETS[0], String(page)) + '&scene=1'), next, 11);
  };
  const fetchArticle = async url => { fetches++; return { html: article(TARGETS[0], new URL(url).searchParams.get('mid')), finalUrl: url }; };
  const report = await collectCollege({ output }, dependencies({ readDirectory: read, fetchArticle }));
  assert.equal(report.pages, 11); assert.equal(report.discovered, 11); assert.equal(report.states.reversed, 11);
  assert.equal(report.databaseWritten, false); assert.equal(report.directoryTraversalComplete, true);
  assert.equal(fetches, 11); assert.equal(seen.length, 12);
  await collectCollege({ output }, dependencies({ readDirectory: () => assert.fail('no directory refetch'), fetchArticle: () => assert.fail('no article refetch') }));
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json')));
  for (const entry of Object.values(manifest.entries)) {
    assert.ok((await fs.readFile(path.join(output, entry.rawFile), 'utf8')).includes('js_content'));
    assert.equal(JSON.parse(await fs.readFile(path.join(output, entry.parsedFile))).author, TARGETS[0].name);
  }
});
test('two source access challenges stop batch, preserve pending, and require explicit resume', async t => {
  const output = await temp(t); let fetches = 0;
  const read = async url => url.endsWith('/robots.txt') ? '' : directory(row() + row(TARGETS[1], '456') + row(TARGETS[0], '789'), '', 3);
  const report = await collectCollege({ output }, dependencies({ readDirectory: read, fetchArticle: async () => {
    fetches++; throw Object.assign(Error('Source requires verification'), { code: 'SOURCE_VERIFICATION_REQUIRED' });
  } }));
  assert.equal(fetches, 2); assert.equal(report.states.blocked, 2); assert.equal(report.states.pending, 1);
  assert.equal(report.stop.accessFailures, 2);
  await collectCollege({ output }, dependencies({ fetchArticle: () => assert.fail('no automatic retry') }));
  const resumed = await collectCollege({ output, resumeBlocked: true }, dependencies({ fetchArticle: async url => {
    const target = TARGETS.find(item => item.biz === new URL(url).searchParams.get('__biz'));
    return { html: article(target, new URL(url).searchParams.get('mid')), finalUrl: url };
  } }));
  assert.equal(resumed.states.reversed, 3); assert.equal(resumed.stop, null);
  assert.equal(JSON.parse(await fs.readFile(path.join(output, 'manifest.json'))).entries[require('../lib/wechat_monitor_content').hash(canonicalUrl(articleUrl()))].attempts.length, 2);
});
test('robots denial is checkpointed rather than reported as complete or empty', async t => {
  const output = await temp(t);
  const report = await collectCollege({ output }, dependencies({ readDirectory: async url => {
    assert.ok(url.endsWith('/robots.txt')); return 'User-agent: *\nDisallow: /college';
  }, fetchArticle: () => assert.fail('no article fetch') }));
  assert.equal(report.stop.code, 'SOURCE_ROBOTS_DISALLOWED'); assert.equal(report.directoryTraversalComplete, false);
});
test('policy connection failures and changed HTML are durable blockers', async t => {
  const output = await temp(t);
  const failed = await collectCollege({ output }, dependencies({ readDirectory: async () => {
    throw Object.assign(Error('Directory timeout'), { code: 'SOURCE_TIMEOUT' });
  } }));
  assert.equal(failed.stop.phase, 'directory_policy'); assert.equal(failed.stop.code, 'SOURCE_TIMEOUT');
  const changed = await collectCollege({ output, resumeBlocked: true }, dependencies({ readDirectory: async url =>
    url.endsWith('/robots.txt') ? '' : '<html>Login required</html>' }));
  assert.equal(changed.stop.code, 'SOURCE_FORMAT_CHANGED'); assert.equal(changed.directoryTraversalComplete, false);
});
test('publisher mismatches remain quarantined with original HTML evidence and cannot count as reversed', async t => {
  const output = await temp(t);
  const report = await collectCollege({ output }, dependencies({ fetchArticle: async url => ({
    html: article(TARGETS[0], '123', '其他公众号'), finalUrl: url,
  }) }));
  assert.equal(report.states.quarantined, 1); assert.equal(report.states.reversed, undefined);
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json')));
  const entry = Object.values(manifest.entries)[0];
  assert.equal(entry.attempts[0].error.publisherEvidence.name, '其他公众号');
  assert.ok(await fs.readFile(path.join(output, entry.rawFile), 'utf8'));
  assert.equal(entry.parsedFile, undefined);
});
test('local reparsing preserves circuit breaker and does not make network requests', async t => {
  const output = await temp(t);
  await collectCollege({ output }, dependencies({ fetchArticle: async () => { throw Object.assign(Error('Slow down'), { code: 'SOURCE_RATE_LIMITED' }); } }));
  const report = await collectCollege({ output, reparseDirectory: true }, dependencies({
    readDirectory: () => assert.fail('local-only'), fetchArticle: () => assert.fail('blocked'),
  }));
  assert.equal(report.stop.code, 'SOURCE_RATE_LIMITED'); assert.equal(report.discovered, 1);
});
test('output lock, invalid delays and incompatible history starts fail closed', async t => {
  const output = await temp(t);
  await assert.rejects(collectCollege({ output, intervalMs: 0 }), { code: 'INVALID_INTERVAL' });
  await fs.writeFile(path.join(output, '.collection.lock'), 'another-process');
  await assert.rejects(collectCollege({ output }), { code: 'EEXIST' });
  assert.equal(await fs.readFile(path.join(output, '.collection.lock'), 'utf8'), 'another-process');
  await fs.unlink(path.join(output, '.collection.lock'));
  await collectCollege({ output, discoverOnly: true }, dependencies());
  await assert.rejects(collectCollege({ output, since: '2025-01-01' }, dependencies()), { code: 'BUNDLE_MISMATCH' });
});
