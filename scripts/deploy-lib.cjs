const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { createGzip } = require('node:zlib');
const { spawn } = require('node:child_process');

function revision(value) {
  if (!/^[0-9a-f]{40}$/.test(value || '')) throw Error('A full committed revision is required');
  return value;
}

function replaceLink(link, target) {
  if (fs.existsSync(link) && !fs.lstatSync(link).isSymbolicLink()) throw Error(`Refusing to replace a directory: ${link}`);
  const temp = `${link}.next-${process.pid}`;
  fs.symlinkSync(target, temp);
  try { fs.renameSync(temp, link); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function readLink(link) {
  try { return fs.readlinkSync(link); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

async function dumpDatabase(file, keys, executable = '/opt/homebrew/bin/mysqldump') {
  const child = spawn(executable, ['--single-transaction', '--no-tablespaces', '--routines', '--triggers', '--set-gtid-purged=OFF',
    '--host', keys.DB_HOST, '--port', String(keys.DB_PORT || 3306), '--user', keys.DB_USER, keys.DB_NAME],
  { env: { ...process.env, MYSQL_PWD: keys.DB_PASSWORD || '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(Error(`Database backup failed: ${stderr}`)));
  });
  await Promise.all([done, pipeline(child.stdout, createGzip(), fs.createWriteStream(file, { mode: 0o600 }))]);
}

function processConfig(proc) {
  const env = proc.pm2_env;
  return {
    name: proc.name, script: env.pm_exec_path, cwd: env.pm_cwd, args: env.args,
    interpreter: env.exec_interpreter, exec_mode: env.exec_mode, instances: 1,
    env: env.env || {}, out_file: env.pm_out_log_path, error_file: env.pm_err_log_path,
    autorestart: env.autorestart, max_memory_restart: env.max_memory_restart,
    kill_timeout: env.kill_timeout || 5000,
  };
}

function assertNoDataLoss(before, after) {
  const actual = new Map(after.map(row => [`${row.organization_id}:${row.unit_id}`, row]));
  for (const row of before) {
    const found = actual.get(`${row.organization_id}:${row.unit_id}`);
    if (!found || found.albums < row.albums || found.photos < row.photos) throw Error('Album/photo count decreased; investigate release');
  }
}

function restorePlan(previous, running) {
  return [...previous].filter(config => {
    const proc = running.find(item => item.name === config.name);
    return !(config.name === 'mamage-face-service' && proc?.pm2_env.status === 'online'
      && proc.pm2_env.pm_cwd === config.cwd && proc.pm2_env.pm_exec_path === config.script);
  }).sort((a, b) => Number(b.name === 'mamage-face-service') - Number(a.name === 'mamage-face-service'));
}

function assertDiskSpace(available) {
  if (!Number.isFinite(available) || available < 3 * 1024 ** 3) throw Error('At least 3 GiB free space is required before deployment');
}

module.exports = { revision, replaceLink, readLink, dumpDatabase, processConfig, assertNoDataLoss, restorePlan, assertDiskSpace };
