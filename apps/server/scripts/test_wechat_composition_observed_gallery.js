const assert = require('node:assert/strict');
const { test } = require('node:test');
const { sanitizeDoc } = require('../routes/wechat_compositions');

test('存档清洗保留 observed 组图模板/分组字段，同时继续清洗 raw/para 富文本', () => {
  const gallery = {
    id: 'observed-gallery-test', type: 'imageGroup', source: 'observed',
    name: '原版轮播 · 北京中关村学院', galleryKind: 'carousel', slots: 2,
    htmlTemplate: '<section><svg><image href="{{photo_0}}"></image><image href="{{photo_1}}"></image></svg></section>',
    occurrenceSlots: [0, 1], sourceImages: ['https://mmbiz.qpic.cn/a', 'https://mmbiz.qpic.cn/b'],
    sourceTitle: '原文', sourceUrl: 'https://mp.weixin.qq.com/s/x', sourceAccount: '北京中关村学院',
    articleId: 1, revisionId: 2,
  };
  const styled = { uid: 'u1', kind: 'styled', type: 'imageCard', src: '/__news-qa/images/1681.jpg',
    galleryId: 'draft-group-0', galleryColumns: 2, galleryStyle: gallery.id, galleryTemplate: gallery };
  const doc = [styled, { uid: 'u2', kind: 'raw', html: '<p onclick="alert(1)">正文</p><script>bad()</script>' },
    { uid: 'u3', kind: 'para', html: '<span onmouseover="x()">段落</span><img onerror="y()">' }];
  const out = sanitizeDoc(structuredClone(doc));
  assert.deepEqual(out[0], styled, 'styled 组图块原样保留（模板、槽位、分组、列数）');
  assert.ok(!/<script/i.test(out[1].html) && !/onclick=/i.test(out[1].html), 'raw 块仍被清洗');
  assert.ok(!/onerror=/i.test(out[2].html) && !/onmouseover=/i.test(out[2].html), 'para 块仍被清洗');
  assert.match(out[1].html, /正文/);
});

test('未知对象/空块不会让清洗抛错', () => {
  assert.deepEqual(sanitizeDoc([null, {}, { kind: 'raw' }]), [null, {}, { kind: 'raw' }]);
});
