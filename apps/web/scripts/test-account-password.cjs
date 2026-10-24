const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const sourcePath = process.argv[2] || path.resolve(__dirname, '../src/AccountPage.jsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
let handler;
traverse(ast, {
  VariableDeclarator(nodePath) {
    if (nodePath.node.id.name === 'handleChangePassword') handler = nodePath.node.init;
  }
});
assert.ok(handler, 'Password handler must exist');

async function run(newPassword, currentPassword = 'Oldpass123', response = { status: 200 }) {
  const result = { requests: [], messages: [], loading: [], current: null, next: null, success: [] };
  const changePassword = vm.runInNewContext(`(${source.slice(handler.start, handler.end)})`, {
    newPassword,
    currentPassword,
    setPwdMessage: value => result.messages.push(value),
    setPwdLoading: value => result.loading.push(value),
    setCurrentPassword: value => { result.current = value; },
    setNewPassword: value => { result.next = value; },
    localStorage: { getItem: () => 'test-token' },
    Toast: { success: value => result.success.push(value) },
    console,
    fetch: async (url, options) => {
      result.requests.push({ url, ...options, body: JSON.parse(options.body) });
      if (response.networkError) throw new Error('test network error');
      return { status: response.status, ok: response.status === 200, json: async () => response.data || {} };
    }
  });
  await changePassword();
  return result;
}

(async () => {
  for (const password of ['', 'abc123', 'abc1234', '12345678', 'abcdefgh', 'abc12345!', ' abc12345', 'abc12345 ', 'abcdefgh123456789', 'abc123\u4e2d\u6587']) {
    const result = await run(password);
    assert.equal(result.requests.length, 0, `Invalid password ${JSON.stringify(password)} must not reach backend`);
    assert.ok(result.messages.at(-1), 'Invalid input must show a message');
  }
  for (const password of ['abcd1234', 'abcdefgh12345678', 'A1234567']) {
    const result = await run(password);
    assert.equal(result.requests.length, 1);
    assert.equal(result.requests[0].body.newPassword, password);
    assert.equal(result.requests[0].url, '/api/users/me/password');
    assert.equal(result.requests[0].headers.Authorization, 'Bearer test-token');
    assert.equal(result.current, '');
    assert.equal(result.next, '');
    assert.deepEqual(result.loading, [true, false]);
  }
  const exact = await run('abcd1234', ' Oldpass123 ');
  assert.equal(exact.requests[0].body.currentPassword, ' Oldpass123 ', 'Current password must not be silently trimmed');
  const first = await run('abcd1234', '');
  assert.equal(Object.hasOwn(first.requests[0].body, 'currentPassword'), false);
  for (const [status, error, message] of [
    [400, 'MISSING_CURRENT_PASSWORD', '\u8bf7\u8f93\u5165\u5f53\u524d\u5bc6\u7801'],
    [400, 'INVALID_PASSWORD', '\u5bc6\u7801\u987b\u4e3a8-16\u4f4d\uff0c\u4e14\u4e3a\u5b57\u6bcd\u548c\u6570\u5b57\u7684\u7ec4\u5408'],
    [401, 'INVALID_CURRENT_PASSWORD', '\u5f53\u524d\u5bc6\u7801\u9519\u8bef\uff0c\u8bf7\u91cd\u65b0\u8f93\u5165']
  ]) {
    const result = await run('abcd1234', 'Oldpass123', { status, data: { error, ...(error === 'INVALID_PASSWORD' ? { message } : {}) } });
    assert.equal(result.messages.at(-1), message);
    assert.equal(result.next, null, 'Failed attempts must preserve input');
    assert.equal(result.loading.at(-1), false);
  }
  assert.doesNotMatch(source, /\u81f3\u5c11\s*6\s*\u4f4d|\u5c11\u4e8e\s*6\s*\u4f4d/);
  assert.match(source, /8\u201316 \u4f4d\uff0c\u9700\u540c\u65f6\u5305\u542b\u5b57\u6bcd\u548c\u6570\u5b57/);
  console.log('PASS: password policy, exact payload, first setup, Chinese errors, success and form copy');
})().catch(error => { console.error(error); process.exitCode = 1; });
