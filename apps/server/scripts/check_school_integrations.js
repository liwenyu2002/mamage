const https = require('node:https');
const { schoolIntegrationReadiness } = require('../lib/school_integrations');

async function check() {
  const result = schoolIntegrationReadiness();
  if (result.https.configured) {
    result.https.verified = await new Promise(resolve => {
      const req = https.get(new URL('/api/health/ready', process.env.MAMAGE_PUBLIC_URL), { timeout: 10000 }, res => {
        res.resume(); resolve(res.statusCode === 200 && Boolean(res.socket.authorized));
      });
      req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }
  console.log(JSON.stringify(result));
  if (result.https.configured && !result.https.verified) process.exitCode = 1;
}
if (require.main === module) void check();
module.exports = { check };
