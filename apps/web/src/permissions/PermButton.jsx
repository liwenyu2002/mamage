import React from 'react';
import { Button } from '../ui';
import { canAll } from './permissionStore';

// Disabled (not hidden) if lacking permission
export default function PermButton({ perms = [], children, disabled, ...rest }) {
  const allowed = canAll(...perms);
  return (
    <Button disabled={disabled || !allowed} {...rest}>
      {children}
    </Button>
  );
}
