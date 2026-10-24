ALTER TABLE organization_unit_memberships
  MODIFY COLUMN role ENUM('member', 'editor', 'manager', 'viewer') NOT NULL DEFAULT 'editor';

UPDATE organization_unit_memberships SET role = 'editor' WHERE role = 'member';

-- MySQL DDL commits independently; allow retry after an interrupted migration.
SET @face_access_ddl = IF(
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'face_search_grants' AND column_name = 'can_manage'),
  'SELECT 1',
  'ALTER TABLE face_search_grants ADD COLUMN can_manage TINYINT(1) NOT NULL DEFAULT 0'
);
PREPARE face_access_stmt FROM @face_access_ddl;
EXECUTE face_access_stmt;
DEALLOCATE PREPARE face_access_stmt;

-- Preserve the existing explicit grants, including all five approved campus users.
UPDATE face_search_grants SET can_manage = 1 WHERE college_wide = 1;

-- Organizations without units use the same explicit face capability checks.
-- Retain their previously available administrator / photographer capabilities.
INSERT IGNORE INTO face_search_grants (organization_id, user_id, college_wide, can_manage, granted_by)
SELECT u.organization_id, u.id, 1, IF(u.role IN ('admin', 'superadmin'), 1, 0), u.id
FROM users u JOIN organizations o ON o.id = u.organization_id
WHERE u.role IN ('admin', 'superadmin', 'photographer')
  AND NOT EXISTS (SELECT 1 FROM organization_units ou WHERE ou.organization_id = u.organization_id);
