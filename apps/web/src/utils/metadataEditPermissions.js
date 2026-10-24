const positiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export function canEditMetadata(resource, user, { kind = 'photo', readOnly = false, unitId } = {}) {
  if (readOnly || !resource || !positiveId(user?.id)) return false;
  const permission = kind === 'album' ? 'projects.update' : 'photos.edit';
  if (!user.permissions?.includes(permission)) return false;
  const scope = user.metadataEditScope;
  if (!['own', 'unit', 'organization'].includes(scope)) return false;
  if (typeof resource.canEdit === 'boolean') return resource.canEdit;
  if (scope === 'organization') return true;
  const resourceUnit = positiveId(unitId ?? resource.unitId ?? resource.unit_id);
  if (resourceUnit !== positiveId(user.activeUnitId)) return false;
  if (scope === 'unit') return resourceUnit !== null;
  const owner = kind === 'album' ? resource.adminId ?? resource.admin_id : resource.photographerId ?? resource.photographer_id;
  return positiveId(owner) !== null && positiveId(owner) === positiveId(user.id);
}
