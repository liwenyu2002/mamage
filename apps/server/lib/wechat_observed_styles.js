const cheerio = require('cheerio');
const crypto = require('node:crypto');
const { scopeFor } = require('./wechat_monitor_store');
const { parsed } = require('./wechat_monitor_content');

const ALLOWED_TAGS = new Set(['section', 'div', 'p', 'span', 'strong', 'b', 'em', 'i', 'br', 'img']);
const TYPES = new Set(['h2', 'h3', 'quote', 'imageCard']);
const UNSAFE_CSS = /url\s*\(|expression\s*\(|javascript:|@import|position\s*:\s*(?:fixed|sticky|absolute)/i;

function observedBase(value) {
  const features = parsed(value, {});
  const size = (Array.isArray(features?.fontSizes) ? features.fontSizes : []).map(item => /^([0-9]+)px$/.exec(item?.value || ''))
    .map(match => Number(match?.[1])).find(number => number >= 12 && number <= 20);
  const color = (Array.isArray(features?.palette) ? features.palette : []).map(item => /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(item?.value || ''))
    .find(match => match && Math.max(...match.slice(1).map(Number)) - Math.min(...match.slice(1).map(Number)) >= 35
      && match.slice(1).every(number => Number(number) <= 255));
  return { ...(size ? { fontSize: size } : {}), ...(color ? { accent: `#${color.slice(1).map(number => Number(number).toString(16).padStart(2, '0')).join('')}` } : {}) };
}

function safeObservedBlock(block) {
  if (!TYPES.has(block?.type) || typeof block.htmlTemplate !== 'string' || Buffer.byteLength(block.htmlTemplate) > 50000) return null;
  const html = block.htmlTemplate;
  if (UNSAFE_CSS.test(html)) return null;
  const required = block.type === 'imageCard' ? '{{src}}' : '{{content}}';
  if (html.split(required).length !== 2) return null;
  const $ = cheerio.load(html.replace(/<!--[\s\S]*?-->/g, ''), null, false);
  const nodes = $('*').toArray();
  if (!nodes.length || nodes.some(node => !ALLOWED_TAGS.has(String(node.tagName).toLowerCase())
    || UNSAFE_CSS.test(node.attribs?.style || '') || /\\|\/\*/.test(node.attribs?.style || ''))) return null;
  if ($.root().text().replace(/\{\{(?:content|caption)\}\}/g, '').trim()) return null;
  if (block.type === 'imageCard' && ($('img').length !== 1 || $('img').attr('src') !== '{{src}}')) return null;
  if (block.type !== 'imageCard' && $('img').length) return null;
  for (const node of nodes) {
    const element = $(node);
    for (const attr of Object.keys(node.attribs || {})) {
      if (attr !== 'style' && !(node.tagName.toLowerCase() === 'img' && attr === 'src')) element.removeAttr(attr);
    }
  }
  return $.root().html();
}

function headingScore(item) {
  const html = item.htmlTemplate;
  const sizes = [...html.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)].map(match => Number(match[1]));
  const size = sizes.length ? sizes[sizes.length - 1] : 15;
  if (size < 14 || /color\s*:\s*(?:#fff(?:fff)?\b|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))/i.test(html)
    && !/background(?:-color|-image)?\s*:/i.test(html)) return -1;
  return size + (/<(?:strong|b)\b|font-weight\s*:\s*(?:bold|[6-9]00)/i.test(html) ? 4 : 0)
    + (/background|border/i.test(html) ? 2 : 0) - (/<(?:em|i)\b|font-style\s*:\s*italic/i.test(html) ? 3 : 0);
}

function assetUrl(raw) {
  try {
    let url = new URL(String(raw || ''), 'http://local.invalid');
    if (url.origin === 'http://local.invalid' && url.pathname === '/api/wx-img') url = new URL(url.searchParams.get('url'));
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !/(?:^|\.)(?:qpic|qlogo)\.cn$/i.test(url.hostname)) return null;
    const key = `${url.hostname.toLowerCase()}${url.pathname}`;
    url.hash = '';
    return { key, src: `/api/wx-img?url=${encodeURIComponent(url.href)}` };
  } catch { return null; }
}
function observedImages(row) {
  const blocks = parsed(row.blocks, []);
  if (!Array.isArray(blocks)) return [];
  const $ = cheerio.load(blocks.filter(block => typeof block === 'string').join(''), null, false);
  const images = [];
  $('*').each((_, element) => {
    const node = $(element), candidates = [];
    if (element.tagName?.toLowerCase() === 'img') candidates.push(node.attr('src'));
    const style = node.attr('style') || '';
    for (const match of style.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) candidates.push(match[2]);
    for (const value of candidates) { const image = assetUrl(value); if (image) images.push(image); }
  });
  return images.map((image, index) => ({ ...image, position: index < 2 ? 'top' : index >= images.length - 2 ? 'bottom' : null }));
}

function buildObservedLibrary(rows, memberships) {
  const byArticle = new Map(rows.map(row => [Number(row.id), row]));
  const repeatedImages = new Map();
  for (const row of rows) for (const image of observedImages(row)) {
    if (!image.position) continue;
    const key = `${image.position}:${image.key}`, found = repeatedImages.get(key) || { ...image, articles: new Map() };
    found.articles.set(Number(row.id), Number(row.published_at)); repeatedImages.set(key, found);
  }
  const groups = new Map();
  for (const member of memberships) {
    const article = byArticle.get(Number(member.article_id));
    if (!article || Number(article.current_revision_id) !== Number(member.revision_id)) continue;
    const group = groups.get(member.group_id) || { name: member.name, members: [] };
    group.members.push(article); groups.set(member.group_id, group);
  }
  const articleGroup = new Map();
  for (const [id, group] of groups) {
    const dates = new Set(group.members.map(row => new Date(Number(row.published_at)).toISOString().slice(0, 10)));
    if (group.members.length < 2 || dates.size < 2) continue;
    for (const row of group.members) if (!articleGroup.has(Number(row.id))) articleGroup.set(Number(row.id), { id, name: group.name });
  }
  const collections = new Map();
  for (const row of rows) {
    const group = articleGroup.get(Number(row.id));
    const key = group ? `series-${group.id}` : `article-${row.id}`;
    const collection = collections.get(key) || { key, name: group?.name || row.title, articles: [] };
    const candidates = parsed(row.style_blocks, []).map((block, index) => ({ block, index, html: safeObservedBlock(block) })).filter(item => item.html);
    collection.articles.push({ row, candidates }); collections.set(key, collection);
  }
  const templates = [], blocks = [];
  for (const group of collections.values()) {
    group.articles.sort((a, b) => b.candidates.filter(item => item.block.type === 'h2').length - a.candidates.filter(item => item.block.type === 'h2').length
      || b.candidates.length - a.candidates.length || Number(a.row.id) - Number(b.row.id));
    const seen = new Set(), selected = [];
    for (const { row, candidates } of group.articles) for (const item of candidates) {
      const fingerprint = `${item.block.type}:${item.html}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const id = `monitor-${row.id}-${row.current_revision_id}-${item.index}`;
      selected.push({ id, type: item.block.type, name: `${group.name.slice(0, 40)} · ${item.block.name || item.block.type}`.slice(0, 100),
        htmlTemplate: item.html, accentEditable: !!item.block.accentEditable, source: 'observed',
        sourceUrl: row.source_url, articleId: Number(row.id), revisionId: Number(row.current_revision_id) });
    }
    const curated = [];
    for (const type of TYPES) {
      const candidates = selected.filter(item => item.type === type && (!['h2', 'h3'].includes(type) || headingScore(item) >= 0));
      if (['h2', 'h3'].includes(type)) candidates.sort((a, b) => headingScore(b) - headingScore(a));
      curated.push(...candidates.slice(0, 3));
    }
    blocks.push(...curated);
    const pickHeading = type => curated.filter(item => item.type === type && headingScore(item) >= 0)
      .sort((a, b) => headingScore(b) - headingScore(a))[0];
    const h2 = pickHeading('h2'), h3 = pickHeading('h3');
    if (!h2 && !h3) continue;
    const mainHeading = h2 || { ...h3, id: `${h3.id}-h2`, type: 'h2', name: `${group.name.slice(0, 40)} · 标题` };
    if (!h2) blocks.push(mainHeading);
    const representative = group.articles[0].row;
    const brandCandidates = [...repeatedImages.values()].filter(image => image.articles.size >= 2
      && new Set([...image.articles.values()].map(value => new Date(value).toISOString().slice(0, 10))).size >= 2)
      .map(image => ({ id: crypto.createHash('sha256').update(`${image.position}:${image.key}`).digest('hex').slice(0, 16),
        src: image.src, position: image.position, occurrences: image.articles.size }));
    templates.push({ id: group.key, name: group.name, sourceTitle: representative.title,
      articleId: Number(representative.id), revisionId: Number(representative.current_revision_id),
      base: observedBase(representative.visual_features), brandCandidates,
      count: group.articles.length, styleIds: { h2: `db-${mainHeading.id}`,
        ...(h3 ? { h3: `db-${h3.id}` } : {}),
        ...(curated.find(item => item.type === 'imageCard') ? { imageCard: `db-${curated.find(item => item.type === 'imageCard').id}` } : {}),
        ...(curated.find(item => item.type === 'quote') ? { quote: `db-${curated.find(item => item.type === 'quote').id}` } : {}) } });
  }
  return { templates, blocks };
}

async function loadObservedStyleLibrary(db, workspace) {
  const scope = scopeFor(workspace);
  const [rows] = await db.query(`SELECT a.id,a.title,a.published_at,a.source_url,a.current_revision_id,r.style_blocks,r.visual_features,r.blocks
    FROM wechat_monitor_articles a JOIN wechat_monitor_accounts x ON x.id=a.account_id AND x.scope_key=a.scope_key
    JOIN wechat_monitor_revisions r ON r.id=a.current_revision_id AND r.article_id=a.id
    WHERE a.scope_key=? AND x.account_key='bjzgca' AND a.published_at > 0 AND a.published_at <= ?
    AND a.source_url LIKE 'https://mp.weixin.qq.com/s%' ORDER BY a.published_at DESC,a.id`, [scope, Date.now()]);
  const [memberships] = await db.query(`SELECT g.id AS group_id,g.name,m.article_id,m.revision_id
    FROM wechat_monitor_groups g JOIN wechat_monitor_memberships m ON m.group_id=g.id
    JOIN wechat_monitor_accounts x ON x.id=g.account_id AND x.scope_key=g.scope_key
    WHERE g.scope_key=? AND g.kind='series' AND x.account_key='bjzgca' ORDER BY g.id`, [scope]);
  return buildObservedLibrary(rows, memberships);
}
module.exports = { safeObservedBlock, buildObservedLibrary, loadObservedStyleLibrary };
