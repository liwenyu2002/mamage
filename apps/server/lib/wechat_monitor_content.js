const crypto = require('node:crypto');
const cheerio = require('cheerio');
const { extractFullArticleFromHtml } = require('./wechat_article_import');
const { extractStyleBlocksFromHtml } = require('./wechat_style_extract');

const PROTOCOL_VERSION = 'wechat-learning-v3';
const PRESETS = [
  { key: 'hit', name: '哈尔滨工业大学', expectedNames: ['哈尔滨工业大学'], since: '2024-01-01',
    indexes: ['https://www.hit.edu.cn/', 'https://news.hit.edu.cn/xxyw/list.htm', 'https://news.hit.edu.cn/hgdqmt/list.htm'],
    identityEvidence: 'https://news.hit.edu.cn/2025/0315/c11819a237593/page.htm' },
  { key: 'bjzgca', name: '北京中关村学院', expectedNames: ['北京中关村学院'], since: '2024-01-01',
    indexes: ['https://www.bza.edu.cn/api/article?type=school&page=1&limit=5', 'https://www.bza.edu.cn/', 'https://www.bza.edu.cn/news/', 'https://www.bza.edu.cn/sitemap.txt'],
    identityEvidence: 'https://www.bza.edu.cn/detail/hdgr8zc0mgbgl4i8n8umiwh1o4tybx59' },
];
const SCENES = { admissions: '招生迎新', graduation: '毕业校友', research: '科研学术', people: '人物故事',
  campus: '校园生活', events: '活动报道', governance: '学校要闻', culture: '文化美育',
  service: '服务通知', recruitment: '人才招聘', special: '专题策划', other: '其他' };
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const parsed = (value, fallback = null) => { try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } };
function invalid(code, message, status = 400) { return Object.assign(Error(message), { code, status }); }
function canonicalUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { throw invalid('INVALID_ARTICLE_URL', '请使用公众号原文链接'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'mp.weixin.qq.com' || url.username || url.password
    || url.port || !/^\/s(?:\/[^/?#]+)?\/?$/.test(url.pathname)) throw invalid('INVALID_ARTICLE_URL', '仅接受 mp.weixin.qq.com/s 文章链接');
  url.protocol = 'https:'; url.hash = '';
  if (url.pathname === '/s') {
    const identified = ['__biz', 'mid', 'idx', 'sn'].every(key => url.searchParams.get(key));
    if (!identified && !url.searchParams.get('signature')) throw invalid('INVALID_ARTICLE_URL', '文章长链接缺少必要标识');
    const query = new URLSearchParams();
    for (const key of identified ? ['__biz', 'mid', 'idx', 'sn'] : ['src', 'timestamp', 'ver', 'signature', 'new']) {
      const value = url.searchParams.get(key); if (value) query.set(key, value.slice(0, 3000));
    }
    url.search = query.toString();
  } else url.search = '';
  return url.href;
}
function dateTimestamp(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw invalid('INVALID_DATE', '日期格式应为 YYYY-MM-DD');
  const timestamp = Date.parse(`${text}T00:00:00+08:00`);
  if (!Number.isFinite(timestamp) || new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10) !== text) throw invalid('INVALID_DATE', '日期不存在');
  return timestamp;
}
function scriptValue(html, names) {
  for (const name of names) {
    const match = html.match(new RegExp(`(?:var\\s+|[;\\n]\\s*)${name}\\s*=\\s*["']([^"'\\r\\n]{1,180})["']`));
    if (match) return match[1].replace(/&amp;/g, '&');
    const number = html.match(new RegExp(`(?:var\\s+|[;\\n]\\s*)${name}\\s*=\\s*(\\d{1,15})\\s*[;,]`));
    if (number) return number[1];
  }
  return '';
}
function visualFeatures($) {
  const colors = new Map(), fonts = new Map(); let centered = 0, decorated = 0;
  $('#js_content [style]').addBack('[style]').each((_, element) => {
    const style = $(element).attr('style') || '';
    for (const color of style.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]{1,60}\)/gi) || []) colors.set(color.toLowerCase(), (colors.get(color.toLowerCase()) || 0) + 1);
    const font = style.match(/(?:^|;)\s*font-size\s*:\s*(\d+(?:\.\d+)?px)/i)?.[1];
    if (font) fonts.set(font, (fonts.get(font) || 0) + 1);
    if (/text-align\s*:\s*center/i.test(style)) centered++;
    if (/(border|background|box-shadow)\s*:/i.test(style)) decorated++;
  });
  const top = map => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([value, count]) => ({ value, count }));
  return { palette: top(colors), fontSizes: top(fonts), centeredBlocks: centered, decoratedBlocks: decorated,
    imageCount: $('#js_content img').length, evidenceMode: 'html_css_only', limitation: '基于正文与 HTML/CSS，未判断图片画面或海报内文字' };
}
function parseArticle(html, sourceUrl, account, now = Date.now()) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > 8 * 1024 * 1024) throw invalid('ARTICLE_TOO_LARGE', '文章超过采集大小上限');
  const url = canonicalUrl(sourceUrl), $ = cheerio.load(html);
  if (!$('#js_content').length) {
    const blocked = /验证|访问过于频繁|环境异常|captcha|verify|访问受限/i.test($.text());
    throw invalid(blocked ? 'SOURCE_VERIFICATION_REQUIRED' : 'ARTICLE_UNAVAILABLE', blocked ? '来源要求验证，已停止自动采集，请处理来源后重试' : '文章已删除、不可用或不含正文', 422);
  }
  const source = extractFullArticleFromHtml(html);
  if (!source.title.trim()) throw invalid('ARTICLE_METADATA_INCOMPLETE', '无法核验文章标题，未创建未命名记录', 422);
  const name = source.author.trim();
  const biz = scriptValue(html, ['biz']) || new URL(url).searchParams.get('__biz') || '';
  if (account.biz ? biz !== account.biz : !parsed(account.expected_names, []).includes(name)) throw invalid('ACCOUNT_MISMATCH', '文章所属公众号与目标不符', 422);
  const rawDate = scriptValue(html, ['ct', 'oriCreateTime', 'createTime']);
  const shownDate = $('#publish_time').text().trim().match(/\d{4}[-年/]\d{1,2}[-月/]\d{1,2}/)?.[0];
  let publishedAt = /^\d{10,13}$/.test(rawDate) ? Number(rawDate) * (rawDate.length <= 10 ? 1000 : 1) : NaN;
  let datePrecision = 'second';
  if (!Number.isFinite(publishedAt) && shownDate) {
    const parts = shownDate.match(/\d+/g); publishedAt = dateTimestamp(`${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`);
    datePrecision = 'day';
  }
  if (!Number.isFinite(publishedAt)) throw invalid('PUBLICATION_DATE_UNKNOWN', '无法核验发布日期，未按当前日期伪造入库', 422);
  if (publishedAt < dateTimestamp(account.since_date)) throw invalid('BEFORE_HISTORY_START', '文章早于设定回溯起点', 422);
  if (publishedAt > now + 24 * 3600000) throw invalid('PUBLICATION_DATE_INVALID', '文章发布日期超出当前时间', 422);
  const raw = $('#js_content').clone(); raw.find('script,style,iframe,form').remove();
  raw.find('p,section,h1,h2,h3,h4,li,blockquote,br').append('\n');
  const text = raw.text().replace(/[\t\r ]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
  if (text.length < 20) throw invalid('ARTICLE_TEXT_INSUFFICIENT', '正文文字不足，可能是海报或视频文章，需要补充图像理解', 422);
  const mid = scriptValue(html, ['appmsgid', 'mid']) || new URL(url).searchParams.get('mid');
  const idx = scriptValue(html, ['idx', 'itemidx']) || new URL(url).searchParams.get('idx');
  const identity = biz && mid && idx ? `${biz}:${mid}:${idx}` : url;
  const visuals = visualFeatures($);
  let styles = []; try { styles = extractStyleBlocksFromHtml(html).blocks; } catch { /* Content remains available without reusable styles. */ }
  return { title: source.title.slice(0, 512), author: name.slice(0, 160), sourceUrl: url, biz,
    identityStatus: account.biz ? 'biz_verified' : 'name_matched', publishedAt, canonicalKey: hash(identity),
    blocks: source.blocks, text, styleBlocks: styles, visualFeatures: visuals,
    contentHash: hash({ title: source.title, blocks: source.blocks }),
    metadata: { identity, publisher: { name, biz: biz || null }, publishedAt, datePrecision, dateEvidence: datePrecision === 'second' ? 'article_script_timestamp' : '#publish_time',
      imageCount: source.imageCount, importedAt: now } };
}
function lexicalFeatures(text) {
  const clean = String(text).normalize('NFKC').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  const counts = {};
  for (let i = 0; i < clean.length - 1; i++) { const token = clean.slice(i, i + 2); counts[token] = Math.min(6, (counts[token] || 0) + 1); }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 1500));
}
function similarity(left, right) {
  let dot = 0, a = 0, b = 0;
  for (const [token, value] of Object.entries(left)) { a += value * value; dot += value * (right[token] || 0); }
  for (const value of Object.values(right)) b += value * value;
  return a && b ? dot / Math.sqrt(a * b) : 0;
}
module.exports = { PROTOCOL_VERSION, PRESETS, SCENES, hash, parsed, invalid, canonicalUrl, dateTimestamp, parseArticle, visualFeatures, lexicalFeatures, similarity };
