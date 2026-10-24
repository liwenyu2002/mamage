const { repairLegacyAnalysis } = require('../lib/legacy_analysis_repair');
async function main() {
  const args = process.argv.slice(2);
  const value = args.find(arg => arg.startsWith('--ids='));
  const ids = value ? value.slice(6).split(',').map(Number) : [];
  const { pool, buildInternalMediaUrl } = require('../db');
  try {
    const { analyzePhoto } = require('../ai_function/ai_for_tags/ai_for_tags');
    console.log(JSON.stringify(await repairLegacyAnalysis({ pool, analyze: analyzePhoto, buildUrl: buildInternalMediaUrl, ids, apply: args.includes('--apply') })));
  } finally { await pool.end(); require('../lib/cos_storage').ensureClient()?.destroy(); }
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
