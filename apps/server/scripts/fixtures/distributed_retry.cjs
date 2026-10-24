if (process.env.MAMAGE_RUNTIME_TEST !== '1' || !process.env.DB_NAME?.endsWith('_workspace_test')) throw Error('Isolated fixture only');
process.env.MAMAGE_DISTRIBUTED_RUNTIME = '1';
const { pool } = require('../../db');
const { createCoordinator } = require('../../lib/distributed_runtime');
const { taskError } = require('../../lib/background_task_failure');
let clock = Number(process.env.MAMAGE_TEST_CLOCK);
const runtime = createCoordinator({ db: pool, intervalMs: 25, now: () => clock, random: () => 0,
  onLeader: async () => process.send({ type: 'leader' }), onLost: () => process.exit(1) });
runtime.register('photo-description', 'retry-test', async (payload, meta) => {
  if (meta.attempt <= 3) throw taskError('DESCRIPTION_REVIEW_UNAVAILABLE', { stage: 'review', cause: { code: 'HUB_HTTP_503', httpStatus: 503 } });
  await pool.query("INSERT IGNORE INTO runtime_state(namespace,state_key,payload,expires_at) VALUES('retry-test-effect',?,'{}',?)", [String(payload.photoId), clock + 60000]);
});
process.on('message', message => { if (message.type === 'clock') { clock = message.now; void runtime.tick(); } });
runtime.start();
process.on('SIGTERM', () => { runtime.stop().then(() => pool.end()).then(() => process.exit(0)); });
process.on('disconnect', () => process.exit(1));
