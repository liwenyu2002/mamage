CREATE TABLE IF NOT EXISTS iam_login_identities (
  source_key CHAR(64) NOT NULL,
  subject_id VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_key, subject_id),
  UNIQUE KEY uq_iam_login_user (source_key, user_id),
  CONSTRAINT fk_iam_login_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS iam_login_pending (
  source_key CHAR(64) NOT NULL,
  subject_id VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
  claims JSON NOT NULL,
  reason VARCHAR(50) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_key, subject_id),
  KEY idx_iam_pending_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
