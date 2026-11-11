const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const serverRequire = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = serverRequire('playwright');
const express = serverRequire('express');
const { createOidcAuthRouter } = require('../../server/routes/auth_oidc');
const dist = path.resolve(__dirname, '../dist');

async function main() {
  const app = express();
  app.use('/api/auth/oidc', createOidcAuthRouter({ config: () => ({ loginReady: true }) }));
  app.get('/test-reauth', (_req, res) => res.send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><button onclick="location.href=\'/api/auth/oidc/complete#oidc_code=' + 'h'.repeat(43) + '\'">模拟扫码确认</button></html>'));
  app.use(express.static(dist));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.MAMAGE_CHROMIUM_PATH || undefined });
  try {
    for (const [width, userAgent] of [[1440, undefined], [390, 'Mozilla/5.0 (Linux; Android 13) DingTalk/7.0']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, ...(userAgent ? { userAgent } : {}) });
    const page = await context.newPage();
    const starts = [];
    let sessions = 0;
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('logout-test-seeded')) {
        localStorage.setItem('mamage_jwt_token', 'local-test-token');
        sessionStorage.setItem('logout-test-seeded', '1');
      }
    });
    await context.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.pathname === '/api/users/me') return req.headers().authorization
        ? route.fulfill({ json: { id: 1, name: '测试用户', role: 'admin', organization_id: 1,
          permissions: ['projects.view', 'photos.view'], workspaceEnabled: true, activeUnitId: 1 } })
        : route.fulfill({ status: 401, json: { error: 'NOT_LOGGED_IN' } });
      if (url.pathname === '/api/workspaces') return route.fulfill({ json: { enabled: true, activeUnitId: 1,
        units: [{ id: 1, name: '测试小组', role: 'editor' }] } });
      if (url.pathname === '/api/album-desktop') return route.fulfill({ json: { albums: [], groups: [], sharedAlbums: [], sharedFolders: [],
        preferences: { pins: [], colors: {} }, scope: { userId: 1, organizationId: 1, unitId: 1 }, workspaceRevision: 1, userRevision: 1 } });
      if (url.pathname === '/api/projects/list') return route.fulfill({ json: { list: [], total: 0, hasMore: false } });
      if (url.pathname === '/api/projects/import-status') return route.fulfill({ json: { statuses: {} } });
      if (url.pathname === '/api/auth/providers') return route.fulfill({ json: {
        password: true, iam: true, oidc: true, oidcEmbed: true, oidcAutoStart: true, oidcLabel: '研究院统一身份认证' } });
      if (url.pathname === '/api/auth/oidc/login') {
        starts.push(url);
        return route.fulfill({ status: 302, headers: { location: url.searchParams.get('reauthenticate') === '1'
          ? '/test-reauth' : '/api/auth/oidc/complete#oidc_code=' + 'h'.repeat(43) } });
      }
      if (url.pathname === '/api/auth/iam/login') {
        starts.push(url);
        return route.fulfill({ contentType: 'text/plain', body: 'Unexpected silent campus login' });
      }
      if (url.pathname === '/api/auth/oidc/complete' || url.pathname === '/api/auth/oidc/complete.js') return route.continue();
      if (url.pathname === '/api/auth/oidc/session') {
        sessions++;
        return route.fulfill({ json: { token: 'local-test-token', returnTo: '/' } });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto(base + '/');
    await page.getByRole('button', { name: '测试用户，账户菜单' }).click();
    await page.getByRole('button', { name: '退出账号', exact: true }).click();
    if (width >= 480) await page.frameLocator('iframe.auth-oidc-frame').getByRole('button', { name: '模拟扫码确认' }).waitFor();
    else await page.getByRole('button', { name: '前往研究院统一身份认证', exact: true }).waitFor();
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => localStorage.getItem('mamage_jwt_token')), null, '退出后不能被 SSO 静默登录');
    assert.equal(starts.length, width >= 480 ? 1 : 0, '桌面显示认证页面，手机等待用户操作');
    assert.equal(sessions, 0, '未确认扫码时不能重新创建会话');
    await page.reload();
    if (width >= 480) await page.frameLocator('iframe.auth-oidc-frame').getByRole('button', { name: '模拟扫码确认' }).waitFor();
    else await page.getByRole('button', { name: '前往研究院统一身份认证', exact: true }).waitFor();
    assert.equal(sessions, 0, '刷新后仍不能静默登录');
    await page.getByRole('tab', { name: '账号密码', exact: true }).click();
    await page.getByLabel('邮箱或学号', { exact: true }).waitFor();
    await page.getByRole('tab', { name: '研究院统一身份认证', exact: true }).click();
    if (width >= 480) {
      await page.frameLocator('iframe.auth-oidc-frame').getByRole('button', { name: '模拟扫码确认' }).click();
    } else {
      await page.getByRole('button', { name: '前往研究院统一身份认证', exact: true }).click();
      await page.getByRole('button', { name: '模拟扫码确认' }).click();
    }
    await page.waitForFunction(() => localStorage.getItem('mamage_jwt_token') === 'local-test-token');
    assert.equal(await page.evaluate(() => localStorage.getItem('mamage_explicit_logout')), null);
    assert.ok(starts.length >= 1);
    assert.ok(starts.every(url => url.pathname === '/api/auth/oidc/login' && url.searchParams.get('reauthenticate') === '1'),
      '显式退出后所有统一登录都必须要求重新认证');
    assert.equal(sessions, 1);
    await context.close();
    }
    const pending = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await pending.newPage();
      let assigned = false;
      await page.addInitScript(() => localStorage.setItem('mamage_jwt_token', 'local-test-token'));
      await pending.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/users/me') return route.fulfill({ json: { id: 2, name: '新用户',
          role: assigned ? 'photographer' : 'visitor', organization_id: 1, permissions: ['photos.view'],
          workspaceEnabled: true, activeUnitId: assigned ? 1 : null, oidcNeedsAssignment: !assigned } });
        if (url.pathname === '/api/workspaces') return route.fulfill({ json: { enabled:true, activeUnitId:assigned ? 1 : null,
          units:assigned ? [{ id:1, name:'测试小组', role:'editor' }] : [] } });
        if (url.pathname === '/api/album-desktop') return route.fulfill({ json: { albums:[], groups:[], sharedAlbums:[], sharedFolders:[],
          preferences:{ pins:[], colors:{} }, scope:{ userId:2, organizationId:1, unitId:1 }, workspaceRevision:1, userRevision:1 } });
        if (url.pathname === '/api/projects/list') return route.fulfill({ json: { list:[], total:0, hasMore:false } });
        if (url.pathname === '/api/projects/import-status') return route.fulfill({ json: { statuses:{} } });
        return route.fulfill({ json:[] });
      });
      await page.goto(base + '/');
      await page.getByText('请联系管理员分配组织权限。', { exact:true }).waitFor();
      assert.equal(await page.locator('.pending-account').count(),1);
      assigned = true;
      await page.getByRole('button', { name:'刷新权限', exact:true }).click();
      await page.locator('.pending-account').waitFor({ state:'detached' });
    } finally { await pending.close(); }
    console.log('Explicit logout restores embedded login, requires reauthentication, and preserves mobile and password login');
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
