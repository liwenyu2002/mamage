const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const { chromium } = createRequire(path.join(root, '../server/package.json'))('playwright');
const { compareParagraphSources } = require('../../server/lib/news_paragraphs');
const output = process.env.MAMAGE_HARDENING_QA_DIR || path.resolve(root, '../../.local/project-hardening-qa');
const dist = path.join(output, 'dist');
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const config = require('../webpack.config')({}, { mode: 'development' });
  await new Promise((resolve, reject) => require('webpack')({ ...config, context: root, entry: './scripts/fixtures/project-hardening.jsx',
    devtool: false, output: { ...config.output, path: dist }, optimization: { splitChunks: false } }, (error, stats) =>
    error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const server = http.createServer((req, res) => {
    const requested = path.join(dist, new URL(req.url, 'http://fixture').pathname);
    const file = requested.startsWith(dist + '/') && fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(dist, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch(); const cases = [];
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const errors = [], writes = []; let complete = false, rejectStatus = true;
      const rewrite = '20名同学在报告厅展示摄影作品并交流。';
      const job = { status: 'running' };
      await context.route('**/api/**', async route => {
        const req = route.request(), url = new URL(req.url()), body = req.postDataJSON();
        if (url.pathname === '/api/operations/status') {
          if (rejectStatus) { rejectStatus = false; return route.fulfill({ status: 500, json: { message: '运行状态暂时不可用' } }); }
          return route.fulfill({ json: { checkedAt: new Date().toISOString(), alerts: [], analysis: { pending: 0, running: 0, failed: 0 },
            system: { disk: { availableBytes: 46 * 1024 ** 3 }, rssBytes: 256 * 1024 ** 2 }, tasks: [], failures: [],
            search: { count: 140, p95Ms: 140, errors: 0, empty: 35 }, backup: { createdAt: new Date().toISOString(), verified: true, bytes: 236000000 },
            regression: { passed: 17, cases: 17, createdAt: new Date().toISOString() }, integrations: { https: false, dingtalk: false, transcription: false } } });
        }
        if (url.pathname.endsWith('/sources')) return route.fulfill({ json: compareParagraphSources(body.markdown, body) });
        if (url.pathname.endsWith('/rewrite')) { writes.push(body); return route.fulfill({ status: 202, json: { jobId: 9001 } }); }
        if (url.pathname.endsWith('/jobs/9001') || url.pathname.includes('/rewrites/')) return route.fulfill({ json: complete ? { status: 'succeeded', result: { markdown: rewrite } } : job });
        throw Error('Unexpected fixture API ' + req.method() + ' ' + url.pathname);
      });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.getByRole('alert').filter({ hasText: '运行状态暂时不可用' }).waitFor();
        await page.getByRole('button', { name: '刷新', exact: true }).click();
        await page.getByText('运行正常', { exact: true }).waitFor();
        await page.locator('.news-paragraph-tools summary').click();
        await page.getByRole('button', { name: '润色', exact: true }).waitFor();
        await page.getByText('相近材料片段', { exact: true }).waitFor();
        await page.getByRole('button', { name: '润色', exact: true }).click();
        await page.getByText('后台改写中', { exact: true }).waitFor();
        await page.reload(); complete = true;
        await page.getByRole('button', { name: '采用建议', exact: true }).waitFor();
        await page.getByRole('button', { name: '润色', exact: true }).waitFor();
        assert.equal(writes.length, 1, 'refresh must recover rather than enqueue another model job');
        const original = await page.getByRole('textbox', { name: '正文', exact: true }).inputValue();
        await page.getByRole('textbox', { name: '正文', exact: true }).fill(original + '\n\n人工修改。');
        assert.equal(await page.getByRole('button', { name: '采用建议', exact: true }).isDisabled(), true);
        await page.getByRole('textbox', { name: '正文', exact: true }).fill(original);
        await page.screenshot({ path: path.join(output, `paragraph-review-${width}.png`), fullPage: true });
        await page.getByRole('button', { name: '采用建议', exact: true }).click();
        assert.equal(await page.getByRole('textbox', { name: '正文', exact: true }).inputValue(), original.replace(writes[0].markdown.slice(writes[0].start, writes[0].end), rewrite));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no viewport overflow');
        assert.deepEqual(errors, []);
        cases.push({ width, pendingRefresh: true, explicitAdoption: true, concurrentEditProtected: true, statusRecovery: true });
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, cases }, null, 2));
    console.log(JSON.stringify({ passed: true, cases }));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
