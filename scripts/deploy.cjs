const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { revision } = require('./deploy-lib.cjs');
const { checkPublish } = require('./check-publish.cjs');
const root = path.resolve(__dirname, '..');
const capture = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const run = (file, args) => execFileSync(file, args, { cwd: root, stdio: 'inherit' });
if (capture('branch', '--show-current') !== 'main') throw Error('Deploy from main only');
if (capture('status', '--porcelain')) throw Error('Commit changes before deployment; dirty releases are refused');
if (!/github\.com[:/]liwenyu2002\/mamage(?:\.git)?$/.test(capture('remote', 'get-url', 'origin'))) throw Error('Unexpected deployment repository');
const sha = revision(capture('rev-parse', 'HEAD'));
checkPublish(root);
const host = process.env.MAMAGE_DEPLOY_HOST || 'liwenyu@10.11.12.63';
if (!/^[a-zA-Z0-9_.@-]+$/.test(host)) throw Error('Invalid SSH destination');
run('git', ['push', 'origin', 'main']);
const bootstrap = `
const {execFileSync: run}=require('node:child_process');
const cwd=process.env.HOME+'/mamage';
const options={cwd,stdio:'inherit'};
if(run('git',['status','--porcelain'],{cwd,encoding:'utf8'}).trim())throw Error('Server checkout has local changes');
run('git',['fetch','origin','main'],options);
run('git',['merge','--ff-only',process.argv[2]],options);
run(process.execPath,[cwd+'/scripts/deploy-remote.cjs',process.argv[2]],options);
`;
execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host,
  `~/.local/bin/node - ${sha}`], { cwd: root, input: bootstrap, stdio: ['pipe', 'inherit', 'inherit'] });
