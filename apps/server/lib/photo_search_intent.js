const { heuristicPhotoSearchPlan, normalizePhotoSearchPlan, photoSearchDates, extractNegatedClothing, extractSinglePersonQuery } = require('./ai_photo_search');
const { visualCondition, heldObjectRelation } = require('./person_visual_evidence');

const EQUIVALENTS = [
  ['发言', '演讲', '讲话', '致辞'],
  ['合影', '合照', '集体照'],
  ['多人', '多人照', '多人照片', '多个人'],
  ['颁奖', '授奖'],
  ['签约', '签署协议'],
];

function unique(values, limit = 8) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].slice(0, limit);
}

function equivalents(term) {
  const group = EQUIVALENTS.find(values => values.includes(term));
  if (group) return unique([term, ...group]);
  const clothing = term.match(/^(?:穿着?|身穿)?(红|蓝|白|黑|黄|绿|紫|粉|灰)(?:色)?(?:的)?(?:衣服|衣|服装|上衣)$/);
  if (clothing) return unique([term, ...['衣', '色衣服', '色上衣', '色外套', '色衬衫', '色服装', '色T恤'].map(suffix => clothing[1] + suffix)]);
  return [term];
}

function removeNames(text, names) {
  return names.reduce((value, name) => value.split(name)
    .map((part, index) => index ? part.replace(/^(?:老师|同学|先生|女士)/, '') : part).join(' '), text);
}

function negativeSpans(query) {
  return [...query.matchAll(/(?:不要|排除|不含|去掉|不包括|没有|除了)([^，。；！？,;!?]{1,40})/g)].map(match => match[1]);
}

function isPhotographer(query, name, plan) {
  if (plan.photographers.includes(name)) return true;
  return query.includes(`${name}拍的`) || query.includes(`${name}拍摄`) || query.includes(`摄影师${name}`);
}

function cleanContent(value) {
  return photoSearchDates(value).remaining
    .replace(/(衣服|服装|上衣|外套|衬衫|T恤|短袖|连衣裙|裙子)(?:的)?(?:人物|人)(?=\s|[，。！？；、,!?;]|$)/gi, '$1')
    .replace(/(?:只有|仅有|只出现|单独|独自|单人(?:照|照片)?|不要其他人|没有其他人|不要|排除|不含|去掉|不包括|一下)/g, ' ')
    .replace(/^(?:\s*(?:请|麻烦|帮我|给我|找一下|找出|查找|搜索|检索|看看|看一下|找))+/g, ' ')
    .replace(/(?:活动现场|活动里|活动中|画面中)/g, ' ')
    .replace(/(?:穿(?:着)?(?:的)?|身穿(?:的)?)(?=[红蓝白黑黄绿紫粉灰])/g, ' ')
    .replace(/(?:的)?(?:照片|图片|相片|单人照)|(?:的(?=\s|$))/g, ' ')
    .replace(/[，。！？；、,!?;|]+/g, ' ')
    .replace(/^[\s的在和与跟、]+|[\s的在和与跟、]+$/g, '').replace(/\s+/g, ' ').trim();
}

function isSimpleIdentityQuery(query, registry) {
  if (!registry.length) return false;
  const remainder = removeNames(query, registry.map(person => person.name))
    .replace(/(?:的|照片|图片|相片|单人照|单人|只有|仅有|单独|一起|同框|合影|和|与|跟|、|\s)/g, '');
  // A request for a group photo is a visual condition, not just an identity constraint.
  return !remainder && !/合影|合照/.test(query);
}

function canResolvePhotoSearchLocally(query, registry) {
  if (isSimpleIdentityQuery(query, registry)) return true;
  const plan = resolveSearchIntent(query, heuristicPhotoSearchPlan(query), registry);
  if (plan.personCount === 1 && !plan.people.length && !plan.mustTerms.length && !plan.excludeTerms.length) return true;
  if (!plan.people.length && !plan.unknownPeople.length && [...plan.mustTerms, ...plan.excludeTerms].length
    && [...plan.mustTerms, ...plan.excludeTerms].every(term => visualCondition(term)?.kind === 'color')) return true;
  if (!plan.people.length || plan.unknownPeople.length || plan.identityUncertain) return false;
  // Skip the LLM only when every remaining condition has a known, bounded interpretation.
  // Unrecognized prose, unfamiliar people and album/photographer requests still use the model.
  return plan.mustTerms.every(term => equivalents(term).length > 1 || (plan.people.length === 1 && heldObjectRelation(term)))
    && plan.excludeTerms.every(term => equivalents(term).length > 1 || (plan.people.length === 1 && heldObjectRelation(term)));
}

// Resolve identity from the authorized registry, never from model-invented names.
// The returned groups are OR within a concept and AND between concepts.
function resolveSearchIntent(query, rawPlan, registry = [], { faceSearchAllowed = true } = {}) {
  const plan = normalizePhotoSearchPlan(rawPlan, query);
  const heuristic = heuristicPhotoSearchPlan(query);
  const clothing = extractNegatedClothing(query);
  const negatives = negativeSpans(clothing.remaining);
  const stated = name => query.toLowerCase().includes(name.toLowerCase());
  const negative = name => negatives.some(span => span.includes(name));
  const known = registry.filter(person => stated(person.name) && !isPhotographer(query, person.name, plan)
    && !registry.some(other => other.name !== person.name && other.name.includes(person.name) && stated(other.name)));
  const excludedNames = unique([
    ...known.filter(person => negative(person.name)).map(person => person.name),
    ...plan.excludePeople.filter(stated),
  ], 6);
  const unknown = plan.people.filter(name => stated(name) && !negative(name)
    && equivalents(name).length === 1 && !plan.photographers.includes(name));
  const names = unique([...known.filter(person => !negative(person.name)).map(person => person.name), ...unknown], 6);
  const allNames = unique([...names, ...excludedNames, ...plan.photographers, ...plan.projects, ...plan.timelineSections], 24);
  const stripped = removeNames(clothing.remaining, allNames).replace(/(?:不要|排除|不含|去掉|不包括|没有)\s*(?=[，。；！？,;!?]|$)/g, ' ');
  const fallback = heuristicPhotoSearchPlan(stripped);
  const content = term => {
    let value = removeNames(term, allNames);
    if (heuristic.personCount === 1) value = extractSinglePersonQuery(value).remaining
      .replace(/独自一人|独自|单个人|一个人|个人照|一人/g, ' ');
    if (names.length) value = value.replace(/同框|一起/g, ' ');
    if (plan.projects.length) value = value.replace(/相册(?:中|里|内)?/g, ' ');
    if (plan.timelineSections.length) value = value.replace(/环节(?:中|里|内)?/g, ' ');
    if (plan.photographers.length) value = value.replace(/摄影师|拍摄的|拍的|拍摄|(?:^|\s)拍(?=\s|$)/g, ' ');
    return cleanContent(value);
  };
  const localPositiveTerms = unique(fallback.mustTerms.map(content).filter(Boolean));
  // Explicit garment negation must not turn model paraphrases into positive keywords.
  const boundedClothingNegation = clothing.excludeTerms.length > 0
    && localPositiveTerms.every(term => equivalents(term).length > 1);
  let mustTerms = boundedClothingNegation ? [...localPositiveTerms]
    : unique(plan.mustTerms.flatMap(term => content(term).split(/\s+/)).filter(Boolean));
  const relations = names.length === 1 ? localPositiveTerms.filter(heldObjectRelation) : [];
  if (relations.length) {
    const canonical = value => value.replace(/麦克风/g, '话筒');
    // Keep the original subject/verb/object together even when the model returns independent scene keywords.
    mustTerms = unique([...mustTerms.filter(term => !relations.some(relation =>
      canonical(relation).includes(canonical(term)) || /^(?:拿|持|举|握|捧|抱|拎)(?:着|起|住|有)?$/.test(term))), ...relations]);
  }
  const shouldTerms = boundedClothingNegation ? []
    : unique(plan.shouldTerms.map(content).filter(Boolean), 12);
  // AI failure and incorrect entity-only parsing still retain the remaining visual request.
  if (!mustTerms.length && names.length) {
    mustTerms.push(...unique(fallback.mustTerms.map(content).filter(Boolean)));
  }
  const groups = mustTerms.map(term => {
    const alternatives = plan.termGroups.find(group => group[0] === term);
    return unique([term, ...(alternatives || []).slice(1), ...equivalents(term)], 8);
  });
  const exclusions = unique([...plan.excludeTerms, ...heuristic.excludeTerms])
    .map(term => cleanContent(removeNames(term, excludedNames)))
    .filter(term => term && term !== '其他人');
  const unknownPeople = names.filter(name => !registry.some(person => person.name.toLowerCase() === name.toLowerCase()));
  return {
    ...plan, mustTerms, shouldTerms, termGroups: groups, excludeTerms: unique(exclusions),
    excludePeople: excludedNames, people: names,
    peopleMode: names.length > 1 ? (/(?:或者|或是|任一|或)/.test(query) ? 'any' : 'all') : plan.peopleMode,
    peopleOnly: plan.peopleOnly || heuristic.peopleOnly,
    personCount: heuristic.personCount,
    mediaType: heuristic.mediaType !== 'all' ? heuristic.mediaType : plan.mediaType,
    quality: heuristic.quality !== 'any' ? heuristic.quality : plan.quality,
    sort: heuristic.sort !== 'relevance' ? heuristic.sort : plan.sort,
    dateFrom: heuristic.dateFrom || plan.dateFrom, dateTo: heuristic.dateTo || plan.dateTo,
    unknownPeople,
    identityUncertain: names.length === 1 && /(?:同框|一起)/.test(query) && /(?:和|与|跟)/.test(query) && mustTerms.length > 0,
    faceSearchUnavailable: !faceSearchAllowed && Boolean(names.length || excludedNames.length || plan.peopleOnly || heuristic.peopleOnly || heuristic.personCount),
  };
}

module.exports = { resolveSearchIntent, equivalents, isSimpleIdentityQuery, canResolvePhotoSearchLocally };
