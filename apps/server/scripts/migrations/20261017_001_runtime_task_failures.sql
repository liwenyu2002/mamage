CREATE TABLE IF NOT EXISTS runtime_task_failures (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(64) NOT NULL,
  photo_id BIGINT UNSIGNED NULL,
  attempt INT NOT NULL,
  stage VARCHAR(32) NOT NULL,
  error_code VARCHAR(96) NOT NULL,
  cause_code VARCHAR(96) NULL,
  http_status SMALLINT UNSIGNED NULL,
  retry_at BIGINT NULL,
  diagnostic JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_task_failures_task (task_id, id),
  KEY idx_task_failures_photo (photo_id, id),
  KEY idx_task_failures_retention (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
