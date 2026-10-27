export function wechatDraftKey(userId, workspaceId) {
  return userId ? `wechat-composer-draft.v2:${userId}:${workspaceId || 'legacy'}` : null;
}

export function wechatAiDraftKey(userId, workspaceId) {
  const key = wechatDraftKey(userId, workspaceId);
  return key ? `${key}:ai` : null;
}

export function wechatImportKey(userId, workspaceId) {
  return userId ? `wechat-composer-import.v2:${userId}:${workspaceId || 'legacy'}` : null;
}

export function hasWechatDraft(draft) {
  return Boolean(draft && (String(draft.title || '').trim() || draft.doc?.length || draft.markdown));
}
