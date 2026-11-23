const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const load = createRequire(path.join(root, 'apps/server/package.json'));
const mysql = load('mysql2/promise');
const serverRoot = path.join(root, 'apps/server');
const suites = ['test_workspace_access', 'test_workspace_share', 'test_workspace_copy',
  'test_workspace_internal_share_route', 'test_workspace_video_assets', 'test_workspace_desktop', 'test_distributed_runtime'];

async function unusedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function main() {
  const args = process.argv.slice(2);
  const containerized = args.includes('--docker');
  const requested = args.filter(arg => arg !== '--docker');
  if (requested.some(test => !suites.includes(test))) throw Error('Pass workspace suite names or omit them to run all');
  const tests = requested.length ? requested : suites;
  if (fs.existsSync(path.join(serverRoot, '.env'))) {
    throw Error('Isolated tests refuse apps/server/.env. Run from a clean checkout without production settings.');
  }
  const scratch = path.join(root, '.local');
  fs.mkdirSync(scratch, { recursive: true });
  const directory = fs.mkdtempSync(path.join(scratch, 'workspace-db-'));
  const datadir = path.join(directory, 'data');
  const log = path.join(directory, 'mysql.log');
  const binary = process.env.MAMAGE_TEST_MYSQLD || 'mysqld';
  let daemon; let container; let conn; let exit; let passed = false;
  const execDocker = (args, options = {}) => execFileSync('docker', args, {
    encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'inherit'], ...options,
  }).trim();
  try {
    let port;
    let socketPath;
    const rootPassword = containerized ? crypto.randomBytes(24).toString('hex') : '';
    if (containerized) {
      const dockerfile = fs.readFileSync(path.join(root, 'deploy/docker/Dockerfile.mysql.compat'), 'utf8');
      const image = dockerfile.match(/^FROM (mysql:[^@\s]+@sha256:[a-f0-9]{64}) AS entrypoint$/m)?.[1];
      if (!image) throw Error('Expected the pinned MySQL image from Dockerfile.mysql.compat');
      container = execDocker(['run', '--detach', '--rm', '--publish', '127.0.0.1::3306',
        '--env', 'MYSQL_ROOT_HOST=%', '--env', 'MYSQL_ROOT_PASSWORD', image, '--mysqlx=OFF', '--skip-log-bin'],
      { env: { ...process.env, MYSQL_ROOT_PASSWORD: rootPassword } });
      port = Number(execDocker(['port', container, '3306/tcp']).match(/^127\.0\.0\.1:(\d+)$/)?.[1]);
      if (!port) throw Error('Expected an isolated loopback port for the MySQL container');
    } else {
      const init = spawnSync(binary, ['--no-defaults', '--initialize-insecure', `--datadir=${datadir}`, `--log-error=${log}`],
        { stdio: 'inherit', timeout: 120000 });
      if (init.error) throw init.error;
      if (init.status !== 0) throw Error(`Isolated MySQL initialization failed; inspect ${log}`);
      port = await unusedPort();
      socketPath = path.join(directory, 'mysql.sock');
      daemon = spawn(binary, ['--no-defaults', `--datadir=${datadir}`, `--socket=${socketPath}`,
        `--pid-file=${directory}/mysql.pid`, `--log-error=${log}`, `--port=${port}`,
        '--bind-address=127.0.0.1', '--mysqlx=OFF', '--skip-log-bin'], { stdio: 'inherit' });
      exit = new Promise((resolve) => {
        daemon.once('exit', resolve);
        daemon.once('error', (error) => { console.error('Isolated MySQL failed:', error.code); resolve(); });
      });
    }
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try { conn = await mysql.createConnection({ host: '127.0.0.1', port, socketPath, user: 'root', password: rootPassword,
        connectTimeout: 1000, multipleStatements: true }); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 250)); }
      if (daemon && (!daemon.pid || daemon.exitCode !== null)) break;
    }
    if (!conn) throw Error(`Isolated MySQL was not ready; inspect ${log}`);
    const name = `mamage_${crypto.randomBytes(5).toString('hex')}_workspace_test`;
    const password = crypto.randomBytes(24).toString('hex');
    await conn.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`);
    await conn.changeUser({ database: name });
    await conn.query(fs.readFileSync(path.join(serverRoot, 'db/mamage_schema_only.sql'), 'utf8'));
    await conn.query("CREATE USER 'mamage_test'@'%' IDENTIFIED BY ?", [password]);
    await conn.query(`GRANT ALL PRIVILEGES ON \`${name}\`.* TO 'mamage_test'@'%'`);
    const env = { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, TZ: 'UTC', NODE_ENV: 'test', MAMAGE_CONTAINER: '0',
      MAMAGE_DISTRIBUTED_RUNTIME: '0',
      DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_USER: 'mamage_test', DB_PASSWORD: password, DB_NAME: name,
      JWT_SECRET: 'isolated-workspace-verification-only-not-production',
      COS_SECRET_ID: '', COS_SECRET_KEY: '', COS_BUCKET: '', COS_BASE_URL: '',
      REDIS_URL: '', AI_VISION_PROVIDER: 'off', VIDEO_TRANSCRIPT_ENABLED: '0',
      AI_REQUEUE_ON_BOOT: '0', VIDEO_RENDER_RECOVER_ON_BOOT: '0',
      VIDEO_WORK_DIR: path.join(directory, 'video-work'), UPLOAD_ABS_DIR: path.join(directory, 'uploads'),
      UPLOAD_BASE_URL: 'http://127.0.0.1:1/api/image',
      INTERNAL_UPLOAD_BASE_URL: 'http://127.0.0.1:1/api/image' };
    async function run(args) {
      const child = spawn(process.execPath, args, { cwd: serverRoot, env, stdio: 'inherit' });
      const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
      try {
        const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
        if (status !== 0) throw Error(`${args[0]} failed with status ${status}`);
      } finally { clearTimeout(timer); }
    }
    await run(['scripts/run_migrations.js']);
    for (const test of tests) await run([`scripts/${test}.js`]);
    console.log(`Isolated workspace/distributed integration: all ${tests.length} suites passed; no production database used.`);
    passed = true;
  } finally {
    if (conn) await conn.end().catch(() => {});
    if (container) {
      try {
        if (!passed) fs.writeFileSync(log, execDocker(['logs', container], { stdio: ['ignore', 'pipe', 'pipe'] }));
      } finally { execDocker(['stop', '--time', '5', container]); }
    }
    if (daemon?.pid && daemon.exitCode === null && daemon.signalCode === null) {
      daemon.kill('SIGTERM');
      const timer = setTimeout(() => daemon.kill('SIGKILL'), 15000);
      await exit; clearTimeout(timer);
    }
    if (passed) fs.rmSync(directory, { recursive: true, force: true });
    else console.error(`Failed verification logs retained locally: ${directory}`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
