const cheerio = require('cheerio');
const crypto = require('node:crypto');
const { parsed } = require('./wechat_monitor_content');

const tag = node => String(node.tagName || '').toLowerCase();
// Copy the source DOM of photo-only galleries. 除 img 外还允许微信轮播常用的 SVG 结构
// （image/path/defs/use/渐变等）；文字、脚本、链接与任意定位仍被拒绝。
const TAGS = new Set(['section', 'div', 'span', 'p', 'img', 'svg', 'g', 'rect', 'foreignobject', 'animatetransform',
  'image', 'path', 'defs', 'use', 'lineargradient', 'radialgradient', 'stop', 'pattern', 'clippath',
  'line', 'circle', 'ellipse', 'polygon', 'polyline']);
const ATTRS = new Set(['style', 'src', 'viewbox', 'xmlns', 'xmlns:xlink', 'x', 'y', 'width', 'height', 'opacity', 'fill',
  'attributename', 'type', 'keytimes', 'values', 'repeatcount', 'begin', 'dur', 'calcmode', 'restart',
  'href', 'xlink:href', 'id', 'transform', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-opacity', 'fill-opacity', 'fill-rule', 'preserveaspectratio', 'overflow',
  'clip-path', 'mask', 'd', 'points', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2',
  'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'patternunits',
  'patterncontentunits', 'clippathunits']);
const unsafe = /expression\s*\(|javascript\s*:|vbscript\s*:|@import|\\|\/\*|position\s*:\s*(fixed|sticky)/i;
const bgUrl = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

function sourceImage(value) {
  try {
    let url = new URL(value, 'http://local.invalid');
    if (url.origin === 'http://local.invalid' && url.pathname === '/api/wx-img') url = new URL(url.searchParams.get('url'));
    return url.protocol === 'https:' && !url.port && !url.username && !url.password
      && /(^|\.)qpic\.cn$/i.test(url.hostname) ? url.href : null;
  } catch { return null; }
}

// Copy the source DOM, not a layout inferred from its screenshot. The supported
// photo-only shapes deliberately exclude article copy, logos and small ornaments.
function templateFromSource(html, row, kind) {
  const $ = cheerio.load(html, null, false);
  const nodes = $('*').toArray();
  if (Buffer.byteLength(html) > 50000 || $.root().text().trim() || nodes.some(node => !TAGS.has(tag(node))
    || unsafe.test(node.attribs?.style || ''))) return null;
  const sourceImages = [], occurrenceSlots = [];
  let invalid = false;
  const slotFor = value => {
    const src = sourceImage(value);
    if (!src) { invalid = true; return ''; }
    // The last frame of a looping carousel repeats the first photo; retain that alias.
    let index = kind === 'carousel' ? sourceImages.indexOf(src) : -1;
    if (index < 0) { index = sourceImages.length; sourceImages.push(src); }
    occurrenceSlots.push(index);
    return `{{photo_${index}}}`;
  };
  for (const node of nodes) {
    const el = $(node);
    if (tag(node) === 'animatetransform' && (el.attr('attributeName') !== 'transform'
      || el.attr('type') !== 'translate' || !/^[\d\s.;-]+$/.test(el.attr('values') || '')
      || !/^[\d.]+s$/.test(el.attr('begin') || ''))) return null;
    for (const attr of Object.keys(node.attribs || {})) if (!ATTRS.has(attr.toLowerCase())) el.removeAttr(attr);
    if (tag(node) === 'img') {
      el.attr('src', slotFor(el.attr('src')));
      el.attr('data-gallery-slot', occurrenceSlots.at(-1));
    } else if (tag(node) === 'image') {
      // SVG <image> 用 href/xlink:href 指向微信图床；替换成槽位 token，渲染时再填用户照片。
      const href = el.attr('href') || el.attr('xlink:href');
      if (!href) return null;
      const token = slotFor(href);
      if (el.attr('href')) el.attr('href', token);
      if (el.attr('xlink:href')) el.attr('xlink:href', token);
      el.attr('data-gallery-slot', occurrenceSlots.at(-1));
    } else if (tag(node) === 'use') {
      // <use> 只允许引用模板内部的 defs，不允许外部文档或图片。
      const href = el.attr('href') || el.attr('xlink:href');
      if (!href || !href.startsWith('#')) return null;
    }
    const style = el.attr('style');
    if (style) el.attr('style', style.replace(bgUrl, (_, quote, url) => {
      const token = slotFor(url);
      el.attr('data-gallery-slot', occurrenceSlots.at(-1));
      return `url("${token}")`;
    }));
  }
  if (invalid || sourceImages.length < 2 || sourceImages.length > 20) return null;
  const htmlTemplate = $.root().html();
  const fingerprint = crypto.createHash('sha256').update(htmlTemplate).digest('hex').slice(0, 16);
  return { id: `observed-gallery-${fingerprint}`, type: 'imageGroup', source: 'observed',
    // 名称带上来源账号：同一 realm/库里可能有多套原版轮播，不能都叫「共创营」。
    name: `${kind === 'carousel' ? '原版轮播' : `原版${sourceImages.length}图`} · ${row.account || '原文'}`,
    slots: sourceImages.length, galleryKind: kind, htmlTemplate, occurrenceSlots, sourceImages,
    sourceHtml: html, sourceTitle: row.title, sourceUrl: row.source_url, sourceAccount: row.account || '北京中关村学院',
    articleId: Number(row.id), revisionId: Number(row.current_revision_id) };
}

function observedGalleryTemplates(row) {
  const blocks = parsed(row.blocks, []);
  if (!Array.isArray(blocks)) return [];
  const $ = cheerio.load(blocks.filter(block => typeof block === 'string').join(''), null, false);
  const candidates = [];
  $('svg').each((_, svg) => {
    if (!$(svg).find('*').toArray().some(node => tag(node) === 'animatetransform')) return;
    let root = svg;
    // Retain the clipping frame, padding and margins surrounding the moving strip.
    while (root.parent?.tagName && !$(root.parent).text().trim()
      && $(root.parent).find('img').length === 0 && $(root.parent).find('svg').length === $(root).find('svg').length + (tag(root) === 'svg' ? 1 : 0)) root = root.parent;
    candidates.push(templateFromSource($.html(root), row, 'carousel'));
  });
  $('section,div').each((_, node) => {
    const el = $(node), children = el.children().toArray(), css = el.css();
    if (!['flex', 'inline-flex'].includes(css.display) || /column|reverse/.test(`${css['flex-flow']} ${css['flex-direction']}`)
      || ![2, 3].includes(children.length) || el.find('svg').length || el.text().trim()) return;
    if (children.some(child => !/^\d+(\.\d+)?%$/.test($(child).css('width') || '')
      || !$(child).find('img').length)) return;
    if (el.find('*').toArray().some(child => {
      const width = $(child).css('width') || '';
      return /^\d+(\.\d+)?px$/.test(width) && parseFloat(width) < 96;
    })) return;
    candidates.push(templateFromSource($.html(node), row, 'columns'));
  });
  return [...new Map(candidates.filter(Boolean).map(item => [item.id, item])).values()];
}

module.exports = { observedGalleryTemplates, templateFromSource };
