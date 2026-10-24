export function newsDraftKey(userId, workspaceId) {
  return userId ? `mamage.aiNewsWriter.draft.v2:${userId}:${workspaceId || 'legacy'}` : null;
}

export function importLegacyNewsDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('旧版草稿格式不正确');
  // Legacy chips came directly from recognition, not human confirmation.
  const channelContent = Object.fromEntries(Object.entries(draft.channelContent || {}).map(([key, value]) =>
    [key, { ...value, generatedHtml: '', factCheck: null }]));
  return { formValues: draft.formValues, selectedPhotos: draft.selectedPhotos,
    selectedChannels: draft.selectedChannels, channelContent,
    activeChannelKey: draft.activeChannelKey, referenceArticle: draft.referenceArticle,
    interviewText: draft.interviewText, participantChips: [], advancedPrompt: '' };
}

export function formatNewsDate(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function newsMaterialFromForm(form = {}) {
  return [['活动', form.eventName], ['日期', formatNewsDate(form.eventDate)], ['地点', form.location],
    ['主办', form.organizer], ['参与', form.participants], ['活动情况', form.highlights]]
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([label, value]) => `${label}：${value.trim()}`).join('\n');
}

export function restoreNewsForm(form = {}) {
  const rawDate = form.eventDate;
  const date = rawDate ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? `${rawDate}T12:00:00` : rawDate) : null;
  const eventDate = date && !Number.isNaN(date.getTime()) ? date : null;
  if (typeof form.sourceMaterial === 'string') return { ...form, eventDate };
  // Move old facts into the visible material so hidden fields cannot override later edits.
  return { ...form, sourceMaterial: newsMaterialFromForm({ ...form, eventDate }),
    eventName: '', eventDate: null, location: '', organizer: '', participants: '', highlights: '' };
}

export function hasNewsSource(form = {}, interviewText = '') {
  return Boolean(String(form.sourceMaterial || '').trim() || String(form.highlights || '').trim()
    || String(interviewText || '').trim());
}

export function archiveNewsContent(content) {
  if (!content?.markdownText) return content?.history || [];
  const { history, ...version } = content;
  return [{ ...version, savedAt: Date.now() }, ...(history || [])].slice(0, 5);
}

export function isNewsBatchDone(status) {
  return ['succeeded', 'failed', 'partial', 'cancelled'].includes(status);
}

// Keep valid same-origin image URLs and alt text; never nest image Markdown inside its URL.
export function resolveNewsPhotos(markdown, photos) {
  const byId = new Map((photos || []).map(photo => [String(photo.id), photo]));
  return String(markdown || '').replace(/!\[([^\]]*)\]\(PHOTO:([\w-]+)\)/g, (original, alt, id) => {
    const photo = byId.get(id);
    const url = photo?.url || photo?.thumbUrl || photo?.thumbSrc || photo?.thumb;
    if (!url || !/^(https?:\/\/|\/[^/])/.test(url)) return original;
    const safeUrl = String(url).replace(/\(/g, '%28').replace(/\)/g, '%29');
    return `![${alt}](${safeUrl})`;
  });
}
