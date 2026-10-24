const assert = require('node:assert/strict');
const { test } = require('node:test');
const { taskError, errorDetails, planFailure, recordFailure } = require('../lib/background_task_failure');

test('nested failures retain safe stage, provider, root code and HTTP status, never raw content', () => {
  const source = Object.assign(new Error('Bearer private-key https://private/photo?signature=secret'), {
    code: 'HUB_HTTP_503', httpStatus: 503, response: { data: 'private model output' }, request: { Authorization: 'secret' },
  });
  const error = taskError('DESCRIPTION_REVIEW_UNAVAILABLE', { stage: 'review', cause: source });
  const details = errorDetails(new Error('PERSON_VISUAL_ANALYSIS_FAILED', { cause: error }));
  assert.equal(details.causeCode, 'HUB_HTTP_503'); assert.equal(details.stage, 'review');
  assert.equal(details.httpStatus, 503); assert.equal(details.provider, 'zgcai');
  for (const serialized of [JSON.stringify(error), JSON.stringify(details)]) assert.doesNotMatch(serialized, /private|signature|Bearer|secret/);
  const loop = { message: 'untrusted data' }; loop.cause = loop;
  assert.equal(errorDetails(loop).code, 'BACKGROUND_TASK_FAILED');
});

test('transient errors use delayed jittered retries but configuration and invalid inputs stop', () => {
  for (const code of ['HUB_TIMEOUT', 'HUB_REQUEST_FAILED', 'HUB_HTTP_429', 'HUB_HTTP_503', 'HUB_VISION_OUTPUT_INVALID', 'ER_LOCK_DEADLOCK']) {
    assert.equal(planFailure({ code }, { kind: 'photo-description', attempt: 3 }).status, 'queued');
    assert.equal(planFailure({ code }, { kind: 'photo-description', attempt: 7 }).status, 'failed');
  }
  for (const code of ['HUB_HTTP_401', 'HUB_HTTP_403', 'HUB_HTTP_404', 'HUB_CONFIG_INVALID', 'FACE_IMAGE_NOT_FOUND', 'DESCRIPTION_IMAGE_INVALID']) {
    assert.equal(planFailure({ code }, { kind: 'photo-description' }).status, 'failed', code);
  }
  const plan = planFailure({ code: 'HUB_HTTP_429', retryAfterMs: 120000 }, { kind: 'face', attempt: 1, now: 1000, random: () => 0 });
  assert.equal(plan.availableAt, 121000);
  assert.equal(planFailure({ code: 'HUB_TIMEOUT' }, { kind: 'face', now: 0, random: () => 1 }).availableAt, 18000);
  assert.equal(planFailure(Error('unknown'), { kind: 'face', attempt: 3 }).status, 'failed');
  assert.equal(planFailure({ code: 'HUB_TIMEOUT' }, { kind: 'video-render', attempt: 3 }).status, 'failed');
});

test('failure history is atomic with retry status and cannot overwrite cancelled work', async () => {
  const events = []; let failInsert = true, affectedRows = 1;
  const conn = { beginTransaction: async () => events.push('begin'), commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'), release: () => events.push('release'), query: async sql => {
      events.push(sql.startsWith('UPDATE') ? 'update' : 'insert');
      if (sql.startsWith('INSERT') && failInsert) throw Error('fixture');
      return [{ affectedRows }];
    } };
  const pool = { getConnection: async () => conn }, job = { id: 1, kind: 'photo-description', payload: '{"photoId":921}' };
  const plan = planFailure({ code: 'HUB_TIMEOUT' }, { kind: job.kind });
  await assert.rejects(recordFailure(pool, job, 'owner', plan));
  assert.deepEqual(events, ['begin', 'update', 'insert', 'rollback', 'release']);
  events.length = 0; failInsert = false; affectedRows = 0;
  await recordFailure(pool, job, 'owner', plan);
  assert.deepEqual(events, ['begin', 'update', 'commit', 'release']);
});
