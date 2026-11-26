ALTER TABLE college_window_photos
  ADD COLUMN original_url VARCHAR(255) DEFAULT NULL AFTER object_key,
  MODIFY COLUMN object_key VARCHAR(160) CHARACTER SET ascii DEFAULT NULL,
  MODIFY COLUMN width INT UNSIGNED DEFAULT NULL,
  MODIFY COLUMN height INT UNSIGNED DEFAULT NULL,
  MODIFY COLUMN sha256 CHAR(64) CHARACTER SET ascii DEFAULT NULL,
  ADD CONSTRAINT chk_college_window_image_source CHECK (
    (original_url IS NULL AND object_key IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND sha256 IS NOT NULL)
    OR (original_url IS NOT NULL AND object_key IS NULL AND width IS NULL AND height IS NULL AND sha256 IS NULL)
  );

DROP TRIGGER IF EXISTS college_window_original_url_update;
CREATE TRIGGER college_window_original_url_update AFTER UPDATE ON photos FOR EACH ROW
UPDATE college_window_photos
   SET revoked_at = CURRENT_TIMESTAMP(3), revoke_reason = 'source_replaced'
 WHERE active_photo_id = NEW.id AND original_url IS NOT NULL
   AND NOT (CAST(original_url AS BINARY) <=> CAST(NEW.url AS BINARY));
