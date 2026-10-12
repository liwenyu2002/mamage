const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { revision, replaceLink, readLink, dumpDatabase, processConfig, assertNoDataLoss } = require('./deploy-lib.cjs');
const { checkPublish } = require('./check-publish.cjs');
const home = os.homedir();
const repo = path.join(home, 'mamage');
const data = path.join(home, 'mamage-data');
const current = path.join(data, 'current');
const lock = path.join(data, 'deploy.lock');
const env = { ...process.env, PATH: `${home}/.local/bin:${home}/.npm-global/bin:/opt/homebrew/bin:/usr/bin:/bin` };
const pm2 = require(path.join(home, '.npm-global/lib/node_modules/pm2'));
const pm = (method, ...args) => new Promise((resolve, reject) => pm2[method](...args, (e, r) => e ? reject(e) : resolve(r)));
const run = (file, args, cwd) => execFileSync(file, args, { cwd, env, stdio: 'inherit' });
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });

async function healthy(url) {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return; } catch {}
    await sleep(1000);
  }
  throw Error(`Health check failed: ${url}`);
}

async function restore(previous) {
  if (previous.current) replaceLink(current, previous.current);
  else if (readLink(current)) fs.unlinkSync(current);
  if (previous.webDistBackup) {
    const dist = path.join(home, 'mamage-web/dist');
    if (fs.existsSync(dist) || readLink(dist)) {
      if (!fs.lstatSync(dist).isSymbolicLink()) throw Error('Unexpected frontend directory during rollback');
      fs.unlinkSync(dist);
    }
    fs.renameSync(previous.webDistBackup, dist);
  }
  for (const config of previous.processes) {
    if ((await pm('list')).some(p => p.name === config.name)) await pm('delete', config.name);
    await pm('start', config);
  }
  await healthy('http://127.0.0.1:8080/api/health');
  await healthy('http://127.0.0.1:8009/health');
  await pm('dump');
}

async function main() {
  fs.mkdirSync(data, { recursive: true });
  try { fs.mkdirSync(lock); } catch (e) { if (e.code === 'EEXIST') throw Error('Another deployment is running; do not remove its lock'); throw e; }
  let pool;
  try {
    await pm('connect');
    if (process.argv[2] === '--rollback') {
      const last = JSON.parse(fs.readFileSync(path.join(data, 'last-release.json'), 'utf8'));
      const rollbackFile = path.join(data, 'last-rollback.json');
      if (fs.existsSync(rollbackFile) && JSON.parse(fs.readFileSync(rollbackFile, 'utf8')).from === last.sha) {
        throw Error('This release was already rolled back');
      }
      const previous = JSON.parse(fs.readFileSync(path.join(last.backup, 'previous.json'), 'utf8'));
      await restore(previous);
      save(path.join(data, 'last-rollback.json'), { from: last.sha, at: new Date().toISOString() });
      console.log('Previous code restored; database was not rolled back.');
      return;
    }
    const sha = revision(process.argv[2]);
    if (!/github\.com[:/]liwenyu2002\/mamage(?:\.git)?$/.test(git('remote', 'get-url', 'origin'))) throw Error('Unexpected repository');
    if (git('status', '--porcelain')) throw Error('Server checkout is not clean');
    git('fetch', 'origin', 'main');
    git('merge-base', '--is-ancestor', sha, 'origin/main');
    checkPublish(repo);
    const id = `${sha.slice(0, 12)}-${Date.now()}`;
    const release = path.join(home, 'mamage-releases', id);
    const backup = path.join(home, 'mamage-backups', id);
    fs.mkdirSync(release, { recursive: true });
    fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
    console.log(`Preparing committed release ${sha}`);
    const archive = execFileSync('git', ['-C', repo, 'archive', sha], { env, maxBuffer: 64 * 1024 * 1024 });
    execFileSync('/usr/bin/tar', ['-xf', '-', '-C', release], { env, input: archive });
    const server = path.join(release, 'apps/server');
    const web = path.join(release, 'apps/web');
    for (const app of ['server', 'web']) {
      const config = path.join(data, 'config', `${app}.env`);
      if (!fs.existsSync(config)) throw Error(`Missing private ${app} configuration`);
      fs.symlinkSync(config, path.join(release, 'apps', app, '.env'));
      run('npm', ['ci', '--no-audit', '--no-fund'], path.join(release, 'apps', app));
    }
    env.MAMAGE_PUBLISH_ROOT = repo;
    run('npm', ['test'], release);
    run('npm', ['run', 'build'], release);
    const load = createRequire(path.join(server, 'package.json'));
    load('dotenv').config({ path: path.join(server, '.env'), override: true });
    process.env.NODE_ENV = 'production';
    load('./lib/validateEnv').validateEnvironment();
    const keys = load('./config/keys');
    pool = load('mysql2/promise').createPool({ host: keys.DB_HOST, port: keys.DB_PORT, user: keys.DB_USER,
      password: keys.DB_PASSWORD, database: keys.DB_NAME, connectionLimit: 2 });
    const counts = async () => (await pool.query(`SELECT p.organization_id,p.unit_id,
      COUNT(DISTINCT p.id) AS albums,COUNT(ph.id) AS photos FROM projects p
      LEFT JOIN photos ph ON ph.project_id=p.id GROUP BY p.organization_id,p.unit_id ORDER BY p.organization_id,p.unit_id`))[0];
    const before = await counts();
    save(path.join(backup, 'counts.json'), before);
    const [folders] = await pool.query('SELECT * FROM album_desktop_workspaces');
    save(path.join(backup, 'folders.json'), folders);
    fs.copyFileSync(path.join(server, '.env'), path.join(backup, 'server.env'));
    await dumpDatabase(path.join(backup, 'database.sql.gz'), keys);
    run('/usr/bin/gzip', ['-t', path.join(backup, 'database.sql.gz')], release);

    for (const name of ['logs', 'uploads']) {
      const target = path.join(data, name);
      fs.mkdirSync(target, { recursive: true });
      fs.symlinkSync(target, path.join(server, name));
    }
    const oldDist = path.join(home, 'mamage-web/dist');
    // Keep old hashed chunks for pages already open during the cutover.
    for (const name of fs.readdirSync(oldDist)) {
      if (/^bundle\..+\.(?:js|css)(?:\.map|\.LICENSE\.txt)?$/.test(name) && !fs.existsSync(path.join(web, 'dist', name))) {
        fs.copyFileSync(path.join(oldDist, name), path.join(web, 'dist', name));
      }
    }
    const processes = await pm('list');
    const api = processes.find(p => p.name === 'mamage-server');
    const face = processes.find(p => p.name === 'mamage-face-service');
    if (!api || !face) throw Error('Expected API and face services are missing');
    const previous = { current: readLink(current), processes: [processConfig(api), processConfig(face)] };
    const oldFace = path.join(face.pm2_env.pm_cwd, 'scripts/face_embed_service.py');
    const newFace = path.join(server, 'scripts/face_embed_service.py');
    const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const faceChanged = hash(oldFace) !== hash(newFace);
    save(path.join(backup, 'previous.json'), previous);
    let changed = false;
    try {
      changed = true;
      if (faceChanged) {
        await pm('delete', face.name);
        await pm('start', { ...processConfig(face), cwd: server });
        await healthy('http://127.0.0.1:8009/health');
      }
      const config = load('./ecosystem.config.js').apps.find(app => app.name === 'mamage-server');
      await pm('delete', api.name);
      await pm('start', { ...config, cwd: server, script: path.join(server, 'app.js'), interpreter: process.execPath });
      await healthy('http://127.0.0.1:8080/api/health');
      replaceLink(current, release);
      if (!fs.lstatSync(oldDist).isSymbolicLink()) {
        previous.webDistBackup = path.join(home, `mamage-web/dist.pre-monorepo-${id}`);
        save(path.join(backup, 'previous.json'), previous);
        fs.renameSync(oldDist, previous.webDistBackup);
        fs.symlinkSync(path.join(current, 'apps/web/dist'), oldDist);
      }
      run(process.execPath, [path.join(release, 'scripts/smoke-production.cjs'), server], release);
      assertNoDataLoss(before, await counts());
      await healthy('http://127.0.0.1:8009/health');
      await pm('dump');
      save(path.join(data, 'last-release.json'), { sha, release, backup, at: new Date().toISOString() });
      console.log(JSON.stringify({ deployed: sha, release, backup, faceService: faceChanged ? 'updated' : 'unchanged', data: 'verified' }));
    } catch (error) {
      if (changed) { console.error('Release verification failed; restoring previous code.'); await restore(previous); }
      throw error;
    }
  } finally {
    if (pool) await pool.end();
    pm2.disconnect();
    fs.rmdirSync(lock);
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
