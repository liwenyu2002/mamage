function schoolIntegrationReadiness(env = process.env) {
  let site = null, callback = null;
  try { site = new URL(env.MAMAGE_PUBLIC_URL || ''); } catch {}
  try { callback = new URL(env.DINGTALK_REDIRECT_URI || ''); } catch {}
  const trustedSite = Boolean(site && site.protocol === 'https:' && !site.username && !site.password
    && !/^\d+(?:\.\d+){3}$/.test(site.hostname) && site.hostname !== 'localhost');
  const missing = [];
  if (!env.DINGTALK_CLIENT_ID) missing.push('应用标识');
  if (!env.DINGTALK_CLIENT_SECRET) missing.push('应用密钥');
  if (!trustedSite) missing.push('学校 HTTPS 入口');
  if (!callback || !trustedSite || callback.origin !== site.origin || callback.pathname !== '/api/auth/dingtalk/callback'
    || callback.search || callback.hash || callback.username || callback.password) missing.push('同站点回调地址');
  return { https: { configured: trustedSite, verified: false },
    dingtalk: { configured: missing.length === 0, missing },
    directoryDownload: { requiresHttps: true } };
}

module.exports = { schoolIntegrationReadiness };
