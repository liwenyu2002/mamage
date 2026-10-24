function positiveInteger(value, name, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw Error(`Invalid ${name}`);
  return number;
}

function buildSearchTelemetryExport({ organizationId, unitId, days = 7, limit = 100, raw = false }) {
  const org = positiveInteger(organizationId, 'organizationId', 4294967295);
  const range = positiveInteger(days, 'days', 180);
  const maxRows = positiveInteger(limit, 'limit', raw ? 10000 : 1000);
  const where = ['organization_id = ?', 'expires_at > UTC_TIMESTAMP(3)', 'created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? DAY)'];
  const params = [org, range];
  if (unitId !== undefined) {
    where.push('unit_id = ?');
    params.push(positiveInteger(unitId, 'unitId', 4294967295));
  }
  const columns = raw
    ? `event_id AS eventId, organization_id AS organizationId, unit_id AS unitId, project_id AS projectId,
       query_text AS query, requested_ai AS requestedAi, search_mode AS searchMode, ai_used AS aiUsed,
       cache_hit AS cached, degraded, relaxed, result_count AS resultCount, duration_ms AS durationMs,
       query_plan AS plan, original_plan AS originalPlan, error_code AS errorCode,
       DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt`
    : `query_text AS query, COUNT(*) AS searches, SUM(result_count = 0) AS zeroResultCount,
       SUM(relaxed = 1) AS relaxedCount, SUM(degraded = 1) AS degradedCount,
       SUM(error_code IS NOT NULL) AS errorCount, ROUND(AVG(duration_ms)) AS averageMs,
       DATE_FORMAT(MAX(created_at), '%Y-%m-%dT%H:%i:%s.%fZ') AS lastSearchedAt`;
  params.push(maxRows);
  return {
    sql: `SELECT ${columns} FROM photo_search_events WHERE ${where.join(' AND ')}
      ${raw ? 'ORDER BY created_at DESC, event_id DESC' : 'GROUP BY query_text ORDER BY searches DESC, MAX(created_at) DESC, query_text ASC'} LIMIT ?`,
    params,
  };
}

module.exports = { buildSearchTelemetryExport };
