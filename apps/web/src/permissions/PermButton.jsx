import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import '../semiTheme';
import { canAll } from './permissionStore';

// Disabled (not hidden) if lacking permission
export default function PermButton({ perms = [], children, ...rest }) {
  const allowed = canAll(...perms);
  return (
    <Button disabled={!allowed} {...rest}>
      {children}
    </Button>
  );
}
