const { test } = require('node:test');
const assert = require('node:assert/strict');
const { safeObservedBlock, buildObservedLibrary, loadObservedStyleLibrary } = require('../lib/wechat_observed_styles');

const heading = { type: 'h2', name: '标题', htmlTemplate: '<section><strong>{{content}}</strong></section>' };
const image = { type: 'imageCard', name: '图片', htmlTemplate: '<section><img src="{{src}}"><p>{{caption}}</p></section>' };
const row = (id, day, blocks) => ({ id, current_revision_id: id + 10, title: `来源 ${id}`,
  published_at: Date.parse(`2025-01-${day}T00:00:00Z`), source_url: `https://mp.weixin.qq.com/s/${id}`, style_blocks: JSON.stringify(blocks) });

test('only safe reusable blocks with editable slots are accepted', () => {
  assert.match(safeObservedBlock(heading), /\{\{content\}\}/);
  assert.match(safeObservedBlock(image), /\{\{src\}\}/);
  for (const htmlTemplate of ['<p>原文事实{{content}}</p>', '<p onclick="alert(1)">{{content}}<script>alert(1)</script></p>',
    '<p style="background:url(https://bad.test/x)">{{content}}</p>', '<p style="background:u&#114;l(https://bad.test/x)">{{content}}</p>',
    '<p>{{content}}{{content}}</p>', '<iframe>{{content}}</iframe>']) {
    assert.equal(safeObservedBlock({ ...heading, htmlTemplate }), null);
  }
  assert.equal(safeObservedBlock({ ...image, htmlTemplate: '<img src="https://bad.test/x">{{caption}}' }), null);
  assert.equal(safeObservedBlock({ type: 'divider', htmlTemplate: '<p>点击</p>' }), null);
  assert.doesNotMatch(safeObservedBlock({ ...heading, htmlTemplate: '<p onclick="bad()">{{content}}</p>' }), /onclick/);
});

test('verified multi-day series produce one template and deduplicate identical blocks', () => {
  const rows = [row(1, '01', [heading, image]), row(2, '02', [heading, image]), row(3, '03', [heading])];
  const members = [{ group_id: 7, name: '共创营', article_id: 1, revision_id: 11 },
    { group_id: 7, name: '共创营', article_id: 2, revision_id: 12 },
    { group_id: 8, name: '未经证实', article_id: 3, revision_id: 13 }];
  const library = buildObservedLibrary(rows, members);
  assert.equal(library.templates.length, 2);
  const series = library.templates.find(item => item.name === '共创营');
  assert.equal(series.count, 2); assert.equal(series.styleIds.h2, 'db-monitor-1-11-0');
  assert.equal(library.blocks.filter(item => item.name.startsWith('共创营')).length, 2);
  assert.ok(library.templates.some(item => item.name === '来源 3'), 'a single candidate is not presented as a confirmed series');
  const stale = buildObservedLibrary(rows, members.map(member => ({ ...member, revision_id: 999 })));
  assert.equal(stale.templates.length, 3);
});

test('template chooses a readable prominent heading instead of a tiny source footnote', () => {
  const tiny = { ...heading, htmlTemplate: '<p style="font-size:12px"><em>{{content}}</em></p>' };
  const prominent = { ...heading, htmlTemplate: '<p style="font-size:20px"><strong>{{content}}</strong></p>' };
  const invisible = { ...heading, htmlTemplate: '<p style="font-size:24px;color:rgb(255,255,255)"><strong>{{content}}</strong></p>' };
  const library = buildObservedLibrary([row(1, '01', [tiny, prominent, invisible])], []);
  assert.equal(library.templates[0].styleIds.h2, 'db-monitor-1-11-1');
  assert.equal(buildObservedLibrary([row(2, '02', [tiny])], []).templates.length, 0);
});

test('library queries the authorized scope, official monitored account and published revisions', async () => {
  const queries = [];
  const db = { async query(sql, values) { queries.push({ sql, values }); return [queries.length === 1 ? [row(1, '01', [heading])] : []]; } };
  const result = await loadObservedStyleLibrary(db, { enabled: true, orgId: 4, unitId: 5 });
  assert.equal(result.templates.length, 1);
  assert.equal(queries[0].values[0], '4:5');
  assert.match(queries[0].sql, /x\.account_key='bjzgca'/);
  assert.match(queries[0].sql, /a\.published_at <= \?/);
  assert.match(queries[0].sql, /r\.article_id=a\.id/);
  assert.equal(queries[1].values[0], '4:5');
});

test('repeated trusted edge images across different days are candidates, not one-off pictures', () => {
  const logo = 'https://mmbiz.qpic.cn/mmbiz_png/brand/640?wx_fmt=png';
  const one = row(1, '01', [heading]), two = row(2, '02', [heading]), third = row(3, '03', [heading]);
  one.blocks = JSON.stringify([`<img src="${logo}"><img src="https://mmbiz.qpic.cn/a/one/640">`]);
  two.blocks = JSON.stringify(['<img src="https://mmbiz.qpic.cn/mmbiz_png/brand/640?other=1"><img src="https://mmbiz.qpic.cn/a/two/640">']);
  third.blocks = JSON.stringify(['<img src="https://evil.test/brand.png"><img src="https://mmbiz.qpic.cn/a/unique/640">']);
  const library = buildObservedLibrary([one, two, third], []);
  const candidates = library.templates.find(item => item.articleId === 1).brandCandidates;
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].position, 'top'); assert.equal(candidates[0].occurrences, 2);
  assert.match(candidates[0].src, /^\/api\/wx-img\?url=/);
  assert.deepEqual(library.templates.find(item => item.articleId === 3).brandCandidates, candidates,
    'account-wide repeated images are offered for review to every template');
  two.published_at = one.published_at;
  assert.deepEqual(buildObservedLibrary([one, two], []).templates[0].brandCandidates, [], 'same-day repeats are insufficient');
});
