const { test } = require('node:test');
const assert = require('node:assert/strict');
const { observedGalleryTemplates, templateFromSource } = require('../lib/wechat_observed_gallery_templates');
const row = { id: 1, current_revision_id: 2, title: '原文', source_url: 'https://mp.weixin.qq.com/s/example' };
const image = i => `<img style="width:94%;border:2px solid #ddd" src="https://mmbiz.qpic.cn/photo/${i}">`;
const html = `<section style="display:flex;gap:7px"><section style="width:50%">${image(0)}${image(1)}</section><section style="width:50%">${image(2)}${image(3)}</section></section>`;

test('copies the complete original frame without replacing source CSS with generated layouts', () => {
  const [style] = observedGalleryTemplates({ ...row, blocks: [html] });
  assert.equal(style.slots, 4);
  assert.equal(style.sourceHtml, html);
  assert.match(style.htmlTemplate, /gap:7px/);
  assert.match(style.htmlTemplate, /width:94%;border:2px solid #ddd/);
  assert.equal(style.sourceImages.length, 4);
  assert.doesNotMatch(style.htmlTemplate, /qpic/);
  assert.deepEqual(style.occurrenceSlots, [0, 1, 2, 3]);
  assert.equal(observedGalleryTemplates({ ...row, blocks: [html, html] }).length, 1);
});

test('keeps photo aliases and original motion values in a looping SVG strip', () => {
  const frames = [0, 1, 0].map((i, n) => `<g><foreignObject x="${n * 1080}" width="100%" height="100%"><svg viewBox="0 0 1080 720" style="background-image:url('https://mmbiz.qpic.cn/photo/${i}');background-size:cover"></svg></foreignObject></g>`).join('');
  const source = `<section style="margin:20px 0;overflow:hidden"><svg viewBox="0 0 1080 720"><g><animateTransform attributeName="transform" type="translate" begin="0s" values="0 0;-1080 0;-2160 0" dur="4s" repeatCount="indefinite"></animateTransform>${frames}</g></svg></section>`;
  const [style] = observedGalleryTemplates({ ...row, blocks: [source] });
  assert.equal(style.slots, 2);
  assert.deepEqual(style.occurrenceSlots, [0, 1, 0]);
  assert.match(style.htmlTemplate, /values="0 0;-1080 0;-2160 0"/);
  assert.match(style.htmlTemplate, /dur="4s"/);
  assert.match(style.htmlTemplate, /margin:20px 0;overflow:hidden/);
});

test('rejects article facts, unsafe content and tracking assets instead of copying them into templates', () => {
  for (const bad of [html.replace('</section>', '<p>活动已有66位参与者</p></section>'),
    html.replace('<img', '<script>bad()</script><img'), html.replace('qpic.cn', 'evil.test'),
    html.replace('gap:7px', 'position:fixed'), html.replace('gap:7px', 'background:expression(bad())')]) {
    assert.equal(templateFromSource(bad, row, 'columns'), null);
  }
});

test('copies SVG galleries that use image/path/defs slots and rejects external <use>', () => {
  const frame = (i, n) => `<g transform="translate(${n * 100},0)"><path d="M0 0h100v100H0z" fill="#fff"></path><image href="https://mmbiz.qpic.cn/photo/${i}" width="100" height="100" preserveAspectRatio="xMidYMid slice"></image></g>`;
  const source = `<section style="overflow:hidden"><svg viewBox="0 0 300 100"><defs><clipPath id="c"><rect width="100" height="100"></rect></clipPath></defs><g><animateTransform attributeName="transform" type="translate" begin="0s" values="0 0;-100 0;-200 0" dur="3s" repeatCount="indefinite"></animateTransform>${[0, 1, 2].map(frame).join('')}</g></svg></section>`;
  const [style] = observedGalleryTemplates({ ...row, blocks: [source] });
  assert.equal(style.slots, 3);
  assert.match(style.htmlTemplate, /\{\{photo_0\}\}/);
  assert.match(style.htmlTemplate, /preserveAspectRatio="xMidYMid slice"/);
  assert.match(style.htmlTemplate, /<path /);
  assert.doesNotMatch(style.htmlTemplate, /qpic/);
  const externalUse = source.replace('<g>', '<g><use href="https://evil.test/x.svg"></use>');
  assert.equal(templateFromSource(externalUse, row, 'carousel'), null);
});
