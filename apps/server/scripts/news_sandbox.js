// Local-only integration environment: real routes, MySQL, workers and model calls.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const mysql = require('mysql2/promise');
const root = path.resolve(__dirname, '../../..');
const directory = path.join(root, '.local/news-live-backend-20261025');
const configFile = path.join(directory, 'sandbox.private.json');
const database = 'mamage_news_sandbox';
const dbPort = 13362, apiPort = 18192;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function privateJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 }); }
function config() {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(configFile)) privateJson(configFile, { database, rootPassword: crypto.randomBytes(32).toString('hex'),
    password: crypto.randomBytes(32).toString('hex'), jwt: crypto.randomBytes(48).toString('hex'), loginPassword: crypto.randomBytes(24).toString('hex') });
  const value = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (value.database !== database) throw Error('Refusing a non-sandbox database');
  return value;
}
function environment(settings) {
  // Never inherit production database, storage, Redis or mail credentials.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  for (const key of ['AI_TEXT_API_KEY', 'AI_TEXT_BASE_URL', 'AI_TEXT_MODEL', 'AI_NEWS_MODEL', 'AI_WECHAT_LAYOUT_MODEL']) if (process.env[key]) env[key] = process.env[key];
  return { ...env, NODE_ENV: 'development', DB_HOST: '127.0.0.1', DB_PORT: String(dbPort), DB_USER: 'news_sandbox', DB_PASSWORD: settings.password,
    DB_NAME: database, JWT_SECRET: settings.jwt, PORT: String(apiPort), ORGANIZATION_UNITS_ACTIVE: '1', DB_CONNECTION_LIMIT: '12',
    AI_TEXT_CONCURRENCY: '2', AI_REQUEUE_ON_BOOT: '0', AI_VALIDATE_ON_STARTUP: '0', REQUEST_LOGS: '0',
    WECHAT_MONITOR_ENABLED: '1',
    UPLOAD_BASE_URL: 'http://127.0.0.1:5192', UPLOAD_ABS_DIR: path.join(directory, 'uploads'),
    SMTP_ENABLED: '0', MAMAGE_NEWS_SANDBOX: '1' };
}
function detached(command, args, env, name) {
  const log = fs.openSync(path.join(directory, `${name}.log`), 'a', 0o600);
  const child = spawn(command, args, { cwd: root, env, detached: true, stdio: ['ignore', log, log] });
  child.unref(); fs.closeSync(log);
  return child.pid;
}
function runScript(file, env) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { cwd: root, env, encoding: 'utf8' });
  fs.appendFileSync(path.join(directory, 'bootstrap.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
  if (result.status !== 0) throw Error(`Sandbox bootstrap failed: ${file}; see private bootstrap.log`);
}
async function seed(db, settings) {
  const bcrypt = require('bcryptjs'), hashed = await bcrypt.hash(settings.loginPassword, 10);
  await db.query("INSERT IGNORE INTO organizations (id,name,slug,code) VALUES (900003,'写作测试组织','news-sandbox','NEWS-SANDBOX')");
  await db.query("INSERT IGNORE INTO organization_units (id,organization_id,slug,name) VALUES (900003,900003,'writing','写作测试小组')");
  for (const id of [900003, 900009]) {
    await db.query(`INSERT INTO users (id,student_no,name,email,role,password_hash,organization_id,active_unit_id)
      VALUES (?,?,?,?,'admin',?,900003,900003) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)`,
    [id, `news-sandbox-${id}`, '本地写作测试', `news-${id}@sandbox.invalid`, hashed]);
    await db.query("INSERT IGNORE INTO organization_unit_memberships (unit_id,user_id,role) VALUES (900003,?,'manager')", [id]);
  }
  for (const permission of ['ai.generate', 'projects.create', 'projects.update', 'photos.view', 'photos.edit', 'upload.photo']) {
    await db.query("INSERT IGNORE INTO role_permissions (role,permission) VALUES ('admin',?)", [permission]);
  }
  await db.query(`INSERT IGNORE INTO projects (id,uuid,name,description,event_date,admin_id,organization_id,unit_id)
    VALUES (9101,?,'学生实践交流（测试）','本地独立测试素材，不是生产相册','2026-10-25',900003,900003,900003)`, [crypto.randomUUID()]);
  const images = [1681,1682,1683,1685,1686,1687,1688,1689,1691,1693,1695,1696];
  for (let index = 0; index < images.length; index++) {
    const url = `/__news-qa/images/${images[index]}.jpg`;
    await db.query(`INSERT IGNORE INTO photos (id,uuid,project_id,url,thumb_url,title,description,tags,photographer_id,organization_id,unit_id,ai_status)
      VALUES (?,?,9101,?,?,?,?,?,900003,900003,900003,'done')`,
    [9201 + index, crypto.randomUUID(), url, url, `测试照片 ${index + 1}`, '室内交流现场，人物围桌讨论。', JSON.stringify(['室内', '交流'])]);
  }
}
async function start() {
  const settings = config(), env = environment(settings);
  if (!env.AI_TEXT_API_KEY || !env.AI_NEWS_MODEL) throw Error('Provide the writing model configuration in the process environment');
  const data = path.join(directory, 'mysql'), socket = path.join(directory, 'mysql.sock');
  const mysqld = process.env.MAMAGE_SANDBOX_MYSQLD || '/opt/homebrew/bin/mysqld';
  let db;
  try { db = await mysql.createConnection({ socketPath: socket, user: 'root', password: settings.rootPassword }); }
  catch {
    if (!fs.existsSync(path.join(data, 'auto.cnf'))) {
      fs.mkdirSync(data, { recursive: true, mode: 0o700 });
      const initialized = spawnSync(mysqld, ['--no-defaults', '--initialize-insecure', `--datadir=${data}`], { encoding: 'utf8' });
      if (initialized.status !== 0) throw Error('Isolated MySQL initialization failed');
    }
    const pid = detached(mysqld, ['--no-defaults', `--datadir=${data}`, `--socket=${socket}`, '--bind-address=127.0.0.1',
      `--port=${dbPort}`, '--mysqlx=OFF', '--skip-log-bin', '--innodb-buffer-pool-size=128M', '--max-connections=30'], process.env, 'mysql');
    for (let attempt = 0; attempt < 80 && !db; attempt++) {
      try { db = await mysql.createConnection({ socketPath: socket, user: 'root', password: settings.rootPassword }); }
      catch {
        try {
          db = await mysql.createConnection({ socketPath: socket, user: 'root' });
          await db.query('ALTER USER CURRENT_USER() IDENTIFIED BY ?', [settings.rootPassword]);
        } catch { await pause(250); }
      }
    }
    if (!db) throw Error(`Isolated MySQL not ready (pid ${pid}); see private mysql.log`);
  }
  try {
    await db.query(`CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await db.query("CREATE USER IF NOT EXISTS 'news_sandbox'@'127.0.0.1' IDENTIFIED BY ?", [settings.password]);
    await db.query(`GRANT ALL ON ${database}.* TO 'news_sandbox'@'127.0.0.1'`);
  } finally { await db.end(); }
  db = await mysql.createConnection({ host: '127.0.0.1', port: dbPort, user: 'news_sandbox', password: settings.password, database, multipleStatements: true });
  try {
    const [tables] = await db.query("SHOW TABLES LIKE 'users'");
    if (!tables.length) await db.query(fs.readFileSync(path.join(__dirname, '../db/mamage_schema_only.sql'), 'utf8'));
  } finally { await db.end(); }
  runScript('run_migrations.js', env);
  runScript('seed_channel_templates.js', env);
  db = await mysql.createConnection({ host: '127.0.0.1', port: dbPort, user: 'news_sandbox', password: settings.password, database });
  try { await seed(db, settings); } finally { await db.end(); }
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/health/ready`), health = await response.json();
    if (response.ok && health.sandbox === true) return { apiURL: `http://127.0.0.1:${apiPort}`, database, reused: true };
  } catch { /* no existing sandbox API */ }
  const apiPid = detached(process.execPath, [__filename, 'serve'], env, 'api');
  privateJson(path.join(directory, 'runtime.json'), { apiPid, database, apiPort, dbPort, startedAt: new Date().toISOString() });
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${apiPort}/api/health/ready`)).ok) return { apiPid, apiURL: `http://127.0.0.1:${apiPort}`, database }; }
    catch { /* wait for isolated API */ }
    await pause(250);
  }
  throw Error('Isolated news backend not ready; see private api.log');
}
function assertSandboxEnvironment(env) {
  if (env.MAMAGE_NEWS_SANDBOX !== '1' || env.DB_HOST !== '127.0.0.1'
    || env.DB_NAME !== database || env.DB_PORT !== String(dbPort)) throw Error('Refusing to run news sandbox against a non-isolated database');
}
async function serve() {
  assertSandboxEnvironment(process.env);
  const express = require('express'), { pool } = require('../db');
  const app = express(); app.disable('x-powered-by'); app.use(express.json({ limit: '9mb' }));
  app.get('/api/health/ready', async (_, res) => { await pool.query('SELECT 1'); res.json({ status: 'ready', sandbox: true }); });
  for (const [endpoint, module] of [['users', 'users'], ['projects', 'projects'], ['photos', 'photos'], ['ai/news', 'ai_news'],
    ['wechat-compositions', 'wechat_compositions'], ['wechat-style', 'wechat_style'], ['wechat-preview', 'wechat_preview'],
    ['wechat-monitor', 'wechat_monitor'],
    ['wx-img', 'wx_image_proxy'], ['favorites', 'user_favorites']]) app.use(`/api/${endpoint}`, require(`../routes/${module}`));
  app.use('/api', (_, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  app.use((error, _req, res, _next) => { console.error('[news-sandbox]', error.code || error.message); res.status(500).json({ error: 'SANDBOX_REQUEST_FAILED' }); });
  const server = app.listen(apiPort, '127.0.0.1');
  const worker = require('../lib/ai_job_worker'); worker.start();
  const monitor = require('../lib/wechat_monitor_worker'); monitor.start();
  const stop = async () => { server.close(); await worker.stop(); await monitor.stop(); await pool.end(); process.exit(0); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
module.exports = { database, directory, configFile, apiPort, dbPort, assertSandboxEnvironment, start, serve };
if (require.main === module) (process.argv[2] === 'serve' ? serve() : start().then(result => console.log(JSON.stringify(result))))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
