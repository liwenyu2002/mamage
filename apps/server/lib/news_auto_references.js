const { scopeFor } = require('./wechat_monitor_store');
const { lexicalFeatures, parsed } = require('./wechat_monitor_content');
const { referenceText, usedReferenceSnapshot } = require('./news_reference_provenance');

// Generic event language is not sufficient evidence that two topics are alike.
const GENERIC = new Set('学校 学生 师生 校园 大学 高校 活动 举行 现场 开展 交流 工作 本次 进行 通过 相关 同学 老师 教师 组织 参与 参加 推进 发展 建设 介绍 分享 会议 过程 展开 实践 以及 此次 日在 一场 系列 全体 新闻 通讯 有关'.split(' '));
function topicFeatures(text) {
  return Object.fromEntries(Object.entries(lexicalFeatures(String(text || '').slice(0, 20000)))
    .filter(([term]) => !GENERIC.has(term) && !/\d/.test(term)));
}

function sceneFor(form, text) {
  if (/讲座|论坛|交流会|研讨会|活动|仪式|会议|沙龙/.test(text)) return 'events';
  if (/采访|人物专访|人物故事/.test(text)) return 'people';
  if (/毕业|校友/.test(text)) return 'graduation';
  if (/迎新|招生/.test(text)) return 'admissions';
  if (['activity', 'lecture'].includes(form.contentTemplate)) return 'events';
  if (form.contentTemplate === 'interview') return 'people';
  return null;
}

async function findAutoReferences(db, workspace, form, interviewText) {
  const scope = scopeFor(workspace);
  const material = [form.eventName, form.sourceMaterial, form.highlights, interviewText]
    .filter(value => typeof value === 'string').join(' ').trim();
  if (!material) return [];
  const features = topicFeatures(material), scene = sceneFor(form, material), best = [];
  let cursor = 0;
  for (;;) {
    const [rows] = await db.query(`SELECT a.id, a.title, a.current_revision_id, r.plain_text, n.scene, n.analysis
      FROM wechat_monitor_articles a JOIN wechat_monitor_revisions r
        ON r.id = a.current_revision_id AND r.article_id = a.id
      JOIN wechat_monitor_analyses n ON n.id = a.current_analysis_id
        AND n.revision_id = a.current_revision_id AND n.article_id = a.id
      WHERE a.scope_key = ? AND a.id > ? AND a.published_at > 0 AND a.published_at <= ?
        AND a.source_url LIKE 'https://mp.weixin.qq.com/s%' ORDER BY a.id LIMIT 500`, [scope, cursor, Date.now()]);
    if (!rows.length) break;
    for (const row of rows) {
      const analysis = parsed(row.analysis, {});
      if (typeof analysis?.summary !== 'string' || !analysis.summary.trim()) continue;
      const articleFeatures = topicFeatures(`${row.title} ${row.plain_text || ''}`);
      const titleFeatures = topicFeatures(row.title);
      const matched = Object.keys(features).filter(term => articleFeatures[term]);
      if (matched.length < 2) continue;
      const overlap = matched.length / Math.max(1, Object.keys(features).length);
      const sameScene = !!scene && scene === row.scene;
      best.push({ id: Number(row.id), revisionId: Number(row.current_revision_id), title: row.title,
        analysis: { summary: analysis.summary, lessons: Array.isArray(analysis.lessons) ? analysis.lessons : [] },
        score: overlap + matched.filter(term => titleFeatures[term]).length * 0.04 + (sameScene ? 0.04 : 0) });
      best.sort((a, b) => b.score - a.score || a.id - b.id);
      if (best.length > 3) best.pop();
    }
    cursor = Number(rows[rows.length - 1].id);
    if (rows.length < 500) break;
  }
  const minimumScore = (best[0]?.score || 0) * 0.65;
  return best.filter(item => item.score >= minimumScore).map(({ score, ...item }) => item);
}

async function selectReferences(db, workspace, form, supplied, interviewText, maxChars) {
  const existing = usedReferenceSnapshot(form, supplied);
  if (existing?.length) return { text: supplied, form, status: 'manual' };
  try {
    const candidates = await findAutoReferences(db, workspace, form, interviewText);
    if (!candidates.length) return { text: supplied, form: { ...form, monitorReferences: [] }, status: 'no_match' };
    let text = supplied;
    const selected = [];
    for (const candidate of candidates) {
      const addition = referenceText(candidate);
      if (!addition || [text, addition].filter(Boolean).join('\n\n').length > maxChars) continue;
      text = [text, addition].filter(Boolean).join('\n\n');
      selected.push(candidate);
    }
    return { text, form: { ...form, monitorReferences: selected }, status: selected.length ? 'automatic' : 'reference_limit' };
  } catch (error) {
    console.warn('news reference matching unavailable:', error.code || error.name);
    return { text: supplied, form: { ...form, monitorReferences: [] }, status: 'unavailable' };
  }
}

module.exports = { sceneFor, topicFeatures, findAutoReferences, selectReferences };
