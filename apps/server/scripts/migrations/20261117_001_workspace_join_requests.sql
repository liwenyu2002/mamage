CREATE TABLE IF NOT EXISTS organization_join_preferences (
  user_id INT UNSIGNED NOT NULL,
  dismissed_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_join_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS organization_join_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  unit_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  reason VARCHAR(300) NOT NULL DEFAULT '',
  review_note VARCHAR(300) NOT NULL DEFAULT '',
  reviewed_by INT UNSIGNED NULL,
  review_revision INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reviewed_at DATETIME(3) NULL,
  read_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_join_request_member (unit_id, user_id),
  KEY idx_join_request_inbox (organization_id, status, unit_id, created_at),
  KEY idx_join_request_applicant (user_id, status, read_at),
  CONSTRAINT fk_join_request_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_join_request_unit FOREIGN KEY (unit_id) REFERENCES organization_units(id),
  CONSTRAINT fk_join_request_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_join_request_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
