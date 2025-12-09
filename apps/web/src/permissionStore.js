// Simple permission store (global singleton)
let permissionSet = new Set();

export function setPermissions(perms) {
  permissionSet = new Set(Array.isArray(perms) ? perms : []);
}

export function clearPermissions() {
  permissionSet = new Set();
}

export function canAll(...perms) {
  if (!perms || perms.length === 0) return true;
  return perms.every((p) => permissionSet.has(p));
}

export function canAny(...perms) {
  if (!perms || perms.length === 0) return true;
  return perms.some((p) => permissionSet.has(p));
}

export function getPermissions() {
  return Array.from(permissionSet);
}
