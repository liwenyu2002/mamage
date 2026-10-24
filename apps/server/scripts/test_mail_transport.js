const assert = require('node:assert/strict');
const { test } = require('node:test');
const nodemailer = require('nodemailer');
const mock = (name, exports) => { const id = require.resolve(name); require.cache[id] = { id, filename: id, loaded: true, exports }; };
const inserted = [];
mock('../db', { pool: { query: async (sql, params) => {
  if (sql.startsWith('SELECT id,')) return [[]];
  if (sql.startsWith('SELECT COUNT')) return [[{ cnt: 0 }]];
  if (sql.startsWith('INSERT INTO')) { inserted.push(params); return [{ insertId: inserted.length }]; }
  if (sql.startsWith('DELETE')) return [{ affectedRows: 1 }];
  throw Error('Unexpected SQL');
} } });
mock('../config/keys', { JWT_SECRET: 'test-only-mail-signing-secret-at-least-32-chars' });
process.env.SMTP_HOST = 'smtp.example.test'; process.env.SMTP_USER = 'sender@example.test'; process.env.SMTP_PASS = 'fixture-only';
const create = nodemailer.createTransport;
let compiled;
let sent;
nodemailer.createTransport = options => {
  assert.equal(options.host, 'smtp.example.test');
  const transport = create({ streamTransport: true, buffer: true });
  const send = transport.sendMail.bind(transport);
  transport.sendMail = async mail => { sent = mail; const result = await send(mail); compiled = result.message; return result; };
  return transport;
};

test('upgraded mail library compiles a real registration email without SMTP/network or real database access', async () => {
  try {
    const { sendVerificationCode } = require('../lib/email_verification');
    const result = await sendVerificationCode({ email: 'Tester@Example.test' });
    assert.equal(result.email, 'tester@example.test');
    assert.equal(sent.to, 'tester@example.test');
    assert.ok(/\d{6}/.test(sent.text));
    assert.ok(Buffer.isBuffer(compiled) && compiled.length > 100);
    assert.match(inserted[0][2], /^[a-f0-9]{64}$/);
    assert.ok(!inserted[0].includes(sent.text.match(/\d{6}/)[0]), 'database stores the code hash, not the plaintext code');
  } finally { nodemailer.createTransport = create; }
});
