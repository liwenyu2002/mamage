// 组图相关浏览器测试的统一入口：必须显式提供已采集原文语料，避免测试静默降级。
//   MAMAGE_NEWS_OBSERVED_ARTICLES=.local/observed-layouts-20261103/articles.json npm run test:gallery
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const corpus = process.env.MAMAGE_NEWS_OBSERVED_ARTICLES;
if (!corpus) {
  console.error('缺少 MAMAGE_NEWS_OBSERVED_ARTICLES（已爬公众号原文 JSON）；');
  console.error('示例：MAMAGE_NEWS_OBSERVED_ARTICLES=.local/observed-layouts-20261103/articles.json npm run test:gallery');
  process.exit(2);
}
const steps = [
  'test-news-gallery-browser.cjs',
  'test-gallery-styles-browser.cjs',
  'test-observed-gallery-browser.cjs',
  'test-style-replacement-browser.cjs',
  'test-news-generation-photos.cjs',
];
for (const step of steps) {
  console.log(`\n[test:gallery] ${step}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, step)], { stdio: 'inherit', env: process.env });
  if (result.status !== 0 && result.status !== null) process.exit(result.status || 1);
  if (result.error) { console.error(result.error.message); process.exit(1); }
}
console.log('\n[test:gallery] all gallery browser suites passed');
