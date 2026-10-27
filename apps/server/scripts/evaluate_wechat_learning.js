// Real writing-model evaluation on self-authored synthetic material, not collected official posts.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
if (require.main === module && process.env.MAMAGE_WECHAT_LEARNING_LIVE !== '1') throw Error('Set MAMAGE_WECHAT_LEARNING_LIVE=1 to evaluate the actual writing model');
const root = path.resolve(__dirname, '../../..');
const directory = path.join(root, '.local/wechat-monitor-qa');
async function loadModel() {
  const health = await (await fetch('http://127.0.0.1:18192/api/health/ready')).json();
  if (health.sandbox !== true) throw Error('Refusing a non-sandbox writing backend');
  const runtime = JSON.parse(fs.readFileSync(path.join(root, '.local/news-live-backend-20261025/runtime.json'), 'utf8'));
  const command = cp.execFileSync('ps', ['-p', String(runtime.apiPid), '-o', 'command='], { encoding: 'utf8' });
  if (!command.includes('/apps/server/scripts/news_sandbox.js serve')) throw Error('Owned local writing process not found');
  const environment = cp.execFileSync('ps', ['eww', '-p', String(runtime.apiPid), '-o', 'command='], { encoding: 'utf8' });
  for (const key of ['AI_TEXT_API_KEY', 'AI_TEXT_BASE_URL', 'AI_TEXT_MODEL', 'AI_NEWS_MODEL']) {
    const value = environment.match(new RegExp('(?:^| )' + key + '=([^ ]+)'))?.[1]; if (value) process.env[key] = value.trim();
  }
  if (!process.env.AI_TEXT_API_KEY || !process.env.AI_NEWS_MODEL) throw Error('The local writing model is not configured');
}
const samples = [
  { id: 1, title: '观察计划｜一餐之后，剩下的去哪了？', paragraphs: [
    '你有没有留意过，午饭结束后，餐盘里还剩下什么？这一次，我们跟着三名学生记录食堂餐盘回收的过程。本文是自行编写的系统测试材料，不是真实新闻。',
    '第一眼：问题藏在餐盘里。学生连续六次在回收处做观察记录，发现主食剩余与盛饭份量有关。记录只覆盖这几次观察，不能代表全校浪费情况。',
    '再走一步：把发现交给具体的人。学生将记录带给食堂工作人员，询问能否试行小份主食。工作人员同意先在一个窗口收集反馈，目前没有形成全食堂推广方案。',
    '“比起先下结论，我更想知道下一步能做什么。”参与记录的同学说。改变未必从宏大的口号开始，也可以从一次认真观察和一次具体询问开始。',
    '下一次就餐，你愿意尝试小份主食吗？欢迎留下你观察到的小问题。观察计划栏目记录那些发生在校园里的微小改变。文字：测试编辑组。',
  ] },
  { id: 2, title: '观察计划｜离开教室前，谁还亮着灯？', paragraphs: [
    '你有没有留意过，晚自习结束后，空教室的灯是否还亮着？这一次，我们和两名学生走过教学楼，记录离开教室前的最后一个动作。本文是自行编写的系统测试材料，不是真实新闻。',
    '第一眼：问题藏在走廊尽头。学生在两个晚上走访十二间教室，看到部分空教室仍然亮灯。这些记录只来自两次走访，不能用于计算全校能耗。',
    '再走一步：把发现交给具体的人。学生把观察表交给值班人员，提出在出口增加关灯提醒。值班人员建议先征求自习同学意见，避免影响仍在使用教室的人。',
    '“提醒之前，先确认教室里是否还有人。”一名学生写在观察表旁。节约不是忽略真实使用需求，而是在离开之前多看一眼。',
    '离开教室前，你通常会做什么？欢迎留下你的观察。观察计划栏目记录那些发生在校园里的微小改变。文字：测试编辑组。',
  ] },
];
async function main() {
  await loadModel();
  fs.mkdirSync(directory, { recursive: true });
  const traceDirectory = path.join(directory, 'live-run-' + Date.now()); fs.mkdirSync(traceDirectory);
  const content = require('../lib/wechat_monitor_content'), learning = require('../lib/wechat_monitor_learning');
  let requestIndex = 0;
  const request = async input => {
    const response = await require('../lib/wechat_layout').requestStructuredPlan(input);
    fs.writeFileSync(path.join(traceDirectory, `raw-${++requestIndex}.json`), JSON.stringify({ synthetic: true, response }, null, 2));
    return response;
  };
  const results = [];
  for (const item of samples) {
    const html = `<h1 id="activity-name">${item.title}</h1><a id="js_name">测试公众号</a><div id="js_content">${item.paragraphs.map(text => `<p style="font-size:16px;line-height:1.8;color:#222">${text}</p>`).join('')}</div><script>var ct="${1711929600 + item.id * 86400}";var biz="SYNTHETIC_NOT_REAL";var appmsgid="${item.id}";var idx="1";</script>`;
    const article = { ...content.parseArticle(html, `https://mp.weixin.qq.com/s/synthetic-${item.id}`, { expected_names: '["测试公众号"]', since_date: '2024-01-01' }), id: item.id, revisionId: item.id };
    const candidates = learning.selectCandidates(article, results.map(result => ({ ...result.article, analysis: result.analysis, features: result.features })));
    const started = Date.now(), result = await learning.analyzeArticle(article, candidates, { request });
    assert.equal(Object.keys(result.analysis.dimensions).length, 8);
    assert.ok(result.analysis.seriesCandidates.some(candidate => candidate.name === '观察计划' && candidate.eligibleForGrouping));
    if (item.id === 2) assert.ok(result.analysis.related.some(relation => relation.articleId === 1), 'same series and clearly shared writing structure should produce an evidence-backed association');
    results.push({ article, ...result, durationMs: Date.now() - started });
  }
  const members = results.map(result => ({ ...result.article, analysis: result.analysis }));
  const started = Date.now(), group = await learning.summarizeGroup({ kind: 'series', name: '观察计划' }, members, { request });
  assert.ok(group.summary.patterns.length > 0);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'live-learning.json'), JSON.stringify({ synthetic: true, model: process.env.AI_NEWS_MODEL,
    productionChanged: false, createdAt: new Date().toISOString(), traceDirectory, results, group, groupDurationMs: Date.now() - started }, null, 2));
  console.log(JSON.stringify({ passed: true, realModel: true, synthetic: true, model: process.env.AI_NEWS_MODEL,
    articles: results.map(result => ({ id: result.article.id, durationMs: result.durationMs, tokens: result.tokens, scene: result.analysis.scene,
      dimensions: Object.keys(result.analysis.dimensions).length, series: result.analysis.seriesCandidates.map(candidate => candidate.name), related: result.analysis.related.length })),
    groupPatterns: group.summary.patterns.length, groupTokens: group.tokens, report: path.join(directory, 'live-learning.json'), productionChanged: false }));
}
module.exports = { samples };
if (require.main === module) main().catch(error => { console.error(error.code || error.name, error.message, JSON.stringify({ field: error.field, invalidEvidence: error.invalidEvidence, synthetic: true })); process.exitCode = 1; });
