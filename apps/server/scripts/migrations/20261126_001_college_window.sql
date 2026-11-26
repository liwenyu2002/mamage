CREATE TABLE IF NOT EXISTS college_window_photos (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id INT UNSIGNED NOT NULL,
  unit_id INT UNSIGNED NOT NULL,
  photo_id INT UNSIGNED NOT NULL,
  object_key VARCHAR(160) CHARACTER SET ascii NOT NULL,
  metadata JSON NOT NULL,
  width INT UNSIGNED NOT NULL,
  height INT UNSIGNED NOT NULL,
  sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
  published_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  published_by INT UNSIGNED NOT NULL,
  revoked_at DATETIME(3) DEFAULT NULL,
  revoked_by INT UNSIGNED DEFAULT NULL,
  revoke_reason VARCHAR(32) CHARACTER SET ascii DEFAULT NULL,
  active_photo_id INT UNSIGNED GENERATED ALWAYS AS (IF(revoked_at IS NULL, photo_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_college_window_active_photo (active_photo_id),
  KEY idx_college_window_feed (organization_id, unit_id, revoked_at, id),
  KEY idx_college_window_source (photo_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- These run in the source transaction so resetting a restriction cannot revive a release.
DROP TRIGGER IF EXISTS college_window_photo_update;
CREATE TRIGGER college_window_photo_update AFTER UPDATE ON photos FOR EACH ROW
UPDATE college_window_photos w
   SET w.revoked_at = CURRENT_TIMESTAMP(3), w.revoke_reason = 'source_ineligible'
 WHERE w.active_photo_id = NEW.id AND (
   NEW.organization_id <> w.organization_id OR (NEW.unit_id IS NOT NULL AND NEW.unit_id <> w.unit_id)
   OR NEW.type NOT IN ('normal', 'cover', 'photo', 'image') OR NEW.source_attribution IS NOT NULL
   OR COALESCE(CAST(NEW.tags AS CHAR CHARACTER SET utf8mb4), '') REGEXP '禁止外发|不得外发|仅限内部|仅内部|保密'
   OR (COALESCE(CAST(NEW.tags AS CHAR CHARACTER SET utf8mb4), '') REGEXP '已脱敏|已匿名|已打码|人脸打码|人脸模糊|不公开姓名'
       AND COALESCE(CAST(OLD.tags AS CHAR CHARACTER SET utf8mb4), '') NOT REGEXP '已脱敏|已匿名|已打码|人脸打码|人脸模糊|不公开姓名')
   OR (NEW.project_id IS NULL AND NOT (NEW.unit_id <=> w.unit_id))
   OR (NOT (NEW.project_id <=> OLD.project_id) AND NEW.project_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM projects pr WHERE pr.id = NEW.project_id AND pr.organization_id = w.organization_id
         AND pr.unit_id = w.unit_id AND pr.restricted_to_user_id IS NULL
         AND COALESCE(pr.tags, '') NOT REGEXP '禁止外发|不得外发|仅限内部|仅内部|保密'))
 );

DROP TRIGGER IF EXISTS college_window_photo_delete;
CREATE TRIGGER college_window_photo_delete AFTER DELETE ON photos FOR EACH ROW
UPDATE college_window_photos SET revoked_at = CURRENT_TIMESTAMP(3), revoke_reason = 'source_deleted'
 WHERE active_photo_id = OLD.id;

DROP TRIGGER IF EXISTS college_window_project_update;
CREATE TRIGGER college_window_project_update AFTER UPDATE ON projects FOR EACH ROW
UPDATE college_window_photos w JOIN photos p ON p.id = w.active_photo_id AND p.project_id = NEW.id
   SET w.revoked_at = CURRENT_TIMESTAMP(3), w.revoke_reason = 'album_ineligible'
 WHERE NEW.organization_id <> w.organization_id OR NOT (NEW.unit_id <=> w.unit_id) OR NEW.restricted_to_user_id IS NOT NULL
    OR COALESCE(NEW.tags, '') REGEXP '禁止外发|不得外发|仅限内部|仅内部|保密';

DROP TRIGGER IF EXISTS college_window_project_delete;
CREATE TRIGGER college_window_project_delete BEFORE DELETE ON projects FOR EACH ROW
UPDATE college_window_photos w JOIN photos p ON p.id = w.active_photo_id AND p.project_id = OLD.id
   SET w.revoked_at = CURRENT_TIMESTAMP(3), w.revoke_reason = 'album_deleted';

DROP TRIGGER IF EXISTS college_window_unit_update;
CREATE TRIGGER college_window_unit_update AFTER UPDATE ON organization_units FOR EACH ROW
UPDATE college_window_photos w
   SET w.revoked_at = CURRENT_TIMESTAMP(3), w.revoke_reason = 'unit_ineligible'
 WHERE w.organization_id = OLD.organization_id AND w.unit_id = OLD.id AND w.revoked_at IS NULL
   AND (NEW.archived_at IS NOT NULL OR NEW.organization_id <> OLD.organization_id);
