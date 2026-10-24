import { request } from './request';

export const loadAlbumDesktop = () => request('/api/album-desktop', { timeoutMs: 20000 });
export const saveAlbumDesktop = (data, scope) => request('/api/album-desktop/state', { method: 'PUT', data: { ...data, scope, sharedReferencesVersion: 1 },
  headers: scope ? { 'x-mamage-unit-id': scope.unitId ? String(scope.unitId) : 'legacy' } : undefined, timeoutMs: 20000 });

// Coalesce fast interactions, serialize writes, and never overwrite another tab's revision.
export function createDesktopSaver(initial, onError, onStatus) {
  let revision = { workspaceRevision: initial.workspaceRevision, userRevision: initial.userRevision };
  const groupKey = value => JSON.stringify(value.map(group => ({ ...group, projectIds: [...(group.projectIds || [])].sort((a,b)=>a-b) })));
  let groups = groupKey(initial.groups);
  let preferences = JSON.stringify(initial.preferences);
  let pending;
  let running;
  let blocked;
  const isTransient = error => !error.status || error.status === 408 || error.status === 429 || error.status >= 500;
  async function persist(data) {
    for (let attempt = 0; ; attempt += 1) {
      try { return await saveAlbumDesktop(data, initial.scope); }
      catch (error) {
        if (!isTransient(error) || attempt >= 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 300 * (2 ** attempt)));
      }
    }
  }
  async function drain() {
    onStatus?.('saving');
    try {
      while (pending) {
        const next = pending;
        pending = null;
        const groupJson = groupKey(next.groups);
        const preferenceJson = JSON.stringify(next.preferences);
        if (groupJson === groups && preferenceJson === preferences) continue;
        const result = await persist({ ...revision,
          ...(groupJson !== groups ? { groups: next.groups } : {}),
          ...(preferenceJson !== preferences ? { preferences: next.preferences } : {}) });
        revision = {
          workspaceRevision: groupJson !== groups ? result.workspaceRevision : revision.workspaceRevision,
          userRevision: preferenceJson !== preferences ? result.userRevision : revision.userRevision,
        };
        groups = groupJson; preferences = preferenceJson;
      }
      onStatus?.('saved');
      return true;
    } catch (error) {
      blocked = !isTransient(error);
      onStatus?.('error'); onError(error);
      return false;
    } finally { running = null; }
  }
  return {
    canRetry() { return !blocked; },
    save(next) {
      if (blocked) return Promise.resolve(false);
      pending = next;
      if (!running) running = Promise.resolve().then(drain);
      return running;
    },
  };
}
