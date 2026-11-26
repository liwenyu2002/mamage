-- The same source provenance rule is enforced by lib/queries/college_window.js on every read.
DROP TRIGGER IF EXISTS college_window_photo_update;
CREATE TRIGGER college_window_photo_update AFTER UPDATE ON photos FOR EACH ROW
UPDATE college_window_photos w
   SET w.revoked_at = CURRENT_TIMESTAMP(3), w.revoke_reason = 'source_ineligible'
 WHERE w.active_photo_id = NEW.id AND (
   NEW.organization_id <> w.organization_id OR (NEW.unit_id IS NOT NULL AND NEW.unit_id <> w.unit_id)
   OR NEW.type NOT IN ('normal', 'cover', 'photo', 'image')
   OR (NEW.source_attribution IS NOT NULL AND NOT (
     COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.source_attribution, '$.type')), '') = 'external_import'
     AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.source_attribution, '$.provider')), '') IN ('photoplus', 'alltuu')
     AND JSON_CONTAINS_PATH(NEW.source_attribution, 'one', '$.shareId', '$.sourceUnitId', '$.sourceOrganizationId', '$.sourcePhotoUuid', '$.copiedAt') = 0
   ))
   OR COALESCE(CAST(NEW.tags AS CHAR CHARACTER SET utf8mb4), '') REGEXP '禁止外发|不得外发|仅限内部|仅内部|保密'
   OR (COALESCE(CAST(NEW.tags AS CHAR CHARACTER SET utf8mb4), '') REGEXP '已脱敏|已匿名|已打码|人脸打码|人脸模糊|不公开姓名'
       AND COALESCE(CAST(OLD.tags AS CHAR CHARACTER SET utf8mb4), '') NOT REGEXP '已脱敏|已匿名|已打码|人脸打码|人脸模糊|不公开姓名')
   OR (NEW.project_id IS NULL AND NOT (NEW.unit_id <=> w.unit_id))
   OR (NOT (NEW.project_id <=> OLD.project_id) AND NEW.project_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM projects pr WHERE pr.id = NEW.project_id AND pr.organization_id = w.organization_id
         AND pr.unit_id = w.unit_id AND pr.restricted_to_user_id IS NULL
         AND COALESCE(pr.tags, '') NOT REGEXP '禁止外发|不得外发|仅限内部|仅内部|保密'))
 );
