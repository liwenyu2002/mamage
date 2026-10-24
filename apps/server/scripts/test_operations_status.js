const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createOperationsStatus, alertsFor, startOperationsMonitor } = require('../lib/operations_status');

test('status reports bounded aggregates, caches concurrent reads and never returns stored raw errors', async () => {
  let now = 2000000000000, calls = 0;
  const backup = { verified: true, createdAt: new Date(now).toISOString(), bytes: 1024 };
  const pool = { query: async ({ sql, timeout }) => {
    calls++; assert.ok(timeout <= 3000);
    if (sql.includes('GROUP BY ai_status')) return [[{ status: 'done', count: 9 }, { status: 'failed', count: 1 }]];
    if (sql.includes('FROM runtime_tasks')) return [[{ kind: 'face', status: 'queued', count: 1, oldestAgeSeconds: 4000 }]];
    if (sql.includes('original_filename')) return [[{ id: 1, projectId: 2, ai_error: "model secret-token not found" }]];
    if (sql.includes('runtime_task_failures')) return [[]];
    if (sql.includes('FROM photo_search_events')) return [[{ durationMs: 100, resultCount: 0 }, { durationMs: 300, resultCount: 1 }]];
    if (sql.includes('FROM runtime_state')) return [[{ stateKey: 'backup:latest', payload: JSON.stringify(backup) }]];
    throw new Error('Unexpected SQL');
  } };
  const status = createOperationsStatus({ pool, now: () => now,
    system: async () => ({ disk: { availableBytes: 5 * 1024 ** 3 } }), environment: {} });
  const [a, b] = await Promise.all([status.collect(), status.collect()]);
  assert.deepEqual(a, b); assert.equal(calls, 6);
  assert.equal(a.analysis.failed, 1); assert.equal(a.search.p95Ms, 300);
  assert.equal(a.failures[0].errorCode, 'LEGACY_MODEL_NOT_FOUND');
  assert.ok(!JSON.stringify(a).includes('secret-token'));
  assert.deepEqual(a.alerts.map(alert => alert.code), ['DISK_LOW', 'ANALYSIS_FAILED', 'QUEUE_STALLED']);
  await status.collect(); assert.equal(calls, 6);
  now += 11000; await status.collect(); assert.equal(calls, 12);
});

test('overdue backups alert without treating empty-result queries as search failures', () => {
  const status = { system: { disk: null }, analysis: { failed: 0 }, tasks: [], backup: null };
  assert.deepEqual(alertsFor(status).map(alert => alert.code), ['BACKUP_OVERDUE']);
  status.backup = { verified: true, createdAt: new Date().toISOString() };
  assert.deepEqual(alertsFor(status), []);
});

test('monitor runs only on the coordinator and stop waits for the last bounded write', async () => {
  let leader = false, writes = 0, samples = 0;
  const monitor = startOperationsMonitor({ pool: { query: async () => { writes++; } },
    status: { collect: async () => { samples++; return { alerts: [], checkedAt: 'synthetic' }; } },
    isLeader: () => leader, intervalMs: 60000, logger: { warn() {} } });
  monitor.tick(); assert.equal(samples, 0);
  leader = true; monitor.tick(); monitor.tick(); await monitor.stop();
  assert.equal(samples, 1); assert.equal(writes, 1);
  monitor.tick(); assert.equal(samples, 1);
});
