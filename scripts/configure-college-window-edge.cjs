const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const HOST = '10.1.131.37';
const SITE = '/etc/nginx/sites-enabled/mamage-staging-callback';
const START = '# BEGIN MAMAGE COLLEGE WINDOW FEED';
const END = '# END MAMAGE COLLEGE WINDOW FEED';

function campusSite(source, { apiIP, webIP }) {
  for (const ip of [apiIP, webIP]) assert.ok(net.isIPv4(ip) && ip.startsWith('10.43.'), 'Expected a K3s ClusterIP');
  assert.ok(source.includes('listen ' + HOST + ':80;'), 'Not the school-only virtual host');
  assert.ok(source.includes('proxy_pass http://' + webIP + ';'), 'Unexpected current website upstream');
  const start = source.indexOf('    ' + START);
  const end = source.indexOf('    ' + END);
  assert.ok(start === -1 ? end === -1 : end > start, 'Incomplete managed block');
  if (start >= 0) source = source.slice(0, start) + source.slice(end + END.length + 5);
  const anchor = [...source.matchAll(/^    location \/ \{/gm)];
  assert.equal(anchor.length, 1, 'Campus website root must be unambiguous');
  const block = [
    '    ' + START,
    '    location ^~ /api/integrations/college-window/v1/ {',
    '        if ($host != ' + HOST + ') { return 404; }',
    '        allow 10.0.0.0/8;',
    '        deny all;',
    '        limit_except GET { deny all; }',
    '        proxy_pass http://' + apiIP + ':8080;',
    '        proxy_http_version 1.1;',
    '        proxy_set_header Host $host;',
    '        proxy_set_header Authorization $http_authorization;',
    '        proxy_set_header X-Forwarded-For "";',
    '        proxy_set_header Connection "";',
    '        proxy_cache off;',
    '        proxy_buffering off;',
    '        proxy_read_timeout 60s;',
    '    }',
    '    location ~ ^/college-window-feed/?$ {',
    '        if ($host != ' + HOST + ') { return 404; }',
    '        allow 10.0.0.0/8;',
    '        deny all;',
    '        proxy_pass http://' + webIP + ';',
    '        proxy_set_header Host $host;',
    '    }',
    '    ' + END, '',
  ].join('\n');
  const index = anchor[0].index;
  return source.slice(0, index) + block + source.slice(index);
}

function main() {
  const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 20000 });
  const sudo = (...args) => run('sudo', ['-n', ...args]);
  const service = name => {
    const result = JSON.parse(sudo('k3s', 'kubectl', '-n', 'mamage', 'get', 'service', name, '-o', 'json'));
    assert.equal(result.spec.type, 'ClusterIP');
    assert.ok(!result.spec.externalIPs?.length);
    return result.spec.clusterIP;
  };
  const dir = path.join(os.homedir(), 'mamage-deploy');
  const lock = path.join(dir, 'kubernetes-release.lock');
  const apply = process.argv.length === 3 && process.argv[2] === '--apply';
  assert.ok(apply || process.argv.length === 2, 'Use --apply to enable the feed after verification');
  const fd = apply ? fs.openSync(lock, 'wx', 0o600) : null;
  try {
    const ip = JSON.parse(run('ip', ['-j', '-4', 'address', 'show', 'scope', 'global']));
    assert.ok(ip.some(link => link.addr_info.some(address => address.local === HOST)), 'Not the MaMage campus host');
    const nginx = sudo('nginx', '-T');
    assert.doesNotMatch(nginx, /^[ \t]*(?:set_real_ip_from|real_ip_header)\b/m, 'Review the proxy trust chain before using this access rule');
    const target = sudo('readlink', '-f', SITE).trim();
    assert.match(target, /^\/etc\/nginx\/sites-(?:available|enabled)\/mamage-staging-callback$/);
    const before = sudo('cat', target);
    const after = campusSite(before, { apiIP: service('school-mamage-api'), webIP: service('school-mamage-web') });
    if (!apply || after === before) {
      console.log(JSON.stringify({ campusFeedReady: true, needsChange: after !== before }));
      return;
    }
    const archive = fs.mkdtempSync(path.join(dir, 'releases', 'college-window-edge-'));
    const backup = path.join(archive, 'nginx-site-before.conf');
    const candidate = path.join(archive, 'nginx-site-after.conf');
    fs.writeFileSync(backup, before, { mode: 0o600 });
    fs.writeFileSync(candidate, after, { mode: 0o600 });
    assert.equal(sudo('cat', target), before, 'The site changed during inspection');
    const temporary = '/etc/nginx/.mamage-college-window-' + process.pid;
    const replace = file => {
      sudo('install', '-m', '0644', file, temporary);
      sudo('mv', '-f', temporary, target);
    };
    replace(candidate);
    try {
      sudo('nginx', '-t');
      sudo('systemctl', 'reload', 'nginx');
    } catch (error) {
      replace(backup);
      sudo('nginx', '-t');
      sudo('systemctl', 'reload', 'nginx');
      throw error;
    }
    console.log(JSON.stringify({ campusFeedReady: true, needsChange: false, backup: archive }));
  } finally {
    if (fd !== null) { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { campusSite };
