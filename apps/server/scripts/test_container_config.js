const assert = require('node:assert/strict');
const { test } = require('node:test');
const { checkContainerConfig } = require('../lib/container_config');
const valid = () => ({ JWT_SECRET: 'test-only-signing-key-with-more-than-32-characters', DB_HOST: 'mysql.database.svc',
  DB_PORT: '3306', DB_USER: 'mamage', DB_PASSWORD: 'test-password', DB_NAME: 'mamage',
  COS_SECRET_ID: 'test-id', COS_SECRET_KEY: 'test-key', COS_BUCKET: 'test-bucket',
  COS_BASE_URL: 'https://s3.campus.example', UPLOAD_BASE_URL: 'https://gallery.campus.example/api/image',
  INTERNAL_UPLOAD_BASE_URL: 'http://release-mamage-api:8080/api/image', FACE_DETECTOR_SERVICE_URL: 'http://face.models.svc:8009',
  ORGANIZATION_UNITS_ACTIVE: '1', MEDIA_URL_SIGNING: '1', VIDEO_TRANSCRIPT_ENABLED: '0' });

test('container contract accepts service DNS without contacting production dependencies', () => {
  assert.deepEqual(checkContainerConfig(valid()), []);
});
test('Hub faces and disabled transcription have no Mac-local service requirement', () => {
  const env = { ...valid(), FACE_INFERENCE_PROVIDER: 'zgcai', FACE_DETECTOR_SERVICE_URL: '',
    VIDEO_TRANSCRIPT_ENABLED: '0', VIDEO_TRANSCRIPT_SERVICE_URL: '' };
  assert.deepEqual(checkContainerConfig(env, () => false), []);
  assert.ok(checkContainerConfig({ ...env, FACE_INFERENCE_PROVIDER: 'local' }).some(e => e.startsWith('FACE_DETECTOR_SERVICE_URL:')));
});
test('missing and invalid configuration is reported by key, never by credential value', () => {
  const env = valid();
  env.DB_PASSWORD = ''; env.JWT_SECRET = 'tiny-secret'; env.DB_PORT = 'bad';
  env.INTERNAL_UPLOAD_BASE_URL = 'http://127.0.0.1:8080/api/image';
  env.FACE_DETECTOR_SERVICE_URL = 'http://localhost:8009';
  env.ORGANIZATION_UNITS_ACTIVE = '0';
  const errors = checkContainerConfig(env).join('\n');
  for (const key of ['DB_PASSWORD', 'JWT_SECRET', 'DB_PORT', 'INTERNAL_UPLOAD_BASE_URL', 'FACE_DETECTOR_SERVICE_URL', 'ORGANIZATION_UNITS_ACTIVE']) assert.ok(errors.includes(key));
  assert.ok(!errors.includes('tiny-secret'));
});
test('transcription cannot silently use nonexistent Mac-local binaries after migration', () => {
  const env = { ...valid(), VIDEO_TRANSCRIPT_ENABLED: '1', VIDEO_TRANSCRIPT_WHISPER_CLI: '/old/mac/whisper', VIDEO_TRANSCRIPT_MODEL_PATH: '/old/mac/model' };
  assert.equal(checkContainerConfig(env, () => false).length, 2);
  assert.deepEqual(checkContainerConfig(env, () => true), []);
});
test('remote transcription requires a reachable endpoint and a separate strong service token', () => {
  const env = { ...valid(), VIDEO_TRANSCRIPT_ENABLED: '1', VIDEO_TRANSCRIPT_SERVICE_URL: 'http://models.internal:8009',
    VIDEO_TRANSCRIPT_SERVICE_TOKEN: 'test-only-transcription-service-key-123456' };
  assert.deepEqual(checkContainerConfig(env, () => false), []);
  assert.equal(checkContainerConfig({ ...env, VIDEO_TRANSCRIPT_SERVICE_TOKEN: '' }).length, 1);
  assert.equal(checkContainerConfig({ ...env, VIDEO_TRANSCRIPT_SERVICE_URL: 'http://localhost:8009' }).length, 1);
});
