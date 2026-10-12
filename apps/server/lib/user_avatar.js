const { buildUploadUrl } = require('../db');

function validAvatar(value, userId) {
  if (value === null || value === '') return true;
  if (typeof value !== 'string' || value.length > 1024 * 1024) return false;
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(value)) return true;
  return new RegExp(`^/?uploads/avatars/${Number(userId)}/[a-zA-Z0-9_-]+\\.(?:png|jpe?g|webp|gif)$`, 'i').test(value);
}

function buildAvatarUrl(value, userId) {
  if (!value || !validAvatar(value, userId)) return null;
  return value.startsWith('data:') ? value : buildUploadUrl(value);
}

module.exports = { validAvatar, buildAvatarUrl };
