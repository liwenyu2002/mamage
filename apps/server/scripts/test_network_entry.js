const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const os = require('os');

process.env.JWT_SECRET = 'network-entry-test-secret';

const { pool } = require('../db');
const originalQuery = pool.query;
const originalNetworkInterfaces = os.networkInterfaces;
let server;

async function main() {
  pool.query = async (sql) => {
    if (sql.startsWith('SELECT role FROM users')) return [[{ role: 'photographer' }]];
    if (sql.startsWith('SELECT organization_id FROM users')) return [[{ organization_id: 1 }]];
    if (sql.startsWith('SELECT 1 FROM role_permissions')) return [[{ allowed: 1 }]];
    throw new Error(`Unexpected database query: ${sql}`);
  };
  os.networkInterfaces = () => ({
    en1: [{ family: 'IPv4', internal: false, address: '10.100.71.180' }],
  });

  const app = express();
  app.use('/api/network', require('../routes/network'));
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/network/lan/manual`;
  const token = jwt.sign({ id: 42 }, process.env.JWT_SECRET, { expiresIn: '5m' });

  const authenticated = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(authenticated.status, 410);
  const entry = await authenticated.json();
  assert.equal(entry.ok, false);
  assert.equal(entry.mode, 'intranet-only');
  assert.equal(entry.lanIp, undefined);
  assert.equal(entry.lanPort, undefined);

  process.env.KUBERNETES_SERVICE_HOST = '10.96.0.1';
  const podEntry = await (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(podEntry.ok, false, 'must not publish a Pod IP as the campus entry');
  process.env.LAN_ENTRY_HOST = 'gallery.campus.example';
  const configured = await (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(configured.lanIp, undefined, 'retired endpoints must never revive the old discovery flow');
  delete process.env.LAN_ENTRY_HOST;
  delete process.env.KUBERNETES_SERVICE_HOST;

  const anonymous = await fetch(url);
  assert.equal(anonymous.status, 401);
  const automatic = await fetch(url.replace('/manual', ''));
  assert.equal(automatic.status, 410);
  assert.equal((await automatic.json()).mode, 'intranet-only');
  console.log('retired network entry tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(async () => {
  pool.query = originalQuery;
  os.networkInterfaces = originalNetworkInterfaces;
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});
