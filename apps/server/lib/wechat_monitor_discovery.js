const cheerio = require('cheerio');
const { openPublicHttps, readLimitedText } = require('./public_remote_fetch');
const { canonicalUrl, dateTimestamp, invalid, hash } = require('./wechat_monitor_content');

const SOGOU_HOST = 'weixin.sogou.com';
const OFFICIAL_HOSTS = ['news.hit.edu.cn', 'www.bza.edu.cn'];
const USER_AGENT = 'MaMage-WeChatMonitor/1.0';
const ROBOTS_CACHE = new Map();
function sourceUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw invalid('INVALID_DISCOVERY_URL', '发现来源链接无效'); }
  if (url.protocol === 'http:' && [SOGOU_HOST, 'mp.weixin.qq.com', ...OFFICIAL_HOSTS].includes(url.hostname)) url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw invalid('INVALID_DISCOVERY_URL', '来源仅接受 HTTPS');
  if (url.hostname === 'mp.weixin.qq.com') { canonicalUrl(url.href); return url; }
  if (url.hostname === 'news.hit.edu.cn' && /^\/(?:xxyw|hgdqmt)\/list\d*\.(?:htm|psp)$|^\/\d{4}\/\d{4}\/c\d+a\d+\/page\.(?:htm|psp)$/.test(url.pathname)) return url;
  if (url.hostname === 'www.bza.edu.cn' && /^\/(?:news\/?|sitemap\.txt|detail\/[A-Za-z0-9-]+\/?)$/.test(url.pathname)) return url;
  if (url.hostname !== SOGOU_HOST || !['/weixin', '/link'].includes(url.pathname)) throw invalid('SOURCE_REDIRECT_REJECTED', '来源跳转超出已核准的官网目录与微信原文范围', 422);
  url.hash = ''; return url;
}
function robotsAllowed(text, pathname) {
  const groups = []; let agents = [], rules = [];
  const commit = () => { if (agents.length) groups.push({ agents, rules }); agents = []; rules = []; };
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.replace(/#.*/, '').match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/); if (!match) continue;
    const key = match[1].toLowerCase(), value = match[2];
    if (key === 'user-agent') { if (rules.length) commit(); agents.push(value.toLowerCase()); }
    else if (['allow', 'disallow'].includes(key) && agents.length && value) rules.push({ allow: key === 'allow', pattern: value });
  }
  commit();
  const specific = groups.filter(group => group.agents.some(agent => agent !== '*' && USER_AGENT.toLowerCase().startsWith(agent)));
  const applicable = specific.length ? specific : groups.filter(group => group.agents.includes('*'));
  let best = null;
  for (const rule of applicable.flatMap(group => group.rules)) {
    const anchored = rule.pattern.endsWith('$'), value = anchored ? rule.pattern.slice(0, -1) : rule.pattern;
    const expression = '^' + value.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : '');
    const length = value.replace(/\*/g, '').length;
    if (new RegExp(expression).test(pathname) && (!best || length > best.length || length === best.length && rule.allow)) best = { length, allow: rule.allow };
  }
  return best?.allow ?? true;
}
async function checkRobots(url, dependencies = {}) {
  const open = dependencies.open || openPublicHttps, now = dependencies.now?.() ?? Date.now();
  let cached = ROBOTS_CACHE.get(url.origin);
  if (!cached || cached.expires < now) {
    const { response } = await open(`${url.origin}/robots.txt`, { timeoutMs: 10000, userAgent: USER_AGENT,
      validateUrl: next => { if (next.origin !== url.origin || next.pathname !== '/robots.txt') throw invalid('SOURCE_REDIRECT_REJECTED', 'robots 来源跳转无效'); } });
    if (response.statusCode === 404) { response.resume(); cached = { text: '', expires: now + 3600000 }; }
    else if (response.statusCode === 200) cached = { text: await readLimitedText(response, 128000), expires: now + 3600000 };
    else { response.resume(); throw invalid('SOURCE_POLICY_UNAVAILABLE', '无法核验来源采集规则，暂缓采集', 503); }
    ROBOTS_CACHE.set(url.origin, cached);
  }
  if (!robotsAllowed(cached.text, url.pathname + url.search)) throw invalid('SOURCE_ROBOTS_DISALLOWED', '来源 robots 规则不允许自动读取此入口', 422);
}
async function fetchPage(raw, dependencies = {}) {
  const url = sourceUrl(raw);
  const validateSource = async value => {
    const next = sourceUrl(value);
    if (next.hostname === SOGOU_HOST) throw invalid('SOURCE_POLICY_DISALLOWED', '搜狗禁止后台机器人采集；请通过公开页面人工发现并导入原文链接', 422);
    await (dependencies.checkRobots || checkRobots)(next, dependencies);
  };
  await validateSource(url);
  const { response, url: finalUrl } = await (dependencies.open || openPublicHttps)(url.href, { timeoutMs: 15000,
    userAgent: USER_AGENT, accept: 'text/html,application/xhtml+xml', validateUrl: validateSource });
  if (response.statusCode !== 200) {
    const retryAfter = Number(response.headers['retry-after']); response.resume();
    const code = response.statusCode === 429 ? 'SOURCE_RATE_LIMITED' : [401, 403].includes(response.statusCode) ? 'SOURCE_ACCESS_DENIED'
      : response.statusCode === 404 ? 'SOURCE_NOT_FOUND' : 'SOURCE_HTTP_ERROR';
    const error = invalid(code, `来源返回 HTTP ${response.statusCode}`, 502);
    error.retryAfter = Number.isFinite(retryAfter) ? Math.min(86400, retryAfter) * 1000 : null; throw error;
  }
  const html = await readLimitedText(response, 8 * 1024 * 1024);
  const $ = cheerio.load(html), visible = $('body').clone(); visible.find('script,style').remove(); const text = visible.text();
  if (/antispider|captcha|请输入验证码|访问过于频繁|访问异常|环境异常|搜狗搜索验证码/i.test(`${finalUrl}\n${$('title').text()}\n${text.slice(0, 3000)}`)
    && !$('#js_content').length) throw invalid('SOURCE_VERIFICATION_REQUIRED', '来源出现验证或访问限制，已暂停此来源', 422);
  return { html, finalUrl: sourceUrl(finalUrl).href };
}
function searchUrl(name, { page = 1, from = null, to = null } = {}) {
  const url = new URL('https://weixin.sogou.com/weixin');
  url.searchParams.set('type', '2'); url.searchParams.set('query', name); url.searchParams.set('page', String(page));
  if (from && to) {
    dateTimestamp(from); dateTimestamp(to);
    url.searchParams.set('query', `${name} ${from.slice(0, 7)}`);
  }
  return url.href;
}
function historicalWindows(since, now = Date.now()) {
  dateTimestamp(since);
  const day = new Date(now + 8 * 3600000).toISOString().slice(0, 10), windows = [];
  let start = since;
  while (start <= day && windows.length < 1200) {
    const next = new Date(dateTimestamp(start) + 8 * 3600000);
    next.setUTCMonth(next.getUTCMonth() + 1, 1);
    const end = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
    windows.push({ from: start, to: end < day ? end : day }); start = next.toISOString().slice(0, 10);
  }
  return windows.reverse();
}
function parseSearch(html, pageUrl, expectedName) {
  const $ = cheerio.load(html), articles = [], seen = new Set();
  const results = $('.news-list li, [id^="sogou_vr_11002601_box_"]');
  results.each((_, element) => {
    const item = $(element), anchor = item.find('h3 a').first(), raw = anchor.attr('href');
    if (!raw) return;
    const account = item.find('.s-p .all-time-y2, .account, .s-p a').first().text().trim();
    if (account !== expectedName) return;
    let url;
    try { url = sourceUrl(new URL(raw, pageUrl).href).href; } catch { return; }
    if (seen.has(url)) return; seen.add(url);
    articles.push({ url, title: anchor.text().trim().slice(0, 512), account, discoveryUrl: pageUrl });
  });
  const next = $('#sogou_next').attr('href');
  let nextUrl = null;
  if (next) {
    try { const url = sourceUrl(new URL(next, pageUrl).href); if (url.hostname === SOGOU_HOST && url.pathname === '/weixin') nextUrl = url.href; } catch { /* Untrusted pagination is not followed. */ }
  }
  const knownEmpty = /没有找到|未找到|暂无.*结果|相关结果约?\s*0/.test($('.main-left, #main').text());
  if (!articles.length && !knownEmpty && !results.length) throw invalid('SOURCE_FORMAT_CHANGED', '搜狗页面结构无法识别，未将空页面记作无更新', 422);
  return { articles, nextUrl, coverage: 'search_index_partial', fingerprint: hash(articles.map(article => article.url)) };
}
function articleRedirect(html, baseUrl) {
  const $ = cheerio.load(html);
  const values = [$('meta[http-equiv="refresh"]').attr('content')?.replace(/^.*?url\s*=\s*/i, ''),
    ...[...String(html).matchAll(/https?:\/\/mp\.weixin\.qq\.com\/s(?:\?[^\s"'<>\\]+|\/[\w-]+)/g)].map(match => match[0])];
  for (const value of values.filter(Boolean)) {
    try { return canonicalUrl(new URL(value.replace(/&amp;/g, '&'), baseUrl).href); } catch { /* Only actual article destinations are accepted. */ }
  }
  throw invalid('SOURCE_LINK_REQUIRES_BROWSER', '搜狗中转链接需要正常浏览器打开，未执行来源脚本或绕过验证', 422);
}
function parseOfficialIndex(html, pageUrl, accountKey) {
  const url = sourceUrl(pageUrl), $ = cheerio.load(html), articles = new Set(), pages = new Set();
  const expected = accountKey === 'hit' ? 'news.hit.edu.cn' : 'www.bza.edu.cn';
  if (url.hostname !== expected) throw invalid('ACCOUNT_SOURCE_MISMATCH', '官网目录与目标机构不匹配', 422);
  const consider = raw => {
    let target; try { target = sourceUrl(new URL(raw, url).href); } catch { return; }
    if (target.hostname === 'mp.weixin.qq.com') articles.add(target.href);
    else if (target.hostname === expected && target.href !== url.href) pages.add(target.href);
  };
  $('a[href]').each((_, element) => consider($(element).attr('href')));
  // Nuxt publishes its page data as JSON, not an authenticated backend endpoint.
  const embedded = $('#__NUXT_DATA__').html();
  if (embedded) {
    let value; try { value = JSON.parse(embedded); } catch { throw invalid('SOURCE_FORMAT_CHANGED', '官网嵌入目录数据格式已变化', 422); }
    const visit = (item, depth = 0) => {
      if (depth > 16) return;
      if (typeof item === 'string' && /^(https?:\/\/|\/detail\/)/.test(item)) consider(item);
      else if (Array.isArray(item)) item.forEach(child => visit(child, depth + 1));
      else if (item && typeof item === 'object') Object.values(item).forEach(child => visit(child, depth + 1));
    };
    visit(value);
  }
  if (url.pathname.endsWith('.txt')) for (const line of html.split(/\r?\n/)) if (/^https?:\/\//.test(line.trim())) consider(line.trim());
  if (!articles.size && !pages.size && !/\/detail\/|\/page\.htm$/.test(url.pathname)) throw invalid('SOURCE_FORMAT_CHANGED', '官网目录未解析出链接，未误记为历史采集完成', 422);
  return { articles: [...articles].map(value => ({ url: value, discoveryUrl: pageUrl, sourceKind: 'official_site_wechat_link' })),
    pages: [...pages], coverage: 'official_index_partial' };
}
module.exports = { sourceUrl, robotsAllowed, checkRobots, fetchPage, searchUrl, historicalWindows, parseSearch, articleRedirect, parseOfficialIndex };
