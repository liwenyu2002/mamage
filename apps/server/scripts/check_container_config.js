const { checkContainerConfig } = require('../lib/container_config');
const errors = checkContainerConfig();
if (errors.length) {
  console.error('Container configuration rejected:\n' + errors.map(error => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else console.log('Container configuration: valid (network/model availability not checked)');
