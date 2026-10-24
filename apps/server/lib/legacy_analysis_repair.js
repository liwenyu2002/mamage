async function repairLegacyAnalysis({ pool, analyze, buildUrl, ids, apply = false }) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 20 || !ids.every(id => Number.isSafeInteger(id) && id > 0)) throw Error('REPAIR_IDS_INVALID');
  const receipts = [];
  for (const id of [...new Set(ids)]) {
    const [rows] = await pool.query('SELECT id,url,ai_status,ai_error,ai_score,description,detailed_description,updated_at FROM photos WHERE id=?', [id]);
    const row = rows[0];
    if (!row || row.ai_status !== 'failed' || !/model.*not found/i.test(row.ai_error || '')
      || row.ai_score !== null || !row.description || !row.detailed_description) throw Error('REPAIR_PRECONDITION_FAILED');
    if (!apply) { receipts.push({ id, eligible: true, changed: false }); continue; }
    const result = await analyze(buildUrl(row.url));
    if (!Number.isFinite(result?.score) || !result.quality) throw Error('REPAIR_QUALITY_MISSING');
    const [update] = await pool.query(`UPDATE photos SET ai_score=?,ai_quality=?,ai_status='done',ai_error=NULL,ai_finished_at=NOW()
      WHERE id=? AND ai_status='failed' AND ai_error=? AND ai_score IS NULL AND url=? AND updated_at=?`,
    [Math.round(Math.max(0, Math.min(100, result.score))), JSON.stringify(result.quality), id, row.ai_error, row.url, row.updated_at]);
    if (update.affectedRows !== 1) throw Error('REPAIR_CONCURRENT_CHANGE');
    receipts.push({ id, changed: true, score: result.score, descriptionsPreserved: true, tagsPreserved: true, identitiesPreserved: true });
  }
  return receipts;
}
module.exports = { repairLegacyAnalysis };
