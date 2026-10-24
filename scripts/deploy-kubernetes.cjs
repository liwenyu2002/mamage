const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkPublish } = require('./check-publish.cjs');
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
function targetOptions(env = process.env) {
  const host = env.MAMAGE_DEPLOY_HOST || 'ubuntu@10.1.131.37';
  const namespace = env.MAMAGE_NAMESPACE || 'mamage';
  const release = env.MAMAGE_RELEASE || 'school';
  if (!/^[a-zA-Z0-9_.@-]+$/.test(host) || ![namespace, release].every(s => /^[a-z][a-z0-9-]{0,45}$/.test(s))) throw Error('Invalid deployment target');
  const base = env.MAMAGE_COMPAT_BASE_IMAGE || '';
  if (base && !/^(?:[a-zA-Z0-9._/:@-]+@)?sha256:[a-f0-9]{64}$/.test(base)) throw Error('Compatibility base must be digest-pinned');
  return { host, namespace, release, base, compatibility: env.MAMAGE_COMPAT_BUILD !== '0' };
}
function main() {
  const root = path.resolve(__dirname, '..');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const run = (name, args, options = {}) => execFileSync(name, args, { cwd: root, stdio: 'inherit', ...options });
  if (git('branch', '--show-current') !== 'main' || git('status', '--porcelain')) throw Error('Deploy only a clean, committed main');
  const sha = git('rev-parse', 'HEAD');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Invalid revision');
  if (!/github\.com[:/]liwenyu2002\/mamage(?:\.git)?$/.test(git('remote', 'get-url', 'origin'))) throw Error('Unexpected repository');
  checkPublish(root);
  const target = targetOptions();
  if (!process.argv.includes('--skip-push')) for (const remote of ['origin', 'gitee']) run('git', ['push', remote, 'main']);
  const sshArgs = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', target.host];
  const ssh = (command, input) => run('ssh', [...sshArgs, command], input === undefined ? {} : { input, stdio: ['pipe', 'inherit', 'inherit'] });
  const image = target.base || 'mamage-api:bootstrap';
  ssh(`test -x ~/.local/bin/node || { mkdir -p ~/.local/bin; c=$(sudo docker create ${quote(image)}); sudo docker cp "$c":/usr/local/bin/node ~/.local/bin/node; sudo docker rm "$c"; sudo chown "$(id -u):$(id -g)" ~/.local/bin/node; }`);
  const directory = `/home/${target.host.includes('@') ? target.host.split('@')[0] : 'ubuntu'}/mamage-releases/${sha}-${Date.now()}`;
  ssh(`umask 077; mkdir -p ${quote(directory)}`);
  const archive = execFileSync('git', ['archive', sha], { cwd: root, maxBuffer: 128 * 1024 ** 2 });
  ssh(`tar -xf - -C ${quote(directory)}`, archive);
  const values = process.env.MAMAGE_HELM_VALUES;
  if (values) {
    JSON.parse(fs.readFileSync(values, 'utf8'));
    ssh(`umask 077; dd of=${quote(directory + '/release-values.private.json')} status=none`, fs.readFileSync(values));
  }
  ssh(`~/.local/bin/node ${quote(directory + '/scripts/deploy-kubernetes-remote.cjs')} ${quote(sha)} ${quote(JSON.stringify({ ...target, values: Boolean(values) }))}`);
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { quote, targetOptions, main };
