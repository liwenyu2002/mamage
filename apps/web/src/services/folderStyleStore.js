const PREFIX = 'mamage-folder-style:v1:';
const memory = new Map();
export const FOLDER_STYLE_EVENT = 'mamage:folder-style';
export const normalizeFolderStyle = value => value === 'classic' ? 'classic' : 'glass';
export function folderStyleKey(userId) {
  return userId == null ? null : `${PREFIX}${String(userId)}`;
}
export function readFolderStyle(userId) {
  const key = folderStyleKey(userId);
  if (!key) return 'glass';
  if (memory.has(key)) return memory.get(key);
  try { return normalizeFolderStyle(localStorage.getItem(key)); }
  catch { return memory.get(key) || 'glass'; }
}
export function writeFolderStyle(userId, value) {
  const key = folderStyleKey(userId);
  if (!key) return false;
  const style = normalizeFolderStyle(value);
  try { localStorage.setItem(key, style); memory.delete(key); }
  catch { memory.set(key, style); }
  window.dispatchEvent(new Event(FOLDER_STYLE_EVENT));
  return true;
}
