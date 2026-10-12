import { request } from './request';
import { getToken } from './authService';

export const PROJECT_PREVIEW_LIMIT = 20;

const cache = new Map(), inFlight = new Map(), queue = [];
let active = 0, authToken, epoch = 0;

function drain() {
  while (active < 3 && queue.length) {
    const next = queue.shift();
    active++;
    Promise.resolve().then(next.task).then(next.resolve, next.reject).finally(() => { active--; drain(); });
  }
}

export function fetchProjectPreviews(id, { scope, revision = '' } = {}) {
  const token = getToken();
  if (authToken !== token) { authToken = token; epoch++; cache.clear(); inFlight.clear(); }
  const currentEpoch = epoch;
  const unit = scope ? scope.unitId || 'legacy' : '';
  const key = `${epoch}:${scope?.organizationId || ''}:${unit}:${id}:${revision}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.list);
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = new Promise((resolve, reject) => {
    queue.push({ resolve, reject, task: () => {
      if (getToken() !== token) throw new Error('PREVIEW_SESSION_CHANGED');
      return request(`/api/projects/${encodeURIComponent(id)}/previews`, {
        timeoutMs: 8000, headers: scope ? { 'x-mamage-unit-id': String(unit) } : undefined,
      }).catch(error => {
        if (error.status !== 404) throw error;
        // Keep local frontends usable against a backend not yet upgraded.
        return request('/api/photos', { data: { projectId: id, limit: PROJECT_PREVIEW_LIMIT + 1, random: 1 }, timeoutMs: 8000,
          headers: scope ? { 'x-mamage-unit-id': String(unit) } : undefined });
      });
    } });
    drain();
  }).then(result => {
    const list = Array.isArray(result?.list) ? result.list : [];
    if (currentEpoch === epoch) {
      cache.delete(key);
      cache.set(key, { list, expires: Date.now() + 30000 });
      while (cache.size > 120) cache.delete(cache.keys().next().value);
    }
    return list;
  }).finally(() => { if (inFlight.get(key) === promise) inFlight.delete(key); });
  inFlight.set(key, promise);
  return promise;
}
