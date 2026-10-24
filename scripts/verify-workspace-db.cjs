const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const load = createRequire(path.join(root, 'apps/server/package.json'));
const mysql = load('mysql2/promise');

async function unusedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function main() {
  const scratch = path.join(root, '.local');
  fs.mkdirSync(scratch, { recursive: true });
  const directory = fs.mkdtempSync(path.join(scratch, 'workspace-db-'));
  const datadir = path.join(directory, 'data');
  const log = path.join(directory, 'mysql.log');
  const binary = process.env.MAMAGE_TEST_MYSQLD || 'mysqld';
  let daemon; let conn; let exit; let passed = false;
  try {
    const init = spawnSync(binary, ['--no-defaults', '--initialize-insecure', `--datadir=${datadir}`, `--log-error=${log}`],
      { stdio: 'inherit', timeout: 120000 });
    if (init.error) throw init.error;
    if (init.status !== 0) throw Error(`Isolated MySQL initialization failed; inspect ${log}`);
    const port = await unusedPort();
    daemon = spawn(binary, ['--no-defaults', `--datadir=${datadir}`, `--socket=${directory}/mysql.sock`,
      `--pid-file=${directory}/mysql.pid`, `--log-error=${log}`, `--port=${port}`,
      '--bind-address=127.0.0.1', '--mysqlx=OFF', '--skip-log-bin'], { stdio: 'inherit' });
    exit = new Promise(resolve => daemon.once('exit', resolve));
    daemon.once('error', error => console.error('Isolated MySQL failed:', error.code));
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try { conn = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: '',
        connectTimeout: 1000, multipleStatements: true }); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 250)); }
      if (daemon.exitCode !== null) break;
    }
    if (!conn) throw Error(`Isolated MySQL was not ready; inspect ${log}`);
    const name = `mamage_${crypto.randomBytes(5).toString('hex')}_workspace_test`;
    await conn.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`);
    await conn.changeUser({ database: name });
    await conn.query(fs.readFileSync(path.join(root, 'apps/server/db/mamage_schema_only.sql'), 'utf8'));
    const env = { ...process.env, NODE_ENV: 'test', MAMAGE_CONTAINER: '0',
      MAMAGE_DISTRIBUTED_RUNTIME: '0',
      DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_USER: 'root', DB_PASSWORD: '', DB_NAME: name,
      JWT_SECRET: 'isolated-workspace-verification-only-not-production',
      COS_SECRET_ID: '', COS_SECRET_KEY: '', COS_BUCKET: '', COS_BASE_URL: '',
      REDIS_URL: '', AI_VISION_PROVIDER: 'off', VIDEO_TRANSCRIPT_ENABLED: '0',
      AI_REQUEUE_ON_BOOT: '0', VIDEO_RENDER_RECOVER_ON_BOOT: '0',
      VIDEO_WORK_DIR: path.join(directory, 'video-work'), UPLOAD_ABS_DIR: path.join(directory, 'uploads'),
      UPLOAD_BASE_URL: 'http://127.0.0.1:1/api/image',
      INTERNAL_UPLOAD_BASE_URL: 'http://127.0.0.1:1/api/image' };
    async function run(args) {
      const child = spawn(process.execPath, args, { cwd: path.join(root, 'apps/server'), env, stdio: 'inherit' });
      const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
      try {
        const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
        if (status !== 0) throw Error(`${args[0]} failed with status ${status}`);
      } finally { clearTimeout(timer); }
    }
    await run(['scripts/run_migrations.js']);
    for (const test of ['test_workspace_access', 'test_workspace_share', 'test_workspace_copy',
      'test_workspace_internal_share_route', 'test_workspace_video_assets', 'test_workspace_desktop', 'test_distributed_runtime']) await run([`scripts/${test}.js`]);
    console.log('Isolated workspace/distributed integration: all 7 suites passed; no production database used.');
    passed = true;
  } finally {
    if (conn) await conn.end().catch(() => {});
    if (daemon && daemon.exitCode === null) {
      daemon.kill('SIGTERM');
      const timer = setTimeout(() => daemon.kill('SIGKILL'), 15000);
      await exit; clearTimeout(timer);
    }
    if (passed) fs.rmSync(directory, { recursive: true, force: true });
    else console.error(`Failed verification logs retained locally: ${directory}`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
