if (process.env.MAMAGE_RUNTIME_TEST !== '1' || !process.env.DB_NAME?.endsWith('_workspace_test')) throw Error('Isolated fixture only');
process.env.MAMAGE_DISTRIBUTED_RUNTIME = '1';
const { pool } = require('../../db');
const { createCoordinator } = require('../../lib/distributed_runtime');
const runtime = createCoordinator({ db: pool, intervalMs: 50,
  onLeader: async () => process.send({ type: 'leader' }),
  onLost: error => { console.error(error); process.exit(1); },
});
runtime.register('verification', 'verification', async payload => {
  process.send({ type: 'task-start', key: payload.key });
  if (process.env.MAMAGE_FIXTURE_HOLD === '1' && payload.hold) await new Promise(() => {});
  await new Promise(resolve => setTimeout(resolve, 40));
  await pool.query(`INSERT IGNORE INTO runtime_state (namespace, state_key, payload, expires_at)
    VALUES ('verification-effect', ?, ?, ?)`, [payload.key, JSON.stringify({ committed: true }), Date.now() + 60000]);
});
runtime.start();
process.on('SIGTERM', () => { runtime.stop().then(() => pool.end()).then(() => process.exit(0)); });
process.on('disconnect', () => process.exit(1));
