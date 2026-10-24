const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.AI_TEXT_API_KEY = 'isolated-test-key';
process.env.AI_TEXT_BASE_URL = 'https://search-fixture.invalid/v1';
process.env.AI_SEARCH_TIMEOUT_MS = '1500';
process.env.AI_SEARCH_MAX_INFLIGHT = '2';
const requests = [];
let responder;
const sdkId = require.resolve('openai');
require.cache[sdkId] = { id: sdkId, filename: sdkId, loaded: true, exports: { OpenAI: class {
  constructor(config) {
    this.chat = { completions: { create: (body, options) => {
      assert.equal(config.maxRetries, 0);
      assert.equal(options.timeout, 1500);
      assert.ok(options.signal instanceof AbortSignal);
      requests.push({ config, body, options });
      return responder(body, options);
    } } };
  }
} } };
const { interpretPhotoSearch, photoSearchDates, heuristicPhotoSearchPlan } = require('../lib/ai_photo_search');
const { resolveSearchIntent, isSimpleIdentityQuery, canResolvePhotoSearchLocally } = require('../lib/photo_search_intent');
const response = plan => ({ choices: [{ message: { content: JSON.stringify(plan) } }] });

test('local date constraints survive AI failure and use the Beijing calendar day', () => {
  const now = Date.UTC(2026, 9, 12, 20);
  assert.deepEqual(photoSearchDates('昨天', now), { dateFrom: '2026-10-12', dateTo: '2026-10-12', remaining: ' ' });
  assert.equal(photoSearchDates('上个月', now).dateFrom, '2026-09-01');
  assert.equal(photoSearchDates('上个月', now).dateTo, '2026-09-30');
  assert.equal(photoSearchDates('2026年2月', now).dateTo, '2026-02-28');
  assert.equal(photoSearchDates('2026-02-30', now).dateFrom, null);
  assert.equal(photoSearchDates('2026年10月1日至10月12日', now).dateTo, '2026-10-12');
  assert.equal(photoSearchDates('2026年10月1日至12日', now).dateTo, '2026-10-12');
  const plan = heuristicPhotoSearchPlan('2026-10-01到2026-10-12只看视频');
  assert.equal(plan.dateTo, '2026-10-12');
  assert.equal(plan.mediaType, 'video');
  assert.deepEqual(plan.mustTerms, []);
});

test('simple named-identity searches need no language-model request', () => {
  const registry = [{ id: 1, name: '甲老师' }, { id: 2, name: '乙老师' }];
  assert.equal(isSimpleIdentityQuery('甲老师单人照', registry), true);
  assert.equal(isSimpleIdentityQuery('甲老师和乙老师同框', registry), true);
  assert.equal(isSimpleIdentityQuery('甲老师穿红衣服', registry), false);
  assert.equal(isSimpleIdentityQuery('甲老师和陌生人同框', registry), false);
  assert.equal(canResolvePhotoSearchLocally('甲老师穿红衣服', registry), true);
  assert.equal(canResolvePhotoSearchLocally('穿的绿衣服的甲老师', registry), true);
  assert.equal(canResolvePhotoSearchLocally('请帮我找一下活动现场里面穿着红色衣服的甲老师的照片', registry), true);
  assert.equal(canResolvePhotoSearchLocally('甲老师，不要红衣服', registry), true);
  assert.equal(canResolvePhotoSearchLocally('穿的不是黑衣服的甲老师', registry), true);
  assert.equal(canResolvePhotoSearchLocally('甲老师不穿黑色衣服', registry), true);
  assert.equal(canResolvePhotoSearchLocally('甲老师不是没穿黑色衣服', registry), false);
  assert.equal(canResolvePhotoSearchLocally('甲老师与不认识的人同框', registry), false);
  assert.equal(canResolvePhotoSearchLocally('甲老师站在正在施工的体育馆门口', registry), false);
  const q = '甲老师和乙老师同框';
  const plan = resolveSearchIntent(q, heuristicPhotoSearchPlan(q), registry);
  assert.deepEqual(plan.mustTerms, []);
  assert.equal(plan.peopleMode, 'all');
});

test('bounded anonymous clothing is local, while backgrounds and unfamiliar conditions still need interpretation', () => {
  for (const q of ['白衣服', '穿白色衣服的人', '黑色外套', '请找蓝衣服']) assert.equal(canResolvePhotoSearchLocally(q, []), true, q);
  for (const q of ['白色背景', '适合做封面的照片', '浅色衣服']) assert.equal(canResolvePhotoSearchLocally(q, []), false, q);
});

test('identical concurrent queries share a request and successful plans are cached', async () => {
  responder = async () => response({ people: ['甲老师'], mustTerms: ['发言'], termGroups: [['发言', '演讲']] });
  const before = requests.length;
  const [first, shared] = await Promise.all([interpretPhotoSearch('甲老师在台上发言'), interpretPhotoSearch('甲老师在台上发言')]);
  assert.equal(requests.length - before, 1);
  assert.equal(first.aiUsed, true);
  assert.deepEqual(shared.plan, first.plan);
  const cached = await interpretPhotoSearch('甲老师在台上发言');
  assert.equal(cached.cached, true);
  assert.equal(requests.length - before, 1);
});

test('an endpoint change cannot reuse an older provider plan', async () => {
  process.env.AI_TEXT_BASE_URL = 'https://other-search-fixture.invalid/v1';
  const before = requests.length;
  await interpretPhotoSearch('甲老师在台上发言');
  assert.equal(requests.length, before + 1);
});

test('explicit single-person, negative, media and date constraints survive model omissions', async () => {
  responder = async () => response({ people: ['甲老师'] });
  const result = await interpretPhotoSearch('2026-10-12只看照片，甲老师单人照，不要合影');
  assert.equal(result.plan.peopleOnly, true);
  assert.equal(result.plan.mediaType, 'image');
  assert.equal(result.plan.dateTo, '2026-10-12');
  assert.ok(result.plan.excludeTerms.includes('合影'));
});

test('distinct model requests are bounded and overflow keeps a local plan instead of queuing', async () => {
  const release = [];
  responder = () => new Promise(resolve => release.push(() => resolve(response({ mustTerms: ['演讲'] }))));
  const first = interpretPhotoSearch('第一场校园演讲');
  const second = interpretPhotoSearch('第二场校园演讲');
  const overflow = await interpretPhotoSearch('第三场校园演讲');
  assert.equal(overflow.aiUsed, false);
  assert.equal(overflow.fallbackReason, 'busy');
  assert.equal(release.length, 2);
  release.forEach(resolve => resolve());
  await Promise.all([first, second]);
});

test('deadline cancels the upstream request and a failed response never leaks provider text', async () => {
  let aborted = false;
  responder = (_body, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(Error('secret provider body')); }, { once: true });
  });
  const before = performance.now();
  const result = await interpretPhotoSearch('超时的校园活动演讲');
  assert.equal(aborted, true);
  assert.equal(result.aiUsed, false);
  assert.equal(result.fallbackReason, 'timeout');
  assert.ok(performance.now() - before < 3000);
  responder = async () => { throw Error('private token, SQL, and upstream body'); };
  const failed = await interpretPhotoSearch('模型失败的校园活动');
  assert.equal(failed.fallbackReason, 'model_failed');
});
