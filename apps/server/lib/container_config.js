const fs = require('node:fs');

function checkContainerConfig(env = process.env, exists = fs.existsSync) {
  const errors = [];
  const required = ['JWT_SECRET', 'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
    'COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET'];
  for (const key of required) if (!String(env[key] || '').trim()) errors.push(`${key}: required`);
  if (env.JWT_SECRET && String(env.JWT_SECRET).length < 32) errors.push('JWT_SECRET: use at least 32 characters');
  if (!Number.isInteger(Number(env.DB_PORT)) || Number(env.DB_PORT) < 1 || Number(env.DB_PORT) > 65535) errors.push('DB_PORT: invalid');
  const usesHubFaces = ['zgcai', 'hub'].includes(String(env.FACE_INFERENCE_PROVIDER || '').toLowerCase());
  for (const key of ['COS_BASE_URL', 'UPLOAD_BASE_URL', 'INTERNAL_UPLOAD_BASE_URL', ...(!usesHubFaces ? ['FACE_DETECTOR_SERVICE_URL'] : [])]) {
    try {
      const url = new URL(env[key]);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error();
      if (key !== 'UPLOAD_BASE_URL' && /^(localhost|127\.|\[?::1\]?)/i.test(url.hostname)) throw Error();
      if (key.includes('UPLOAD_BASE_URL') && !url.pathname.endsWith('/api/image')) throw Error();
    } catch { errors.push(`${key}: configure a reachable HTTP(S) service endpoint`); }
  }
  if (/^(localhost|127\.|\[?::1\]?)/i.test(String(env.DB_HOST || ''))) errors.push('DB_HOST: configure the external database, not Pod loopback');
  if (env.ORGANIZATION_UNITS_ACTIVE !== '1') errors.push('ORGANIZATION_UNITS_ACTIVE: must be 1');
  if (env.MEDIA_URL_SIGNING !== '1') errors.push('MEDIA_URL_SIGNING: must be 1');
  if (env.VIDEO_TRANSCRIPT_ENABLED !== '0') {
    if (env.VIDEO_TRANSCRIPT_SERVICE_URL) {
      try {
        const url = new URL(env.VIDEO_TRANSCRIPT_SERVICE_URL);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
          || /^(localhost|127\.|\[?::1\]?)/i.test(url.hostname)) throw Error();
      } catch { errors.push('VIDEO_TRANSCRIPT_SERVICE_URL: configure a reachable private HTTP(S) endpoint'); }
      if (String(env.VIDEO_TRANSCRIPT_SERVICE_TOKEN || '').length < 32) errors.push('VIDEO_TRANSCRIPT_SERVICE_TOKEN: use at least 32 characters');
    } else {
      for (const key of ['VIDEO_TRANSCRIPT_WHISPER_CLI', 'VIDEO_TRANSCRIPT_MODEL_PATH']) {
        if (!env[key] || !exists(env[key])) errors.push(`${key}: required local asset when transcription is enabled`);
      }
    }
  }
  return [...new Set(errors)];
}

module.exports = { checkContainerConfig };
