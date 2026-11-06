// 本地 QA 预览入口（手动运行，不跑测试）：复用 serve-news-usability 的同源静态服务。
// 构建产物默认在 .local/news-usability-qa/gallery-dist；未构建时请先运行：
//   MAMAGE_NEWS_OBSERVED_ARTICLES=.local/observed-layouts-20261103/articles.json \
//     node scripts/test-news-gallery-browser.cjs
// 然后：
//   npm run preview:news
const path = require('node:path');
const { createServer, output } = require('./serve-news-usability.cjs');

const port = Number(process.env.PORT || 5199);
const distDirectory = path.resolve(process.env.MAMAGE_QA_DIST || path.join(output, 'gallery-dist'));
const server = createServer({ distDirectory });
server.listen(port, '127.0.0.1', () => {
  console.log(`[qa] 排版台（wechat）  http://127.0.0.1:${port}/?channel=wechat`);
  console.log(`[qa] 原文对照页      http://127.0.0.1:${port}/?view=gallery-styles`);
  console.log(`[qa] dist: ${distDirectory}`);
});
server.on('error', error => { console.error('[qa] 启动失败:', error.code || error.message); process.exitCode = 1; });
