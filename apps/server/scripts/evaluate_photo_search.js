const fs = require('node:fs');
const { evaluatePhotoSearch } = require('../lib/photo_search_evaluation');

try {
  const [, , judgmentsPath, resultsPath, outputPath] = process.argv;
  if (!judgmentsPath || !resultsPath) throw Error('Usage: node scripts/evaluate_photo_search.js judgments.json results.json [report.json]');
  const judgments = JSON.parse(fs.readFileSync(judgmentsPath, 'utf8'));
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const report = evaluatePhotoSearch(judgments, results);
  if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report.summary, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
