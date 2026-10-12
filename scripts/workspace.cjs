const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const run = (args) => execFileSync('npm', args, { cwd: root, stdio: 'inherit' });
if (process.argv[2] === 'setup') {
  for (const app of ['server', 'web']) run(['--prefix', `apps/${app}`, 'ci', '--no-audit', '--no-fund']);
} else if (process.argv[2] === 'test') {
  run(['--prefix', 'apps/server', 'test']);
  run(['--prefix', 'apps/web', 'run', 'test:audit']);
  run(['run', 'test:deploy']);
} else throw Error('Use setup or test');
