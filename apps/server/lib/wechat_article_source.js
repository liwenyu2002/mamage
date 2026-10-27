const cheerio = require('cheerio');
const { openPublicHttps, readLimitedText } = require('./public_remote_fetch');

// Keep the existing reverse-import request profile; never rotate identities or copy browser cookies.
const DESKTOP_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
function sourceError(code, message, httpStatus = 502) {
  return Object.assign(Error(message), { code, httpStatus, status: httpStatus });
}
function assertAllowedWechatUrl(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl).trim()); } catch { throw sourceError('INVALID_ARTICLE_URL', '公众号链接格式无效', 400); }
  if (url.protocol === 'https:' && url.hostname === 'mp.weixin.qq.com' && !url.username && !url.password && !url.port
    && url.pathname === '/mp/wappoc_appmsgcaptcha') {
    throw sourceError('SOURCE_VERIFICATION_REQUIRED', '公众号原文跳转到验证页面，已停止该链接的自动处理', 422);
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'mp.weixin.qq.com' || url.username || url.password
    || url.port || !/^\/s(?:\/[^/?#]+)?\/?$/.test(url.pathname)) {
    throw sourceError('INVALID_ARTICLE_URL', '仅支持 mp.weixin.qq.com/s 公众号文章链接', 400);
  }
  url.protocol = 'https:'; url.hash = '';
  return url;
}
async function fetchWechatArticleHtml(rawUrl, dependencies = {}) {
  const url = assertAllowedWechatUrl(rawUrl);
  let opened;
  try {
    opened = await (dependencies.open || openPublicHttps)(url.href, {
      timeoutMs: 10000, maxRedirects: 5, userAgent: DESKTOP_CHROME_UA,
      accept: 'text/html,application/xhtml+xml', validateUrl: assertAllowedWechatUrl,
    });
  } catch (error) {
    if (error.httpStatus) throw error;
    throw sourceError(error.code || 'SOURCE_FETCH_FAILED', '公众号原文连接失败，请稍后重试');
  }
  const { response } = opened;
  if (response.statusCode !== 200) {
    response.resume();
    const code = response.statusCode === 429 ? 'SOURCE_RATE_LIMITED' : [401, 403].includes(response.statusCode)
      ? 'SOURCE_ACCESS_DENIED' : response.statusCode === 404 ? 'SOURCE_NOT_FOUND' : 'SOURCE_HTTP_ERROR';
    const error = sourceError(code, `公众号页面返回 HTTP ${response.statusCode}`);
    const seconds = Number(response.headers['retry-after']);
    if (Number.isFinite(seconds) && seconds > 0) error.retryAfter = Math.min(86400, seconds) * 1000;
    throw error;
  }
  let html;
  try { html = await readLimitedText(response, MAX_RESPONSE_BYTES); }
  catch (error) { throw sourceError(error.code || 'SOURCE_READ_FAILED', error.code === 'SOURCE_TOO_LARGE' ? '公众号页面超过 8MB 上限' : '公众号原文读取失败，请稍后重试'); }
  const $ = cheerio.load(html);
  if (!$('#js_content').length) {
    const visible = $('body').clone(); visible.find('script,style').remove();
    if (/验证|访问过于频繁|环境异常|访问受限|captcha|verify/i.test($('title').text() + visible.text())) {
      throw sourceError('SOURCE_VERIFICATION_REQUIRED', '公众号页面要求验证，已停止该链接的自动处理', 422);
    }
    throw sourceError('ARTICLE_UNAVAILABLE', '公众号文章不可用或没有正文', 422);
  }
  return { html, finalUrl: assertAllowedWechatUrl(opened.url || url).href };
}
module.exports = { fetchWechatArticleHtml, assertAllowedWechatUrl };
