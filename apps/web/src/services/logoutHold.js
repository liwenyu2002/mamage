const KEY = 'mamage_explicit_logout';

export function hasExplicitLogout(location = window.location, storage) {
  if (new URLSearchParams(location.search || '').get('signed_out') === '1') return true;
  try { return (storage || window.localStorage).getItem(KEY) === '1'; } catch { return false; }
}

export function markExplicitLogout(storage) {
  try { (storage || window.localStorage).setItem(KEY, '1'); } catch { /* The signed_out URL is the fallback. */ }
}

export function clearExplicitLogout(storage) {
  try { (storage || window.localStorage).removeItem(KEY); } catch { /* Login still succeeds without storage access. */ }
}
