const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../../server/package.json'))('playwright');
const dist = path.resolve(__dirname, '../dist');
async function main() {
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.png') ? 'image/png' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.MAMAGE_CHROMIUM_PATH || undefined });
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 860 } });
      let starts = 0, polls = 0, cancels = 0, phase = 'waiting', fail = false, expires = 120000;
      const errors = [];
      try {
        await context.route('**/api/**', async route => {
          const request = route.request(), url = new URL(request.url());
          if (url.pathname === '/api/auth/providers') return route.fulfill({ json: { password: true, iam: true, iamQr: true } });
          if (url.pathname === '/api/auth/iam/qr') {
            starts++; assert.equal(request.postDataJSON().returnTo, '/?projectId=102&upload=1');
            if (fail) return route.fulfill({ status: 503, json: { error: 'IAM_QR_UNAVAILABLE' } });
            const id = String(starts).padStart(43, 'q');
            return route.fulfill({ json: { id, imageUrl: `/api/auth/iam/qr/${id}/image`, expiresAt: Date.now() + expires } });
          }
          if (url.pathname.endsWith('/image')) return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(dist, 'icons/icon-192.png')) });
          if (url.pathname.endsWith('/cancel')) { cancels++; return route.fulfill({ status: 204 }); }
          if (url.pathname.endsWith('/status')) {
            polls++; return route.fulfill({ json: { phase, ...(phase === 'ready' ? { completeUrl: url.pathname.replace('/status', '/complete') } : {}) } });
          }
          if (url.pathname.endsWith('/complete')) return route.fulfill({ contentType: 'text/plain', body: 'Continue through school OAuth' });
          return route.fulfill({ json: [] });
        });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/?projectId=102&upload=1');
        const qr = page.getByRole('img', { name: '校园登录二维码', exact: true });
        await qr.waitFor(); assert.equal(await qr.evaluate(img => img.complete && img.naturalWidth > 0), true);
        assert.ok((await qr.boundingBox()).width >= 200); assert.equal(starts, 1);
        assert.equal(await page.getByRole('button', { name: '前往校园登录', exact: true }).isEnabled(), true);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.getByRole('tab', { name: '账号密码', exact: true }).click();
        await page.getByLabel('邮箱或学号', { exact: true }).waitFor();
        await page.waitForTimeout(100); const previousPolls = polls;
        await page.waitForTimeout(1700); assert.equal(polls, previousPolls); assert.equal(cancels, 1);
        phase = 'expired'; await page.getByRole('tab', { name: '校园登录', exact: true }).click();
        await page.getByText('二维码已过期', { exact: true }).waitFor();
        fail = true; await page.getByRole('button', { name: '刷新二维码', exact: true }).click();
        await page.getByText('二维码暂不可用', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '前往校园登录', exact: true }).isEnabled(), true);
        fail = false; phase = 'waiting'; expires = 1000;
        await page.getByRole('button', { name: '刷新二维码', exact: true }).click();
        await qr.waitFor(); await page.getByText('二维码已过期', { exact: true }).waitFor();
        await page.waitForTimeout(200); assert.equal(await page.getByText('二维码暂不可用', { exact: true }).count(), 0, 'aborting the expiry poll must not overwrite the expiry message');
        phase = 'ready'; expires = 120000;
        await page.getByRole('button', { name: '刷新二维码', exact: true }).click();
        await page.getByText('Continue through school OAuth', { exact: true }).waitFor();
        assert.equal(context.pages().length, 1); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
    console.log('IAM QR browser: desktop/mobile/320px, cancel, expiry, refresh, fallback and same-tab completion passed');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
