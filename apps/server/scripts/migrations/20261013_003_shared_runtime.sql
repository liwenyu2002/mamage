CREATE TABLE IF NOT EXISTS runtime_state (
  namespace VARCHAR(64) NOT NULL,
  state_key VARCHAR(191) NOT NULL,
  payload JSON NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (namespace, state_key),
  KEY idx_runtime_state_expiry (namespace, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS runtime_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind VARCHAR(64) NOT NULL,
  dedupe_key VARCHAR(191) NOT NULL,
  lane VARCHAR(32) NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  payload JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  available_at BIGINT NOT NULL,
  owner VARCHAR(64) NULL,
  last_error VARCHAR(1000) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_runtime_task (kind, dedupe_key),
  KEY idx_runtime_dispatch (status, lane, priority, available_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
