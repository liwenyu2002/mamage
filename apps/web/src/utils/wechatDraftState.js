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

// 备份与推文文件共用 wechat_compositions 表：备份由 saveBackup 自动命名，形如
// “<标题> · 内容稿 · <时间>” / “<标题> · 排版稿 · <时间>”。按这个命名把两类分开，
// 避免文件列表把排版备份当普通文件打开覆盖、备份弹窗把普通文件列成备份。
const BACKUP_NAME_PATTERN = /·\s*(内容稿|排版稿)\s*·/;
export function isBackupName(name) {
  return BACKUP_NAME_PATTERN.test(String(name || ''));
}
export function backupKindFromName(name) {
  const match = BACKUP_NAME_PATTERN.exec(String(name || ''));
  return match ? (match[1] === '内容稿' ? 'content' : 'layout') : null;
}
