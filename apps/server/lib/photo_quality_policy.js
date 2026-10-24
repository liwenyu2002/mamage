const REJECT_MAX = 40;
const RECOMMEND_MIN = 75;
const FATAL_SCORE_CAP = 45;

function qualityFilterSql(label, alias = 'p') {
  if (!['recommended', 'medium', 'rejected'].includes(label)) throw new Error('INVALID_QUALITY_LABEL');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error('INVALID_SQL_ALIAS');
  const tags = `COALESCE(CAST(${alias}.tags AS CHAR), '[]')`;
  const has = (values) => '(' + values.map(value => `${tags} LIKE '%"${value}"%'`).join(' OR ') + ')';
  // Stored labels include fatal defects that cannot be inferred from the score.
  return `(CASE
    WHEN ${has(['AI rejected', '不推荐'])} THEN 'rejected'
    WHEN ${has(['AI recommended', '推荐'])} THEN 'recommended'
    WHEN ${has(['AI medium', '中等'])} THEN 'medium'
    WHEN ${alias}.ai_score IS NULL THEN NULL
    WHEN ${alias}.ai_score <= ${REJECT_MAX} THEN 'rejected'
    WHEN ${alias}.ai_score >= ${RECOMMEND_MIN} THEN 'recommended'
    ELSE 'medium' END = '${label}')`;
}

module.exports = { REJECT_MAX, RECOMMEND_MIN, FATAL_SCORE_CAP, qualityFilterSql };
