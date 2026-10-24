CREATE TABLE IF NOT EXISTS folder_shares (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  source_unit_id INT UNSIGNED NOT NULL,
  source_folder_id VARCHAR(80) NOT NULL,
  folder_name VARCHAR(80) NOT NULL,
  target_unit_id INT UNSIGNED NULL,
  target_user_id INT UNSIGNED NULL,
  mode ENUM('read', 'collaborate', 'copy', 'public') NOT NULL,
  snapshot_json JSON NULL,
  created_by INT UNSIGNED NOT NULL,
  expires_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_folder_shares_source (organization_id, source_unit_id, source_folder_id),
  KEY idx_folder_shares_target (organization_id, target_unit_id, revoked_at, expires_at),
  CONSTRAINT fk_folder_shares_org FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_folder_shares_source FOREIGN KEY (source_unit_id) REFERENCES organization_units (id),
  CONSTRAINT fk_folder_shares_target FOREIGN KEY (target_unit_id) REFERENCES organization_units (id),
  CONSTRAINT fk_folder_shares_recipient FOREIGN KEY (target_user_id) REFERENCES users (id),
  CONSTRAINT fk_folder_shares_creator FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE internal_shares
  ADD COLUMN folder_share_id BIGINT UNSIGNED NULL,
  ADD KEY idx_internal_shares_folder (folder_share_id, project_id, revoked_at),
  ADD CONSTRAINT fk_internal_shares_folder FOREIGN KEY (folder_share_id) REFERENCES folder_shares (id);

ALTER TABLE share_links
  ADD COLUMN folder_share_id BIGINT UNSIGNED NULL,
  ADD KEY idx_share_links_folder (folder_share_id),
  ADD CONSTRAINT fk_share_links_folder FOREIGN KEY (folder_share_id) REFERENCES folder_shares (id);
