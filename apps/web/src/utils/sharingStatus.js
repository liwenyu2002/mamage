export function sharingStatusText(sharing) {
  if (!sharing) return '';
  if (sharing.direction === 'received') return [sharing.originLabel ? `来自 ${sharing.originLabel}` : '来自共享',
    sharing.mode === 'collaborate' ? '共同编辑' : '只读', '实时共享'].join(' · ');
  if (sharing.direction !== 'sent') return '';
  const targets = [...new Set((sharing.targetUnitNames || []).filter(Boolean))];
  return [targets.length ? `已共享至 ${targets.join('、')}` : '', targets.length ? '实时共享' : '',
    sharing.public ? '公开分享已开启' : ''].filter(Boolean).join(' · ');
}

export function cardSharingStatus(item) {
  if (item.sharing !== undefined) return item.sharing;
  return item.isShared ? { direction: 'received', originLabel: item.originLabel, mode: item.shareMode } : null;
}

export function cardSharingLabel(sharing) {
  if (!sharingStatusText(sharing)) return '';
  if (sharing.direction === 'received') return sharing.mode === 'collaborate' ? '协作共享' : '只读共享';
  const internal = sharing.targetUnitNames?.some(Boolean);
  return sharing.public ? internal ? '共享 · 外链' : '公开外链' : '已共享';
}
