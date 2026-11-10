const { error } = require('./iam_protocol');

const fail = () => error('IAM_QR_UNAVAILABLE', 502);
function iamUrl(value, cfg, base = cfg.authorizeUrl) {
  const url = new URL(value, base), origin = new URL(cfg.authorizeUrl).origin;
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.hash) throw fail();
  return url;
}
function completionUrl(value, cfg) {
  if (typeof value !== 'string' || value.length > 16000) throw fail();
  const url = iamUrl(value, cfg);
  if (!url.pathname.startsWith('/sso/')) throw fail();
  return url.href;
}
async function bytes(response, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) { throw fail(); }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function context(body, previous = {}) {
  const challengeId = body?.challengeId || previous.challengeId;
  const contextRaw = body?.contextRaw || previous.contextRaw;
  if (typeof challengeId !== 'string' || !challengeId || challengeId.length > 512
    || typeof contextRaw !== 'string' || !contextRaw || contextRaw.length > 128 * 1024) throw fail();
  const crossBrowserId = body?.crossBrowserId || previous.crossBrowserId;
  if (crossBrowserId !== undefined && (typeof crossBrowserId !== 'string' || !crossBrowserId || crossBrowserId.length > 256)) throw fail();
  return crossBrowserId ? { challengeId, contextRaw, crossBrowserId } : { challengeId, contextRaw };
}

// This adapter uses the school's own anonymous QR challenge, never its password form.
// IAM still issues an OAuth code; only the existing callback can create a MaMage session.
const ATTEMPT_TIMEOUT = 5000, ATTEMPTS = 3;
// IAM's /authn/api/idp/* intermittently stalls without ever answering (seen from several networks).
// A stalled attempt never recovers, so retry on transport-level failures only, with a short cap per attempt.
const transient = e => ['TimeoutError', 'AbortError'].includes(e?.name)
  || ['UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(e?.cause?.code);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function createIamQrGateway({ transport = fetch } = {}) {
  // IAM 的 challenge 绑定在 /authn 的会话 cookie 上；没有 cookie 时 listening 会立刻返回 7001。
  function jar() {
    const store = new Map();
    const absorb = response => {
      if (!response || typeof response.headers?.getSetCookie !== 'function') return;
      for (const raw of response.headers.getSetCookie()) {
        const [pair] = String(raw).split(';'); const at = pair.indexOf('=');
        if (at > 0) store.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
      }
    };
    return { absorb, header: () => [...store.entries()].map(([k, v]) => k + '=' + v).join('; ') };
  }
  async function send(target, options, { attempts = ATTEMPTS, timeout = ATTEMPT_TIMEOUT } = {}) {
    let last;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try { return await transport(target, { ...options, signal: AbortSignal.timeout(timeout) }); }
      catch (e) {
        last = e;
        if (!transient(e) || attempt === attempts) throw e;
        console.warn('[iam-qr] upstream retry', attempt, e.name || e.cause?.code || 'error');
        await pause(150);
      }
    }
    throw last;
  }
  async function post(cfg, page, endpoint, body, { timeout = ATTEMPT_TIMEOUT, attempts = ATTEMPTS, cookies = null } = {}) {
    const jarHeader = cookies?.header?.() || '';
    const response = await send(iamUrl('/authn/api/idp/' + endpoint, cfg), {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Referer: page, ...(jarHeader ? { Cookie: jarHeader } : {}) }, body: JSON.stringify(body),
    }, { timeout, attempts });
    cookies?.absorb?.(response);
    if (!response.ok) { await response.body?.cancel(); throw fail(); }
    try { return JSON.parse((await bytes(response, 256 * 1024)).toString('utf8')); } catch { throw fail(); }
  }
  const FLAKY = new Set([9308, 9999]);
  // 传输层超时与 IAM 侧偶发抖动码都重试；真正的业务拒绝（如无 qrcode 动作）不重试。
  async function postUntil(cfg, page, endpoint, body, accept, cookies = null) {
    let last;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const result = await post(cfg, page, endpoint, body, { timeout: 3000, attempts: 1, cookies });
        if (accept(result)) return result;
        last = result;
        if (!FLAKY.has(result.status) || attempt === 5) return result;
        console.warn('[iam-qr] upstream flaky status', endpoint, result.status, 'attempt', attempt);
      } catch (e) {
        if (!transient(e) || attempt === 5) throw e;
        console.warn('[iam-qr] upstream retry', endpoint, e.name || 'error', 'attempt', attempt);
      }
      await pause(120);
    }
    return last;
  }
  return {
    async start(cfg, authorizationUrl) {
      let stage = 'page';
      try { return await startFlow(cfg, authorizationUrl, jar()); }
      catch (e) {
        if (e.code === 'IAM_QR_UNAVAILABLE') console.warn('[iam-qr] start failed at stage', stage);
        throw e;
      }
      async function startFlow(cfg, authorizationUrl, cookies) {
      const withCookies = options => ({ ...options, headers: { ...(options.headers || {}), ...(cookies.header() ? { Cookie: cookies.header() } : {}) } });
      let page = iamUrl(authorizationUrl, cfg);
      for (let i = 0; page.pathname !== '/authn/index.html'; i++) {
        if (i >= 5 || !['/sso/oauth2.0/authorize', '/sso/login'].includes(page.pathname)) throw fail();
        const response = await send(page, { redirect: 'manual' }, { attempts: 2, timeout: 8000 });
        cookies.absorb(response);
        await response.body?.cancel();
        if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.get('location')) throw fail();
        page = iamUrl(response.headers.get('location'), cfg, page);
      }
      const service = iamUrl(page.searchParams.get('service'), cfg);
      const authorization = new URL(authorizationUrl);
      if (service.pathname !== '/sso/oauth2.0/callbackAuthorize') throw fail();
      for (const key of ['client_id', 'redirect_uri', 'response_type', 'state', 'code_challenge', 'code_challenge_method']) {
        if (service.searchParams.get(key) !== authorization.searchParams.get(key)) throw fail();
      }
      stage = 'init';
      const init = await postUntil(cfg, page.href, 'init', { sp: { type: 'IAM_TICKET', callbackUrl: service.href } },
        result => result.status === 1000 && !result.responseBody?.deny, cookies);
      if (init.status !== 1000 || init.responseBody?.deny) {
        console.warn('[iam-qr] init rejected', init.status, String(init.msg || '').slice(0, 80));
        throw fail();
      }
      const action = init.responseBody.actions?.find(item => item.code === 'qrcode');
      if (!action?.id) { console.warn('[iam-qr] init without qrcode action', (init.responseBody.actions || []).map(a => a.code).join(',')); throw fail(); }
      const initial = context(init.responseBody);
      stage = 'preAuth';
      const pre = await postUntil(cfg, page.href, 'preAuth', { ...initial, actionId: action.id },
        result => result.status === 1000 && !result.responseBody?.nextActions, cookies);
      if (pre.status !== 1000 || pre.responseBody?.nextActions) {
        console.warn('[iam-qr] preAuth rejected', pre.status, String(pre.msg || '').slice(0, 80),
          'next=' + JSON.stringify(pre.responseBody?.nextActions || null).slice(0, 80));
        throw fail();
      }
      const challenge = context(pre.responseBody, initial);
      const imageUrl = iamUrl(pre.responseBody?.param?.qrcodeUri, cfg, page);
      if (!/^\/authn\/api\/app\/qrcode\/[a-zA-Z0-9_-]{16,128}$/.test(imageUrl.pathname) || imageUrl.search) throw fail();
      stage = 'image';
      // IAM 偶尔先返回 200 + image/jpeg 但 0 字节，等一拍再取通常就有图；因此按内容有效性重试。
      let data, mime;
      for (let attempt = 1; attempt <= 4; attempt++) {
        const image = await send(imageUrl, { redirect: 'error', headers: { Referer: page.href, ...(cookies.header() ? { Cookie: cookies.header() } : {}) } }, { attempts: 1, timeout: 8000 });
        if (!image.ok) { console.warn('[iam-qr] image http', image.status, 'attempt', attempt); await image.body?.cancel(); throw fail(); }
        const type = image.headers.get('content-type')?.split(';')[0];
        const candidate = type === 'image/jpg' ? 'image/jpeg' : type;
        const body = await bytes(image, 128 * 1024);
        const valid = candidate === 'image/png' ? body.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
          : body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
        if (['image/png', 'image/jpeg'].includes(candidate) && valid) { data = body; mime = candidate; break; }
        console.warn('[iam-qr] image retry', attempt, type, body.length);
        if (attempt === 4) throw fail();
        await pause(200);
      }
      return { ...challenge, cookies: cookies.header(), page: page.href, image: data.toString('base64'), mime };
      }
    },
    async poll(cfg, attempt) {
      let result;
      const cookies = jar();
      if (attempt.cookies) for (const pair of attempt.cookies.split(';')) {
        const at = pair.indexOf('='); if (at > 0) cookies.absorb(new Response(null, { headers: { 'set-cookie': pair.trim() } }));
      }
      try { result = await post(cfg, attempt.page, 'listening', {
        challengeId: attempt.challengeId, contextRaw: attempt.contextRaw,
        ...(attempt.crossBrowserId ? { crossBrowserId: attempt.crossBrowserId } : {}),
      }, { timeout: 5000, attempts: 1, cookies }); } catch (e) {
        if (e.name === 'TimeoutError') return { phase: 'waiting' };
        throw e;
      }
      const body = result.responseBody || {};
      const note = (phase) => { if (phase !== 'waiting') console.warn('[iam-qr] poll', phase, result.status,
        JSON.stringify({ next: body.nextActions || null, deny: Boolean(body.deny), issues: (body.issue || []).map(i => i.type) }).slice(0, 200)); };
      if (body.nextActions || body.deny) { note('fallback'); return { phase: 'fallback' }; }
      if ([9046, 9045, 9044, 9075, 9074].includes(result.status)) { note('expired'); return { phase: 'expired' }; }
      if (![1000, 2007].includes(result.status)) { note('fallback'); return { phase: 'fallback' }; }
      console.warn('[iam-qr] listening', result.status, 'challenge=' + String(attempt.challengeId).slice(0, 8));
      const updated = context(body, attempt);
      const keep = { cookies: cookies.header() };
      if (result.status === 2007) return { ...updated, ...keep, phase: 'waiting' };
      const issues = Array.isArray(body.issue) ? body.issue : [];
      const ticket = issues.find(issue => issue.type === 'IAM_TICKET');
      if (!ticket || issues.some(issue => !['IAM_TICKET', 'crossbrowser'].includes(issue.type))) { note('fallback'); return { phase: 'fallback' }; }
      let go;
      try { go = completionUrl(ticket.go, cfg); }
      catch (e) { console.warn('[iam-qr] ticket go rejected', String(ticket.go || '').slice(0, 120)); throw e; }
      console.warn('[iam-qr] poll ready', result.status);
      return { ...updated, ...keep, phase: 'ready', go };
    },
  };
}
module.exports = { createIamQrGateway, completionUrl };
