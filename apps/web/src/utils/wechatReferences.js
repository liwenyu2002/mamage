export function referenceFindings(items) {
  return (Array.isArray(items) ? items : []).filter(item => item?.analysis && typeof item.analysis.summary === 'string').map(item => {
    const lines = [`参考文章：${item.title}`, `写法综述：${item.analysis.summary}`];
    for (const lesson of Array.isArray(item.analysis.lessons) ? item.analysis.lessons : []) {
      if (!lesson || typeof lesson.principle !== 'string') continue;
      lines.push(`写作原则：${lesson.principle}${lesson.application ? `；适用：${lesson.application}` : ''}${lesson.caveat ? `；注意：${lesson.caveat}` : ''}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}
