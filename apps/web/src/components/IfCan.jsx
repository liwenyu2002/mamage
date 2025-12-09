import React from 'react';
import { canAll } from '../permissionStore';

export default function IfCan({ perms = [], children }) {
  if (!canAll(...perms)) return null;
  return <>{children}</>;
}
