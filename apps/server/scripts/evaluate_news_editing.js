// Opt-in, synthetic-only live-model evaluation. No database or application server is used.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
if (process.env.MAMAGE_NEWS_CONTEXT_EVAL !== '1') throw Error('Set MAMAGE_NEWS_CONTEXT_EVAL=1 to opt in to model API calls');
if (process.env.MAMAGE_NEWS_EVAL_ENV) {
  const values = require('dotenv').parse(fs.readFileSync(process.env.MAMAGE_NEWS_EVAL_ENV));
  for (const key of ['AI_TEXT_API_KEY', 'OPENAI_API_KEY', 'AI_TEXT_BASE_URL', 'DASHSCOPE_BASE_URL', 'AI_NEWS_MODEL', 'AI_TEXT_MODEL']) {
    if (values[key] && !process.env[key]) process.env[key] = values[key];
  }
}
process.env.AI_REQUEST_TIMEOUT_MS = process.env.AI_REQUEST_TIMEOUT_MS || '30000';
const { buildRevisionRequest, generateRevision } = require('../lib/news_revision');
const output = process.env.MAMAGE_NEWS_EVAL_OUTPUT || path.resolve(__dirname, '../../../.local/news-context-eval-20261024/results.json');
function story(first = '校园植物名录', second = '观察手册') {
  const blocks = Array.from({ length: 18 }, (_, i) => ({ uid: `b-${i}`, type: 'paragraph',
    text: `这是本次项目第${i + 1}部分的过程记录。` + '同学们在观察中整理笔记，对资料进行分类，以便后续讨论；这些过程记录不代表新的成果或统计数据。'.repeat(8) }));
  blocks[0] = { uid: 'b-0', type: 'heading', depth: 1, text: '青禾项目观察记录' };
  blocks[1].text = `本次青禾项目的第一项成果是${first}。`;
  blocks[7].text = '本次项目只记录校园内观察，不进行校外调查；没有开展竞赛评奖。';
  blocks[10].text = '另一个社团去年的书展成果是访谈报告，与本次项目无关。';
  blocks[11].text = '本次项目的两项成果分别为。';
  blocks[16].text = `本次项目的第二项成果是${second}。本次项目仅有一个班参加，观察结果不能推论全校情况。`;
  return { title: blocks[0].text, blocks };
}
function requestFor(mode, instruction, source = story()) {
  const target = mode === 'continue' ? null : { uid: 'b-11', ...(mode === 'complete' ? { start: 12, end: 12 } : {}) };
  return buildRevisionRequest({ source, mode, target, instruction });
}
const cases = [
  ...[
    { name: 'school-missing-asks', material: '同学介绍项目，教师点评。', questions: true },
    { name: 'school-polish-missing-asks', mode: 'polish', material: '同学介绍项目，教师点评。', questions: true },
    { name: 'school-material-resolves', material: '本次活动的学校全称是青禾实验中学。', require: ['青禾实验中学'] },
    { name: 'school-polish-follows-instruction', mode: 'polish', material: '本次活动的学校全称是青禾实验中学。', require: ['青禾实验中学'] },
    { name: 'school-distant-document-resolves', material: '同学介绍项目，教师点评。', documentName: '青禾实验中学', require: ['青禾实验中学'] },
    { name: 'school-counterfactual-name', material: '本次活动的学校全称是望川中学。', require: ['望川中学'], forbid: ['青禾实验中学'] },
    { name: 'school-ambiguous-asks', material: '青禾实验中学与望川中学共同举办交流。没有记录报告厅属于哪所学校。', questions: true },
    { name: 'school-question-answer', material: '同学介绍项目，教师点评。', instruction: '学校全称是青禾实验中学。',
      conversation: [{ role: 'user', text: '写清楚是什么学校' }, { role: 'assistant', text: '请提供学校全称。' }], require: ['青禾实验中学'] },
  ].map(item => ({ ...item, input: buildRevisionRequest({ source: { title: '学生实践交流', blocks: [
    { uid: 'b-0', type: 'heading', depth: 1, text: '学生实践交流' },
    { uid: 'b-1', type: 'paragraph', text: '学校在报告厅举行学生实践交流。学生介绍了各自的项目，教师在现场进行点评。' },
    ...(item.documentName ? [...Array.from({ length: 10 }, (_, index) => ({ uid: `b-${index + 2}`, type: 'paragraph', text: '交流围绕实践项目展开，同学整理资料，结合现场情况分享项目进展。' })),
      { uid: 'b-16', type: 'paragraph', text: `本次活动举办学校为${item.documentName}，报告厅属于这所学校。` }] : []),
  ] }, mode: item.mode || 'custom', target: { uid: 'b-1', start: 0, end: 2 }, instruction: item.instruction || '写清楚是什么学校',
  form: { sourceMaterial: item.material }, conversation: item.conversation || [] }) })),
  { name: 'complete-distant-two-facts', input: requestFor('complete', '只在句号前补全两项成果名称。'), require: ['校园植物名录', '观察手册'], forbid: ['访谈报告'] },
  { name: 'complete-counterfactual-source-swap', input: requestFor('complete', '只在句号前补全两项成果名称。', story('校园水表台账', '节水观察手册')), require: ['校园水表台账', '节水观察手册'], forbid: ['校园植物名录', '访谈报告'] },
  { name: 'polish-middle-boundaries', input: requestFor('polish', '润色这一段，写清本次项目名称、观察范围和没有开展评奖的边界。'), require: ['青禾', '校园'], match: /(?:未|没|不|无).{0,8}(?:评奖|竞赛)/ },
  { name: 'insert-after-anchor', input: requestFor('add_paragraph', '在本段后补一段说明两项成果，不挪动或改写原文。'), require: ['校园植物名录', '观察手册'], forbid: ['访谈报告'] },
  { name: 'continue-with-limit', input: requestFor('continue', '文末只续写一段简短结尾，交代两项成果并保留适用范围限制。'), require: ['校园植物名录', '观察手册', '一个班'], match: /(?:不能|不宜|不应|不可|不足以|并不).{0,12}(?:全校|推论|代表)/, forbid: ['手册只有', '手册仅有'] },
  { name: 'expand-grounded-context', input: requestFor('expand', '扩写本段，交代两项成果、校园观察范围及不能代表全校的限制。'), require: ['校园植物名录', '观察手册', '校园', '全校'] },
  { name: 'missing-quotation-asks', input: requestFor('add_paragraph', '补一段本次项目负责人在现场的直接发言原话。'), questions: true },
  { name: 'shorten-with-distant-limit', input: (() => {
    const source = story();
    source.blocks[11].text = '通过持续整理、不断整理和反复归类，本次项目最终形成了校园植物名录和观察手册两项成果。两项成果的形成离不开观察和记录，观察和记录也支撑了两项成果的形成。';
    return requestFor('shorten', '精简本段的重复内容，保留两项成果，并带上全文的适用范围限制。', source);
  })(), require: ['校园植物名录', '观察手册', '一个班', '全校'], maxChars: 75 },
  { name: 'follow-up-keeps-two-block-scope', input: (() => {
    const source = story();
    source.blocks[11].text = '本次项目形成的两项成果分别为校园植物名录和观察手册。';
    source.blocks[12].text = '本次项目仅有一个班参加，观察结果不能推论全校情况。';
    return buildRevisionRequest({ source, mode: 'custom', target: { uids: ['b-11', 'b-12'] }, instruction: '这两段再简短一点，保留成果名称和范围边界，其他不动。' });
  })(), require: ['校园植物名录', '观察手册', '一个班', '全校'] },
];
async function main() {
  const results = [];
  for (const item of cases) {
    const started = performance.now();
    try {
      const result = await generateRevision({ options: { revision: item.input, inputFingerprint: item.input.fingerprint } });
      const plan = result.extra.plan;
      const additions = plan.blocks.filter(block => !item.input.source.blocks.some(old => old.uid === block.uid));
      const targetText = item.input.target?.uids ? plan.blocks.filter(block => item.input.target.uids.includes(block.uid)).map(block => block.text).join('\n')
        : item.input.target && plan.blocks.find(block => block.uid === item.input.target.uid)?.text;
      const text = item.questions ? '' : ['continue', 'add_paragraph'].includes(item.input.mode) ? additions.map(block => block.text).join('\n') : targetText;
      if (item.questions) assert.ok(plan.questions?.length, 'missing quotation must ask instead of fabricating');
      else {
        assert.ok(!plan.questions?.length, 'facts are present in the full document');
        for (const word of item.require || []) assert.ok(text.includes(word), `missing required context: ${word}`);
        for (const word of item.forbid || []) assert.ok(!text.includes(word), `used distractor: ${word}`);
        if (item.match) assert.match(text, item.match);
        if (item.maxChars) assert.ok(text.length <= item.maxChars, 'shorten must reduce verbosity rather than just append context');
      }
      results.push({ name: item.name, passed: true, elapsedMs: Math.round(performance.now() - started), tokens: result.tokens,
        mode: item.input.mode, contextBlocks: item.input.source.blocks.length, contextChars: JSON.stringify(item.input.source).length,
        changedText: text, questions: plan.questions || [] });
    } catch (error) {
      results.push({ name: item.name, passed: false, elapsedMs: Math.round(performance.now() - started), error: String(error.message || error.code).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 500) });
      if (error.status === 401 || error.status === 403 || /未配置|尚未配置/.test(error.message)) break;
    }
    console.log(JSON.stringify({ name: item.name, passed: results.at(-1).passed, elapsedMs: results.at(-1).elapsedMs }));
  }
  const report = { syntheticOnly: true, productionChanged: false, automatedChecks: 'Context facts, scoped preservation, position, missing-source clarification; not a general writing-quality accuracy score.', checkedAt: new Date().toISOString(), model: process.env.AI_NEWS_MODEL || process.env.AI_TEXT_MODEL,
    passed: results.length === cases.length && results.every(item => item.passed), cases: results };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, passed: report.passed, cases: results.length }));
  if (!report.passed) process.exitCode = 1;
}
module.exports = { cases, main };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
