const assert = require('node:assert/strict');
const { test } = require('node:test');
const { protectionRules } = require('../lib/storage_protection');

test('storage policy preserves other owners rules and never expires completed original media', () => {
  const old = { ID: 'other-project', Status: 'Enabled', Filter: { Prefix: 'other/' }, Expiration: { Days: 400 } };
  const rules = protectionRules([old]);
  assert.deepEqual(rules[0], old);
  const originals = rules.find(rule => rule.ID === 'mamage-incomplete-uploads');
  assert.equal(originals.Filter.Prefix, 'uploads/');
  assert.equal(originals.AbortIncompleteMultipartUpload.DaysAfterInitiation, 7);
  assert.equal(originals.Expiration, undefined); assert.equal(originals.NoncurrentVersionExpiration, undefined);
  assert.ok(rules.filter(rule => rule.Expiration).every(rule => ['other/', 'backups/mamage/'].includes(rule.Filter.Prefix)));
  assert.equal(protectionRules(rules).length, rules.length);
});
