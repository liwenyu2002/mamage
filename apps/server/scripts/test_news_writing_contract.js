const assert = require('node:assert/strict');
const { test } = require('node:test');
const mock = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const events = [];
const inserts = [];
let failJob = false;
const connection = {
  beginTransaction: async () => events.push('begin'),
  commit: async () => events.push('commit'),
  rollback: async () => events.push('rollback'),
  release: () => events.push('release'),
  query: async (sql, values) => {
    inserts.push({ sql, values });
    if (failJob && sql.includes('INSERT INTO ai_jobs')) throw new Error('simulated insert failure');
    return [{ insertId: inserts.length + 100 }];
  },
};
mock('../db', { pool: { getConnection: async () => connection, query: async () => [[]] } });
mock('../lib/ai_job_worker', { enqueueJob: async id => events.push(`enqueue:${id}`) });
mock('../lib/news_preview_renderer', {});
mock('../lib/workspace_access', { resolveWorkspace: async () => ({ enabled: false }), sendWorkspaceError: () => false });
mock('../lib/channel_templates', { getActiveTemplates: async () => [
  { channel_key: 'press_release', name: '官网新闻' }, { channel_key: 'weibo', name: '微博' },
] });
mock('../lib/ai_quota', { checkAndReserveQuota: async () => events.push('quota') });
const router = require('../routes/ai_news');
const { assemblePrompt, buildFactCheck } = router;
const { buildSystemPrompt } = require('../ai_function/ai_for_news/ai_for_news');

test('channel writing requirements reach the prompt; interviews are not silently truncated', () => {
  const interview = '现场记录。'.repeat(1100) + '末尾重要事实：活动完成了成果展示。';
  const prompt = assemblePrompt({ eventName: '校园活动' }, [{ id: 1, faceNames: ['识别候选'] }],
    '旧样文有3000人参加', interview,
    { channelName: '新闻稿', writingRequirements: '导语突出学生实践' });
  assert(prompt.includes('导语突出学生实践'));
  assert(prompt.includes('末尾重要事实：活动完成了成果展示。'));
  assert(prompt.includes('未确认'));
});
test('pasted activity material and rewrite intent reach the model without mandatory form fields', () => {
  const sourceMaterial = '10月12日，200名学生在报告厅介绍实践作品。';
  const prompt = assemblePrompt({ sourceMaterial, writingMode: 'rewrite' }, [], '', '', { channelName: '新闻稿' });
  assert(prompt.includes(sourceMaterial));
  assert.match(prompt, /润色/);
  assert.match(prompt, /待确认|待核对/);
  const checked = buildFactCheck({ markdown: '200名学生在报告厅介绍实践作品。',
    formSnapshot: { sourceMaterial }, personNames: [], forbiddenWords: [] });
  assert(!checked.issues.some(issue => issue.type === 'unsupported_number'));
});

test('all channel templates are subordinate to factual boundaries', () => {
  const system = buildSystemPrompt({ channelTemplate: { prompt_fragments: { systemRules: ['必须补充量化成效'] } } });
  assert.match(system, /不得.*编造|禁止.*编造/);
  assert.match(system, /引语/);
  assert.match(system, /人工确认/);
});

test('unsupported attendance, attributed speech and quotations are review warnings', () => {
  const result = buildFactCheck({
    markdown: '# 活动举办\n2026年10月12日，活动在报告厅举行，3000人参加。校长表示，要继续加强人才培养。“这是我们共同努力的重要成果。”',
    formSnapshot: { eventName: '活动举办', eventDate: '2026-10-12', location: '报告厅', highlights: '学生展示作品', interviewText: '' },
    personNames: [], forbiddenWords: [],
  });
  assert(result.issues.some(issue => issue.type === 'unsupported_number'));
  assert(result.issues.some(issue => issue.type === 'unsupported_quote'));
  assert(result.issues.some(issue => issue.type === 'unsupported_speech'));
  assert.equal(result.reviewRequired, true);
});

test('provided quotations and metrics do not receive unsupported warnings', () => {
  const result = buildFactCheck({
    markdown: '200名学生参加。张老师表示：“这是我们共同努力的重要成果。”',
    formSnapshot: { participants: '200名学生', interviewText: '张老师表示：“这是我们共同努力的重要成果。”' },
    personNames: [], forbiddenWords: [],
  });
  assert(!result.issues.some(issue => issue.type.startsWith('unsupported_')));
});

async function generate(body) {
  events.length = 0;
  inserts.length = 0;
  const handler = router.stack.find(layer => layer.route?.path === '/generate/batch').route.stack.at(-1).handle;
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ user: { id: 7 }, body }, response);
  return response;
}

test('batch route stores writing requirements and a complete job matrix before enqueue', async () => {
  const response = await generate({ form: { eventName: '校园活动', targetWords: '500-800' },
    channels: ['press_release', 'weibo'], interviewText: '末尾采访事实', writingRequirements: '突出学生实践' });
  assert.equal(response.statusCode, 202);
  assert.equal(response.body.jobs.length, 2);
  const snapshot = JSON.parse(inserts[0].values[3]);
  assert.equal(snapshot.interviewText, '末尾采访事实');
  assert.equal(snapshot.writingRequirements, '突出学生实践');
  for (const job of inserts.slice(1)) {
    assert(job.values[5].includes('突出学生实践'));
    assert.equal(JSON.parse(job.values[6]).maxTokens, 2300);
  }
  assert(events.indexOf('commit') < events.findIndex(value => value.startsWith('enqueue:')));
  assert(events.includes('release'));
});
test('batch route accepts a few lines of material without a separately filled event form', async () => {
  const sourceMaterial = '学生交流实践项目，教师现场点评。重点写学生的实践过程。';
  const response = await generate({ form: { sourceMaterial }, channels: ['press_release'] });
  assert.equal(response.statusCode, 202);
  assert.equal(JSON.parse(inserts[0].values[3]).sourceMaterial, sourceMaterial);
  assert(inserts[1].values[5].includes(sourceMaterial));
});

test('oversized interview is rejected without quota or inserts', async () => {
  const response = await generate({ channels: ['press_release'], interviewText: '字'.repeat(20001) });
  assert.equal(response.statusCode, 413);
  assert.deepEqual(events, []);
  assert.deepEqual(inserts, []);
});
test('oversized pasted material is rejected without silently dropping the end', async () => {
  const response = await generate({ form: { sourceMaterial: '字'.repeat(20001) }, channels: ['press_release'] });
  assert.equal(response.statusCode, 413);
  assert.deepEqual(events, []);
});

test('failed job insertion rolls the entire batch back and starts no workers', async () => {
  failJob = true;
  try {
    const response = await generate({ channels: ['press_release'] });
    assert.equal(response.statusCode, 500);
    assert(events.includes('rollback'));
    assert(events.includes('release'));
    assert(!events.includes('commit'));
    assert(!events.some(value => value.startsWith('enqueue:')));
  } finally { failJob = false; }
});
