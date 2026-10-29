CREATE TABLE IF NOT EXISTS iam_departments (
  source_key CHAR(64) NOT NULL,
  external_id VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
  name VARCHAR(191) NOT NULL,
  parent_id VARCHAR(191) COLLATE utf8mb4_bin NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 0,
  event_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  payload_hash CHAR(64) NOT NULL DEFAULT '',
  PRIMARY KEY (source_key, external_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS iam_accounts (
  source_key CHAR(64) NOT NULL,
  external_id VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
  user_id INT UNSIGNED NULL,
  organization_id INT UNSIGNED NOT NULL,
  principal_id VARCHAR(191) NOT NULL,
  name VARCHAR(50) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  student_no VARCHAR(32) NOT NULL DEFAULT '',
  departments JSON NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 0,
  event_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  payload_hash CHAR(64) NOT NULL DEFAULT '',
  PRIMARY KEY (source_key, external_id),
  UNIQUE KEY uq_iam_accounts_user (source_key, user_id),
  KEY idx_iam_accounts_user (user_id),
  CONSTRAINT fk_iam_accounts_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS iam_user_state (
  user_id INT UNSIGNED NOT NULL,
  disabled TINYINT UNSIGNED NOT NULL DEFAULT 0,
  session_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  media_revoked_before BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_iam_user_state_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS iam_push_receipts (
  source_key CHAR(64) NOT NULL,
  request_key CHAR(64) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  response JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_key, request_key),
  KEY idx_iam_receipts_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS iam_identity_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key CHAR(64) NOT NULL,
  identity_hash CHAR(64) NOT NULL,
  user_id INT UNSIGNED NULL,
  action VARCHAR(40) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_iam_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
