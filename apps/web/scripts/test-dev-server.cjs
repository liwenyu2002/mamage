const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createRequire } = require('node:module');
const serverRequire = createRequire(path.resolve(__dirname, '../../server/package.json'));

test('Vite proxies reads, blocks production writes, renders the shared template and hot-reloads', { timeout: 60000 }, async () => {
  const { createServer } = await import('vite');
  const received = [];
  const backend = http.createServer((req, res) => {
    received.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ method: req.method, path: req.url }));
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamage-vite-'));
  const env = { MAMAGE_BACKEND_URL: `http://127.0.0.1:${backend.address().port}`,
    MAMAGE_PRODUCTION_READONLY: '1', MAMAGE_API_BASE: "'</script><script>bad()</script>", WEBPACK_DEV_SERVER_OPEN: '0' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  let server; let browser;
  try {
    const fixture = path.join(dir, 'entry.js');
    await fs.writeFile(fixture, `document.body.textContent = 'before'; if (import.meta.hot) import.meta.hot.accept();`);
    server = await createServer({ configFile: path.resolve(__dirname, '../vite.config.mjs'),
      logLevel: 'error', server: { port: 0, fs: { allow: [dir, path.resolve(__dirname, '..')] } } });
    assert.equal(server.config.server.host, '127.0.0.1');
    server.middlewares.use('/__hmr-test.js', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<script type="module" src="/@vite/client"></script><script type="module" src="/@fs${fixture}"></script>`);
    });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    for (const pathname of ['/api/probe?check=1', '/uploads/probe.jpg', '/static/probe']) {
      const response = await fetch(base + pathname);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).path, pathname);
    }
    const count = received.length;
    const denied = await fetch(base + '/api/projects', { method: 'POST' });
    assert.equal(denied.status, 405);
    assert.equal((await denied.json()).error, 'PRODUCTION_READONLY');
    assert.equal(received.length, count);
    assert.equal((await fetch(base + '/api/users/login', { method: 'POST' })).status, 200);
    const html = await (await fetch(base + '/share/smoke')).text();
    assert.match(html, /src="\/src\/index.jsx"/);
    assert.match(html, /@vite\/client/);
    assert.doesNotMatch(html, /<%=|<script>bad/);
    assert.match(html, /\\u003c\/script>/);
    assert.match(await (await fetch(base + '/src/index.jsx')).text(), /createRoot/);
    assert.equal((await fetch(base + '/favicon.svg')).status, 200);
    assert.equal((await fetch(base + '/.env')).status, 403);
    const { chromium } = serverRequire('playwright');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
    await page.goto(base + '/');
    try { await page.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0, null, { timeout: 15000 }); }
    catch (error) { throw Error(`${error.message}\n${pageErrors.join('\n')}`); }
    assert.deepEqual(pageErrors, [], 'the real React app must start, not only its entry module');
    await page.goto(base + '/__hmr-test.js');
    await page.waitForFunction(() => document.body.textContent === 'before');
    await fs.writeFile(fixture, `document.body.textContent = 'after'; if (import.meta.hot) import.meta.hot.accept();`);
    await page.waitForFunction(() => document.body.textContent === 'after');
  } finally {
    await browser?.close();
    await server?.close();
    await new Promise(resolve => backend.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
