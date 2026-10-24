const crypto = require('node:crypto');
const { GetBucketVersioningCommand, PutBucketVersioningCommand,
  GetBucketLifecycleConfigurationCommand, PutBucketLifecycleConfigurationCommand } = require('@aws-sdk/client-s3');

function protectionRules(existing = []) {
  const additions = [
    { ID: 'mamage-incomplete-uploads', Status: 'Enabled', Filter: { Prefix: 'uploads/' },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 } },
    { ID: 'mamage-encrypted-backups', Status: 'Enabled', Filter: { Prefix: 'backups/mamage/' },
      Expiration: { Days: 35 }, NoncurrentVersionExpiration: { NoncurrentDays: 35 },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
  ];
  return [...existing.filter(rule => !additions.some(next => next.ID === rule.ID)), ...additions];
}

function lifecycleCommand(Bucket, Rules) {
  const command = new PutBucketLifecycleConfigurationCommand({ Bucket, LifecycleConfiguration: { Rules } });
  // Older S3-compatible stores require Content-MD5 in addition to SDK checksums.
  command.middlewareStack.add(next => async args => {
    const body = args.request.body;
    if (typeof body !== 'string' && !Buffer.isBuffer(body)) throw new Error('LIFECYCLE_BODY_INVALID');
    args.request.headers['content-md5'] = crypto.createHash('md5').update(body).digest('base64');
    return next(args);
  }, { step: 'build', name: 'mamageLifecycleMD5', priority: 'low' });
  return command;
}

async function configureStorageProtection({ storage = require('./cos_storage'), apply = false } = {}) {
  const client = storage.ensureClient(), Bucket = storage.getBucket();
  if (!client || !Bucket) throw new Error('STORAGE_NOT_CONFIGURED');
  const beforeVersion = await client.send(new GetBucketVersioningCommand({ Bucket }));
  let existing = [];
  try { existing = (await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket }))).Rules || []; }
  catch (error) { if (error.name !== 'NoSuchLifecycleConfiguration') throw error; }
  if (!apply) return { versioning: beforeVersion.Status || 'not-enabled', rules: existing };
  if (beforeVersion.Status !== 'Enabled') await client.send(new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }));
  await client.send(lifecycleCommand(Bucket, protectionRules(existing)));
  const afterVersion = await client.send(new GetBucketVersioningCommand({ Bucket }));
  const rules = (await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket }))).Rules || [];
  return { versioning: afterVersion.Status, rules, existingRuleCount: existing.length, objectsDeletedByCommand: false };
}

module.exports = { configureStorageProtection, protectionRules, lifecycleCommand };
