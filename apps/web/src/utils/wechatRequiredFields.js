export function missingRequiredFields(text) {
  return String(text || '').replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^([^\s：:|｜]{1,12})\s*[：:|｜]\s*(?:待填写|待补充|待确认|未填写)\s*$/);
    return match ? [match[1]] : [];
  });
}
