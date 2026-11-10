const assert = require('node:assert/strict');
const path = require('node:path'), http = require('node:http');
const { createRequire } = require('node:module');
const serverRequire = createRequire(path.resolve(__dirname, '../../server/package.json'));
const { chromium } = serverRequire('playwright');
const express = serverRequire('express');
const { createOidcAuthRouter } = require('../../server/routes/auth_oidc');
const dist = path.resolve(__dirname, '../dist');
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self' http://localhost:*; object-src 'none'; base-uri 'self'";

async function main() {
  const app = express();
  let base, failCallback = false;
  const oauth = new URLSearchParams({ code: 'test-authorize-code', state: 's'.repeat(43) }).toString();
  app.use((req, res, next) => { res.set('Content-Security-Policy', csp); next(); });
  app.get('/fixture-idp', (req, res) => res.type('html').send(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Test IdP</title><body><h2>测试认证服务</h2><a href="${base}/api/auth/oidc/complete${failCallback
      ? '#oidc_error=OIDC_ACCOUNT_NOT_AUTHORIZED' : '#oidc_callback=' + encodeURIComponent(oauth)}">模拟扫码确认</a></body></html>`));
  app.use('/api/auth/oidc', createOidcAuthRouter({ config: () => ({ loginReady: true }) }));
  app.use(express.static(dist));
  app.get(/.*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const idpBase = `http://localhost:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.MAMAGE_CHROMIUM_PATH || undefined });
    for (const width of [1440, 480]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let starts = 0, sessions = 0, failing = false, returnTo = '/';
      failCallback = false;
      try {
        await page.clock.install();
        await context.route('**/api/**', async route => {
          const request = route.request(), url = new URL(request.url());
          if (url.pathname === '/api/auth/providers') return route.fulfill({ json: {
            password: true, iam: true, iamQr: true, oidc: true, oidcEmbed: true, oidcAutoStart: true, oidcLabel: '研究院统一身份认证' } });
          if (url.pathname === '/api/auth/oidc/login') {
            starts++; returnTo = url.searchParams.get('returnTo');
            if (failing) return route.fulfill({ status: 503, json: { error: 'OIDC_LOGIN_UNAVAILABLE' } });
            return route.fulfill({ status: 302, headers: { location: `${idpBase}/fixture-idp?attempt=${starts}`,
              'set-cookie': 'mamage_oidc_lan=test-browser-binding; Path=/; HttpOnly; SameSite=Lax' } });
          }
          if (url.pathname === '/api/auth/oidc/finish') {
            assert.equal(request.frame(), page.mainFrame(), '必须在顶层完成 Cookie 校验与授权码兑换');
            assert.equal(url.searchParams.get('code'), 'test-authorize-code');
            assert.match(request.headers().cookie || '', /mamage_oidc_lan=test-browser-binding/);
            return route.fulfill({ status: 302, headers: { location: '/api/auth/oidc/complete#oidc_code=' + 'h'.repeat(43) } });
          }
          if (url.pathname === '/api/auth/oidc/complete' || url.pathname === '/api/auth/oidc/complete.js') return route.continue();
          if (url.pathname === '/api/auth/oidc/session') {
            sessions++; assert.equal(request.frame(), page.mainFrame());
            assert.equal(request.postDataJSON().code, 'h'.repeat(43));
            return route.fulfill({ json: { token: 'local-test-token', returnTo } });
          }
          if (url.pathname === '/api/users/me') return route.fulfill({ json: { id: 1, name: '测试用户', role: 'visitor', organization_id: 1 } });
          return route.fulfill({ json: [] });
        });
        const startUrl = base + '/?projectId=102&upload=1';
        await page.goto(startUrl);
        const portal = () => page.frames().find(frame => frame.url().startsWith(idpBase + '/fixture-idp'));
        await page.frameLocator('.auth-oidc-frame').getByText('测试认证服务').waitFor();
        assert.equal(page.url(), startUrl, '内嵌模式不能触发自动整页跳转');
        assert.equal(returnTo, '/?projectId=102&upload=1'); assert.equal(starts, 1);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        assert.ok((await page.locator('.auth-oidc-frame').boundingBox()).width >= 280);

        await page.evaluate(() => window.postMessage({ type: 'mamage:oidc-complete', hash: '#oidc_code=' + 'h'.repeat(43) }, location.origin));
        await portal().evaluate(() => parent.postMessage({ type: 'mamage:oidc-complete', hash: '#oidc_code=' + 'h'.repeat(43) }, '*'));
        await page.waitForTimeout(100); assert.equal(page.url(), startUrl); assert.equal(sessions, 0);

        await page.getByRole('tab', { name: '账号密码', exact: true }).click();
        await page.getByLabel('邮箱或学号', { exact: true }).waitFor();
        assert.equal(await page.locator('iframe').count(), 0, '切换密码登录后移除内嵌窗口');
        await page.getByRole('tab', { name: '研究院统一身份认证', exact: true }).click();
        await page.frameLocator('.auth-oidc-frame').getByText('测试认证服务').waitFor();
        await page.clock.fastForward(9 * 60000 + 1000);
        await page.getByText('登录已过期', { exact: true }).waitFor();
        assert.equal(await page.locator('iframe').count(), 0);
        failing = true;
        await page.getByRole('button', { name: '重新加载', exact: true }).click();
        await page.getByText('暂时无法显示登录界面', { exact: true }).waitFor();
        failing = false; failCallback = true;
        await page.getByRole('button', { name: '重新加载', exact: true }).click();
        await page.frameLocator('.auth-oidc-frame').getByText('模拟扫码确认').click();
        await page.getByText('暂时无法显示登录界面', { exact: true }).waitFor();
        const stoppedAt = starts;
        await page.waitForTimeout(150); assert.equal(starts, stoppedAt, '回调失败不能自动重开、形成循环');
        assert.equal(await page.locator('iframe').count(), 0);

        failCallback = false;
        await page.getByRole('button', { name: '重新加载', exact: true }).click();
        await page.frameLocator('.auth-oidc-frame').getByText('测试认证服务').waitFor();
        // A new login page no longer has the album URL, so verify the original deep link separately below.
        await page.goto(startUrl);
        await page.frameLocator('.auth-oidc-frame').getByText('模拟扫码确认').click();
        await page.waitForFunction(() => localStorage.getItem('mamage_jwt_token') === 'local-test-token');
        await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('projectId') === '102');
        assert.equal(returnTo, '/?projectId=102&upload=1', '一次性上传指令也须交回相册处理');
        assert.equal(sessions, 1); assert.equal(context.pages().length, 1, '不弹出新窗口');
        assert.deepEqual(errors, []);
      } catch (error) {
        const frames = [];
        for (const frame of page.frames()) frames.push({ url: frame.url(), text: await frame.locator('body').innerText({ timeout: 1000 }).catch(() => '') });
        console.error(JSON.stringify({ width, starts, sessions, url: page.url(), frames,
          text: (await page.locator('body').innerText()).slice(0, 1400), errors }));
        await page.screenshot({ path: `/tmp/mamage-oidc-browser-failure-${width}.png` });
        throw error;
      } finally { await context.close(); }
    }
    for (const width of [390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 860 } });
      try {
        await context.route('**/api/**', async route => {
          const url = new URL(route.request().url());
          if (url.pathname === '/api/auth/providers') return route.fulfill({ json: {
            password: true, oidc: true, oidcEmbed: true, oidcAutoStart: true, oidcLabel: '研究院统一身份认证' } });
          if (url.pathname === '/api/auth/oidc/login') {
            assert.equal(url.searchParams.has('embedded'), false);
            assert.equal(url.searchParams.get('returnTo'), '/?projectId=102&upload=1');
            return route.fulfill({ contentType: 'text/plain', body: 'Full-page authorization fixture' });
          }
          return route.fulfill({ json: [] });
        });
        const page = await context.newPage();
        await page.goto(base + '/?projectId=102&upload=1');
        await page.getByRole('button', { name: '前往研究院统一身份认证', exact: true }).waitFor();
        assert.equal(await page.locator('iframe').count(), 0, '窄屏不裁切官方扫码页');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.getByRole('tab', { name: '账号密码', exact: true }).click();
        await page.getByLabel('邮箱或学号', { exact: true }).waitFor();
        await page.getByRole('tab', { name: '研究院统一身份认证', exact: true }).click();
        await page.getByRole('button', { name: '前往研究院统一身份认证', exact: true }).click();
        await page.getByText('Full-page authorization fixture', { exact: true }).waitFor();
        assert.equal(context.pages().length, 1);
      } finally { await context.close(); }
    }
    console.log('OIDC iframe browser: desktop/480px embed, 390px/320px full-page fallback, message validation, expiry, failure recovery, top-level completion and deep link passed');
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
