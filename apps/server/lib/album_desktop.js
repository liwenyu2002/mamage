const { randomUUID } = require('crypto');

function invalid(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function json(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function validateGroups(value, albumIds) {
  if (!Array.isArray(value) || value.length > 300) throw invalid('相册集数据不正确');
  const seen = new Set();
  const groups = value.map((group) => {
    if (!group || typeof group !== 'object') throw invalid('相册集数据不正确');
    const id = String(group.id || randomUUID());
    const name = String(group.name || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || seen.has(id) || !name || name.length > 80) throw invalid('相册集名称或标识不正确');
    seen.add(id);
    const kind = group.kind === 'smart' ? 'smart' : 'manual';
    const projectIds = [...new Set(Array.isArray(group.projectIds) ? group.projectIds.map(Number) : [])];
    if (projectIds.some(id => !Number.isSafeInteger(id) || !albumIds.has(id))) throw invalid('相册已删除，或不属于当前工作空间', 403);
    const rule = group.rule || {};
    const year = String(rule.year || '');
    if (year && !/^\d{4}$/.test(year)) throw invalid('年份不正确');
    const parentId = group.parentId == null || group.parentId === '' ? null : String(group.parentId);
    return { id, name, kind, parentId, projectIds: kind === 'smart' ? [] : projectIds,
      rule: kind === 'smart' ? { year, text: String(rule.text || '').trim().slice(0, 100) } : {},
      symbol: kind === 'smart' ? 'smart' : ['timeline', 'image', 'grid'].includes(group.symbol) ? group.symbol : 'grid',
      layout: kind === 'smart' ? 'rule' : ['stack', 'panorama', 'mosaic'].includes(group.layout) ? group.layout : 'stack',
      color: /^#[a-fA-F0-9]{6}$/.test(group.color || '') ? group.color : '#515c67',
      tint: /^#[a-fA-F0-9]{6}$/.test(group.tint || '') ? group.tint : '#e6e9ec' };
  });
  const byId = new Map(groups.map(group => [group.id, group]));
  for (const group of groups) {
    const ancestors = new Set();
    let current = group;
    while (current) {
      if (ancestors.has(current.id)) throw invalid('文件夹不能移入自身或自己的子文件夹');
      ancestors.add(current.id);
      if (ancestors.size > 5) throw invalid('最多支持 5 级文件夹');
      if (current.parentId && !byId.has(current.parentId)) throw invalid('目标文件夹不存在或不属于当前工作空间');
      current = byId.get(current.parentId);
    }
  }
  return groups;
}

function validatePreferences(value, groups, albumIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('个人桌面设置不正确');
  const groupIds = new Set(groups.map(g => g.id));
  const keys = new Set([...albumIds].map(id => `album:${id}`).concat(groups.map(g => `group:${g.id}`)));
  const pins = [...new Set(Array.isArray(value.pins) ? value.pins.filter(key => keys.has(key)) : [])];
  const recentItems = [];
  const seen = new Set();
  for (const item of Array.isArray(value.recentItems) ? value.recentItems : []) {
    const id = Number(item?.id);
    if (!albumIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    recentItems.push({ id, visitedAt: Number.isFinite(Number(item.visitedAt)) ? Math.min(Date.now(), Number(item.visitedAt)) : Date.now() });
    if (recentItems.length === 30) break;
  }
  const colors = {};
  for (const [id, color] of Object.entries(value.colors || {})) {
    if (groupIds.has(id) && /^#[a-fA-F0-9]{6}$/.test(color)) colors[id] = color;
  }
  return { pins, recentItems, colors,
    dismissed: [...new Set(Array.isArray(value.dismissed) ? value.dismissed.map(Number).filter(id => albumIds.has(id)) : [])] };
}

function authorizeFolderChanges(stored, submitted, { userId, canManage, canDelete }) {
  const ids = new Set([...stored, ...submitted].flatMap(group => group.projectIds || []).map(Number));
  const previous = validateGroups(stored, ids);
  const byId = new Map(stored.map(group => [group.id, group]));
  const ownerId = group => {
    const value = Number(group?.createdBy);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  };
  const editable = group => canManage || ownerId(group) === userId;
  const retained = new Set(submitted.map(group => group.id));
  if (!canDelete && stored.some(group => !retained.has(group.id))) throw invalid('只有管理员可以删除文件夹', 403);
  const comparable = group => JSON.stringify({ ...group, projectIds: [...group.projectIds].sort((a, b) => a - b) });
  if (!canManage) {
    const nextById = new Map(submitted.map(group => [group.id, group]));
    for (const before of previous) {
      if (!editable(byId.get(before.id)) && comparable(before) !== comparable(nextById.get(before.id))) {
        throw invalid('只能修改自己创建的文件夹；历史文件夹请联系管理员', 403);
      }
    }
    const protectedIds = stored.filter(group => !editable(group)).map(group => group.id);
    const protectedSet = new Set(protectedIds);
    if (JSON.stringify(submitted.filter(group => protectedSet.has(group.id)).map(group => group.id)) !== JSON.stringify(protectedIds)) {
      throw invalid('不能调整其他人文件夹的顺序', 403);
    }
  }
  const authorized = submitted.map(group => ({ ...group, createdBy: byId.has(group.id) ? ownerId(byId.get(group.id)) : userId,
    ...(byId.get(group.id)?.restrictedToUserId ? { restrictedToUserId: byId.get(group.id).restrictedToUserId } : {}) }));
  const parents = new Map(authorized.map(group => [group.id, group]));
  for (const group of authorized) {
    const visited = new Set([group.id]);
    for (let parent = parents.get(group.parentId); parent; parent = parents.get(parent.parentId)) {
      if (visited.has(parent.id)) throw invalid('文件夹不能移入自身或自己的子文件夹');
      visited.add(parent.id);
      if (!parent.restrictedToUserId) continue;
      if (group.restrictedToUserId && Number(group.restrictedToUserId) !== Number(parent.restrictedToUserId)) throw invalid('不能合并不同接收人的私有文件夹', 403);
      group.restrictedToUserId = Number(parent.restrictedToUserId);
    }
  }
  return authorized;
}

module.exports = { invalid, json, validateGroups, validatePreferences, authorizeFolderChanges };
