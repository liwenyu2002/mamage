// Keep the existing preference key so previously chosen appearances migrate.
export const GLASS_APPEARANCE_KEY = 'mamage-viewer-appearance';
export const GLASS_APPEARANCE_EVENT = 'mamage-appearance-change';
const appliedAppearances = new WeakMap();

export function normalizeGlassAppearance(value) {
  return { dark: value?.dark === true,
    blur: Number.isFinite(value?.blur) ? Math.max(9, Math.min(28, value.blur)) : 20 };
}

export function readGlassAppearance(target = window) {
  try { return normalizeGlassAppearance(JSON.parse(target.localStorage.getItem(GLASS_APPEARANCE_KEY))); }
  catch { return normalizeGlassAppearance(appliedAppearances.get(target)); }
}

export function applyGlassAppearance(appearance, target = window) {
  const next = normalizeGlassAppearance(appearance);
  target.document.documentElement.dataset.glassTheme = next.dark ? 'dark' : 'light';
  target.document.documentElement.style.setProperty('--glass-blur', `${next.blur}px`);
  appliedAppearances.set(target, next);
  return next;
}

export function saveGlassAppearance(appearance, target = window) {
  const next = applyGlassAppearance(appearance, target);
  try { target.localStorage.setItem(GLASS_APPEARANCE_KEY, JSON.stringify(next)); }
  catch { /* In-memory events still synchronize all surfaces when storage is blocked. */ }
  target.dispatchEvent(new CustomEvent(GLASS_APPEARANCE_EVENT, { detail: next }));
  return next;
}
