const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const { normalizeLayoutSource, availableStyles, buildLayoutRequest, validateLayoutPlan, generateLayout, builtin } = require('../lib/wechat_layout');
const { buildRevisionRequest, validateRevisionPlan, assembleRevisionPlan, generateRevision } = require('../lib/news_revision');

test('expanded selection remains bounded to the same sentence and retains the original selected text', () => {
  const source = { title: '标题', blocks: [{ uid: 'b-0', type: 'paragraph', text: '学校举行交流活动。第二句不应改变。' }] };
  const selected = { uid: 'b-0', start: 0, end: 2 };
  const target = { uid: 'b-0', start: 0, end: '学校举行交流活动。'.length };
  const input = buildRevisionRequest({ source, target, originalSelection: selected, mode: 'custom', instruction: '写清楚学校名称' });
  assert.equal(JSON.parse(input.prompt).originalSelection.selectedText, '学校');
  assert.throws(() => buildRevisionRequest({ source, target: { ...target, end: source.blocks[0].text.length },
    originalSelection: selected, mode: 'custom', instruction: '写清楚学校名称' }), /当前句/);
  assert.throws(() => buildRevisionRequest({ source, target, originalSelection: selected, mode: 'custom',
    instruction: '将选中文字替换，其他文字不变' }), /原始选区无效/);
});

test('a model returning the full paragraph as a replacement cannot duplicate surrounding text', () => {
  const text = '青禾实验中学于10月25日在报告厅举行星河项目分享会，师生交流记录方法。';
  const start = text.indexOf('星河'), source = { title: '标题', blocks: [{ uid: 'b-0', type: 'paragraph', text }] };
  const input = buildRevisionRequest({ source, target: { uid: 'b-0', start, end: start + 2 }, mode: 'custom',
    instruction: '将选中文字替换为星河校园观察，其他文字不变' });
  const expected = text.slice(0, start) + '星河校园观察' + text.slice(start + 2);
  const full = { title: '标题', blocks: [], replacements: [{ uid: 'b-0', text: expected }], questions: [] };
  assert.equal(assembleRevisionPlan(full, input).blocks[0].text, expected);
  const partial = { ...full, replacements: [{ uid: 'b-0', text: text.slice(start - 10, start) + '星河校园观察' }] };
  assert.throws(() => assembleRevisionPlan(partial, input), /选区外/);
});
const { registerWechatLayoutRoutes } = require('../routes/wechat_layout');

const source = { title: '实践交流', doc: [
  { uid: 'p1', kind: 'para', type: 'body', html: '同学<strong>分享</strong>实践成果。', blockId: 'discard', accent: '#ffffff' },
  { uid: 'h1', kind: 'styled', type: 'h2', content: '交流现场' },
  { uid: 'i1', kind: 'styled', type: 'imageCard', src: '/api/image?secret=private', caption: '活动现场' },
] };
const catalog = availableStyles([{ id: 27, type: 'h2', name: '组织标题' }]);
const planFor = input => ({ blocks: input.doc.map(block => ({ uid: block.uid, styleId: block.kind === 'para' ? 'builtin-body-plain'
  : builtin.templates[0].blockConfig[block.type] })), accent: '#277a70', body: { fontSize: 16, lineHeight: 1.8 }, page: { paddingX: 20 } });
const fakeModel = value => ({ chat: { completions: { create: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { total_tokens: 100 } }) } } });

test('layout requests preserve three semantic heading levels and make them explicit to the model', async () => {
  const doc = [1, 2, 3].map(level => ({ uid: `heading-${level}`, kind: 'styled', type: level === 3 ? 'h3' : 'h2', headingLevel: level, content: `第${level}级标题` }));
  const input = buildLayoutRequest({ source: { title: '文章标题', doc }, brief: '不同标题层级使用有区分的样式，整体简洁。' }, catalog);
  assert.deepEqual(input.source.doc.map(block => block.headingLevel), [1, 2, 3]);
  assert.deepEqual(JSON.parse(input.prompt).blocks.map(block => block.headingLevel), [1, 2, 3]);
  assert.throws(() => normalizeLayoutSource({ title: '', doc: [{ ...doc[0], headingLevel: 4 }] }));
  assert.throws(() => normalizeLayoutSource({ title: '', doc: [{ ...doc[2], headingLevel: 1 }] }));
  let instruction;
  const client = { chat: { completions: { create: async call => {
    instruction = call.messages[0].content;
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(planFor(input.source)) } }], usage: { total_tokens: 100 } };
  } } } };
  await generateLayout({ options: { layout: input } }, { client });
  assert.match(instruction, /headingLevel/);
});

test('content canonicalization strips styling and executable HTML without changing safe inline text', () => {
  const normalized = normalizeLayoutSource(source);
  assert.equal(normalized.doc[0].blockId, undefined); assert.equal(normalized.doc[0].accent, undefined);
  assert.equal(normalized.doc[0].html, source.doc[0].html);
  assert.equal(normalized.doc[2].src, source.doc[2].src);
  const cleaned = normalizeLayoutSource({ ...source, doc: [{ uid: 'x', kind: 'para', html: '<p style="color:red"><strong onclick="x()">好</strong><script>x()</script><a href="javascript:evil">链接</a></p>' }] });
  assert.equal(cleaned.doc[0].html, '<strong>好</strong><a>链接</a>');
  assert.throws(() => normalizeLayoutSource({ ...source, doc: [source.doc[0], source.doc[0]] }));
  assert.throws(() => normalizeLayoutSource({ ...source, doc: [{ ...source.doc[2], src: 'javascript:x' }] }));
  assert.throws(() => normalizeLayoutSource({ ...source, doc: Array(121).fill(source.doc[0]) }));
});

test('AI layout is a strict authorized style assignment, never a content rewrite', async () => {
  const input = buildLayoutRequest({ source, brief: '清爽校园风，绿色点缀' }, catalog);
  assert.ok(!input.prompt.includes('secret=private'));
  assert.ok(input.prompt.includes('组织标题'));
  const original = JSON.stringify(input.source), plan = planFor(input.source);
  const result = validateLayoutPlan({ ...plan, blocks: [...plan.blocks].reverse() }, input.source, catalog);
  assert.equal(result.blocks.length, 3); assert.equal(JSON.stringify(input.source), original);
  for (const bad of [
    { ...plan, html: '<b>rewrite</b>' }, { ...plan, title: '新标题' },
    { ...plan, blocks: plan.blocks.slice(1) },
    { ...plan, blocks: plan.blocks.map(item => ({ ...item, text: 'rewrite' })) },
    { ...plan, blocks: plan.blocks.map(item => ({ ...item, styleId: 'db-999' })) },
    { ...plan, blocks: [plan.blocks[0], plan.blocks[0], plan.blocks[2]] },
    { ...plan, blocks: [plan.blocks[1], { ...plan.blocks[0], styleId: 'db-27' }, plan.blocks[2]] },
    { ...plan, body: { fontSize: 99 } }, { ...plan, page: { position: 'fixed' } },
  ]) assert.throws(() => validateLayoutPlan(bad, input.source, catalog));
  const output = await generateLayout({ options: { layout: input, inputFingerprint: input.fingerprint } }, { client: fakeModel(plan) });
  assert.equal(output.extra.fingerprint, input.fingerprint); assert.equal(output.tokens, 100);
  await assert.rejects(generateLayout({ options: { layout: input } }, { client: fakeModel({ ...plan, html: 'bad' }) }));
});

const revisionBody = { source: { title: '实践交流', blocks: [
  { uid: 'b-0', type: 'heading', depth: 1, text: '实践交流' }, { uid: 'b-2', type: 'paragraph', text: '同学分享实践成果，教师参与交流。' },
  { uid: 'b-4', type: 'image', text: '交流现场' },
] }, instruction: '导语简短一点', form: { sourceMaterial: '同学分享实践成果，教师参与交流。' } };
test('AI revisions avoid adding emoji without stripping user-provided content', async () => {
  const body = { ...revisionBody, source: { ...revisionBody.source, blocks: revisionBody.source.blocks.map(block => block.uid === 'b-2'
    ? { ...block, text: '同学说：“加油🙂”。' } : block) }, target: { uid: 'b-2' }, instruction: '润色这段' };
  const input = buildRevisionRequest(body);
  let system;
  const client = { chat: { completions: { create: async call => {
    system = call.messages[0].content;
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: input.source.title,
      blocks: [{ uid: 'b-2', text: '一名同学说：“加油🙂”。' }], replacements: [], questions: [] }) } }], usage: { total_tokens: 1 } };
  } } } };
  const result = await generateRevision({ options: { revision: input } }, { client });
  assert.match(system, /不要主动.*表情符号/);
  assert.match(result.extra.plan.blocks[1].text, /加油🙂/);
});
test('a word selection is explicit in the prompt and replacement fragments cannot overwrite surrounding content', async () => {
  const body = { ...revisionBody, source: { ...revisionBody.source, blocks: revisionBody.source.blocks.map(block => block.uid === 'b-2'
    ? { ...block, text: '学校在报告厅举办交流。' } : block) }, target: { uid: 'b-2', start: 0, end: 2 }, instruction: '写清楚是什么学校' };
  const input = buildRevisionRequest(body);
  assert.deepEqual(JSON.parse(input.prompt).focus, [{ uid: 'b-2', start: 0, end: 2, selectedText: '学校' }]);
  const result = await generateRevision({ options: { revision: input } }, { client: fakeModel({ title: input.source.title,
    replacements: [{ uid: 'b-2', text: '青禾实验中学' }] }) });
  assert.equal(result.extra.plan.blocks[1].text, '青禾实验中学在报告厅举办交流。');
  assert.deepEqual(result.extra.plan.blocks[2], { uid: 'b-4', text: '交流现场' });
  for (const replacements of [[{ uid: 'b-4', text: '越界' }], [{ uid: 'b-2', text: '插入\n新段' }], [],
    [{ uid: 'b-2', text: '一' }, { uid: 'b-2', text: '二' }]]) assert.throws(() => assembleRevisionPlan({ title: input.source.title, replacements }, input));
  const question = assembleRevisionPlan({ title: input.source.title,
    blocks: input.source.blocks.map(({ uid, text }) => ({ uid, text })), questions: ['请提供学校全称。'] }, input);
  assert.deepEqual(validateRevisionPlan(question, input).blocks, input.source.blocks.map(({ uid, text }) => ({ uid, text })));
  assert.throws(() => assembleRevisionPlan({ title: input.source.title,
    blocks: [{ uid: 'b-2', text: '无关的活动概括。' }], questions: ['请提供学校全称。'] }, input), /不能同时返回修改/);
  await assert.rejects(generateRevision({ options: { revision: input } }, { client: fakeModel({ title: input.source.title,
    replacements: [{ uid: 'b-2', text: '学校' }], blocks: [], questions: [] }) }), /未完成这次修改/);
  assert.throws(() => assembleRevisionPlan({ title: input.source.title, blocks: [], replacements: [{ uid: 'b-2', text: '猜测校名' }],
    questions: ['请提供学校全称。'] }, input), /不能同时返回修改/);
});

test('local edits read the whole manuscript, including nonadjacent facts and later boundaries, but write only their target', async () => {
  const blocks = Array.from({ length: 18 }, (_, index) => ({ uid: `b-${index}`, type: 'paragraph', text: `第${index + 1}段记录项目的观察过程。` + '同学们记录不同阶段的工作，结合现场材料进行交流。'.repeat(12) }));
  blocks[1].text = '第一项成果为校园植物名录。';
  blocks[9].text = '两项成果分别为，记录用途在后文说明。';
  blocks[16].text = '第二项成果为观察手册。所有记录只供观察，不作达标评价。';
  const target = { uid: blocks[9].uid, start: 7, end: 7 };
  const input = buildRevisionRequest({ source: { title: '项目记录', blocks }, mode: 'complete', target, instruction: '补全两项成果名称' });
  const prompt = JSON.parse(input.prompt);
  assert.equal(prompt.source.blocks.length, 18);
  assert.ok(input.prompt.includes(blocks[1].text) && input.prompt.includes(blocks[16].text));
  assert.ok(input.prompt.indexOf(blocks[16].text) - input.prompt.indexOf(blocks[1].text) > 4000);
  const original = blocks[9].text;
  const text = original.slice(0, target.start) + '校园植物名录和观察手册' + original.slice(target.end);
  const partial = { title: input.source.title, blocks: [{ uid: target.uid, text }] };
  const plan = validateRevisionPlan(assembleRevisionPlan(partial, input), input);
  assert.equal(plan.blocks[9].text, text);
  for (let index = 0; index < blocks.length; index++) if (index !== 9) assert.equal(plan.blocks[index].text, blocks[index].text);
  assert.throws(() => validateRevisionPlan(assembleRevisionPlan({ ...partial, blocks: [{ uid: target.uid, text: '覆盖整个段落' }] }, input), input), /选区之外/);
  assert.throws(() => assembleRevisionPlan({ ...partial, blocks: [...partial.blocks, { uid: blocks[1].uid, text: '误改' }] }, input), /目标范围/);
  const response = await generateRevision({ options: { revision: input } }, { client: fakeModel(partial) });
  assert.equal(response.extra.plan.blocks.length, 18, 'server merges a small model response into the complete source');
});

test('insert and continue modes enforce distinct positions, preserve all original blocks and ask for missing facts', () => {
  const source = revisionBody.source;
  for (const mode of ['add_paragraph', 'continue']) {
    const input = buildRevisionRequest({ ...revisionBody, mode, target: { uid: 'b-0' }, instruction: '补充衔接，不新增事实' });
    const plan = validateRevisionPlan(assembleRevisionPlan({ title: source.title, blocks: [{ uid: 'new-p', text: '围绕实践成果的交流继续展开。' }] }, input), input);
    const index = mode === 'continue' ? source.blocks.length : 1;
    assert.equal(plan.blocks[index].uid, 'new-p');
    assert.deepEqual(plan.blocks.filter(block => block.uid !== 'new-p'), source.blocks.map(({ uid, text }) => ({ uid, text })));
    assert.throws(() => assembleRevisionPlan({ title: source.title, blocks: [{ uid: 'b-2', text: '覆盖旧段落' }] }, input));
    const question = validateRevisionPlan(assembleRevisionPlan({ title: source.title, blocks: [], questions: ['请提供本次现场发言的原话。'] }, input), input);
    assert.deepEqual(question.blocks, source.blocks.map(({ uid, text }) => ({ uid, text })));
    assert.equal(question.questions.length, 1);
  }
  const input = buildRevisionRequest({ ...revisionBody, mode: 'polish', target: { uid: 'b-2' } });
  const valid = assembleRevisionPlan({ title: source.title, blocks: [{ uid: 'b-2', text: '同学介绍实践成果，教师参与交流。' }] }, input);
  assert.equal(validateRevisionPlan(valid, input).title, source.title);
  assert.throws(() => validateRevisionPlan({ ...valid, blocks: valid.blocks.map(block => block.uid === 'b-4' ? { ...block, text: '误改图注' } : block) }, input), /选定范围/);
  assert.throws(() => buildRevisionRequest({ ...revisionBody, mode: 'complete' }), /光标/);
  assert.throws(() => buildRevisionRequest({ ...revisionBody, mode: 'add_paragraph' }), /位置/);
  assert.notEqual(buildRevisionRequest({ ...revisionBody, mode: 'expand' }).fingerprint, input.fingerprint);
  const grouped = buildRevisionRequest({ ...revisionBody, mode: 'custom', target: { uids: ['b-2', 'b-4'] }, instruction: '只调整这两处建议' });
  const groupedPlan = assembleRevisionPlan({ title: source.title, blocks: [{ uid: 'b-2', text: '同学介绍成果。' }, { uid: 'b-4', text: '交流画面' }] }, grouped);
  assert.equal(validateRevisionPlan(groupedPlan, grouped).blocks[0].text, source.blocks[0].text);
  assert.throws(() => assembleRevisionPlan({ title: source.title, blocks: [{ uid: 'b-2', text: '缺少第二处' }] }, grouped));
});
test('cross-paragraph text selections enforce every partial boundary and reject malformed or reversed ranges', () => {
  const source = { title: '原题', blocks: [
    { uid: 'b-0', type: 'paragraph', text: '原文开头保留，中间可改。' },
    { uid: 'b-2', type: 'image', text: '图注不能修改' },
    { uid: 'b-4', type: 'paragraph', text: '中间可改，原文结尾保留。' },
  ] };
  const ranges = [{ uid: 'b-0', start: 7, end: source.blocks[0].text.length }, { uid: 'b-4', start: 0, end: 5 }];
  const input = buildRevisionRequest({ source, mode: 'shorten', target: { ranges } });
  const partial = { title: source.title, blocks: [{ uid: 'b-0', text: source.blocks[0].text.slice(0, 7) + '已精简。' },
    { uid: 'b-4', text: '已精简' + source.blocks[2].text.slice(5) }] };
  const plan = validateRevisionPlan(assembleRevisionPlan(partial, input), input);
  assert.equal(plan.blocks[1].text, '图注不能修改');
  assert.throws(() => validateRevisionPlan({ ...plan, blocks: plan.blocks.map(block => block.uid === 'b-4' ? { ...block, text: '覆盖结尾' } : block) }, input), /选区之外/);
  assert.throws(() => validateRevisionPlan({ ...plan, blocks: plan.blocks.map(block => block.uid === 'b-2' ? { ...block, text: '改图注' } : block) }, input), /选定范围/);
  for (const target of [{ ranges: [...ranges].reverse() }, { ranges: [null] }, { ranges: 'bad' }, { ranges: [{ uid: 'b-0', start: -1, end: 4 }] }, { ranges, uid: 'b-0' }]) {
    assert.throws(() => buildRevisionRequest({ source, mode: 'polish', target }), error => error.status === 400);
  }
  assert.equal(JSON.parse(input.prompt).source.blocks.length, 3);
});

test('dialogue revisions retain image identities, reject invented data and leave source intact', async () => {
  const input = buildRevisionRequest(revisionBody), original = JSON.stringify(input.source);
  const plan = { title: input.source.title, blocks: input.source.blocks.map(({ uid, text }) => ({ uid, text })) };
  plan.blocks[1].text = '同学分享实践成果。';
  assert.deepEqual(validateRevisionPlan(plan, input), plan); assert.equal(JSON.stringify(input.source), original);
  assert.throws(() => validateRevisionPlan({ ...plan, blocks: plan.blocks.slice(0, 2) }, input));
  assert.throws(() => validateRevisionPlan({ ...plan, blocks: [...plan.blocks, { uid: 'unknown', text: '新增' }] }, input));
  assert.throws(() => validateRevisionPlan({ ...plan, blocks: [...plan.blocks, { uid: 'new-p', text: '<script>x</script>' }] }, input));
  assert.throws(() => validateRevisionPlan({ ...plan, blocks: [...plan.blocks, { uid: 'new-p', text: '已有9888人参加。' }] }, input));
  assert.throws(() => validateRevisionPlan({ ...plan, blocks: [...plan.blocks, { uid: 'new-p', text: '![注入图片](https://example.test/x)' }] }, input));
  assert.throws(() => validateRevisionPlan({ ...plan, title: '其他标题' }, input));
  const response = await generateRevision({ options: { revision: input, inputFingerprint: input.fingerprint } }, { client: fakeModel(plan) });
  assert.equal(response.extra.plan.blocks[1].text, '同学分享实践成果。');
});

test('layout and dialogue tasks are quota-bound, idempotent, owner/workspace/org scoped and permission gated', async () => {
  const jobs = []; let reservations = 0, enqueues = 0, reads = 0, quotaBlocked = false;
  const pool = { query: async (sql, params) => {
    reads++;
    if (sql.startsWith('SELECT id,type,name')) return [[{ id: 27, type: 'h2', name: '组织标题' }]];
    if (sql.startsWith('SELECT id,options')) return [jobs.filter(job => job.user === params[0] && job.client === params[1])];
    if (sql.startsWith('INSERT INTO ai_jobs')) {
      jobs.push({ id: jobs.length + 1, user: params[0], unit_id: params[1], options: JSON.parse(params[3]), client: params[4] }); return [{ insertId: jobs.length }];
    }
    if (sql.startsWith('SELECT j.id')) return [jobs.filter(job => job.user === params[0] && job.client === params[1]
      && job.unit_id === params[2] && job.options.purpose === params[3] && job.options.organizationScope === params[4]).map(job => ({ id: job.id, status: 'pending' }))];
    throw Error(`Unexpected SQL ${sql}`);
  } };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.get('x-user') || 7), organization_id: Number(req.get('x-org') || 2) }; next(); });
  const router = express.Router();
  registerWechatLayoutRoutes(router, { pool, requirePermission: () => (req, res, next) => req.get('x-role') === 'viewer' ? res.sendStatus(403) : next(),
    resolveWorkspace: async req => { if (req.get('x-space') === 'denied') throw Object.assign(Error('No workspace access'), { status: 403 }); return { enabled: true, unitId: Number(req.get('x-space') || 1) }; },
    sendWorkspaceError: (res, error) => { if (error.message === 'No workspace access') { res.status(403).json({ error: 'FORBIDDEN' }); return true; } return false; },
    checkAndReserveQuota: async () => {
      if (quotaBlocked) throw Object.assign(Error('本月配额已用完'), { statusCode: 429 });
      reservations++;
    }, enqueueJob: async () => { enqueues++; } });
  app.use('/api/wechat-compositions', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/wechat-compositions`;
  const post = (path, data, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) });
  try {
    for (const [task, payload] of [['layout', { source, brief: '清爽校园风' }], ['revision', revisionBody]]) {
      const body = { ...payload, clientRequestId: `synthetic-${task}-request-001` };
      const before = reads, quotaBefore = reservations;
      assert.equal((await post('/' + task, body, { 'x-role': 'viewer' })).status, 403); assert.equal(reads, before);
      assert.equal((await post('/' + task, body, { 'x-space': 'denied' })).status, 403); assert.equal(reservations, quotaBefore);
      assert.equal((await post('/' + task, { ...body, source: null })).status, 400); assert.equal(reservations, quotaBefore);
      assert.equal((await post('/' + task, body)).status, 202); assert.equal((await post('/' + task, body)).status, 202);
      assert.equal(reservations, quotaBefore + 1); assert.equal(jobs.length, reservations); assert.equal(enqueues, reservations);
      assert.equal((await post('/' + task, { ...body, brief: 'different', instruction: '改结尾' })).status, 409);
      assert.equal((await fetch(`${base}/${task}/${body.clientRequestId}`)).status, 200);
      for (const headers of [{ 'x-user': '8' }, { 'x-space': '3' }, { 'x-org': '4' }]) assert.equal((await fetch(`${base}/${task}/${body.clientRequestId}`, { headers })).status, 404);
      assert.equal((await post('/' + task, body, { 'x-space': '3' })).status, 409);
    }
    quotaBlocked = true;
    const before = jobs.length;
    assert.equal((await post('/revision', { ...revisionBody, clientRequestId: 'synthetic-quota-rejection-001' })).status, 429);
    assert.equal(jobs.length, before);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
