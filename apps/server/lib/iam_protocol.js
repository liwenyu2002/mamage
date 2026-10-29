const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const error = (code, status = 400) => Object.assign(new Error(code), { code, status });
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const md5 = value => crypto.createHash('md5').update(value, 'utf8').digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length
  && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function pushSignature(config, form, requestPath) {
  return md5(config.appId + (form.salt || '') + form.timestamp + requestPath + 'POST' + config.appSecret).toUpperCase();
}
function cipherOptions(config) {
  // The bundled sync_sdk_380 derives AES-256's key from the ASCII lowercase MD5 hex, not the raw secret.
  if (config.cipher === 'sdk-aes') return { algorithm: 'aes-256-ecb', key: Buffer.from(md5(config.appSecret), 'utf8'), encoding: 'base64' };
  const raw = Buffer.from(config.appSecret, 'utf8');
  if (config.cipher === 'aes-raw' && [16, 24, 32].includes(raw.length)) return { algorithm: `aes-${raw.length * 8}-ecb`, key: raw, encoding: 'base64' };
  if (config.cipher === 'sdk-sm4' && raw.length >= 16 && crypto.getCiphers().includes('sm4-ecb')) {
    return { algorithm: 'sm4-ecb', key: raw.subarray(0, 16), encoding: 'hex' };
  }
  throw error('IAM_CIPHER_NOT_CONFIGURED', 503);
}
function readPush(config, form, requestPath, now = Date.now()) {
  if (!form || !['1', '2'].includes(form.dataType)) throw error('IAM_INVALID_TYPE');
  for (const key of ['timestamp', 'salt', 'sign', 'data']) if (typeof form[key] !== 'string') throw error('IAM_INVALID_FORM');
  if (Object.keys(form).some(key => !['dataType', 'timestamp', 'salt', 'sign', 'data'].includes(key))) throw error('IAM_INVALID_FORM');
  if (!/^\d{13}$/.test(form.timestamp) || Math.abs(now - Number(form.timestamp)) > 5 * 60000) throw error('IAM_EXPIRED_PUSH', 401);
  if (!form.salt || form.salt.length > 128 || /[\r\n]/.test(form.salt) || !/^[A-F0-9]{32}$/i.test(form.sign)
    || !same(pushSignature(config, form, requestPath), form.sign.toUpperCase())) throw error('IAM_INVALID_SIGNATURE', 401);
  if (!form.data || form.data.length > 1400000) throw error('IAM_PUSH_TOO_LARGE', 413);
  const { algorithm, key, encoding } = cipherOptions(config);
  const validEncoding = encoding === 'hex' ? /^(?:[a-f0-9]{2})+$/i : /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!validEncoding.test(form.data)) throw error('IAM_INVALID_CIPHERTEXT');
  let entries;
  try {
    const decipher = crypto.createDecipheriv(algorithm, key, null);
    const plaintext = Buffer.concat([decipher.update(Buffer.from(form.data, encoding)), decipher.final()]);
    entries = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  } catch { throw error('IAM_INVALID_CIPHERTEXT'); }
  if (!Array.isArray(entries) || entries.length > 1000) throw error('IAM_INVALID_BATCH');
  return { entries, requestKey: sha256(`${requestPath}\n${form.timestamp}\n${form.salt}`),
    payloadHash: sha256(`${form.dataType}\n${form.data}`), sign: form.sign.toUpperCase() };
}
function identifier(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 191 || /[\u0000-\u001f]/.test(value)) throw error('IAM_INVALID_IDENTIFIER');
  return value.trim();
}
function normalizeEntry(input, type, config) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.appId !== config.appId) throw error('IAM_WRONG_APPLICATION');
  if (!/^[01]$/.test(String(input.status)) || !/^\d{13}$/.test(String(input.eventTimestamp))
    || !/^\d+$/.test(String(input.syncType))) throw error('IAM_INVALID_EVENT');
  if (Number(input.eventTimestamp) > Date.now() + 5 * 60000) throw error('IAM_FUTURE_EVENT');
  const result = { eventMs: Number(input.eventTimestamp), status: Number(input.status),
    externalId: identifier(type === '1' ? input.depNum : input.externalId) };
  if (type === '1') {
    result.name = identifier(input.name); result.parent = input.parentNum ? identifier(input.parentNum) : null;
    if (result.parent === result.externalId) throw error('IAM_INVALID_PARENT');
  } else {
    result.principal = identifier(input.principalId);
    if (input.deptNums != null && (!Array.isArray(input.deptNums) || input.deptNums.length > 200)) throw error('IAM_INVALID_DEPARTMENTS');
    result.departments = [...new Set((input.deptNums || []).map(identifier))].sort();
    const attrs = input.attributes;
    const attr = name => attrs && typeof attrs === 'object' && !Array.isArray(attrs) && typeof attrs[name] === 'string' ? attrs[name].trim() : '';
    result.name = attr(config.nameAttribute).slice(0, 50);
    result.email = attr(config.emailAttribute).slice(0, 255).toLowerCase();
    if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw error('IAM_INVALID_EMAIL');
    result.studentNo = attr(config.studentAttribute).slice(0, 32);
  }
  result.payloadHash = sha256(JSON.stringify(result));
  return result;
}
module.exports = { error, sha256, same, pushSignature, cipherOptions, readPush, normalizeEntry, identifier };
