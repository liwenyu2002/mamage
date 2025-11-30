// src/services/transferStore.js
// 全局“中转站”选择仓库：最多 30 张，跨页面、跨会话（localStorage）

const STORAGE_KEY = 'photo-transfer-selection';
const MAX_COUNT = 30;

let selection = [];

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        selection = parsed;
        console.log('[transferStore] loaded from storage:', selection.length);
      }
    }
  } catch (e) {
    console.warn('[transferStore] load failed', e);
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch (e) {
    console.warn('[transferStore] save failed', e);
  }
}

const listeners = [];

function notify() {
  const snapshot = selection.slice();
  listeners.forEach(fn => {
    try {
      fn(snapshot);
    } catch (e) {
      console.warn('[transferStore] listener error', e);
    }
  });
}

function subscribe(fn) {
  if (typeof fn === 'function') {
    listeners.push(fn);
    fn(selection.slice());
  }
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

function getAll() {
  return selection.slice();
}

function getCount() {
  return selection.length;
}

function add(photo) {
  if (!photo) return false;
  if (selection.length >= MAX_COUNT) return false;
  const key = photo.id || photo.url;
  if (!key) return false;
  if (selection.some(p => (p.id || p.url) === key)) return true;
  selection.push(photo);
  persist();
  notify();
  return true;
}

function removeById(idOrUrl) {
  const oldLen = selection.length;
  selection = selection.filter(p => (p.id || p.url) !== idOrUrl);
  if (selection.length !== oldLen) {
    persist();
    notify();
  }
}

function clear() {
  selection = [];
  persist();
  notify();
}

load();

export { getAll, getCount, add, clear, removeById, subscribe, MAX_COUNT };
