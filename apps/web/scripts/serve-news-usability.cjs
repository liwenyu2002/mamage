const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.resolve(root, '../../.local/news-usability-qa');
const images = process.env.MAMAGE_NEWS_QA_IMAGES || path.join(process.env.HOME, 'Downloads/MaMage-search-test-20261013/images');

function createServer({ liveRevision = false, runRevision, backendURL = null, session = null, distDirectory = path.join(output, 'dist') } = {}) {
  if (backendURL && (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(backendURL) || !session?.token)) throw Error('A local sandbox API and session are required');
  const dist = path.resolve(distDirectory);
  const jobs = new Map();
  let running = 0;
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const revision = require('../../server/lib/news_revision');
  const execute = runRevision || (input => revision.generateRevision({ options: { revision: input, inputFingerprint: input.fingerprint } }));
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture'), pathname = url.pathname;
    if (backendURL && !/^(?:127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) return json(res, 403, { message: '仅支持本机测试' });
    if (backendURL && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { message: '仅支持本地预览页面' });
    if (pathname === '/__news-qa/config') return json(res, 200, backendURL
      ? { liveRevision: true, liveBackend: true, session } : { liveRevision });
    if (backendURL && pathname.startsWith('/api/')) {
      const upstream = http.request(new URL(req.url, backendURL), { method: req.method,
        headers: { ...req.headers, host: new URL(backendURL).host } }, response => {
        res.writeHead(response.statusCode, { ...response.headers, 'Cache-Control': 'no-store' });
        response.pipe(res);
      });
      upstream.on('error', () => {
        if (!res.headersSent) json(res, 502, { message: '本地真实后端未连接，请重试' }); else res.destroy();
      });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
      req.pipe(upstream);
      return;
    }
    const task = pathname.match(/^\/__news-qa\/revision(?:\/([A-Za-z0-9_-]{8,100}))?$/);
    if (task) {
      if (!liveRevision) return json(res, 503, { message: '真实改稿模型未连接，不返回模拟建议' });
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { message: '仅支持本地预览页面' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { message: '仅支持本地预览页面' });
      const scope = ['user', 'workspace'].map(key => url.searchParams.get(key) || '900003');
      if (scope.some(value => !/^[1-9]\d{0,9}$/.test(value))) return json(res, 400, { message: '预览空间无效' });
      const keyFor = id => `${scope.join(':')}:${id}`;
      for (const [key, job] of jobs) if (job.status !== 'running' && Date.now() - job.createdAt > 3600000) jobs.delete(key);
      if (req.method === 'GET' && task[1]) {
        const job = jobs.get(keyFor(task[1]));
        return job ? json(res, 200, { status: job.status, result: job.result, error: job.error }) : json(res, 404, { message: '本地改稿任务不存在，可重新提交' });
      }
      if (req.method !== 'POST' || task[1]) return json(res, 405, { message: '请求方式不支持' });
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { message: '仅接受 JSON' });
      try {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 300000) { json(res, 413, { message: '内容过长' }); return; }
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!/^[A-Za-z0-9_-]{8,100}$/.test(body.clientRequestId || '')) return json(res, 400, { message: '任务标识无效' });
        const input = revision.buildRevisionRequest(body), key = keyFor(body.clientRequestId), existing = jobs.get(key);
        if (existing) return existing.fingerprint === input.fingerprint
          ? json(res, 202, { status: existing.status }) : json(res, 409, { message: '同一任务不能提交不同内容' });
        if (running >= 2 || jobs.size >= 1000) return json(res, 429, { message: '本地改稿忙，请稍后重试' });
        const job = { fingerprint: input.fingerprint, createdAt: Date.now(), status: 'running' };
        jobs.set(key, job); running++;
        Promise.resolve().then(() => execute(input)).then(result => {
          job.status = 'succeeded'; job.result = { plan: result.extra.plan };
        }).catch(error => {
          job.status = 'failed';
          job.error = error.status === 400 ? error.message : '真实 AI 改稿未完成，原稿已保留，请稍后重试';
        }).finally(() => { running--; });
        return json(res, 202, { status: 'running' });
      } catch (error) {
        return json(res, error.status === 400 || error instanceof SyntaxError ? 400 : 500,
          { message: error.status === 400 ? error.message : '改稿请求无效，原稿已保留' });
      }
    }
    const image = pathname.match(/^\/__news-qa\/images\/(\d+\.jpg)$/);
    const requested = image ? path.join(images, image[1]) : path.join(dist, pathname);
    const file = (image || requested.startsWith(dist + '/')) && fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested : path.join(dist, 'index.html');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css'
      : file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') ? 'image/jpeg' : 'text/html; charset=utf-8');
    fs.createReadStream(file).pipe(res);
  });
}
module.exports = { createServer, output, root };
if (require.main === module) createServer({ liveRevision: process.env.MAMAGE_NEWS_PREVIEW_LIVE === '1',
  backendURL: process.env.MAMAGE_NEWS_SANDBOX_API || null,
  session: process.env.MAMAGE_NEWS_SANDBOX_SESSION_FILE ? JSON.parse(fs.readFileSync(process.env.MAMAGE_NEWS_SANDBOX_SESSION_FILE, 'utf8')) : null })
  .listen(Number(process.env.PORT || 5192), '127.0.0.1', () => console.log('News preview: http://127.0.0.1:' + (process.env.PORT || 5192)));
