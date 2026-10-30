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
  return { challengeId, contextRaw };
}

// This adapter uses the school's own anonymous QR challenge, never its password form.
// IAM still issues an OAuth code; only the existing callback can create a MaMage session.
function createIamQrGateway({ transport = fetch } = {}) {
  async function post(cfg, page, endpoint, body, timeout = 10000) {
    const response = await transport(iamUrl('/authn/api/idp/' + endpoint, cfg), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { 'Content-Type': 'application/json', Referer: page }, body: JSON.stringify(body),
    });
    if (!response.ok) { await response.body?.cancel(); throw fail(); }
    try { return JSON.parse((await bytes(response, 256 * 1024)).toString('utf8')); } catch { throw fail(); }
  }
  return {
    async start(cfg, authorizationUrl) {
      let page = iamUrl(authorizationUrl, cfg);
      for (let i = 0; page.pathname !== '/authn/index.html'; i++) {
        if (i >= 5 || !['/sso/oauth2.0/authorize', '/sso/login'].includes(page.pathname)) throw fail();
        const response = await transport(page, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
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
      const init = await post(cfg, page.href, 'init', { sp: { type: 'IAM_TICKET', callbackUrl: service.href } });
      if (init.status !== 1000 || init.responseBody?.deny) throw fail();
      const action = init.responseBody.actions?.find(item => item.code === 'qrcode');
      if (!action?.id) throw fail();
      const initial = context(init.responseBody);
      const pre = await post(cfg, page.href, 'preAuth', { ...initial, actionId: action.id });
      if (pre.status !== 1000 || pre.responseBody?.nextActions) throw fail();
      const challenge = context(pre.responseBody, initial);
      const imageUrl = iamUrl(pre.responseBody?.param?.qrcodeUri, cfg, page);
      if (!/^\/authn\/api\/app\/qrcode\/[a-zA-Z0-9_-]{16,128}$/.test(imageUrl.pathname) || imageUrl.search) throw fail();
      const image = await transport(imageUrl, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Referer: page.href } });
      if (!image.ok) { await image.body?.cancel(); throw fail(); }
      const type = image.headers.get('content-type')?.split(';')[0];
      const mime = type === 'image/jpg' ? 'image/jpeg' : type;
      if (!['image/png', 'image/jpeg'].includes(mime)) { await image.body?.cancel(); throw fail(); }
      const data = await bytes(image, 128 * 1024);
      const valid = mime === 'image/png' ? data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
      if (!valid) throw fail();
      return { ...challenge, page: page.href, image: data.toString('base64'), mime };
    },
    async poll(cfg, attempt) {
      let result;
      try { result = await post(cfg, attempt.page, 'listening', {
        challengeId: attempt.challengeId, contextRaw: attempt.contextRaw,
      }, 20000); } catch (e) {
        if (e.name === 'TimeoutError') return { phase: 'waiting' };
        throw e;
      }
      const body = result.responseBody || {};
      if (body.nextActions || body.deny) return { phase: 'fallback' };
      if ([9046, 9045, 9044, 9075, 9074].includes(result.status)) return { phase: 'expired' };
      if (![1000, 2007].includes(result.status)) return { phase: 'fallback' };
      const updated = context(body, attempt);
      if (result.status === 2007) return { ...updated, phase: 'waiting' };
      const issues = Array.isArray(body.issue) ? body.issue : [];
      const ticket = issues.find(issue => issue.type === 'IAM_TICKET');
      if (!ticket || issues.some(issue => !['IAM_TICKET', 'crossbrowser'].includes(issue.type))) return { phase: 'fallback' };
      return { ...updated, phase: 'ready', go: completionUrl(ticket.go, cfg) };
    },
  };
}
module.exports = { createIamQrGateway, completionUrl };
