-- Existing accounts keep their current access. Future accounts are own-only.
SET @photo_scope_ddl = IF(
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'users' AND column_name = 'view_organization_photos'),
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN view_organization_photos TINYINT(1) NOT NULL DEFAULT 1'
);
PREPARE photo_scope_stmt FROM @photo_scope_ddl;
EXECUTE photo_scope_stmt;
DEALLOCATE PREPARE photo_scope_stmt;
ALTER TABLE users ALTER COLUMN view_organization_photos SET DEFAULT 0;
