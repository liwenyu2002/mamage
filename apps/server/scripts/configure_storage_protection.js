const { configureStorageProtection } = require('../lib/storage_protection');
if (require.main === module) configureStorageProtection({ apply: process.argv.includes('--apply') })
  .then(result => console.log(JSON.stringify(result)))
  .catch(error => { console.error(error.name || error.code || 'STORAGE_PROTECTION_FAILED'); process.exitCode = 1; })
  .finally(() => require('../lib/cos_storage').ensureClient()?.destroy());
