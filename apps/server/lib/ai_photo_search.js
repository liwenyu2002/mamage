const { OpenAI } = require('openai');

const CACHE_TTL_MS = Math.max(60 * 1000, Number(process.env.AI_SEARCH_CACHE_TTL_MS || 10 * 60 * 1000));
const CACHE_MAX = Math.max(20, Number(process.env.AI_SEARCH_CACHE_MAX || 300));
const REQUEST_TIMEOUT_MS = Math.max(1500, Number(process.env.AI_SEARCH_TIMEOUT_MS || 7000));
const cache = new Map();
const inflight = new Map();

const MEDIA_TYPES = new Set(['all', 'image', 'video']);
const QUALITY_TYPES = new Set(['any', 'recommended', 'medium', 'rejected']);
const SORT_TYPES = new Set(['relevance', 'newest', 'quality']);
const PEOPLE_MODES = new Set(['any', 'all']);
const MAX_INFLIGHT = Math.max(1, Math.min(20, Number(process.env.AI_SEARCH_MAX_INFLIGHT) || 4));

function uniqueStrings(input, limit = 8, maxLen = 32) {
  const values = Array.isArray(input) ? input : (input ? [input] : []);
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key) || result.length >= limit) return;
    seen.add(key);
    result.push(normalized);
  });
  return result;
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

function photoSearchDates(query, now = Date.now()) {
  const text = String(query || '');
  const day = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  const explicit = [...text.matchAll(/(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?/g)];
  const dates = explicit.map(match => normalizeDate(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`)).filter(Boolean);
  if (explicit.length === 1 && dates.length === 1) {
    const first = explicit[0];
    const tail = text.slice(first.index + first[0].length).match(/^\s*(?:至|到)\s*(?:(\d{1,2})月)?(\d{1,2})日/);
    if (tail) {
      const end = normalizeDate(`${first[1]}-${(tail[1] || first[2]).padStart(2, '0')}-${tail[2].padStart(2, '0')}`);
      if (end) return { dateFrom: dates[0], dateTo: end, remaining: text.replace(first[0] + tail[0], ' ') };
    }
  }
  if (explicit.length) return dates.length === explicit.length
    ? { dateFrom: dates[0], dateTo: dates.at(-1),
      remaining: explicit.reduce((value, match) => value.replace(match[0], ' '), text).replace(/(^|\s)(?:到|至|~|—|-)(?=\s|$)/g, ' ') }
    : { dateFrom: null, dateTo: null, remaining: text };
  if (/(?:今天|今日|昨天|昨日|前天)/.test(text)) {
    const token = text.match(/今天|今日|昨天|昨日|前天/)[0];
    const shift = /今天|今日/.test(token) ? 0 : token === '前天' ? 2 : 1;
    const date = new Date(Date.parse(day) - shift * 86400000).toISOString().slice(0, 10);
    return { dateFrom: date, dateTo: date, remaining: text.replace(token, ' ') };
  }
  const month = text.match(/(20\d{2})[-年/](\d{1,2})月?(?!\d)/);
  if (month && Number(month[2]) >= 1 && Number(month[2]) <= 12) {
    const year = Number(month[1]); const index = Number(month[2]);
    return { dateFrom: `${year}-${String(index).padStart(2, '0')}-01`,
      dateTo: new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10), remaining: text.replace(month[0], ' ') };
  }
  const year = Number(day.slice(0, 4));
  const monthIndex = Number(day.slice(5, 7)) - 1;
  const relative = text.match(/今年|去年|本月|这个月|上个月|上月|近\s*\d{1,3}\s*天|最近\s*\d{1,3}\s*天/);
  if (relative) {
    const token = relative[0];
    let dateFrom; let dateTo = day;
    if (/今年|去年/.test(token)) {
      const y = token === '去年' ? year - 1 : year;
      dateFrom = `${y}-01-01`; dateTo = token === '去年' ? `${y}-12-31` : day;
    } else if (/月/.test(token)) {
      const index = /上/.test(token) ? monthIndex - 1 : monthIndex;
      dateFrom = new Date(Date.UTC(year, index, 1)).toISOString().slice(0, 10);
      dateTo = /上/.test(token) ? new Date(Date.UTC(year, index + 1, 0)).toISOString().slice(0, 10) : day;
    } else {
      const days = Math.max(1, Math.min(365, Number(token.match(/\d+/)[0])));
      dateFrom = new Date(Date.parse(day) - (days - 1) * 86400000).toISOString().slice(0, 10);
    }
    return { dateFrom, dateTo, remaining: text.replace(token, ' ') };
  }
  return { dateFrom: null, dateTo: null, remaining: text };
}

function normalizePhotoSearchPlan(input, originalQuery = '') {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const query = String(originalQuery || '').trim().slice(0, 160);
  const mediaType = MEDIA_TYPES.has(String(raw.mediaType || '').toLowerCase())
    ? String(raw.mediaType).toLowerCase()
    : 'all';
  const quality = QUALITY_TYPES.has(String(raw.quality || '').toLowerCase())
    ? String(raw.quality).toLowerCase()
    : 'any';
  const sort = SORT_TYPES.has(String(raw.sort || '').toLowerCase())
    ? String(raw.sort).toLowerCase()
    : 'relevance';
  const peopleMode = PEOPLE_MODES.has(String(raw.peopleMode || '').toLowerCase())
    ? String(raw.peopleMode).toLowerCase()
    : 'any';
  const peopleOnly = raw.peopleOnly === true
    || raw.peopleOnly === 1
    || String(raw.peopleOnly || '').toLowerCase() === 'true';

  return {
    query,
    mustTerms: uniqueStrings(raw.mustTerms, 8),
    shouldTerms: uniqueStrings(raw.shouldTerms, 12),
    termGroups: (Array.isArray(raw.termGroups) ? raw.termGroups : []).slice(0, 8)
      .map(group => uniqueStrings(group, 4)).filter(group => group.length),
    excludeTerms: uniqueStrings(raw.excludeTerms, 6),
    people: uniqueStrings(raw.people, 6, 40),
    excludePeople: uniqueStrings(raw.excludePeople, 6, 40),
    peopleMode,
    peopleOnly,
    personCount: raw.personCount === 1 ? 1 : null,
    photographers: uniqueStrings(raw.photographers, 4, 40),
    projects: uniqueStrings(raw.projects, 4, 60),
    timelineSections: uniqueStrings(raw.timelineSections, 4, 60),
    mediaType,
    quality,
    dateFrom: normalizeDate(raw.dateFrom),
    dateTo: normalizeDate(raw.dateTo),
    sort,
  };
}

function extractNegatedClothing(query) {
  const text = String(query || '');
  if (/(?:不是|并非).{0,4}(?:不穿|没穿|没有穿|未穿)/.test(text)) {
    return { remaining: text, excludeTerms: [] };
  }
  const excludeTerms = [];
  const remaining = text.replace(
    /(?:(?:穿(?:着)?(?:的)?|身穿(?:的)?)?(?:不是|并非|非)(?:穿(?:着)?|身穿)?|(?:没有|不|没|未)(?:穿(?:着)?|身穿)|(?:不要|排除|不含|去掉)(?:穿(?:着)?|身穿)?)\s*([红蓝白黑黄绿紫粉灰])(?:色)?(?:的)?(衣服|衣|服装|上衣)/g,
    (_, color, garment) => {
      excludeTerms.push(`${color}色${garment === '衣' || garment === '服装' ? '衣服' : garment}`);
      return ' ';
    }
  );
  return { remaining, excludeTerms: uniqueStrings(excludeTerms) };
}

function extractSinglePersonQuery(query) {
  const text = String(query || '');
  let personCount = null;
  const remaining = text.replace(/单人(?:的?(?:照片|相片|图片|照)|(?=$|[\s，。！？；、,!?;]))|独照|(?:只有|仅有|仅|只出现)\s*(?:一|1)(?:个|位)?人/g,
    (term, offset) => {
      if (/(?:不要|不含|排除|不是|并非|不|不仅|不止)\s*$/.test(text.slice(0, offset))) return term;
      personCount = 1;
      return ' ';
    });
  return { personCount, remaining: personCount
    ? remaining.replace(/(?:画面|照片|图片|相片)(?:里|中)(?:面)?(?=\s|$)/g, ' ') : remaining };
}

function heuristicPhotoSearchPlan(query) {
  const original = String(query || '').replace(/^\s*(?:ai|智能)\s*[:：]\s*/i, '').trim().slice(0, 160);
  const clothing = extractNegatedClothing(original);
  const dates = photoSearchDates(clothing.remaining);
  const single = extractSinglePersonQuery(dates.remaining);
  let mediaType = 'all';
  if (/(?:只要|只看|仅看|搜索|找).{0,4}(?:视频|录像)|\bvideo\b/i.test(original)) mediaType = 'video';
  else if (/(?:只要|只看|仅看).{0,4}(?:照片|图片|相片)|\bimage\b|\bphoto\b/i.test(original)) mediaType = 'image';

  let quality = 'any';
  if (/(?:不推荐|废片|淘汰|拒绝|较差)/.test(original)) quality = 'rejected';
  else if (/(?:中等|普通|一般|尚可)/.test(original)) quality = 'medium';
  else if (/(?:推荐|精选|最好|最佳|高质量|适合.{0,3}(?:头图|封面))/.test(original)) quality = 'recommended';

  let sort = 'relevance';
  if (/(?:最新|最近|刚上传)/.test(original)) sort = 'newest';
  else if (/(?:质量最高|最好看|最佳|精选)/.test(original)) sort = 'quality';

  const peopleMode = /(?:一起|同框|同时出现|和|与|跟)/.test(original) ? 'all' : 'any';
  const peopleOnly = /(?:只有|仅有|只出现|单独|独自|单人照|单人照片|不要其他人|没有其他人)/.test(original);
  const excludeTerms = [...clothing.excludeTerms];
  clothing.remaining.replace(/(?:不要|排除|不含|去掉)([\u4e00-\u9fffA-Za-z0-9_-]{1,12})/g, (_, term) => {
    excludeTerms.push(term.replace(/(?:的)?(?:照片|图片|视频)$/g, ''));
    return _;
  });
  const cleaned = single.remaining
    .replace(/(?:帮我|请|麻烦)?(?:找|搜索|检索|查找|看看|看一下|给我)/g, ' ')
    .replace(/(?:(?:画面|照片|图片|相片)(?:里|中)?)?(?:只有|仅有|只出现|单独|独自)/g, ' ')
    .replace(/(?:不要|没有)其他人|单人(?:照|照片)?/g, ' ')
    .replace(/(?:只要|只看|仅看|一些|一张|几张|所有|相关|里面|画面中|照片|图片|相片|视频|录像)/g, ' ')
    .replace(/(?:推荐|精选|最好|最佳|高质量|中等|普通|一般|尚可|不推荐|废片|淘汰|拒绝|较差|最新|最近|刚上传)/g, ' ')
    .replace(/(?:不要|排除|不含|去掉)[\u4e00-\u9fffA-Za-z0-9_-]{1,12}/g, ' ')
    .replace(/[，。！？；、,!?;|]+/g, ' ')
    .replace(/的(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const terms = uniqueStrings(cleaned.split(' '), 8);
  const hasStructuredConstraint = single.personCount || mediaType !== 'all' || quality !== 'any' || sort !== 'relevance' || excludeTerms.length > 0 || dates.dateFrom;
  if (!terms.length && original && !hasStructuredConstraint) terms.push(original);

  return normalizePhotoSearchPlan({ mustTerms: terms, excludeTerms, mediaType, quality, sort, peopleMode, peopleOnly,
    personCount: single.personCount,
    dateFrom: dates.dateFrom, dateTo: dates.dateTo }, original);
}

function shouldUseAiPhotoSearch(query, enabled = true) {
  if (!enabled) return false;
  const raw = String(query || '').trim();
  if (!raw || /^\s*(?:快速|普通)\s*[:：]/.test(raw)) return false;
  if (/^\s*(?:ai|智能)\s*[:：]/i.test(raw)) return true;
  if (raw.length >= 5 && !/^[\w.-]+$/i.test(raw)) return true;
  return /(?:帮我|请找|适合|包含|出现|同时|不要|排除|最好|最新|推荐|中等|不推荐|摄影师|相册|环节|拍摄|人物|同框)/.test(raw);
}

function parseJsonObject(content) {
  const text = String(content || '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { /* continue */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { return null; }
}

function getClientConfig() {
  const apiKey = process.env.AI_TEXT_API_KEY || process.env.OPENAI_API_KEY || '';
  // 与 validateAi 一致：AI_TEXT_BASE_URL 优先（分销商 key 配分销商端点），
  // DASHSCOPE_BASE_URL 仅作兜底——优先级写反会把分销商 key 打到阿里云官方端点吃 401。
  const baseURL = process.env.AI_TEXT_BASE_URL || process.env.DASHSCOPE_BASE_URL || undefined;
  const model = process.env.AI_SEARCH_MODEL || process.env.AI_TEXT_MODEL || 'deepseek-chat';
  return { apiKey, baseURL, model };
}

function cacheGet(key) {
  const row = cache.get(key);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, row);
  return row.value;
}

function cacheSet(key, value) {
  cache.delete(key);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

async function callSearchModel(query) {
  const { apiKey, baseURL, model } = getClientConfig();
  if (!apiKey) throw new Error('AI_TEXT_API_KEY_NOT_CONFIGURED');
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), maxRetries: 0 });
  const system = [
    '你是高校活动图库的搜索查询解析器。只输出一个 JSON 对象，不要解释。',
    `今天是北京时间 ${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}，可据此换算用户明确说出的相对日期。`,
    '不要编造具体人物、相册、日期或摄影师；只抽取用户明确表达的约束。',
    '字段固定为 mustTerms, shouldTerms, termGroups, excludeTerms, people, excludePeople, peopleMode, peopleOnly, photographers, projects, timelineSections, mediaType, quality, dateFrom, dateTo, sort。',
    'mustTerms 是必须在标题、画面描述、AI标签或OCR中命中的核心可见内容，每项应为短词；不要放人物姓名、摄影师、相册或环节。',
    'shouldTerms 是同义词和视觉相关词，用于扩大召回与排序，最多 8 个；例如“发言”可扩展“演讲、讲台、麦克风”。',
    'termGroups 是 mustTerms 的等义表达分组，最多8组、每组最多4词；每组第一项必须是一个 mustTerms 原词，其余只能是同义表达，不能是相关但不等价的场景或道具。组内任选、组间全满足。',
    'excludeTerms 是用户明确不要的画面内容；excludePeople 是明确排除的人名，不能放入 people。people 只能包含用户原文实际出现的人名，不能把衣服、动作、身份泛称当作姓名；多人要求同框时 peopleMode=all，否则 any。',
    '不是、不穿、没穿、并非等明确否定的内容只放 excludeTerms，不能变成 mustTerms 或 shouldTerms 的肯定关键词；不能留下“穿的不是衣服”这样的句子残片。',
    'peopleOnly 是布尔值。用户说“只有某人、仅某人、某人单独、不要其他人”时必须为 true，表示画面不能出现目标以外的人脸；其他情况为 false。',
    'mediaType 只能是 all/image/video；quality 只能是 any/recommended/medium/rejected；sort 只能是 relevance/newest/quality。',
    'dateFrom/dateTo 只能是 YYYY-MM-DD 或 null。没有信息的数组给 []，枚举字段使用默认 all/any/relevance。',
  ].join('\n');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: String(query || '').slice(0, 160) },
    ],
    temperature: 0.1,
    max_tokens: 900,
    }, { signal: controller.signal, timeout: REQUEST_TIMEOUT_MS });
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'APIConnectionTimeoutError') throw new Error('AI_SEARCH_TIMEOUT');
    throw error;
  } finally { clearTimeout(timer); }
  const parsed = parseJsonObject(response && response.choices && response.choices[0] && response.choices[0].message
    ? response.choices[0].message.content
    : '');
  if (!parsed) throw new Error('AI_SEARCH_INVALID_JSON');
  return { plan: normalizePhotoSearchPlan(parsed, query), model };
}

async function interpretPhotoSearch(query, options = {}) {
  const heuristic = heuristicPhotoSearchPlan(query);
  if (!shouldUseAiPhotoSearch(query, options.enableAi !== false)) {
    return { plan: heuristic, aiUsed: false, cached: false, fallbackReason: null, model: null };
  }

  const cfg = getClientConfig();
  if (!cfg.apiKey) {
    return { plan: heuristic, aiUsed: false, cached: false, fallbackReason: 'not_configured', model: null };
  }
  const key = `v2:${cfg.baseURL || 'default'}:${cfg.model}:${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}:${String(query || '').trim().toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };
  if (inflight.has(key)) return inflight.get(key);
  if (inflight.size >= MAX_INFLIGHT) return { plan: heuristic, aiUsed: false, cached: false, fallbackReason: 'busy', model: null };

  const task = callSearchModel(query)
    .then(({ plan, model }) => {
      // “仅此人物”属于明确且高风险的排他条件，模型漏字段时保留规则解析结果。
      const mergedPlan = { ...plan, peopleOnly: Boolean(plan.peopleOnly || heuristic.peopleOnly),
        excludeTerms: uniqueStrings([...plan.excludeTerms, ...heuristic.excludeTerms], 6),
        dateFrom: heuristic.dateFrom || plan.dateFrom, dateTo: heuristic.dateTo || plan.dateTo,
        mediaType: heuristic.mediaType !== 'all' ? heuristic.mediaType : plan.mediaType,
        quality: heuristic.quality !== 'any' ? heuristic.quality : plan.quality,
        sort: heuristic.sort !== 'relevance' ? heuristic.sort : plan.sort };
      const value = { plan: mergedPlan, aiUsed: true, cached: false, fallbackReason: null, model };
      cacheSet(key, value);
      return value;
    })
    .catch((error) => ({
      plan: heuristic,
      aiUsed: false,
      cached: false,
      fallbackReason: error?.message === 'AI_SEARCH_TIMEOUT' ? 'timeout' : 'model_failed',
      model: null,
    }))
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

function describePhotoSearchPlan(plan, matchedPeople = []) {
  const chips = [];
  const people = uniqueStrings((matchedPeople || []).map((p) => p.name), 6, 40);
  if (people.length) chips.push(`人物：${people.join('、')}`);
  if (people.length && plan.peopleOnly) chips.push('仅限这些人物');
  if (plan.personCount === 1) chips.push('单人照');
  if (plan.mustTerms.length) chips.push(`内容：${plan.mustTerms.join('、')}`);
  if (plan.projects.length) chips.push(`相册：${plan.projects.join('、')}`);
  if (plan.timelineSections.length) chips.push(`环节：${plan.timelineSections.join('、')}`);
  if (plan.photographers.length) chips.push(`摄影师：${plan.photographers.join('、')}`);
  if (plan.mediaType === 'image') chips.push('只看照片');
  if (plan.mediaType === 'video') chips.push('只看视频');
  if (plan.quality === 'recommended') chips.push('AI 推荐');
  if (plan.quality === 'medium') chips.push('中等');
  if (plan.quality === 'rejected') chips.push('不推荐');
  if (plan.dateFrom || plan.dateTo) chips.push(`日期：${plan.dateFrom || '不限'} 至 ${plan.dateTo || '不限'}`);
  if (plan.excludeTerms.length) chips.push(`排除：${plan.excludeTerms.join('、')}`);
  if (plan.excludePeople?.length) chips.push(`排除人物：${plan.excludePeople.join('、')}`);
  return chips.slice(0, 8);
}

module.exports = {
  describePhotoSearchPlan,
  extractNegatedClothing,
  extractSinglePersonQuery,
  heuristicPhotoSearchPlan,
  interpretPhotoSearch,
  normalizePhotoSearchPlan,
  photoSearchDates,
  shouldUseAiPhotoSearch,
};
