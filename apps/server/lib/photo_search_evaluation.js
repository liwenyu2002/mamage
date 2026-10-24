function idsFromRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => String(row && typeof row === 'object' ? row.id : row)).filter(id => id && id !== 'undefined' && id !== 'null');
}

function percentile(values, percent) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * percent) - 1)];
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function latencyStats(runs) {
  const values = runs.map(run => run.elapsedMs).filter(value => Number.isFinite(value) && value >= 0);
  return { measured: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95) };
}

function validateDataset(dataset) {
  if (dataset?.schemaVersion !== 1 || !Array.isArray(dataset.corpusPhotoIds) || !Array.isArray(dataset.queries)) {
    throw Error('Expected schemaVersion=1, corpusPhotoIds and queries');
  }
  const corpus = new Set(idsFromRows(dataset.corpusPhotoIds));
  if (!corpus.size || corpus.size !== dataset.corpusPhotoIds.length) throw Error('Corpus IDs must be unique and nonempty');
  const queryIds = new Set();
  for (const query of dataset.queries) {
    if (!query.id || queryIds.has(String(query.id))) throw Error('Query IDs must be unique and nonempty');
    queryIds.add(String(query.id));
    for (const [id, grade] of Object.entries(query.grades || {})) {
      if (!corpus.has(id) || !Number.isInteger(grade) || grade < 0 || grade > 3) throw Error('Grades must reference corpus IDs and use integers 0..3');
    }
    for (const key of ['allowedPhotoIds', 'excludedPhotoIds']) {
      if (query[key] !== undefined && (!Array.isArray(query[key]) || idsFromRows(query[key]).some(id => !corpus.has(id)))) {
        throw Error(`${key} must contain corpus IDs`);
      }
    }
    if (query.judgmentsComplete === true && Object.keys(query.grades || {}).length !== corpus.size) {
      throw Error('Complete judgments must explicitly grade every corpus photo, including zero grades');
    }
  }
  return corpus;
}

function evaluatePhotoSearch(dataset, results) {
  const corpus = validateDataset(dataset);
  const queries = new Map(dataset.queries.map(query => [String(query.id), query]));
  const runs = (Array.isArray(results) ? results : []).filter(result => !result.type || result.type === 'case').map(result => {
    const query = queries.get(String(result.id));
    if (!query) throw Error(`Missing judgments for query ${result.id}`);
    const rawIds = idsFromRows(result.list || result.photoIds);
    const ids = [...new Set(rawIds)];
    const outsideCorpus = ids.filter(id => !corpus.has(id));
    const grades = query.grades || {};
    const top10 = ids.slice(0, 10);
    const positiveIds = Object.keys(grades).filter(id => grades[id] > 0);
    const judgedTop10 = top10.filter(id => Object.hasOwn(grades, id));
    const responseOk = !result.error && (result.status === undefined || result.status === 200)
      && (Array.isArray(result.list) || Array.isArray(result.photoIds));
    const measurable = query.judgmentsComplete === true && !outsideCorpus.length && responseOk;
    const hasRelevant = positiveIds.length > 0;
    const hitsAt10 = top10.filter(id => grades[id] > 0).length;
    const hitsAt50 = ids.slice(0, 50).filter(id => grades[id] > 0).length;
    const dcg = values => values.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
    const ideal = dcg(Object.values(grades).sort((a, b) => b - a).slice(0, 10));
    const allowed = query.allowedPhotoIds === undefined ? null : new Set(idsFromRows(query.allowedPhotoIds));
    const excluded = new Set(idsFromRows(query.excludedPhotoIds));
    const hardViolations = ids.filter(id => (allowed && !allowed.has(id)) || excluded.has(id));
    return {
      id: String(result.id), query: query.q, category: query.category || 'uncategorized', responseOk,
      returned: rawIds.length, duplicateIds: rawIds.length - ids.length, outsideCorpus,
      judgmentsComplete: query.judgmentsComplete === true,
      judgedTop10: judgedTop10.length, returnedTop10: top10.length,
      precisionAt10: measurable && hasRelevant ? hitsAt10 / 10 : null,
      recallAt50: measurable && hasRelevant ? hitsAt50 / positiveIds.length : null,
      ndcgAt10: measurable && ideal > 0 ? dcg(top10.map(id => grades[id] || 0)) / ideal : null,
      correctEmpty: measurable && !hasRelevant ? ids.length === 0 : null,
      hardConstraintsMeasured: allowed !== null || query.excludedPhotoIds !== undefined,
      hardViolationIds: hardViolations,
      elapsedMs: typeof result.elapsedMs === 'number' ? result.elapsedMs : null,
      cached: result.search?.cached === true,
      relaxed: result.search?.relaxed === true,
    };
  });
  const metric = key => runs.map(run => run[key]).filter(value => typeof value === 'number');
  const constraintsMeasured = runs.filter(run => run.hardConstraintsMeasured);
  const emptyMeasured = runs.filter(run => typeof run.correctEmpty === 'boolean');
  return {
    schemaVersion: 1,
    note: 'Precision@10 uses a fixed denominator of 10. Accuracy is unmeasured without complete human judgments; model scores are not ground truth.',
    summary: {
      runs: runs.length, responseErrors: runs.filter(run => !run.responseOk).length,
      fullyJudgedQueries: runs.filter(run => run.judgmentsComplete && !run.outsideCorpus.length).length,
      measuredPrecisionQueries: metric('precisionAt10').length,
      precisionAt10: mean(metric('precisionAt10')), recallAt50: mean(metric('recallAt50')), ndcgAt10: mean(metric('ndcgAt10')),
      hardConstraintQueries: constraintsMeasured.length,
      hardConstraintViolationRate: constraintsMeasured.length ? constraintsMeasured.filter(run => run.hardViolationIds.length).length / constraintsMeasured.length : null,
      emptyQueriesMeasured: emptyMeasured.length,
      falsePositiveEmptyQueries: emptyMeasured.filter(run => !run.correctEmpty).length,
      latency: { cold: latencyStats(runs.filter(run => !run.cached)), warm: latencyStats(runs.filter(run => run.cached)) },
    },
    runs,
  };
}

module.exports = { evaluatePhotoSearch };
