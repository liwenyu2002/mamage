const assert = require('node:assert/strict');
const { test } = require('node:test');
const { campusSite } = require('./configure-college-window-edge.cjs');

const upstream = { apiIP: '10.43.12.1', webIP: '10.43.12.2' };
const existing = [
  'server {', '    listen 10.1.131.37:80;', '    server_name 10.1.131.37;',
  '    location / {', '        proxy_pass http://10.43.12.2;', '    }', '}', '',
].join('\n');

test('adds a subnet- and host-gated read-only route without changing the existing site', () => {
  const output = campusSite(existing, upstream);
  assert.match(output, /location \^~ \/api\/integrations\/college-window\/v1\//);
  assert.match(output, /location ~ \^\/college-window-feed\//);
  assert.equal((output.match(/if \(\$host != 10\.1\.131\.37\)/g) || []).length, 2);
  assert.equal((output.match(/allow 10\.0\.0\.0\/8;/g) || []).length, 2);
  assert.match(output, /limit_except GET \{ deny all; \}/);
  assert.match(output, /proxy_pass http:\/\/10\.43\.12\.1:8080;/);
  assert.match(output, /proxy_set_header X-Forwarded-For "";/);
  assert.equal(output.slice(output.indexOf('    location / {')), existing.slice(existing.indexOf('    location / {')));
  assert.equal(campusSite(output, upstream), output);
});

test('refuses a different host, an external upstream or an ambiguous site', () => {
  assert.throws(() => campusSite(existing.replace('10.1.131.37:80', '80'), upstream));
  assert.throws(() => campusSite(existing, { ...upstream, apiIP: '192.0.2.1' }));
  assert.throws(() => campusSite(existing + existing, upstream));
});
