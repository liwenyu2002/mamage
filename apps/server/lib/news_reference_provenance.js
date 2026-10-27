function referenceText(item) {
  if (!item || typeof item.title !== 'string' || typeof item.analysis?.summary !== 'string') return '';
  const lines = [`参考文章：${item.title}`, `写法综述：${item.analysis.summary}`];
  for (const lesson of Array.isArray(item.analysis.lessons) ? item.analysis.lessons : []) {
    if (!lesson || typeof lesson.principle !== 'string') continue;
    lines.push(`写作原则：${lesson.principle}${lesson.application ? `；适用：${lesson.application}` : ''}${lesson.caveat ? `；注意：${lesson.caveat}` : ''}`);
  }
  return lines.join('\n');
}

function usedReferenceSnapshot(form, submittedReference) {
  if (!Array.isArray(form?.monitorReferences)) return null;
  const result = [], seen = new Set(), reference = String(submittedReference || '');
  for (const item of form.monitorReferences) {
    const id = Number(item?.id), revisionId = Number(item?.revisionId), text = referenceText(item);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(revisionId) || revisionId <= 0
      || !text || !reference.includes(text) || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, revisionId, title: item.title.slice(0, 255) });
  }
  return result;
}
module.exports = { referenceText, usedReferenceSnapshot };
