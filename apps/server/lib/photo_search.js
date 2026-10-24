const { pool } = require('../db');
const { buildMediaUrl } = require('./media_access');
const { describePhotoSearchPlan, interpretPhotoSearch, extractNegatedClothing, normalizePhotoSearchPlan } = require('./ai_photo_search');
const { usableFaceSql } = require('./face_result_policy');
const { resolveSearchIntent, equivalents, canResolvePhotoSearchLocally } = require('./photo_search_intent');
const { compileVisualConditions } = require('./person_visual_evidence');
const { visualSearchEnabled, reviewCandidates } = require('./search_visual_index');
const { qualityFilterSql } = require('./photo_quality_policy');

const MAX_PAGE_SIZE = 200;
const MAX_QUERY_LEN = 160;

function escapeLikeToken(input) {
  return String(input || '').replace(/[#%_]/g, '#$&');
}

function uniqueStrings(input, limit = 12) {
  const seen = new Set();
  const result = [];
  (Array.isArray(input) ? input : []).forEach((value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 64);
    const key = text.toLowerCase();
    if (!text || seen.has(key) || result.length >= limit) return;
    seen.add(key);
    result.push(text);
  });
  return result;
}

function tokenizeLiteralQuery(query) {
  return uniqueStrings(String(query || '')
    .toLowerCase()
    .replace(/[，。！？；、,!?;|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean), 8);
}

function isMediaFilenameQuery(query) {
  return /^[^/\\\r\n]+\.(?:jpe?g|png|heic|heif|tiff?|webp|gif|bmp|avif|cr[23]|nef|arw|dng|raf|rw2|orf|pef|srw|mp4|mov|m4v|mkv|avi|mts|m2ts|webm|3gp)$/i.test(query);
}

function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return String(raw).split(/[;,，；]/).map((s) => s.trim()).filter(Boolean);
  }
}

function parseJsonObject(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function textMatch(term, includeFaces = true) {
  const like = `%${escapeLikeToken(String(term || '').toLowerCase())}%`;
  return {
    sql: `(
      LOWER(COALESCE(p.title, '')) LIKE ? ESCAPE '#'
      OR LOWER(COALESCE(p.original_filename, '')) LIKE ? ESCAPE '#'
      OR LOWER(COALESCE(p.description, '')) LIKE ? ESCAPE '#'
      OR LOWER(COALESCE(p.detailed_description, '')) LIKE ? ESCAPE '#'
      OR LOWER(COALESCE(p.ocr_text, '')) LIKE ? ESCAPE '#'
      OR LOWER(COALESCE(CAST(p.tags AS CHAR), '')) LIKE ? ESCAPE '#'
      OR LOWER(COALESCE(pr.name, '')) LIKE ? ESCAPE '#'
      OR LOWER(COALESCE(pts.name, '')) LIKE ? ESCAPE '#'
      OR LOWER(COALESCE(u.name, '')) LIKE ? ESCAPE '#'
      OR LOWER(COALESCE(u.nickname, '')) LIKE ? ESCAPE '#'
      OR LOWER(COALESCE(u.student_no, '')) LIKE ? ESCAPE '#'
      ${includeFaces ? `OR EXISTS (
        SELECT 1
        FROM photo_faces pf_text
        INNER JOIN face_persons fp_text ON fp_text.id = pf_text.person_id
        WHERE pf_text.photo_id = p.id
          AND ${usableFaceSql('pf_text')}
          AND fp_text.organization_id = p.organization_id
          AND LOWER(COALESCE(fp_text.name, '')) LIKE ? ESCAPE '#'
      )` : ''}
      OR (LOWER(COALESCE(p.type, '')) = 'video' AND EXISTS (
        SELECT 1
        FROM photo_video_semantics pvs_text
        WHERE pvs_text.photo_id = p.id
          AND LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pvs_text.analysis_json, '$.transcript.text')), '')) LIKE ? ESCAPE '#'
      ))
    )`,
    params: includeFaces
      ? Array(13).fill(like)
      : Array(12).fill(like),
  };
}

function fieldGroupMatch(terms, sqlExpression) {
  const clauses = [];
  const params = [];
  uniqueStrings(terms, 6).forEach((term) => {
    clauses.push(`LOWER(COALESCE(${sqlExpression}, '')) LIKE ? ESCAPE '#'`);
    params.push(`%${escapeLikeToken(term.toLowerCase())}%`);
  });
  return clauses.length ? { sql: `(${clauses.join(' OR ')})`, params } : null;
}

async function findPeople(orgId, query) {
  if (!query) return [];
  const where = [orgId === null ? 'fp.organization_id IS NULL' : 'fp.organization_id = ?', "COALESCE(fp.name, '') <> ''"];
  const params = orgId === null ? [] : [orgId];
  where.push('CHAR_LENGTH(TRIM(fp.name)) >= 2 AND LOCATE(LOWER(TRIM(fp.name)), ?) > 0');
  params.push(query.toLowerCase());
  try {
    const [rows] = await pool.query(
      `SELECT fp.id, fp.person_no AS personNo, fp.name,
              (SELECT COUNT(*) FROM photo_faces pfc WHERE pfc.person_id = fp.id AND ${usableFaceSql('pfc')}) AS photoCount
       FROM face_persons fp
       WHERE ${where.join(' AND ')}
       HAVING photoCount > 0
       ORDER BY photoCount DESC, fp.updated_at DESC
       LIMIT 80`,
      params
    );
    return (rows || []).map((row) => ({
      id: Number(row.id),
      personNo: row.personNo || null,
      name: String(row.name || '').trim(),
      photoCount: Number(row.photoCount) || 0,
    })).filter((row) => row.id && row.name);
  } catch (error) {
    if (error && (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR')) return [];
    throw error;
  }
}

function rowsMatchingPersonTerm(rows, term) {
  const needle = String(term || '').trim().toLowerCase();
  if (!needle) return [];
  const exact = rows.filter((row) => row.name.toLowerCase() === needle);
  if (exact.length) return exact;
  return [];
}

function stripMatchedPersonNames(term, people) {
  let result = String(term || '').trim();
  (people || []).forEach((person) => {
    const name = String(person && person.name ? person.name : '').trim();
    if (name) result = result.split(name).join(' ');
  });
  return result.replace(/^\s*的|的\s*$/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildScoreParts(terms, matchedPeople, includeFaces = true) {
  const sql = [];
  const params = [];
  uniqueStrings(terms, 16).forEach((term, index) => {
    const escaped = escapeLikeToken(term.toLowerCase());
    const prefix = `${escaped}%`;
    const contain = `%${escaped}%`;
    const weight = index < 8 ? 1 : 0.65;
    sql.push(`CASE WHEN LOWER(COALESCE(p.title, '')) LIKE ? ESCAPE '#' THEN ${Math.round(30 * weight)} ELSE 0 END`);
    params.push(prefix);
    sql.push(`CASE WHEN LOWER(COALESCE(p.original_filename, '')) LIKE ? ESCAPE '#' THEN ${Math.round(36 * weight)} ELSE 0 END`);
    params.push(prefix);
    sql.push(`CASE WHEN LOWER(COALESCE(pr.name, '')) LIKE ? ESCAPE '#' THEN ${Math.round(24 * weight)} ELSE 0 END`);
    params.push(prefix);
    sql.push(`CASE WHEN LOWER(COALESCE(pts.name, '')) LIKE ? ESCAPE '#' THEN ${Math.round(22 * weight)} ELSE 0 END`);
    params.push(prefix);
    sql.push(`CASE WHEN LOWER(COALESCE(p.description, '')) LIKE ? ESCAPE '#' THEN ${Math.round(16 * weight)} ELSE 0 END`);
    params.push(contain);
    sql.push(`CASE WHEN LOWER(COALESCE(p.detailed_description, '')) LIKE ? ESCAPE '#' THEN ${Math.round(8 * weight)} ELSE 0 END`);
    params.push(contain);
    sql.push(`CASE WHEN LOWER(COALESCE(CAST(p.tags AS CHAR), '')) LIKE ? ESCAPE '#' THEN ${Math.round(15 * weight)} ELSE 0 END`);
    params.push(contain);
    sql.push(`CASE WHEN LOWER(COALESCE(p.ocr_text, '')) LIKE ? ESCAPE '#' THEN ${Math.round(13 * weight)} ELSE 0 END`);
    params.push(contain);
    sql.push(`CASE WHEN LOWER(COALESCE(p.type, '')) = 'video' AND EXISTS (
      SELECT 1
      FROM photo_video_semantics pvs_score
      WHERE pvs_score.photo_id = p.id
        AND LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pvs_score.analysis_json, '$.transcript.text')), '')) LIKE ? ESCAPE '#'
    ) THEN ${Math.round(14 * weight)} ELSE 0 END`);
    params.push(contain);
    sql.push(`CASE WHEN LOWER(CONCAT_WS(' ', u.name, u.nickname, u.student_no)) LIKE ? ESCAPE '#' THEN ${Math.round(12 * weight)} ELSE 0 END`);
    params.push(contain);
    if (includeFaces) {
      sql.push(`CASE WHEN EXISTS (
        SELECT 1
        FROM photo_faces pf_term
        INNER JOIN face_persons fp_term ON fp_term.id = pf_term.person_id
        WHERE pf_term.photo_id = p.id
          AND ${usableFaceSql('pf_term')}
          AND fp_term.organization_id = p.organization_id
          AND LOWER(COALESCE(fp_term.name, '')) LIKE ? ESCAPE '#'
      ) THEN ${Math.round(34 * weight)} ELSE 0 END`);
      params.push(contain);
    }
  });
  if (matchedPeople.length) {
    const ids = matchedPeople.map((row) => Number(row.id)).filter(Boolean);
    if (ids.length) {
      sql.push(`CASE WHEN EXISTS (
        SELECT 1 FROM photo_faces pf_score
        WHERE pf_score.photo_id = p.id AND pf_score.person_id IN (?)
          AND ${usableFaceSql('pf_score')}
      ) THEN 48 ELSE 0 END`);
      params.push(ids);
    }
  }
  sql.push('(COALESCE(p.ai_score, 50) / 20)');
  return { sql: sql.join(' + '), params };
}

async function loadFaceNamesForPhotos(photoIds, orgId) {
  const ids = (photoIds || []).map(Number).filter(Boolean);
  if (!ids.length) return new Map();
  const params = [ids];
  let orgSql = 'pf.organization_id IS NULL';
  if (orgId !== null) {
    orgSql = 'pf.organization_id = ?';
    params.push(orgId);
  }
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT pf.photo_id AS photoId, fp.id AS personId, fp.name
       FROM photo_faces pf
       INNER JOIN face_persons fp ON fp.id = pf.person_id
       WHERE pf.photo_id IN (?) AND ${orgSql} AND COALESCE(fp.name, '') <> '' AND ${usableFaceSql('pf')}
       ORDER BY pf.photo_id ASC, fp.name ASC`,
      params
    );
    const map = new Map();
    (rows || []).forEach((row) => {
      const key = Number(row.photoId);
      if (!map.has(key)) map.set(key, []);
      const list = map.get(key);
      if (!list.some((person) => person.id === String(row.personId))) {
        list.push({ id: String(row.personId), name: String(row.name || '').trim() });
      }
    });
    return map;
  } catch (error) {
    if (error && (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR')) return new Map();
    throw error;
  }
}

async function searchPhotos(options = {}) {
  const checkActive = () => options.signal?.throwIfAborted();
  const notify = async event => { checkActive(); await options.onProgress?.(event); checkActive(); };
  checkActive();
  const query = String(options.q || '').trim().slice(0, MAX_QUERY_LEN);
  const page = Math.max(1, Math.floor(Number(options.page) || 1));
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(Number(options.pageSize) || 20)));
  const offset = (page - 1) * pageSize;
  const projectId = Number(options.projectId) > 0 ? Number(options.projectId) : null;
  const orgId = options.orgId === null ? null : Number(options.orgId);
  const unitId = Number(options.unitId) > 0 ? Number(options.unitId) : null;
  const faceSearchAllowed = options.faceSearchAllowed !== false;
  const filenameQuery = isMediaFilenameQuery(query);
  const peopleRows = faceSearchAllowed && !filenameQuery ? await findPeople(orgId, query) : [];
  checkActive();
  const localIntent = filenameQuery || canResolvePhotoSearchLocally(query, peopleRows);
  await notify({ type: 'status', phase: localIntent ? 'searching' : 'understanding' });
  const interpreted = filenameQuery
    ? { plan: normalizePhotoSearchPlan({ mustTerms: [query], termGroups: [[query]] }, query), aiUsed: false, cached: false, fallbackReason: null }
    : await interpretPhotoSearch(query, { enableAi: options.enableAi !== false && !localIntent });
  checkActive();
  const plan = filenameQuery
    ? { ...interpreted.plan, unknownPeople: [], identityUncertain: false, faceSearchUnavailable: false }
    : resolveSearchIntent(query, interpreted.plan, peopleRows, { faceSearchAllowed });
  const literalTokens = tokenizeLiteralQuery(query);
  const explicitPersonTerms = plan.people;
  const personGroups = explicitPersonTerms.map((term) => rowsMatchingPersonTerm(peopleRows, term));
  const matchedPeople = [];
  personGroups.flat().forEach((person) => {
    if (!matchedPeople.some((row) => row.id === person.id)) matchedPeople.push(person);
  });
  const matchedNames = new Set(matchedPeople.map((row) => row.name.toLowerCase()));

  let mustTerms = uniqueStrings(
    uniqueStrings(plan.mustTerms, 8).map((term) => stripMatchedPersonNames(term, matchedPeople)),
    8
  ).filter((term) => !matchedNames.has(term.toLowerCase()));
  const shouldTerms = uniqueStrings(
    uniqueStrings(plan.shouldTerms, 12).map((term) => stripMatchedPersonNames(term, matchedPeople)),
    12
  ).filter((term) => !matchedNames.has(term.toLowerCase()));
  const hasStructuredFilter = plan.mediaType !== 'all'
    || plan.personCount === 1
    || plan.quality !== 'any'
    || plan.dateFrom
    || plan.dateTo
    || plan.projects.length
    || plan.timelineSections.length
    || plan.photographers.length
    || plan.excludeTerms.length;
  if (!mustTerms.length && !shouldTerms.length && !explicitPersonTerms.length && !hasStructuredFilter && query) {
    mustTerms = literalTokens.length ? literalTokens : [query];
  }
  const relatedEligible = faceSearchAllowed && matchedPeople.length > 0 && !plan.unknownPeople.length
    && !plan.identityUncertain && mustTerms.length > 0;
  const showingRelated = options.related === true && relatedEligible;
  const visualRequest = !filenameQuery && visualSearchEnabled(options) && plan.mediaType !== 'video' && !plan.faceSearchUnavailable && !plan.identityUncertain
    && !plan.unknownPeople.length ? compileVisualConditions({ ...plan, mustTerms: showingRelated ? [] : mustTerms }, matchedPeople,
      { semantic: process.env.SEARCH_VISUAL_SEMANTIC_ENABLED === '1', anonymous: process.env.PHOTO_PERSON_OBSERVATIONS_ENABLED === '1' }) : null;
  let visual = null;

  const where = [];
  const whereParams = [];
  if (orgId === null || !Number.isFinite(orgId)) {
    where.push('p.organization_id IS NULL');
  } else {
    where.push('p.organization_id = ?');
    whereParams.push(orgId);
  }
  if (options.workspaceEnabled) {
    if (unitId) {
      const sharedIds = Array.isArray(options.sharedProjectIds)
        && (options.scope?.type === 'workspace' || (options.scope?.type === 'folder' && Array.isArray(options.projectIds)))
        ? [...new Set(options.sharedProjectIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0
          && (options.scope.type === 'workspace' || options.projectIds.includes(id))))] : [];
      where.push(sharedIds.length ? '(COALESCE(pr.unit_id, p.unit_id) = ? OR p.project_id IN (?))' : 'COALESCE(pr.unit_id, p.unit_id) = ?');
      whereParams.push(unitId);
      if (sharedIds.length) whereParams.push(sharedIds);
    } else {
      where.push('COALESCE(pr.unit_id, p.unit_id) IS NULL');
    }
    if (!options.collegeAdmin) {
      where.push('(pr.restricted_to_user_id IS NULL OR pr.restricted_to_user_id = ?)');
      whereParams.push(options.userId);
    }
  }
  if (projectId) {
    where.push('p.project_id = ?');
    whereParams.push(projectId);
  }
  if (Array.isArray(options.projectIds)) {
    const ids = [...new Set(options.projectIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
    where.push(ids.length ? 'p.project_id IN (?)' : '1 = 0');
    if (ids.length) whereParams.push(ids);
  }

  if (plan.mediaType === 'video') where.push("LOWER(COALESCE(p.type, '')) = 'video'");
  if (plan.mediaType === 'image') where.push("LOWER(COALESCE(p.type, '')) <> 'video'");
  if (['recommended', 'medium', 'rejected'].includes(plan.quality)) where.push(qualityFilterSql(plan.quality));
  if (plan.dateFrom) {
    where.push('COALESCE(p.capture_time, DATE(p.created_at)) >= ?');
    whereParams.push(plan.dateFrom);
  }
  if (plan.dateTo) {
    where.push('COALESCE(p.capture_time, p.created_at) < DATE_ADD(?, INTERVAL 1 DAY)');
    whereParams.push(plan.dateTo);
  }

  const projectMatch = fieldGroupMatch(plan.projects, 'pr.name');
  if (projectMatch) { where.push(projectMatch.sql); whereParams.push(...projectMatch.params); }
  const timelineMatch = fieldGroupMatch(plan.timelineSections, 'pts.name');
  if (timelineMatch) { where.push(timelineMatch.sql); whereParams.push(...timelineMatch.params); }
  const photographerMatch = fieldGroupMatch(plan.photographers, "CONCAT_WS(' ', u.name, u.nickname, u.student_no)");
  if (photographerMatch) { where.push(photographerMatch.sql); whereParams.push(...photographerMatch.params); }

  mustTerms.forEach((term) => {
    if (showingRelated) return;
    if (visualRequest && !visualRequest.remainingMustTerms.includes(term)) return;
    const group = plan.termGroups.find(values => values[0] === term) || equivalents(term);
    const matches = group.map(value => textMatch(value, false));
    where.push(`(${matches.map(match => match.sql).join(' OR ')})`);
    matches.forEach(match => whereParams.push(...match.params));
  });
  if (!visualRequest && !mustTerms.length && shouldTerms.length && !explicitPersonTerms.length && !projectMatch && !timelineMatch && !photographerMatch) {
    const matches = shouldTerms.map((term) => textMatch(term, false));
    where.push(`(${matches.map((match) => match.sql).join(' OR ')})`);
    matches.forEach((match) => whereParams.push(...match.params));
  }
  plan.excludeTerms.forEach((term) => {
    if (visualRequest && !visualRequest.remainingExcludeTerms.includes(term)) return;
    const matches = equivalents(term).map(value => textMatch(value, false));
    where.push(`NOT (${matches.map(match => match.sql).join(' OR ')})`);
    matches.forEach(match => whereParams.push(...match.params));
  });
  if (plan.faceSearchUnavailable || plan.identityUncertain) where.push('1 = 0');
  if (faceSearchAllowed && plan.personCount === 1) {
    where.push("LOWER(COALESCE(p.type, '')) <> 'video'");
    if (!explicitPersonTerms.length) {
      // A single detected face can still be surrounded by an audience facing away.
      where.push(`COALESCE(JSON_CONTAINS(p.tags, '"单人"'), 0) = 1
        AND COALESCE(JSON_CONTAINS(p.tags, '"多人"'), 0) = 0
        AND COALESCE(JSON_CONTAINS(p.tags, '"合影"'), 0) = 0
        AND COALESCE(JSON_CONTAINS(p.tags, '"无人"'), 0) = 0`);
    }
    where.push(`(SELECT COUNT(*) FROM photo_faces pf_count
      WHERE pf_count.photo_id = p.id AND pf_count.organization_id = p.organization_id
        AND ${usableFaceSql('pf_count')}) = ?`);
    whereParams.push(1);
  }
  if (faceSearchAllowed && plan.excludePeople.length) {
    const excludedIds = plan.excludePeople.flatMap(term => rowsMatchingPersonTerm(peopleRows, term)).map(person => person.id);
    if (excludedIds.length) {
      where.push(`NOT EXISTS (SELECT 1 FROM photo_faces pf_excluded WHERE pf_excluded.photo_id = p.id
        AND pf_excluded.organization_id = p.organization_id AND pf_excluded.person_id IN (?) AND ${usableFaceSql('pf_excluded')})`);
      whereParams.push(excludedIds);
    }
  }

  if (faceSearchAllowed && explicitPersonTerms.length) {
    if (!matchedPeople.length || (plan.peopleMode === 'all' && personGroups.some((group) => group.length === 0))) {
      where.push('1 = 0');
    } else if (plan.peopleMode === 'all') {
      personGroups.forEach((group) => {
        where.push(`EXISTS (SELECT 1 FROM photo_faces pf_person WHERE pf_person.photo_id = p.id AND pf_person.person_id IN (?) AND ${usableFaceSql('pf_person')})`);
        whereParams.push(group.map((row) => row.id));
      });
    } else {
      const ids = matchedPeople.map((row) => row.id);
      where.push(`EXISTS (SELECT 1 FROM photo_faces pf_person WHERE pf_person.photo_id = p.id AND pf_person.person_id IN (?) AND ${usableFaceSql('pf_person')})`);
      whereParams.push(ids);
    }
    if (plan.peopleOnly && matchedPeople.length) {
      where.push(`NOT EXISTS (
        SELECT 1
        FROM photo_faces pf_other
        WHERE pf_other.photo_id = p.id
          AND pf_other.organization_id = p.organization_id
          AND ${usableFaceSql('pf_other')}
          AND (pf_other.person_id IS NULL OR pf_other.person_id NOT IN (?))
      )`);
      whereParams.push(matchedPeople.map((row) => row.id));
    }
  }

  const baseFrom = `
    FROM photos p
    LEFT JOIN users u ON p.photographer_id = u.id
    LEFT JOIN projects pr ON p.project_id = pr.id
    LEFT JOIN project_timeline_sections pts ON p.timeline_section_id = pts.id
  `;
  if (visualRequest) {
    await notify({ type: 'status', phase: 'verifying' });
    where.push("COALESCE(p.type,'image') <> 'video'");
    const limit = Math.max(20,Math.min(1000,Number(process.env.SEARCH_VISUAL_CANDIDATE_LIMIT)||128));
    const [candidates] = visualRequest.anonymous ? [[]] : await pool.query(`SELECT p.id AS visualCandidateId ${baseFrom}
      WHERE ${where.join(' AND ')} ORDER BY COALESCE(p.ai_score,0) DESC,p.created_at DESC,p.id DESC LIMIT ?`, [...whereParams,limit+1]);
    checkActive();
    try {
      let reviewed;
      if (visualRequest.anonymous) {
        reviewed = { matchedIds: [],unknownIds: [],candidateCount: 0,rejected: 0,checked: 0,pending: 0,uncertain: 0,queued: 0,unavailable: false };
        let cursor = 0;
        for (;;) {
          checkActive();
          const [batch] = await pool.query(`SELECT p.id AS visualCandidateId ${baseFrom}
            WHERE ${where.join(' AND ')} AND p.id > ? ORDER BY p.id ASC LIMIT ?`, [...whereParams,cursor,256]);
          if (!batch.length) break;
          const result = await reviewCandidates({ candidates: batch.map(row => ({ id: row.visualCandidateId })),
            request: visualRequest,signal: options.signal,enqueue: false });
          reviewed.matchedIds.push(...result.matchedIds);reviewed.unknownIds.push(...result.unknownIds);
          for (const key of ['candidateCount','rejected','checked','uncertain']) reviewed[key] += Number(result[key]) || 0;
          cursor = Number(batch.at(-1).visualCandidateId);
          if (batch.length < 256) break;
        }
      } else reviewed = await reviewCandidates({ candidates: candidates.slice(0,limit).map(row=>({ id: row.visualCandidateId })),
        request: visualRequest, signal: options.signal });
      const { matchedIds, unknownIds, ...status } = reviewed;
      const truncated = !visualRequest.anonymous && candidates.length>limit;
      visual = { ...status, truncated, coverageComplete: !unknownIds.length && !truncated,
        retryAfterMs: reviewed.pending>0 && !reviewed.unavailable ? 4000 : null,
        source: visualRequest.anonymous ? 'photo-person-observations' : 'local-person-vision' };
      where.push(matchedIds.length ? 'p.id IN (?)' : '1 = 0');
      if (matchedIds.length) whereParams.push(matchedIds);
    } catch (error) {
      checkActive();
      visual = { unavailable: true, pending: 0, uncertain: candidates.length, coverageComplete: false };
      where.push('1 = 0');
    }
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const countTotal = async () => {
    checkActive();
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total ${baseFrom} ${whereSql}`, whereParams);
    checkActive();
    return countRows && countRows[0] ? Number(countRows[0].total) || 0 : 0;
  };

  const scoreTerms = uniqueStrings([...mustTerms, ...shouldTerms, ...plan.termGroups.flat(), ...plan.projects, ...plan.timelineSections, ...plan.photographers], 18);
  const score = buildScoreParts(scoreTerms, matchedPeople, false);
  const requestedSort = String(options.sort || '').toLowerCase();
  const sort = plan.sort !== 'relevance' ? plan.sort : (requestedSort === 'newest' ? 'newest' : 'relevance');
  const orderBy = sort === 'newest'
    ? 'ORDER BY p.created_at DESC, p.id DESC'
    : sort === 'quality'
      ? 'ORDER BY COALESCE(p.ai_score, 0) DESC, relevanceScore DESC, p.created_at DESC, p.id DESC'
      : 'ORDER BY relevanceScore DESC, COALESCE(p.ai_score, 0) DESC, p.created_at DESC, p.id DESC';

  const readBatch = async (limit, batchOffset) => {
    checkActive();
    const [rows] = await pool.query(
      `SELECT
         p.id, p.uuid, p.project_id AS projectId, pr.name AS projectName,
         p.timeline_section_id AS timelineSectionId, pts.name AS timelineSectionName,
         pts.section_time AS timelineSectionTime, p.url, p.thumb_url AS thumbUrl,
         p.playback_url AS playbackUrl, p.title, p.original_filename AS originalFilename, p.description, p.adjustments, p.tags,
         p.ocr_text AS ocrText, p.ai_status AS aiStatus, p.ai_error AS aiError,
         p.ai_started_at AS aiStartedAt, p.ai_finished_at AS aiFinishedAt,
         p.ai_score AS aiScore, p.ai_quality AS aiQuality, p.type,
         p.photographer_id AS photographerId,
         COALESCE(NULLIF(u.name, ''), NULLIF(u.nickname, '')) AS photographerName,
         p.capture_time AS captureTime, p.created_at AS createdAt, p.updated_at AS updatedAt,
         ${score.sql || '0'} AS relevanceScore
       ${baseFrom}
       ${whereSql}
       ${orderBy}
       LIMIT ? OFFSET ?`,
      [...score.params, ...whereParams, limit, batchOffset]
    );
    checkActive();

    const faceMap = faceSearchAllowed
      ? await loadFaceNamesForPhotos((rows || []).map((row) => row.id), orgId)
      : new Map();
    checkActive();
    return (rows || []).map((row) => {
      const people = faceMap.get(Number(row.id)) || [];
      return {
        id: row.id,
        uuid: row.uuid,
        projectId: row.projectId,
        projectName: row.projectName || null,
        timelineSectionId: row.timelineSectionId || null,
        timelineSectionName: row.timelineSectionName || null,
        timelineSectionTime: row.timelineSectionTime || null,
        url: row.url ? buildMediaUrl(row.url, { userId: options.userId, photoId: row.id }) : null,
        thumbUrl: row.thumbUrl ? buildMediaUrl(row.thumbUrl, { userId: options.userId, photoId: row.id }) : null,
        playbackUrl: row.playbackUrl ? buildMediaUrl(row.playbackUrl, { userId: options.userId, photoId: row.id }) : null,
        playback_url: row.playbackUrl ? buildMediaUrl(row.playbackUrl, { userId: options.userId, photoId: row.id }) : null,
        title: row.title || null,
        originalFilename: row.originalFilename || null,
        description: row.description || null,
        adjustments: parseJsonObject(row.adjustments),
        tags: parseTags(row.tags),
        ocrText: row.ocrText || null,
        aiStatus: row.aiStatus || null,
        aiError: row.aiError || null,
        aiStartedAt: row.aiStartedAt || null,
        aiFinishedAt: row.aiFinishedAt || null,
        aiScore: row.aiScore === null || row.aiScore === undefined ? null : Number(row.aiScore),
        aiQuality: parseJsonObject(row.aiQuality),
        type: row.type,
        photographerId: row.photographerId || null,
        photographerName: row.photographerName || null,
        captureTime: row.captureTime || null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        relevanceScore: Number(row.relevanceScore) || 0,
        faceNames: people.map((person) => person.name),
        personNames: people.map((person) => person.name),
        people,
      };
    });
  };

  const makeResult = (list, total) => ({
    list,
    page,
    pageSize,
    total,
    hasMore: total === null ? null : page * pageSize < total,
    q: query,
    tokens: mustTerms,
    sort,
    search: {
      scope: options.scope || (projectId ? { type: 'album', id: projectId } : { type: 'workspace' }),
      mode: interpreted.aiUsed ? 'ai' : 'enhanced',
      aiUsed: interpreted.aiUsed,
      cached: interpreted.cached,
      degraded: Boolean(interpreted.fallbackReason),
      plan: {
        mustTerms,
        shouldTerms,
        excludeTerms: plan.excludeTerms,
        termGroups: plan.termGroups,
        people: explicitPersonTerms,
        excludePeople: plan.excludePeople,
        peopleMode: plan.peopleMode,
        peopleOnly: plan.peopleOnly,
        personCount: plan.personCount,
        photographers: plan.photographers,
        projects: plan.projects,
        timelineSections: plan.timelineSections,
        mediaType: plan.mediaType,
        quality: plan.quality,
        dateFrom: plan.dateFrom,
        dateTo: plan.dateTo,
        sort,
      },
      chips: describePhotoSearchPlan({ ...plan, mustTerms }, matchedPeople),
      matchedPeople: matchedPeople.map((row) => ({
        id: String(row.id), name: row.name, photoCount: row.photoCount,
      })),
      unknownPeople: faceSearchAllowed ? plan.unknownPeople : [],
      relatedAvailable: total === 0 && relatedEligible && !showingRelated && !visualRequest,
      ...(visual ? { visual } : {}),
      matchType: showingRelated ? 'related' : 'strict',
      relaxed: showingRelated,
      relaxedHint: showingRelated ? `以下仅匹配人物与其他筛选条件，尚未确认「${mustTerms.join('、')}」` : null,
      notice: plan.faceSearchUnavailable ? '当前账号未获授权使用人脸检索。'
        : plan.unknownPeople.length && (!matchedPeople.length || plan.peopleMode === 'all') ? `人物库中未找到：${plan.unknownPeople.join('、')}`
          : plan.identityUncertain ? '多人同框条件尚未完整识别，未自动放宽人物范围。'
            : visual ? (visual.unavailable ? '视觉核验暂不可用，未将未知衣着作为匹配结果。'
              : `${visualRequest.anonymous ? '按画面内人物已有衣着分析匹配' : '衣着按目标人物核验'}；${visual.pending || 0} 张待核验，${visual.uncertain || 0} 张暂不能确认。${visualRequest.remainingMustTerms.length || visualRequest.remainingExcludeTerms.length ? '其他内容条件仍参考已有描述。' : ''}${visual.truncated ? '当前仅核验部分候选，请缩小相册或日期范围。' : ''}`)
            : matchedPeople.length && extractNegatedClothing(query).excludeTerms.length
              ? '衣着排除基于已有照片描述；同框人物或描述缺失时仍需核对。'
            : matchedPeople.length && mustTerms.length && list.length > 0 ? '人物与画面描述已匹配；同框时衣着、动作的归属仍需核对。' : null,
    },
  });

  if (typeof options.onProgress !== 'function') {
    const total = await countTotal();
    return makeResult(total > 0 && offset < total ? await readBatch(pageSize, offset) : [], total);
  }
  await notify({ type: 'status', phase: 'searching', search: makeResult([], null).search });
  const list = [];
  const seen = new Set();
  // The first eight results bypass COUNT; later batches append without reranking visible cards.
  for (let taken = 0; taken < pageSize;) {
    const limit = Math.min(taken ? 64 : 8, pageSize - taken);
    const batch = await readBatch(limit, offset + taken);
    const fresh = batch.filter(photo => !seen.has(String(photo.id)));
    fresh.forEach(photo => seen.add(String(photo.id)));
    list.push(...fresh);
    if (fresh.length) await notify({ type: 'results', data: makeResult(fresh, null) });
    taken += batch.length;
    if (batch.length < limit) break;
  }
  await notify({ type: 'status', phase: 'counting' });
  return makeResult(list, await countTotal());
}

module.exports = {
  escapeLikeToken,
  searchPhotos,
  textMatch,
  tokenizeLiteralQuery,
};
