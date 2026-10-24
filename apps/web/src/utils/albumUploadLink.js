const STORAGE_KEY = 'mamage_album_upload_intent_v1';
const MAX_AGE_MS = 30 * 60 * 1000;

function id(value) {
  const text = String(value ?? '');
  return /^[1-9]\d{0,9}$/.test(text) && Number(text) <= 2147483647 ? text : null;
}

export function buildAlbumUploadUrl(projectId, unitId, baseUrl) {
  const project = id(projectId);
  const base = new URL(baseUrl);
  if (!project || !['http:', 'https:'].includes(base.protocol)) throw Error('Invalid album upload destination');
  const url = new URL('/', base.origin);
  url.searchParams.set('projectId', project);
  url.searchParams.set('upload', '1');
  if (id(unitId)) url.searchParams.set('unitId', id(unitId));
  return url.href;
}

export function readAlbumUploadIntent(href) {
  try {
    const url = new URL(href);
    if (!['/', '/login'].includes(url.pathname) || url.searchParams.get('upload') !== '1') return null;
    const projectId = id(url.searchParams.get('projectId'));
    const rawUnit = url.searchParams.get('unitId');
    if (!projectId || (rawUnit !== null && !id(rawUnit))) return null;
    return { projectId, unitId: id(rawUnit) };
  } catch { return null; }
}

export function rememberAlbumUploadIntent(storage, intent, now = Date.now()) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ projectId: id(intent?.projectId), unitId: id(intent?.unitId), savedAt: now })); } catch { /* Private browsing may disable storage. */ }
}

export function storedAlbumUploadIntent(storage, now = Date.now()) {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY));
    if (!id(value?.projectId) || (value.unitId !== null && !id(value.unitId))
      || !Number.isFinite(value.savedAt) || now < value.savedAt || now - value.savedAt > MAX_AGE_MS) return null;
    return { projectId: id(value.projectId), unitId: id(value.unitId) };
  } catch { return null; }
}

export function clearAlbumUploadIntent(storage) {
  try { storage.removeItem(STORAGE_KEY); } catch { /* Storage is optional for password login. */ }
}
