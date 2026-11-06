// 公众号官方 API 自动发现（合规路径）：用帐号自己的 AppID/AppSecret 调
// 「获取已发布的消息列表」拉最新文章，再交给现有逆向/身份校验链路。
// 需要帐号管理员在公众平台配置服务器 IP 白名单；没有凭据时返回 null，监控继续用官网目录。
// 文档：https://developers.weixin.qq.com/doc/subscription/api/public/api_freepublish_batchget.html
const BASE = 'https://api.weixin.qq.com';
const error = (code, message) => Object.assign(Error(message || code), { code });

const ACCOUNT_KEY = /^[a-z][a-z0-9_-]{0,31}$/;
const APPID = /^wx[a-zA-Z0-9]{16}$/;
const SECRET = /^[a-zA-Z0-9]{32}$/;

function normalizeAccount(value) {
  if (!value || typeof value !== 'object') return null;
  const key = String(value.key || '').trim();
  const appid = String(value.appid || '').trim();
  const secret = String(value.secret || '').trim();
  if (!ACCOUNT_KEY.test(key) || !APPID.test(appid) || !SECRET.test(secret)) return null;
  return { key, appid, secret };
}

// 两种写法：WECHAT_OFFICIAL_ACCOUNTS=[{"key","appid","secret"}]，或按账号
// WECHAT_OFFICIAL_<KEY>_APPID / WECHAT_OFFICIAL_<KEY>_SECRET（KEY 大写）。
function officialAccounts(env = process.env) {
  const accounts = new Map();
  for (const presetKey of ['hit', 'bjzgca']) {
    const prefix = `WECHAT_OFFICIAL_${presetKey.toUpperCase()}`;
    const account = normalizeAccount({ key: presetKey, appid: env[`${prefix}_APPID`], secret: env[`${prefix}_SECRET`] });
    if (account) accounts.set(account.key, account);
  }
  const raw = String(env.WECHAT_OFFICIAL_ACCOUNTS || '').trim();
  if (raw) {
    let list = null;
    try { list = JSON.parse(raw); } catch { list = null; }
    if (!Array.isArray(list)) throw error('WECHAT_API_CONFIG_INVALID', 'WECHAT_OFFICIAL_ACCOUNTS 必须是 JSON 数组');
    for (const item of list) {
      const account = normalizeAccount(item);
      if (!account) throw error('WECHAT_API_CONFIG_INVALID', '公众号 API 配置需要合法的 key/appid/secret');
      accounts.set(account.key, account);
    }
  }
  return [...accounts.values()];
}

function classifyErrcode(errcode) {
  if (errcode === 40001 || errcode === 42001 || errcode === 42007 || errcode === 41001) return 'WECHAT_API_TOKEN_INVALID';
  if (errcode === 40164) return 'WECHAT_API_IP_NOT_ALLOWED';
  if (errcode === 48001 || errcode === 50001) return 'WECHAT_API_UNAUTHORIZED';
  if (errcode === -1 || errcode === 45009) return 'WECHAT_API_BUSY';
  return 'WECHAT_API_ERROR';
}
function assertNoErrcode(document) {
  if (document && typeof document === 'object' && document.errcode !== undefined && Number(document.errcode) !== 0) {
    const code = classifyErrcode(Number(document.errcode));
    throw error(code, `微信接口错误 ${document.errcode}: ${String(document.errmsg || '').slice(0, 120)}`);
  }
  return document;
}

function createOfficialClient({ request = (...args) => fetch(...args), now = Date.now, base = BASE, logger = console } = {}) {
  const tokens = new Map();
  async function readJson(response) {
    if (!response || typeof response.ok !== 'boolean') throw error('WECHAT_API_UNAVAILABLE', '微信接口响应无效');
    if (!response.ok) throw error('WECHAT_API_UNAVAILABLE', `微信接口 HTTP ${response.status}`);
    let size = 0; const chunks = [];
    for await (const chunk of response.body || []) {
      size += chunk.length;
      if (size > 1024 * 1024) throw error('WECHAT_API_INVALID_RESPONSE', '微信接口响应过大');
      chunks.push(Buffer.from(chunk));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw error('WECHAT_API_INVALID_RESPONSE', '微信接口返回非 JSON'); }
  }
  async function token(account, { refresh = false } = {}) {
    const cached = tokens.get(account.key);
    if (!refresh && cached && cached.expiresAt > now() + 120000) return cached.value;
    const url = `${base}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(account.appid)}&secret=${encodeURIComponent(account.secret)}`;
    let document;
    try { document = await readJson(await request(url, { method: 'GET', signal: AbortSignal.timeout(15000) })); }
    catch (failure) { throw failure.code ? failure : error('WECHAT_API_UNAVAILABLE', '获取 access_token 失败'); }
    assertNoErrcode(document);
    if (typeof document.access_token !== 'string' || !document.access_token) throw error('WECHAT_API_INVALID_TOKEN', '微信接口未返回 access_token');
    const ttl = Math.max(60, Math.min(Number(document.expires_in) || 7200, 7200));
    tokens.set(account.key, { value: document.access_token, expiresAt: now() + ttl * 1000 });
    return document.access_token;
  }
  async function batchget(account, { offset = 0, count = 20 } = {}) {
    const accessToken = await token(account);
    const url = `${base}/cgi-bin/freepublish/batchget?access_token=${encodeURIComponent(accessToken)}`;
    let document;
    try {
      document = await readJson(await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset, count, no_content: 1 }), signal: AbortSignal.timeout(15000) }));
    } catch (failure) { throw failure.code ? failure : error('WECHAT_API_UNAVAILABLE', '拉取发布列表失败'); }
    if (document && Number(document.errcode) === 40001 || document && Number(document.errcode) === 42001) {
      // token 失效：清缓存重试一次，仍失败就交给上层按 blocked 记录。
      tokens.delete(account.key);
      const retriedToken = await token(account, { refresh: true });
      document = await readJson(await request(`${base}/cgi-bin/freepublish/batchget?access_token=${encodeURIComponent(retriedToken)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset, count, no_content: 1 }), signal: AbortSignal.timeout(15000) }));
    }
    assertNoErrcode(document);
    if (!Array.isArray(document.item)) throw error('WECHAT_API_INVALID_RESPONSE', '发布列表缺少 item');
    return { total: Number(document.total_count) || 0, items: document.item.slice(0, 20) };
  }
  // 拉最近一页（最多 40 条），只保留可核验的微信原文链接与标题，交给 worker 入队。
  async function recentArticles(account, { pages = 2, pageSize = 20 } = {}) {
    const items = [];
    let total = 0;
    for (let page = 0; page < Math.max(1, Math.min(pages, 5)); page += 1) {
      const result = await batchget(account, { offset: page * pageSize, count: pageSize });
      total = result.total;
      for (const entry of result.items) {
        const updateTime = Number(entry.update_time) || null;
        for (const news of (entry.content && Array.isArray(entry.content.news_item) ? entry.content.news_item : [])) {
          if (news.is_deleted) continue;
          const url = String(news.url || '').trim();
          if (!/^https?:\/\/mp\.weixin\.qq\.com\/s\?|^https?:\/\/mp\.weixin\.qq\.com\/s\//.test(url)) continue;
          items.push({ url, title: String(news.title || '').slice(0, 512), updateTime, articleId: String(entry.article_id || '') });
        }
      }
      if ((page + 1) * pageSize >= total) break;
    }
    // 同一篇多图文/重复条目按 URL 去重，保留最新 updateTime。
    const unique = new Map();
    for (const item of items) if (!unique.has(item.url)) unique.set(item.url, item);
    return { total, scanned: items.length, items: [...unique.values()] };
  }
  return { token, batchget, recentArticles };
}

module.exports = { officialAccounts, createOfficialClient, classifyErrcode, assertNoErrcode, normalizeAccount };
