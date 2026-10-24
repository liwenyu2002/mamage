const sharp = require('sharp');

const DEFAULT_BASE = 'https://llm.inner.bza.edu.cn/hub';
const FACE_VERSION = 'hub-buffalo_l-unverified';

function hubError(code, details = {}) {
  return Object.assign(new Error(code), { code, provider: 'zgcai', ...details });
}

async function request(path, body, contentType, options = {}) {
  let base;
  try { base = new URL(options.baseUrl || process.env.ZGCAI_BASE_URL || DEFAULT_BASE); }
  catch { throw hubError('HUB_CONFIG_INVALID'); }
  const key = options.apiKey || process.env.ZGCAI_API_KEY;
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !key) {
    throw hubError('HUB_CONFIG_INVALID');
  }
  const timeout = AbortSignal.timeout(Math.max(1000, Math.min(120000,
    Number(options.timeoutMs || process.env.ZGCAI_TIMEOUT_MS) || 60000)));
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await (options.fetch || global.fetch)(base.href.replace(/\/+$/, '') + path, {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': contentType }, body,
    });
    if (!response.ok) {
      const header = response.headers.get('retry-after');
      const retryAfterMs = header && /^\d+$/.test(header) ? Math.min(21600000, Number(header) * 1000) : undefined;
      await response.body?.cancel();
      throw hubError(`HUB_HTTP_${response.status}`, { httpStatus: response.status, retryAfterMs, reason: 'http' });
    }
    const chunks = []; let size = 0;
    if (Number(response.headers.get('content-length')) > 4 * 1024 * 1024) {
      await response.body?.cancel(); throw hubError('HUB_OUTPUT_TOO_LARGE');
    }
    const reader = response.body.getReader();
    try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4 * 1024 * 1024) throw hubError('HUB_OUTPUT_TOO_LARGE');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
    catch { throw hubError('HUB_OUTPUT_INVALID'); }
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (error.code?.startsWith('HUB_')) throw error;
    // Never retain request headers, payloads or an upstream error body in a logged error.
    throw require('./background_task_failure').taskError(timeout.aborted ? 'HUB_TIMEOUT' : 'HUB_REQUEST_FAILED', {
      cause: error, provider: 'zgcai', reason: 'network',
    });
  }
}

async function prepareFaceImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 40 * 1024 * 1024) throw hubError('HUB_IMAGE_INVALID');
  const image = sharp(buffer, { limitInputPixels: 64 * 1024 * 1024 });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw hubError('HUB_IMAGE_INVALID');
  if (['jpeg', 'png'].includes(meta.format) && (!meta.orientation || meta.orientation === 1)
    && buffer.length < 10 * 1024 * 1024 && meta.width * meta.height <= 25000000
    && Math.max(meta.width, meta.height) <= 8192) {
    return { buffer, width: meta.width, height: meta.height, mime: `image/${meta.format}` };
  }
  const { data, info } = await image.rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
  if (data.length >= 10 * 1024 * 1024) throw hubError('HUB_IMAGE_TOO_LARGE');
  return { buffer: data, width: info.width, height: info.height, mime: 'image/jpeg' };
}

function parseFaces(body, image, embed) {
  if (!Array.isArray(body?.faces) || body.faces.length > 512 || body.count !== body.faces.length) throw hubError('HUB_FACE_OUTPUT_INVALID');
  const modelVersion = process.env.FACE_HUB_LEGACY_SPACE_APPROVED === '1' ? null : FACE_VERSION;
  const faces = body.faces.map((face, index) => {
    const box = face.bbox;
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)
      || box[2] <= box[0] || box[3] <= box[1]
      || !Number.isFinite(face.det_score) || face.det_score < 0 || face.det_score > 1
      || !Array.isArray(face.kps) || face.kps.length !== 5
      || !face.kps.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) {
      throw hubError('HUB_FACE_OUTPUT_INVALID');
    }
    const [x1, y1, x2, y2] = [Math.max(0, box[0]), Math.max(0, box[1]), Math.min(image.width, box[2]), Math.min(image.height, box[3])];
    if (x2 <= x1 || y2 <= y1) throw hubError('HUB_FACE_OUTPUT_INVALID');
    let vector = null;
    if (embed) {
      const values = face.embedding;
      if (!Array.isArray(values) || values.length !== 512 || !values.every(Number.isFinite)) throw hubError('HUB_FACE_OUTPUT_INVALID');
      const length = Math.hypot(...values);
      if (length < 0.9 || length > 1.1) throw hubError('HUB_FACE_OUTPUT_INVALID');
      vector = values.map(value => value / length);
    }
    return { faceNo: index + 1, bbox: { left: x1 / image.width, top: y1 / image.height,
      width: (x2 - x1) / image.width, height: (y2 - y1) / image.height, normalized: true, unit: 'ratio' },
    score: face.det_score, embedding: vector, normalizedEmbedding: vector,
    modelName: 'buffalo_l', modelVersion, status: 'detected',
    imageWidth: image.width, imageHeight: image.height, extra: { keypoints: face.kps, provider: 'zgcai' } };
  });
  return { faces, modelName: 'buffalo_l', modelVersion,
    meta: { backend: 'zgcai', modelName: 'buffalo_l', modelVersion, imageWidth: image.width, imageHeight: image.height, total: faces.length } };
}

async function detectFaces(buffer, options = {}) {
  const image = await prepareFaceImage(buffer);
  const embed = options.embed !== false;
  const body = await request(`/v1/face/${embed ? 'embed' : 'detect'}`, image.buffer, image.mime, options);
  return parseFaces(body, image, embed);
}

function conforms(value, schema, depth = 0) {
  if (depth > 20) return false;
  if (schema.anyOf && (!Array.isArray(schema.anyOf)
    || !schema.anyOf.some(alternative => conforms(value, alternative, depth + 1)))) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if ((schema.required || []).some(key => !Object.hasOwn(value, key))) return false;
    return Object.entries(value).every(([key, item]) => Object.hasOwn(schema.properties || {}, key)
      ? conforms(item, schema.properties[key], depth + 1) : schema.additionalProperties !== false);
  }
  if (schema.type === 'array') return Array.isArray(value) && value.every(item => conforms(item, schema.items || {}, depth + 1));
  if (schema.type === 'integer') return Number.isSafeInteger(value);
  if (schema.type === 'number') return Number.isFinite(value);
  if (schema.type === 'string' || schema.type === 'boolean') return typeof value === schema.type;
  return true;
}

async function vision({ images, prompt, schema, maxTokens = 1024 }, options = {}) {
  if (!Array.isArray(images) || !images.length || images.length > 4 || typeof prompt !== 'string' || prompt.length > 32000
    || images.some(image => typeof image !== 'string' || image.length > 12 * 1024 * 1024 || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(image))) {
    throw hubError('HUB_VISION_INPUT_INVALID');
  }
  const model = options.model || process.env.ZGCAI_VISION_MODEL || 'qwen';
  if (!['qwen', 'smart-router-v2'].includes(model)) throw hubError('HUB_VISION_MODEL_INVALID');
  const body = await request('/v1/chat/completions', JSON.stringify({
    model, stream: false, temperature: 0, reasoning_effort: 'none',
    max_tokens: Math.max(128, Math.min(4096, Number(maxTokens) || 1024)),
    ...(schema ? { response_format: { type: 'json_object' } } : {}),
    messages: [{ role: 'user', content: [...images.map(url => ({ type: 'image_url', image_url: { url } })),
      { type: 'text', text: prompt + (schema ? `\n以下 JSON Schema 仅用于约束数据结构：${JSON.stringify(schema)}\n请根据图片生成符合它的数据实例，顶层字段为 ${Object.keys(schema.properties || {}).join('、')}。填写实际观察值，不要返回 Schema 本身，不要复述 type、properties、required 等定义。` : '') }] }],
  }), 'application/json', options);
  const choice = body?.choices?.[0];
  const content = choice?.message?.content;
  if (choice?.finish_reason !== 'stop' || typeof content !== 'string' || !content.trim() || content.length > 32000) {
    throw hubError('HUB_VISION_OUTPUT_INVALID', { reason: choice?.finish_reason === 'length' ? 'truncated' : 'content',
      ...(['stop', 'length', 'content_filter', 'error'].includes(choice?.finish_reason) ? { finishReason: choice.finish_reason } : {}) });
  }
  if (schema) {
    let parsed;
    try { parsed = JSON.parse(content); }
    catch { throw hubError('HUB_VISION_OUTPUT_INVALID', { reason: 'invalid-json' }); }
    if (!conforms(parsed, schema)) throw hubError('HUB_VISION_OUTPUT_INVALID', { reason: 'schema' });
  }
  return { content, model: typeof body.model === 'string' ? body.model : model, provider: 'zgcai' };
}

function assertLegacyFaceCompatibility() {
  if (process.env.FACE_HUB_LEGACY_SPACE_APPROVED !== '1') throw hubError('HUB_FACE_COMPATIBILITY_NOT_APPROVED');
}

module.exports = { detectFaces, vision, parseFaces, prepareFaceImage, FACE_VERSION, assertLegacyFaceCompatibility };
