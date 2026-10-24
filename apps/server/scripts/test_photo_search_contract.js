const assert = require('node:assert/strict');
const { test } = require('node:test');
const ai = require('../lib/ai_photo_search');
const { resolveSearchIntent, equivalents } = require('../lib/photo_search_intent');
const people = [{ id: 11, name: '甲老师', photoCount: 5 }, { id: 12, name: '乙老师', photoCount: 3 }];
const options = { orgId: 2, unitId: 7, userId: 47, workspaceEnabled: true, faceSearchAllowed: true };
const mock = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
let interpretation;
let queries;
let totals;
let streamPhotos;
let visualReview;
let indexedCandidates;
function reset(plan, { degraded = false, counts = [0] } = {}) {
  queries = [];
  totals = counts.slice();
  streamPhotos = null;
  indexedCandidates = [101];
  interpretation = { plan: ai.normalizePhotoSearchPlan(plan), aiUsed: !degraded, cached: true,
    fallbackReason: degraded ? 'timeout' : null };
}
mock('../db', { pool: { query: async (sql, params = []) => {
  assert.equal((sql.match(/\?/g) || []).length, params.length, 'every SQL value is bound');
  queries.push({ sql, params });
  if (sql.includes('FROM face_persons fp\n')) return [people.filter(person => params.at(-1).includes(person.name.toLowerCase()))];
  if (sql.includes('AS visualCandidateId')) return [sql.includes('p.id > ?')
    ? indexedCandidates.filter(id => id > params.at(-2)).slice(0, params.at(-1)).map(visualCandidateId => ({ visualCandidateId }))
    : [{ visualCandidateId: 101 }]];
  if (sql.includes('SELECT COUNT(*) AS total')) return [[{ total: totals.shift() ?? 0 }]];
  if (sql.includes('AS relevanceScore')) return [streamPhotos
    ? streamPhotos.slice(params.at(-1), params.at(-1) + params.at(-2))
    : [{ id: 101, type: 'image', description: '红色外套', tags: '[]' }]];
  if (sql.includes('SELECT DISTINCT pf.photo_id AS photoId')) return [[{ photoId: 101, personId: 11, name: '甲老师' }]];
  throw Error('Unexpected SQL');
} } });
mock('../lib/media_access', { buildMediaUrl: value => value });
mock('../lib/ai_photo_search', { ...ai, interpretPhotoSearch: async () => interpretation });
mock('../lib/search_visual_index', { ...require('../lib/search_visual_index'),
  reviewCandidates: async request => visualReview(request) });
const { searchPhotos } = require('../lib/photo_search');

test('quality search uses mutually exclusive stored-label buckets with the same score cutoffs as album culling', async () => {
  for (const quality of ['medium', 'rejected', 'recommended']) {
    reset({ quality });
    await searchPhotos({ ...options, q: '', enableAi: false });
    const count = queries.find(query => query.sql.startsWith('SELECT COUNT(*) AS total'));
    assert.ok(count);
    assert.doesNotMatch(count.sql, /ai_score\s*(?:>=|<)\s*55/,
      '41-54 point medium photos must not also match rejected search');
    assert.match(count.sql, /CASE[\s\S]+END = '(?:medium|rejected|recommended)'/);
  }
});

test('anonymous clothing reads all scoped stored candidates in bounded batches without a 128-photo recall cap', async () => {
  process.env.SEARCH_VISUAL_ENABLED = '1';process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED = '1';
  try {
    reset({ mustTerms: ['白衣服'] }, { counts: [300] });
    indexedCandidates = Array.from({ length: 300 }, (_, i) => i + 501);
    const reviews = [];
    visualReview = async request => { reviews.push(request);return { matchedIds: request.candidates.map(p => p.id), unknownIds: [], candidateCount: request.candidates.length, pending: 0, uncertain: 0, checked: request.candidates.length, rejected: 0, queued: 0, unavailable: false }; };
    const result = await searchPhotos({ ...options, q: '白衣服', projectIds: [76] });
    assert.equal(result.total, 300);assert.equal(result.search.visual.truncated, false);
    assert.equal(reviews.length, 2);assert.deepEqual(reviews.map(r => r.candidates.length), [256, 44]);
    assert.ok(reviews.every(r => r.request.anonymous && r.request.personId === null && r.enqueue === false));
    for (const candidate of queries.filter(q => q.sql.includes('AS visualCandidateId'))) {
      assert.match(candidate.sql, /p.project_id IN \(\?\)/);assert.match(candidate.sql, /COALESCE\(pr.unit_id, p.unit_id\) = \?/);
      assert.ok(!candidate.params.some(value => typeof value === 'string' && value.includes('白')));
    }
    const count = queries.find(q => q.sql.startsWith('SELECT COUNT(*) AS total'));
    assert.ok(count.params.some(value => Array.isArray(value) && value.length === 300));
  } finally { delete process.env.SEARCH_VISUAL_ENABLED;delete process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED; }
});

test('ordinary content search includes detailed descriptions without altering any permission predicates', async () => {
  reset({ mustTerms: ['羽绒服'] });
  await searchPhotos({ ...options, q: '羽绒服' });
  const count = queries.find(q => q.sql.startsWith('SELECT COUNT(*) AS total'));
  assert.match(count.sql, /p.detailed_description/);
  assert.match(count.sql, /p.organization_id = \?/);
  assert.match(count.sql, /restricted_to_user_id/);
});

test('generic single-person photos use an exact usable-face count, never literal caption keywords', async () => {
  for (const q of ['单人照', '单人照片', '请帮我找单人照', '照片里只有一个人', '独照']) {
    reset(ai.heuristicPhotoSearchPlan(q), { counts: [1] });
    const result = await searchPhotos({ ...options, q, enableAi: false });
    assert.equal(result.search.plan.personCount, 1, q);
    assert.deepEqual(result.search.plan.mustTerms, [], q);
    assert.ok(result.search.chips.includes('单人照'), q);
    const count = queries.find(query => query.sql.startsWith('SELECT COUNT(*) AS total'));
    assert.match(count.sql, /SELECT COUNT\(\*\) FROM photo_faces pf_count/);
    assert.match(count.sql, /pf_count\.organization_id = p\.organization_id/);
    assert.match(count.sql, /JSON_CONTAINS\(p.tags, '\"单人\"'\)/);
    assert.match(count.sql, /JSON_CONTAINS\(p.tags, '\"多人\"'\)/);
    assert.match(count.sql, /legacy_blocked/);
    assert.match(count.sql, /\) = \?/);
    assert.ok(count.params.includes(1));
    assert.ok(!count.params.some(value => typeof value === 'string' && /单人|独照|一个人/.test(value)));
    assert.match(count.sql, /COALESCE\(p\.type, ''\).*<> 'video'/);
    assert.deepEqual(count.params.slice(0, 3), [2, 7, 47]);
  }
});

test('generic single-person filtering keeps face authorization and does not invent counts from model prose', async () => {
  reset(ai.heuristicPhotoSearchPlan('单人照'));
  const denied = await searchPhotos({ ...options, q: '单人照', faceSearchAllowed: false });
  assert.equal(denied.total, 0);
  assert.match(denied.search.notice, /未获授权/);
  assert.ok(queries.every(query => !query.sql.includes('FROM face_persons') && !query.sql.includes('FROM photo_faces pf_count')));
  assert.match(queries.find(query => query.sql.startsWith('SELECT COUNT(*) AS total')).sql, /1 = 0/);
  for (const q of ['只有舞台', '仅有红衣', '不要单人照', '不只有一个人', '单人床', '单人沙发']) {
    const plan = resolveSearchIntent(q, { peopleOnly: true, personCount: 1 }, people);
    assert.equal(plan.personCount, null, q);
  }
  const named = resolveSearchIntent('甲老师单人照', {}, people);
  assert.equal(named.personCount, 1);
  assert.deepEqual(named.people, ['甲老师']);
  const aiProse = resolveSearchIntent('请帮我找单人照', { mustTerms: ['单人'],
    shouldTerms: ['单人照', '独自', '一人', '个人照', '独照', '单个人', '一个人'] }, people);
  assert.deepEqual(aiProse.mustTerms, []);
  assert.deepEqual(aiProse.shouldTerms, []);
});

test('workspace search includes only server-resolved saved shared references, preserving own-unit scope', async () => {
  reset({}, { counts: [1] });
  await searchPhotos({ ...options, q: '', sharedProjectIds: [76], scope: { type: 'workspace' } });
  const count = queries.find(query => query.sql.startsWith('SELECT COUNT(*) AS total'));
  assert.match(count.sql, /\(COALESCE\(pr.unit_id, p.unit_id\) = \? OR p.project_id IN \(\?\)\)/);
  assert.deepEqual(count.params.slice(0, 4), [2, 7, [76], 47]);
  assert.ok(!count.sql.includes('AND p.project_id IN (?)'), 'own projectless media must remain searchable');
});

test('folder scope applies to counts, streamed batches and visual candidates without weakening person conditions', async () => {
  reset({ people: ['甲老师'], mustTerms: ['红衣服'] }, { counts: [1] });
  const scope = { type: 'folder', id: 'meeting', name: '会议', includeDescendants: true };
  const result = await searchPhotos({ ...options, q: '红衣服的甲老师', projectIds: [83, 84, 83], scope,
    onProgress: async () => {} });
  assert.deepEqual(result.search.scope, scope);
  for (const query of queries.filter(query => query.sql.includes('LEFT JOIN projects pr'))) {
    assert.ok(query.sql.includes('p.project_id IN (?)'));
    assert.ok(query.params.some(value => Array.isArray(value) && JSON.stringify(value) === '[83,84]'));
    assert.ok(query.sql.includes('COALESCE(pr.unit_id, p.unit_id) = ?'));
    assert.ok(query.sql.includes('pf_person.person_id IN (?)'));
  }
  reset({ people: ['甲老师'] });
  const empty = await searchPhotos({ ...options, q: '甲老师', projectIds: [] });
  assert.equal(empty.total, 0);
  assert.match(queries.find(query => query.sql.startsWith('SELECT COUNT(*) AS total')).sql, /1 = 0/);
});

test('a complete camera filename is literal: no AI identity/date/clothing filters, with ACL and folder scope intact', async () => {
  const q = '2026-10-01_甲老师单人照.MOV';
  reset({ people: ['甲老师'], dateFrom: '2026-10-01', dateTo: '2026-10-01', mustTerms: ['单人照'] }, { counts: [1] });
  streamPhotos = [{ id: 101, type: 'video', originalFilename: q }];
  const result = await searchPhotos({ ...options, q, projectIds: [83, 84] });
  assert.equal(result.search.aiUsed, false);
  assert.deepEqual(result.search.plan.people, []);
  assert.equal(result.search.plan.dateFrom, null);
  assert.equal(result.search.plan.dateTo, null);
  assert.deepEqual(result.search.plan.mustTerms, [q]);
  assert.equal(result.search.plan.peopleOnly, false);
  assert.equal(result.list[0].originalFilename, q);
  assert.ok(queries.every(query => !query.sql.includes('FROM face_persons fp\n')));
  const count = queries.find(query => query.sql.startsWith('SELECT COUNT(*) AS total'));
  assert.deepEqual(count.params.slice(0, 4), [2, 7, 47, [83, 84]]);
  assert.match(count.sql, /p\.original_filename/);
  assert.ok(count.params.includes('%2026-10-01#_甲老师单人照.mov%'));
});

test('folder references widen only their authorized scope; caller-supplied IDs without server scope are ignored', async () => {
  reset({ mustTerms: ['Original.JPG'] }, { counts: [1] });
  await searchPhotos({ ...options, q: 'Original.JPG', projectIds: [81, 76], sharedProjectIds: [76, 999], scope: { type: 'folder', id: 'business' } });
  for (const query of queries.filter(q => q.sql.includes('LEFT JOIN projects pr'))) {
    assert.match(query.sql, /\(COALESCE\(pr.unit_id, p.unit_id\) = \? OR p.project_id IN \(\?\)\)/);
    assert.ok(query.params.some(value => Array.isArray(value) && JSON.stringify(value) === '[76]'));
    assert.ok(query.params.some(value => Array.isArray(value) && JSON.stringify(value) === '[81,76]'));
    assert.match(query.sql, /pr.restricted_to_user_id = \?/);
  }
  assert.deepEqual(queries.find(query => query.sql.startsWith('SELECT COUNT(*) AS total')).params.slice(0, 5), [2, 7, [76], 47, [81, 76]]);
  reset({ mustTerms: ['Original.JPG'] });
  await searchPhotos({ ...options, q: 'Original.JPG', sharedProjectIds: [76] });
  assert.ok(queries.filter(q => q.sql.includes('LEFT JOIN projects pr')).every(q => !q.sql.includes('OR p.project_id IN (?)')));
});

test('registry lookup counts only name-matched people without materializing all usable faces', async () => {
  reset({ people: ['甲老师'], mustTerms: ['红衣服'] }, { counts: [1] });
  await searchPhotos({ ...options, q: '红衣服的甲老师' });
  const registry = queries.find(query => query.sql.includes('FROM face_persons fp\n'));
  assert.ok(registry, 'the real search path must resolve its person registry');
  assert.ok(registry.sql.includes('HAVING photoCount > 0'), 'inactive profiles still need exclusion');
  assert.ok(!registry.sql.includes('FROM photo_faces active'), 'an EXISTS semijoin can scan the full face table before name filtering');
  assert.ok(registry.sql.includes('pfc.person_id = fp.id'));
  assert.ok(registry.sql.includes("pfc.status NOT IN ('rejected', 'deleted', 'legacy_blocked')"));
  assert.ok(registry.sql.includes('fp.organization_id = ?'));
  assert.ok(registry.sql.includes('LOCATE(LOWER(TRIM(fp.name)), ?) > 0'));
  assert.ok(registry.sql.includes('ORDER BY photoCount DESC, fp.updated_at DESC'));
  assert.deepEqual(registry.params, [2, '红衣服的甲老师']);
});

test('query-bound registry names override model hallucinations and recover long sentences', () => {
  const q = '请帮我找一下活动现场里面穿着红色衣服的甲老师的照片';
  const plan = resolveSearchIntent(q, { people: ['乙老师'], mustTerms: ['红衣服'] }, people);
  assert.deepEqual(plan.people, ['甲老师']);
  assert.ok(plan.termGroups[0].includes('红色外套'));
  const fallback = resolveSearchIntent(q, ai.heuristicPhotoSearchPlan(q), people);
  assert.deepEqual(fallback.people, ['甲老师']);
  assert.deepEqual(fallback.mustTerms, ['红色衣服']);
});

test('single-person and negative-person intent survive incorrect AI plans', () => {
  assert.equal(resolveSearchIntent('甲老师单人照', {}, people).peopleOnly, true);
  const single = resolveSearchIntent('只有甲老师的照片', ai.heuristicPhotoSearchPlan('只有甲老师的照片'), people);
  assert.deepEqual(single.mustTerms, []);
  const negative = resolveSearchIntent('甲老师不要乙老师', { people: ['甲老师', '乙老师'] }, people);
  assert.deepEqual(negative.people, ['甲老师']);
  assert.deepEqual(negative.excludePeople, ['乙老师']);
  assert.deepEqual(negative.mustTerms, []);
});

test('unknown co-occurring people cannot be silently dropped or replaced by related candidates', async () => {
  reset({ people: ['甲老师', '不存在的人'], peopleMode: 'all', mustTerms: ['红衣服'] });
  const result = await searchPhotos({ ...options, related: true, q: '甲老师与不存在的人穿红衣服同框' });
  assert.equal(result.total, 0);
  assert.deepEqual(result.search.plan.people, ['甲老师', '不存在的人']);
  assert.deepEqual(result.search.unknownPeople, ['不存在的人']);
  assert.equal(result.search.relatedAvailable, false);
  assert.ok(queries.find(query => query.sql.startsWith('SELECT COUNT(*) AS total')).sql.includes('1 = 0'));
});

test('equivalent terms are grouped, not independent mandatory keywords or unrelated props', () => {
  const plan = resolveSearchIntent('甲老师发言', { people: ['甲老师'], mustTerms: ['发言'],
    shouldTerms: ['麦克风'], termGroups: [['发言', '演讲'], ['未出现的条件', '合影']] }, people);
  assert.equal(plan.termGroups.length, 1);
  assert.ok(plan.termGroups[0].includes('演讲'));
  assert.ok(!plan.termGroups[0].includes('麦克风'));
  assert.ok(equivalents('红衣服').includes('红色外套'));
  assert.ok(!equivalents('红衣服').includes('红色背景'));
});

test('explicit visual conditions cannot be demoted into optional ranking terms', () => {
  const plan = resolveSearchIntent('甲老师穿红衣服', { people: ['甲老师'], shouldTerms: ['红色外套'] }, people);
  assert.deepEqual(plan.mustTerms, ['红衣服']);
  assert.ok(plan.termGroups[0].includes('红色外套'));
});

test('negated clothing stays an exclusion without a positive prose fragment or excluding its wearer', () => {
  for (const q of ['穿的不是黑衣服的甲老师', '甲老师不是穿黑色衣服', '甲老师不穿黑衣服',
    '甲老师没穿黑色上衣', '不是黑色衣服的甲老师', '甲老师穿的并非黑衣服',
    '甲老师，不要黑衣服', '甲老师，不穿黑衣服。']) {
    const fallback = resolveSearchIntent(q, ai.heuristicPhotoSearchPlan(q), people);
    assert.deepEqual(fallback.people, ['甲老师'], q);
    assert.deepEqual(fallback.excludePeople, [], q);
    assert.deepEqual(fallback.mustTerms, [], q);
    assert.ok(fallback.excludeTerms.some(term => equivalents(term).includes('黑色衣服')), q);
    const incorrectModel = resolveSearchIntent(q, { people: ['甲老师'], mustTerms: ['穿的不是衣服'],
      shouldTerms: ['黑色'], excludeTerms: ['黑衣服', '黑色服装'] }, people);
    assert.deepEqual(incorrectModel.mustTerms, [], 'model fragments must not become additional required keywords');
    assert.deepEqual(incorrectModel.shouldTerms, [], 'negated colors must not improve ranking');
  }
});

test('a negated garment does not remove independent positive scene or co-occurrence constraints', () => {
  const q = '甲老师发言，不穿黑衣服';
  const plan = resolveSearchIntent(q, { people: ['甲老师'], mustTerms: ['穿的不是衣服'], excludeTerms: ['黑衣服'] }, people);
  assert.deepEqual(plan.people, ['甲老师']);
  assert.deepEqual(plan.mustTerms, ['发言']);
  assert.ok(plan.termGroups[0].includes('演讲'));
  const cooccurrence = resolveSearchIntent('甲老师和乙老师同框，不穿黑衣服', {}, people);
  assert.deepEqual(cooccurrence.people, ['甲老师', '乙老师']);
  assert.equal(cooccurrence.peopleMode, 'all');
  assert.deepEqual(cooccurrence.mustTerms, []);
  const excludedPerson = resolveSearchIntent('甲老师不穿黑衣服，不要乙老师', {}, people);
  assert.deepEqual(excludedPerson.people, ['甲老师']);
  assert.deepEqual(excludedPerson.excludePeople, ['乙老师']);
  assert.deepEqual(excludedPerson.mustTerms, []);
});

test('negative clothing uses no positive prose SQL and retains person, scope and permission checks', async () => {
  reset({ people: ['甲老师'], mustTerms: ['穿的不是衣服'], excludeTerms: ['黑衣服'] }, { counts: [1] });
  const result = await searchPhotos({ ...options, q: '穿的不是黑衣服的甲老师' });
  assert.deepEqual(result.search.plan.mustTerms, []);
  assert.deepEqual(result.search.plan.people, ['甲老师']);
  assert.ok(result.search.notice.includes('描述'));
  const count = queries.find(query => query.sql.startsWith('SELECT COUNT(*) AS total'));
  assert.ok(count.sql.includes('pf_person.person_id IN (?)'));
  assert.ok(count.sql.includes('NOT ('));
  assert.ok(count.params.includes('%黑色衣服%'));
  assert.ok(!count.params.some(value => typeof value === 'string' && value.includes('穿的不是')));
  assert.deepEqual(count.params.slice(0, 3), [2, 7, 47]);
  reset({ people: ['甲老师'], excludeTerms: ['黑衣服'] });
  const denied = await searchPhotos({ ...options, faceSearchAllowed: false, q: '甲老师不穿黑衣服' });
  assert.equal(denied.total, 0);
  assert.ok(queries.every(query => !query.sql.includes('FROM face_persons')));
});

test('visual search recalls identity candidates even when old captions omit clothing, and applies verified IDs last', async () => {
  process.env.SEARCH_VISUAL_ENABLED = '1';
  let reviewed;
  try {
    reset({ people: ['甲老师'], mustTerms: ['绿衣服'] }, { counts: [1] });
    visualReview = async request => { reviewed = request; return { matchedIds: [101], unknownIds: [],
      candidateCount: 1, checked: 1, pending: 0, uncertain: 0, unavailable: false }; };
    const result = await searchPhotos({ ...options, q: '甲老师穿绿衣服', projectIds: [83, 84] });
    assert.equal(result.total, 1);
    assert.deepEqual(reviewed.candidates, [{ id: 101 }]);
    const candidate = queries.find(query=>query.sql.includes('AS visualCandidateId'));
    assert.ok(candidate.sql.includes('pf_person.person_id IN (?)'));
    assert.ok(candidate.sql.includes('p.project_id IN (?)'));
    assert.deepEqual(candidate.params[3], [83, 84]);
    assert.deepEqual(candidate.params.slice(0,3), [2,7,47]);
    assert.ok(!candidate.params.some(value=>typeof value === 'string' && value.includes('绿')));
    const count = queries.find(query=>query.sql.startsWith('SELECT COUNT(*) AS total'));
    assert.ok(count.sql.includes('p.id IN (?)'));
    assert.deepEqual(count.params.at(-1),[101]);
    assert.equal(result.search.visual.coverageComplete,true);
    assert.equal(result.search.relatedAvailable,false);
  } finally { delete process.env.SEARCH_VISUAL_ENABLED; }
});

test('unknown negative clothing returns pending, not a false non-black hit; visual failure stays closed', async () => {
  process.env.SEARCH_VISUAL_ENABLED = '1';
  try {
    reset({ people: ['甲老师'], excludeTerms: ['黑色衣服'] });
    visualReview = async () => ({ matchedIds: [], unknownIds: [101], candidateCount: 1, pending: 1,
      uncertain: 0, checked: 0, unavailable: false });
    const result = await searchPhotos({ ...options, q: '甲老师不穿黑衣服' });
    assert.equal(result.total,0);
    assert.equal(result.search.visual.pending,1);
    assert.equal(result.search.visual.coverageComplete,false);
    assert.ok(queries.find(query=>query.sql.startsWith('SELECT COUNT(*) AS total')).sql.includes('1 = 0'));
    reset({ people: ['甲老师'], mustTerms: ['红衣服'] });
    visualReview = async () => { throw Error('private model provider failure'); };
    const failed = await searchPhotos({ ...options, q: '甲老师穿红衣服' });
    assert.equal(failed.total,0);
    assert.equal(failed.search.visual.unavailable,true);
    assert.ok(!JSON.stringify(failed).includes('private model'));
    reset({ people: ['甲老师'], mustTerms: ['红衣服'] });
    const denied = await searchPhotos({ ...options, faceSearchAllowed:false, q:'甲老师穿红衣服' });
    assert.equal(denied.total,0);
    assert.ok(queries.every(query=>!query.sql.includes('AS visualCandidateId')));
  } finally { delete process.env.SEARCH_VISUAL_ENABLED; }
});

test('album and photographer constraints do not accidentally become duplicate visual terms', () => {
  const plan = resolveSearchIntent('乙老师拍的甲老师在开学典礼相册里的照片',
    { people: ['甲老师'], projects: ['开学典礼'], photographers: ['乙老师'] }, people);
  assert.deepEqual(plan.people, ['甲老师']);
  assert.deepEqual(plan.mustTerms, []);
  assert.deepEqual(plan.projects, ['开学典礼']);
});

test('an unknown proper name remains a hard constraint even if the model repeats it as a keyword', () => {
  const plan = resolveSearchIntent('甲老师和张三同框', { people: ['甲老师', '张三'], mustTerms: ['张三'] }, people);
  assert.deepEqual(plan.people, ['甲老师', '张三']);
  assert.deepEqual(plan.unknownPeople, ['张三']);
  const alternative = resolveSearchIntent('甲老师或者乙老师', { people: ['甲老师', '乙老师'], peopleMode: 'all' }, people);
  assert.equal(alternative.peopleMode, 'any');
});

test('empty strict results never automatically become full-gallery results', async () => {
  reset({ mustTerms: ['火箭发射'] }, { counts: [0, 5] });
  const result = await searchPhotos({ ...options, q: '火箭发射' });
  assert.equal(result.total, 0);
  assert.deepEqual(result.list, []);
  assert.equal(result.search.relatedAvailable, false);
  assert.equal(queries.filter(query => query.sql.startsWith('SELECT COUNT(*) AS total')).length, 1);
  assert.equal(queries.filter(query => query.sql.includes('AS relevanceScore')).length, 0);
});

test('explicit related search drops only visual terms, preserving all hard filters and model status', async () => {
  reset({ people: ['甲老师'], peopleOnly: true, mustTerms: ['红衣服'], excludeTerms: ['合影'],
    excludePeople: ['乙老师'], mediaType: 'image', quality: 'recommended', dateFrom: '2026-10-01', dateTo: '2026-10-12' },
  { degraded: true, counts: [1] });
  const result = await searchPhotos({ ...options, related: true, q: '甲老师单人照穿红衣服，不要乙老师，不要合影，推荐照片' });
  assert.equal(result.search.matchType, 'related');
  assert.equal(result.search.aiUsed, false);
  assert.equal(result.search.degraded, true);
  const count = queries.find(query => query.sql.startsWith('SELECT COUNT(*) AS total'));
  assert.deepEqual(count.params.slice(0, 3), [2, 7, 47]);
  for (const predicate of ['p.organization_id = ?', 'COALESCE(pr.unit_id, p.unit_id) = ?',
    'pr.restricted_to_user_id = ?', 'pf_person.person_id IN (?)', 'pf_other.person_id NOT IN (?)',
    'pf_excluded.person_id IN (?)', 'DATE_ADD(?, INTERVAL 1 DAY)', 'p.ai_score >= 75']) assert.ok(count.sql.includes(predicate), predicate);
  assert.ok(count.params.includes('%合照%'));
  assert.ok(!count.params.includes('%红衣服%'));
  const page = queries.find(query => query.sql.includes('AS relevanceScore'));
  assert.ok(page.params.includes('%红色外套%'), 'related results retain visual relevance ranking');
  assert.equal(queries.filter(query => query.sql.includes('FROM face_persons fp\n')).length, 1);
});

test('strict zero results offer related candidates without another lookup or selection', async () => {
  reset({ people: ['甲老师'], mustTerms: ['红衣服'] }, { degraded: true });
  const result = await searchPhotos({ ...options, q: '甲老师穿红衣服' });
  assert.equal(result.total, 0);
  assert.equal(result.search.relatedAvailable, true);
  assert.equal(result.search.aiUsed, false);
  assert.equal(result.search.degraded, true);
  assert.equal(queries.filter(query => query.sql.includes('AS relevanceScore')).length, 0);
});

test('a model failure cannot drop an unresolved person in a co-occurrence query', async () => {
  const q = '甲老师和不存在的人同框';
  reset(ai.heuristicPhotoSearchPlan(q), { degraded: true });
  const result = await searchPhotos({ ...options, related: true, q });
  assert.equal(result.total, 0);
  assert.equal(result.search.relatedAvailable, false);
  assert.equal(result.search.matchType, 'strict');
  assert.ok(queries.find(query => query.sql.startsWith('SELECT COUNT(*) AS total')).sql.includes('1 = 0'));
});

test('without face permission no registry or face predicates are used and no broad fallback is possible', async () => {
  reset({ people: ['甲老师'], mustTerms: ['红衣服'] });
  const result = await searchPhotos({ ...options, faceSearchAllowed: false, related: true, q: '甲老师穿红衣服' });
  assert.equal(result.total, 0);
  assert.deepEqual(result.search.matchedPeople, []);
  assert.deepEqual(result.search.unknownPeople, []);
  assert.ok(queries.every(query => !query.sql.includes('photo_faces') && !query.sql.includes('FROM face_persons')));
  assert.ok(queries.find(query => query.sql.startsWith('SELECT COUNT(*) AS total')).sql.includes('1 = 0'));
});

test('positive dates include the entire final day; safe terms never enter SQL source', async () => {
  const term = "x%' OR 1=1 --";
  reset({ mustTerms: [term], dateTo: '2026-10-12' });
  await searchPhotos({ ...options, q: term });
  const query = queries.find(query => query.sql.startsWith('SELECT COUNT(*) AS total'));
  assert.ok(!query.sql.includes(term));
  assert.ok(query.sql.includes('< DATE_ADD(?, INTERVAL 1 DAY)'));
  assert.ok(query.params.includes('2026-10-12'));
});

test('streaming exposes authorized photos before the total-count query starts', async () => {
  reset({ people: ['甲老师'] }, { counts: [1] });
  const progress = [];
  const result = await searchPhotos({ ...options, q: '甲老师', pageSize: 24, onProgress: async event => {
    progress.push(event);
    if (event.type === 'results') {
      assert.equal(event.data.total, null, 'unknown totals are not fabricated');
      assert.equal(event.data.list[0].id, 101);
      assert.equal(queries.filter(query => query.sql.startsWith('SELECT COUNT(*) AS total')).length, 0);
    }
  } });
  assert.equal(result.total, 1);
  assert.equal(progress.filter(event => event.type === 'results').length, 1);
  const select = queries.find(query => query.sql.includes('AS relevanceScore'));
  assert.equal(select.params.at(-2), 8, 'first batch is small');
  assert.deepEqual(select.params.slice(-6, -2), [2, 7, 47, [11]], 'streaming retains organization, unit, ACL and identity');
});

test('cancelling after the first batch skips counting and further database work', async () => {
  reset({ people: ['甲老师'] }, { counts: [1] });
  const controller = new AbortController();
  await assert.rejects(searchPhotos({ ...options, q: '甲老师', signal: controller.signal, onProgress: async event => {
    if (event.type === 'results') controller.abort();
  } }), { name: 'AbortError' });
  assert.equal(queries.filter(query => query.sql.startsWith('SELECT COUNT(*) AS total')).length, 0);
});

test('multiple streamed batches preserve stable order and a single final result count', async () => {
  reset({ people: ['甲老师'] }, { counts: [80] });
  streamPhotos = Array.from({ length: 80 }, (_, index) => ({ id: index + 1, type: 'image' }));
  const chunks = [];
  const result = await searchPhotos({ ...options, q: '甲老师', pageSize: 80, onProgress: async event => {
    if (event.type === 'results') chunks.push(event.data.list.map(photo => photo.id));
  } });
  assert.deepEqual(chunks.map(chunk => chunk.length), [8, 64, 8]);
  assert.deepEqual(chunks.flat(), streamPhotos.map(photo => photo.id));
  assert.deepEqual(result.list.map(photo => photo.id), streamPhotos.map(photo => photo.id));
  assert.equal(queries.filter(query => query.sql.startsWith('SELECT COUNT(*) AS total')).length, 1);
});
