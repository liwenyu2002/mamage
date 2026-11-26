const { createHash, timingSafeEqual } = require('node:crypto');
const { BlockList, isIP } = require('node:net');
const { unitRoleAllows } = require('./access_policy');

const MAX_CANDIDATES = 30;
const MAX_PUBLISH = 12;
const DELIVERY_PATH = '/api/integrations/college-window/v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const RESTRICTED_TAGS = '禁止外发|不得外发|仅限内部|仅内部|保密';
const ANONYMIZED_TAGS = '已脱敏|已匿名|已打码|人脸打码|人脸模糊|不公开姓名';

function id(value) {
  if (!/^[1-9]\d*$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= 0xffffffff ? number : null;
}

function split(value) {
  return String(value || '').split(',').map(part => part.trim()).filter(Boolean);
}

function peerAddresses(input) {
  const rules = split(input);
  if (!rules.length) return null;
  const list = new BlockList();
  for (const rule of rules) {
    const [address, prefix, extra] = rule.split('/');
    const ip = isIP(address);
    if (!ip || extra !== undefined || (prefix !== undefined &&
      (!/^\d{1,3}$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (ip === 4 ? 32 : 128)))) return null;
    if (prefix === undefined) list.addAddress(address, ip === 4 ? 'ipv4' : 'ipv6');
    else list.addSubnet(address, Number(prefix), ip === 4 ? 'ipv4' : 'ipv6');
  }
  return list;
}

function readConfig(env = process.env) {
  const orgId = id(env.MAMAGE_COLLEGE_WINDOW_ORG_ID);
  const unitId = id(env.MAMAGE_COLLEGE_WINDOW_UNIT_ID);
  const managerIds = new Set(split(env.MAMAGE_COLLEGE_WINDOW_MANAGER_IDS).map(id));
  if (!orgId || !unitId || !managerIds.size || managerIds.has(null)) return null;
  const tokenHash = String(env.MAMAGE_COLLEGE_WINDOW_CONSUMER_TOKEN_SHA256 || '').trim().toLowerCase();
  return { orgId, unitId, managerIds, tokenHash: DIGEST.test(tokenHash) ? Buffer.from(tokenHash, 'hex') : null,
    peers: peerAddresses(env.MAMAGE_COLLEGE_WINDOW_CONSUMER_PEERS) };
}

function canManage(config, workspace) {
  return Boolean(config && workspace?.enabled && workspace.orgId === config.orgId && workspace.unitId === config.unitId
    && config.managerIds.has(workspace.userId) && (workspace.collegeAdmin || unitRoleAllows(workspace.role, 'read')));
}

function consumerAllowed(config, remoteAddress, authorization) {
  if (!config?.tokenHash || !config.peers) return false;
  const ip = isIP(remoteAddress || '');
  if (!ip || !config.peers.check(remoteAddress, ip === 4 ? 'ipv4' : 'ipv6')) return false;
  const match = /^Bearer ([\w-]{32,128})$/i.exec(authorization || '');
  return Boolean(match && timingSafeEqual(config.tokenHash, createHash('sha256').update(match[1]).digest()));
}

// Do not export entire fields when they contain details that are difficult to redact reliably.
const PRIVATE_TEXT = /(?:身份证|证件号|学籍|[学工][号籍]|手机号|电话号码|家长电话|联系方式|家庭住址|私人邮箱|二维码|保密|不得外发|禁止外发|仅限?内部|密钥|密码|访问令牌|会议纪要|成绩单|名单|隐私|未公开|https?:\/\/|www\.|@|\d{5,}|(?:\+?86[\s-]*)?1[3-9](?:[\s-]*\d){9})/iu;

function safeText(value, length) {
  const text = typeof value === 'string' ? value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/gu, ' ').trim() : '';
  return !text || PRIVATE_TEXT.test(text) ? null : Array.from(text).slice(0, length).join('');
}

function publicationText(source, names = [], hidePeople = false) {
  const description = hidePeople ? null : safeText(source.aiDescription, 500);
  return {
    albumName: safeText(source.albumName, 160),
    peopleNames: hidePeople ? [] : [...new Set(names.map(name => safeText(name, 80)).filter(Boolean))].slice(0, 40),
    description,
  };
}

const NO_FACES = /(?:没有|不要(?:出现|有)?|不含|不出现|不露出|无)\s*(?:任何|可辨认的|可见的?)?\s*人脸|不露脸|没有脸/u;
const NO_PEOPLE = /(?:没有(?:任何)?人(?:物)?|无人物|无人)(?=的?(?:照片?|图片|相片|画面|镜头)|[\s，、。；,;]|$)/u;

function extractContentFilter(query) {
  for (const [contentFilter, pattern] of [['no-faces', NO_FACES], ['no-people', NO_PEOPLE]]) {
    const match = pattern.exec(query);
    if (!match) continue;
    const prefix = query.slice(0, match.index);
    if (/(?:不要|排除|不是|不选|不看)\s*$/.test(prefix)) continue;
    const rest = `${prefix} ${query.slice(match.index + match[0].length)}`
      .replace(/^[\s，、。；,:：;]+|[\s，、。；,:：;]+$/g, '')
      .replace(/^(?:(?:请|帮我|给我|再|挑选|挑出|选出|筛选|找出|选|找|所有|全部|只要|只看|的)\s*)+/u, '')
      .replace(/\s*的?(?:照片?|图片|相片)\s*$/u, '')
      .replace(/^[\s，、。；,:：;]+|[\s，、。；,:：;]+$/g, '');
    return { query: rest, contentFilter };
  }
  return { query };
}

function selectRequest(body) {
  const q = typeof body?.query === 'string' ? body.query.trim().slice(0, 160) : '';
  const ai = body?.mode === 'ai';
  if (ai && !q) return null;
  const amount = q.match(/(\d{1,4})\s*张/);
  const query = ai && amount
    ? q.replace(amount[0], ' ').replace(/^\s*(?:请|帮我|给我|我想要|再)?\s*(?:选出|挑选|挑出|找出|选|找|补充|补选|补)?\s*/, '')
      .replace(/^(?:的\s*)|(?:\s*(?:的照片|照片|的图片|图片))$/g, '').trim()
    : q;
  return { ...extractContentFilter(query), ai, limit: ai && amount ? Math.max(1, Math.min(MAX_CANDIDATES, Number(amount[1]))) : 24,
    exclude: [...new Set((Array.isArray(body?.exclude) ? body.exclude.slice(0, 500) : []).map(id).filter(Boolean))] };
}

function reviewDigest(source, workspace, metadata, sha256) {
  return createHash('sha256').update(JSON.stringify([
    workspace.userId, source.id, source.projectId, source.sourceKey, source.adjustments, metadata, sha256,
  ])).digest('hex');
}

function automaticTags(generated) {
  if (!generated) return { sql: 'tags', params: [] };
  // Preserve an editor's privacy markers even when analysis replaces generated tags.
  const groups = [[RESTRICTED_TAGS, '禁止外发'], [ANONYMIZED_TAGS, '已脱敏']];
  const guards = groups.filter(([terms]) => !new RegExp(terms).test(generated)).map(([terms, canonical]) =>
    `IF(CAST(tags AS CHAR CHARACTER SET utf8mb4) REGEXP '${terms}', JSON_ARRAY('${canonical}'), JSON_ARRAY())`);
  return { sql: guards.length ? `JSON_MERGE_PRESERVE(CAST(? AS JSON), ${guards.join(', ')})` : '?', params: [generated] };
}

module.exports = { readConfig, canManage, consumerAllowed, publicationText, reviewDigest, selectRequest,
  id, UUID, DIGEST, MAX_CANDIDATES, MAX_PUBLISH, DELIVERY_PATH, RESTRICTED_TAGS, ANONYMIZED_TAGS, automaticTags };
