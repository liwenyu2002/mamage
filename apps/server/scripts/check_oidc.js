#!/usr/bin/env node
// OIDC（Keycloak）接入自检：只读配置与（可选）发现端点，不发起登录、不写数据库、不打印密钥。
//   node scripts/check_oidc.js
//   node scripts/check_oidc.js --discovery        # 访问 <issuer>/.well-known/openid-configuration
//   node scripts/check_oidc.js --database         # 检查 iam_* 表是否存在（登录依赖账号保护表）
const { oidcConfig } = require('../lib/oidc_config');

const flags = new Set(process.argv.slice(2));
const cfg = oidcConfig();
const masked = value => value ? `${value.slice(0, 4)}…(${value.length} chars)` : '(未配置)';
const report = {
  enabled: cfg.enabled,
  loginReady: cfg.loginReady,
  missing: cfg.missing,
  issuer: cfg.issuer || null,
  providerLabel: cfg.providerLabel,
  clientId: masked(cfg.clientId),
  clientSecret: masked(cfg.clientSecret),
  clientAuth: cfg.clientAuth,
  scopes: cfg.scopes,
  callback: cfg.callback,
  publicOrigin: cfg.publicOrigin,
  organizationId: cfg.orgId,
  claimPaths: { id: cfg.profileIdPath, name: cfg.profileNamePath, email: cfg.profileEmailPath, student: cfg.profileStudentPath },
  profileLoginMatching: cfg.profileLoginMatching,
  autoProvision: cfg.autoProvision,
  clockSkewSeconds: cfg.clockSkewSeconds,
  insecureHttpSite: cfg.insecureHttp,
  sourceKey: cfg.sourceKey,
};
(async () => {
  if (flags.has('--discovery')) {
    if (!cfg.issuer) report.discovery = { error: 'OIDC_ISSUER 未配置' };
    else {
      try {
        const response = await fetch(`${cfg.issuer}/.well-known/openid-configuration`, { redirect: 'error', signal: AbortSignal.timeout(cfg.timeoutMs) });
        const document = await response.json();
        report.discovery = { status: response.status, issuerMatches: document.issuer === cfg.issuer,
          authorization_endpoint: document.authorization_endpoint, token_endpoint: document.token_endpoint,
          jwks_uri: document.jwks_uri, userinfo_endpoint: document.userinfo_endpoint || null };
      } catch (e) { report.discovery = { error: e.code || e.message || 'unreachable' }; }
    }
  }
  if (flags.has('--database')) {
    try {
      const pool = require('../db').pool;
      const [rows] = await pool.query("SHOW TABLES LIKE 'iam\\_%'");
      report.database = { iamTables: rows.map(row => Object.values(row)[0]).filter(Boolean) };
      report.database.ready = ['iam_login_identities', 'iam_login_pending', 'iam_identity_audit', 'iam_user_state']
        .every(name => report.database.iamTables.includes(name));
    } catch (e) { report.database = { error: e.code || 'DATABASE_UNAVAILABLE' }; }
  }
  console.log(JSON.stringify(report, null, 2));
  if (!cfg.loginReady && cfg.enabled) process.exitCode = 1;
})().catch(error => { console.error(JSON.stringify({ error: error.code || error.message })); process.exitCode = 1; });
