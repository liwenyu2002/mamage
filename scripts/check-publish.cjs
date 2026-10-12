const { execFileSync } = require('node:child_process');
function checkPublish(cwd) {
  const objects = execFileSync('git', ['rev-list', '--objects', 'main'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const paths = objects.split('\n').map(line => line.slice(line.indexOf(' ') + 1));
  const forbidden = paths.filter(file => /(?:^|\/)(?:PRODUCTION_READONLY_API\.md|\.env(?:\.(?!example$|sample$|template$)[^/]+)?|[^/]+\.pem)$/.test(file));
  if (forbidden.length) throw Error('Publish refused: private files occur in reachable history: ' + [...new Set(forbidden)].join(', '));
}
module.exports = { checkPublish };
if (require.main === module) { checkPublish(process.cwd()); console.log('Publish history guard passed'); }
