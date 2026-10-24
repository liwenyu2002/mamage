const positiveId = value => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

export function isPhotoUploadedBy(photo, userId) {
  const uploaderId = positiveId(photo?.photographerId ?? photo?.photographer_id);
  return uploaderId !== null && uploaderId === positiveId(userId);
}

export function canDeletePhoto(photo, user, { readOnly = false, projectUnitId } = {}) {
  if (readOnly || !photo || !positiveId(user?.id) || !user?.permissions?.includes('photos.delete')) return false;
  const scope = user.photoDeleteScope;
  if (scope === 'organization') return true;
  if (!['own', 'unit'].includes(scope)) return false;
  const activeUnitId = positiveId(user.activeUnitId);
  const unitId = positiveId(projectUnitId === undefined ? (photo.unitId ?? photo.unit_id) : projectUnitId);
  if (unitId !== activeUnitId) return false;
  if (scope === 'unit') return Boolean(activeUnitId);
  return isPhotoUploadedBy(photo, user.id);
}

export function getPhotoDeleteErrorMessage(error) {
  if (Number(error?.status) === 403) return '只能删除自己上传的照片和视频，或请管理员处理';
  if (Number(error?.status) === 404) return '照片已不存在或无权访问，请刷新相册';
  if (Number(error?.status) === 409) return '照片正在复制，请稍后再删除';
  return '删除失败，请稍后重试';
}
