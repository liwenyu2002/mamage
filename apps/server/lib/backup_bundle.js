const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');

const MAGIC = Buffer.from('MAMAGE-BACKUP-1\n');
const FILES = ['database.sql.gz', 'manifest.json', 'runtime-config.json'];

function readKey(value) {
  const key = Buffer.from(String(value || '').trim(), 'base64');
  if (key.length !== 32) throw new Error('BACKUP_KEY_INVALID');
  return key;
}

async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function command(file, args, options = {}) {
  const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let errorText = '';
  child.stderr.on('data', chunk => { errorText = (errorText + chunk).slice(-1000); });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error('BACKUP_ARCHIVE_FAILED')));
  });
  done.catch(() => {});
  return { child, done };
}

async function createBundle({ sqlPath, outputPath, key, runtimeConfig = {}, database, release = null }) {
  readKey(key);
  if (!/^[A-Za-z0-9_]+$/.test(database || '')) throw new Error('BACKUP_DATABASE_INVALID');
  const folder = await fsp.mkdtemp(path.join(path.dirname(outputPath), '.bundle-'));
  try {
    execFileSync('gzip', ['-t', sqlPath], { stdio: 'pipe' });
    const config = JSON.stringify(runtimeConfig);
    const manifest = { format: 1, createdAt: new Date().toISOString(), database, release,
      databaseSHA256: await digest(sqlPath), configSHA256: crypto.createHash('sha256').update(config).digest('hex') };
    await fsp.writeFile(path.join(folder, 'runtime-config.json'), config, { mode: 0o600 });
    await fsp.writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
    try { await fsp.link(sqlPath, path.join(folder, 'database.sql.gz')); }
    catch (error) {
      if (error.code !== 'EXDEV') throw error;
      await fsp.copyFile(sqlPath, path.join(folder, 'database.sql.gz'));
    }
    const iv = crypto.randomBytes(12);
    const header = Buffer.concat([MAGIC, iv]);
    const cipher = crypto.createCipheriv('aes-256-gcm', readKey(key), iv);
    cipher.setAAD(header);
    await fsp.writeFile(outputPath, header, { mode: 0o600, flag: 'wx' });
    const archive = command('tar', ['-cf', '-', '-C', folder, ...FILES]);
    try {
      await pipeline(archive.child.stdout, cipher, fs.createWriteStream(outputPath, { flags: 'a', mode: 0o600 }));
      await archive.done;
      await fsp.appendFile(outputPath, cipher.getAuthTag());
    } catch (error) {
      archive.child.kill('SIGTERM');
      await fsp.rm(outputPath, { force: true });
      throw error;
    }
    return { ...manifest, bytes: (await fsp.stat(outputPath)).size, sha256: await digest(outputPath) };
  } finally { await fsp.rm(folder, { recursive: true, force: true }); }
}

async function extractBundle({ inputPath, outputDirectory, key }) {
  const handle = await fsp.open(inputPath, 'r');
  const header = Buffer.alloc(MAGIC.length + 12);
  const tag = Buffer.alloc(16);
  let size;
  try {
    size = (await handle.stat()).size;
    if (size < header.length + 17) throw new Error('BACKUP_FORMAT_INVALID');
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, 16, size - 16);
  } finally { await handle.close(); }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('BACKUP_FORMAT_INVALID');
  const folder = await fsp.mkdtemp(path.join(path.dirname(outputDirectory), '.restore-'));
  const archive = path.join(folder, 'archive.tar');
  let created = false;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', readKey(key), header.subarray(MAGIC.length));
    decipher.setAAD(header); decipher.setAuthTag(tag);
    try {
      await pipeline(fs.createReadStream(inputPath, { start: header.length, end: size - 17 }),
        decipher, fs.createWriteStream(archive, { mode: 0o600, flags: 'wx' }));
    } catch { throw new Error('BACKUP_AUTHENTICATION_FAILED'); }
    const names = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split('\n').sort();
    if (JSON.stringify(names) !== JSON.stringify([...FILES].sort())) throw new Error('BACKUP_ARCHIVE_INVALID');
    const types = execFileSync('tar', ['-tvf', archive], { encoding: 'utf8' }).trim().split('\n');
    if (types.some(line => !line.startsWith('-'))) throw new Error('BACKUP_ARCHIVE_INVALID');
    await fsp.mkdir(outputDirectory, { mode: 0o700 });
    created = true;
    execFileSync('tar', ['-xf', archive, '-C', outputDirectory, '--no-same-owner', '--no-same-permissions'], { stdio: 'pipe' });
    for (const file of FILES) await fsp.chmod(path.join(outputDirectory, file), 0o600);
    const manifest = JSON.parse(await fsp.readFile(path.join(outputDirectory, 'manifest.json'), 'utf8'));
    if (await digest(path.join(outputDirectory, 'database.sql.gz')) !== manifest.databaseSHA256
      || await digest(path.join(outputDirectory, 'runtime-config.json')) !== manifest.configSHA256) {
      throw new Error('BACKUP_CONTENT_INVALID');
    }
    execFileSync('gzip', ['-t', path.join(outputDirectory, 'database.sql.gz')], { stdio: 'pipe' });
    return manifest;
  } catch (error) {
    if (created) await fsp.rm(outputDirectory, { recursive: true, force: true });
    throw error;
  } finally { await fsp.rm(folder, { recursive: true, force: true }); }
}

module.exports = { createBundle, extractBundle, digest, readKey };
