const crypto = require('node:crypto');

const VERSION = 'person-visual-v2-crop-20261014';
const COLORS = ['black', 'white', 'gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'beige'];
const ACTIVITIES = ['speech', 'group_photo', 'award', 'signing'];
const COLOR_NAMES = { 黑: 'black', 白: 'white', 灰: 'gray', 红: 'red', 橙: 'orange', 黄: 'yellow',
  绿: 'green', 蓝: 'blue', 紫: 'purple', 粉: 'pink', 棕: 'brown', 褐: 'brown', 米: 'beige', 卡其: 'beige',
  墨绿: 'green', 深绿: 'green', 浅绿: 'green', 藏蓝: 'blue', 深蓝: 'blue', 浅蓝: 'blue' };
const ACTIVITY_NAMES = { 发言: 'speech', 演讲: 'speech', 讲话: 'speech', 致辞: 'speech',
  合影: 'group_photo', 合照: 'group_photo', 集体照: 'group_photo', 颁奖: 'award', 授奖: 'award',
  签约: 'signing', 签署协议: 'signing' };

function visualCondition(term) {
  const value = String(term || '').trim();
  const clothing = value.match(/^(?:穿(?:着|的)?|身穿)?(墨绿|深绿|浅绿|藏蓝|深蓝|浅蓝|卡其|[黑白灰红橙黄绿蓝紫粉棕褐米])(?:色)?(?:的)?(?:衣服|衣|服装|上衣|外套|衬衫|T恤|短袖|连衣裙|裙子)$/i);
  if (clothing) return { kind: 'color', value: COLOR_NAMES[clothing[1]] };
  return ACTIVITY_NAMES[value] ? { kind: 'activity', value: ACTIVITY_NAMES[value] } : null;
}

function assertionKey(text) {
  return crypto.createHash('sha256').update(String(text).trim().toLowerCase()).digest('hex').slice(0,24);
}

function heldObjectRelation(term) {
  const match = String(term || '').trim().match(/^(?:(左手|右手|双手|手)(?:里|中)?)?(拿着?|持(?:着|有)?|举(?:着|起)?|握(?:着|住)?|捧着?|抱着?|拎着?)([^\s，。；！？,;!?]{1,24})$/u);
  if (!match || /的|在|和|与|并|但|不是|没有|旁人|别人|其他人/.test(match[3])) return null;
  return { object: match[3], profileReusable: (!match[1] || match[1] === '手')
    && ['拿', '拿着', '持', '持着', '持有', '举', '举着'].includes(match[2]) };
}

function assertionState(condition, evidence) {
  const decision = evidence?.assertions?.[condition.key];
  const relation = heldObjectRelation(condition.value);
  if (!relation) return ['yes', 'no'].includes(decision?.state) ? decision.state : 'unknown';
  if (evidence?.binding !== 'clear' || !Array.isArray(evidence.profile?.heldObjects)) return decision?.state === 'no' ? 'no' : 'unknown';
  const canonical = value => String(value || '').trim().toLowerCase()
    .replace(/麦克风|microphone/g, '话筒').replace(/^一[个支部台把本束枚]/, '');
  const wanted = canonical(relation.object);
  const held = evidence.profile.heldObjects.some(value => {
    const object = canonical(value);
    if (object === wanted) return true;
    if (!object.endsWith(wanted)) return false;
    return /^(?:[黑白红蓝绿银金灰]色|无线|有线|手持式|小型|大型)+$/.test(object.slice(0, -wanted.length));
  });
  if (decision) return decision.state === 'no' ? 'no' : decision.state === 'yes' && held ? 'yes' : 'unknown';
  // A recorded held object is positive evidence; an empty or incomplete profile proves no absence.
  return held && relation.profileReusable ? 'yes' : 'unknown';
}

function compileVisualConditions(plan, people, { semantic = false, activities = semantic, anonymous = false } = {}) {
  const unnamed = anonymous && !plan.people?.length && !people.length;
  if (!unnamed && (plan.people?.length !== 1 || people.length !== 1 || plan.people[0] !== people[0].name)) return null;
  const positive = []; const negative = []; const remainingMustTerms = []; const remainingExcludeTerms = [];
  for (const [terms, conditions, remainder] of [[plan.mustTerms || [], positive, remainingMustTerms],
    [plan.excludeTerms || [], negative, remainingExcludeTerms]]) {
    for (const term of terms) {
      const recognized = visualCondition(term);
      let condition = unnamed ? (recognized?.kind === 'color' ? recognized : null)
        : (recognized?.kind !== 'activity' || activities ? recognized : null)
          || (semantic || heldObjectRelation(term) ? { kind: 'assertion', value: String(term),
            key: assertionKey(heldObjectRelation(term) ? `held-object-reviewed-v1:${term}` : term) } : null);
      if (unnamed && condition) {
        const garment = /外套$/.test(term) ? 'outerwear' : /衬衫$/.test(term) ? 'shirt'
          : /(?:T恤|短袖)$/i.test(term) ? 'tshirt' : /(?:连衣裙|裙子)$/.test(term) ? 'dress' : null;
        if (garment) condition = { ...condition, garment };
      }
      if (!condition) remainder.push(term);
      else if (!conditions.some(item => item.kind === condition.kind && item.value === condition.value && item.garment === condition.garment)) conditions.push(condition);
    }
  }
  if (!positive.length && !negative.length) return null;
  return { personId: unnamed ? null : Number(people[0].id), ...(unnamed ? { anonymous: true } : {}),
    positive, negative, remainingMustTerms, remainingExcludeTerms };
}

function normalizeEvidence(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const visibility = ['clear','partial','hidden'].includes(value.visibility) ? value.visibility : 'hidden';
  const colors = [...new Set(Array.isArray(value.colors) ? value.colors.filter(color => COLORS.includes(color)) : [])];
  return { binding: value.binding === 'clear' && value.visibility && Array.isArray(value.colors) ? 'clear' : 'uncertain',
    visibility, colors,
    activities: Object.fromEntries(ACTIVITIES.map(key => [key, ['yes','no'].includes(value.activities?.[key]) ? value.activities[key] : 'unknown'])),
    observation: String(value.observation || '').replace(/[\u0000-\u001f]/g, ' ').slice(0,240) };
}

function judgeEvidence(request, raw, { allowMulticolor = false } = {}) {
  if (!raw || raw.binding !== 'clear') return 'unknown';
  const evidence = normalizeEvidence(raw);
  let uncertain = false;
  for (const [conditions, negated] of [[request.positive, false], [request.negative, true]]) {
    for (const condition of conditions) {
      let matches;
      if (condition.kind === 'color') {
        if (evidence.visibility !== 'clear' || !evidence.colors.length || (!allowMulticolor && evidence.colors.length !== 1)) { uncertain = true; continue; }
        matches = evidence.colors.includes(condition.value);
        if (matches && condition.garment) {
          const upper = String(raw.profile?.clothing?.upper || '').toLowerCase();
          const garments = {
            outerwear: /外套|夹克|羽绒服|大衣|风衣|棉衣|棉服|\b(?:coat|jacket|parka)\b/,
            shirt: /衬衫|button[- ]?down|collared shirt|dress shirt/,
            tshirt: /t恤|短袖|t[- ]?shirt/,
            dress: /连衣裙|\bdress\b(?! shirt)/,
          };
          if (!garments[condition.garment]?.test(upper)) {
            if (Object.values(garments).some(pattern => pattern.test(upper))) matches = false;
            else { uncertain = true; continue; }
          }
        }
      } else if (condition.kind === 'activity') {
        const state = evidence.activities[condition.value];
        if (!state || state === 'unknown') { uncertain = true; continue; }
        matches = state === 'yes';
      } else {
        const state = assertionState(condition, raw);
        if (!['yes','no'].includes(state)) { uncertain = true; continue; }
        matches = state === 'yes';
      }
      if (matches === negated) return 'reject';
    }
  }
  return uncertain ? 'unknown' : 'match';
}

function modelVersion() {
  if (process.env.SEARCH_VISUAL_PROVIDER === 'zgcai') {
    return `zgcai:${process.env.ZGCAI_BASE_URL || 'https://llm.inner.bza.edu.cn/hub'}:${process.env.ZGCAI_VISION_MODEL || 'qwen'}:${process.env.SEARCH_VISUAL_MODEL_REVISION || 'unverified'}:scene-${process.env.SEARCH_VISUAL_SEMANTIC_ENABLED === '1'}`;
  }
  return `${process.env.OLLAMA_VISION_MODEL || process.env.LOCAL_VISION_MODEL || 'qwen3-vl:8b'}:${process.env.SEARCH_VISUAL_MODEL_REVISION || 'local'}:scene-${process.env.SEARCH_VISUAL_SEMANTIC_ENABLED === '1'}`;
}

function evidenceKey(face, model = modelVersion()) {
  return crypto.createHash('sha256').update(JSON.stringify([VERSION, model, face.id, face.photoId, face.personId,
    face.x, face.y, face.w, face.h, face.unit, face.imageWidth, face.imageHeight, face.photoUrl, face.thumbUrl])).digest('hex');
}

function ratioBox(face) {
  let box = [face.x, face.y, face.w, face.h].map(Number);
  if (box.some(value => !Number.isFinite(value)) || box[2] <= 0 || box[3] <= 0) return null;
  if (/^(pixel|px)$/i.test(face.unit || '') || box[2] > 1.5 || box[3] > 1.5) {
    if (!(Number(face.imageWidth) > 0 && Number(face.imageHeight) > 0)) return null;
    box = box.map((value,index) => value / Number(index % 2 ? face.imageHeight : face.imageWidth));
  }
  if (box.some(value => value < 0 || value > 1) || box[0]+box[2] > 1.01 || box[1]+box[3] > 1.01) return null;
  return box;
}

module.exports = { VERSION, COLORS, ACTIVITIES, compileVisualConditions, visualCondition, assertionKey, assertionState, heldObjectRelation,
  normalizeEvidence, judgeEvidence, evidenceKey, ratioBox, modelVersion };
