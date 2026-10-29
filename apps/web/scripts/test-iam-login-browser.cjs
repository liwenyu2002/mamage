const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../../server/package.json'))('playwright');
const dist = path.resolve(__dirname, '../dist'), artifacts = process.env.MAMAGE_IAM_QA_DIR;
async function main() {
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const target = file.startsWith(dist + '/') && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch();
    for (const width of [1440, 390]) for (const enabled of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height: 960 } });
      try {
        const errors = [], writes = [];
        await context.route('**/api/**', async route => {
          const req = route.request(), url = new URL(req.url());
          if (url.pathname === '/api/auth/iam/login') {
            assert.equal(url.searchParams.get('returnTo'), '/?projectId=102&upload=1');
            return route.fulfill({ contentType: 'text/plain', body: 'Isolated IAM authorization fixture' });
          }
          if (req.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
          if (url.pathname === '/api/auth/providers') return route.fulfill({ json: { password: true, iam: enabled, dingtalk: false } });
          return route.fulfill({ json: [] });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/?projectId=102&upload=1`);
        await page.locator('.auth-page-root input[type="password"]').waitFor();
        const login = page.getByRole('button', { name: '校园统一登录（钉钉）', exact: true });
        if (enabled) await login.waitFor(); else await page.waitForLoadState('networkidle');
        assert.equal(await login.count(), enabled ? 1 : 0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow at ${width}`);
        if (artifacts) await page.screenshot({ path: path.join(artifacts, `iam-${enabled}-${width}.png`), fullPage: true });
        if (enabled) { await login.click(); await page.getByText('Isolated IAM authorization fixture').waitFor(); }
        assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      } finally { await context.close(); }
    }
    console.log('IAM login browser checks passed: desktop/mobile, disabled/enabled, upload return path, no page errors');
  } finally {
    if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
