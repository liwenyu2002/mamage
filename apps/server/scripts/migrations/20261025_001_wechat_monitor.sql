CREATE TABLE IF NOT EXISTS wechat_monitor_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  scope_key VARCHAR(80) NOT NULL,
  org_id BIGINT UNSIGNED NOT NULL,
  unit_id BIGINT UNSIGNED NULL,
  account_key VARCHAR(48) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  biz VARCHAR(160) NULL,
  expected_names TEXT NOT NULL,
  since_date VARCHAR(10) NOT NULL DEFAULT '2024-01-01',
  enabled TINYINT NOT NULL DEFAULT 1,
  interval_seconds INT NOT NULL DEFAULT 1800,
  discovery_config MEDIUMTEXT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'needs_source',
  last_checked_at BIGINT NULL,
  last_request_at BIGINT NULL,
  next_check_at BIGINT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wechat_monitor_account (scope_key, account_key),
  KEY ix_wechat_monitor_due (enabled, next_check_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wechat_monitor_articles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  scope_key VARCHAR(80) NOT NULL,
  canonical_key CHAR(64) NOT NULL,
  source_url TEXT NOT NULL,
  title VARCHAR(512) NOT NULL,
  author VARCHAR(160) NOT NULL,
  published_at BIGINT NOT NULL,
  identity_status VARCHAR(32) NOT NULL,
  current_revision_id BIGINT UNSIGNED NULL,
  current_analysis_id BIGINT UNSIGNED NULL,
  first_seen_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  UNIQUE KEY uq_wechat_monitor_article (account_id, canonical_key),
  KEY ix_wechat_monitor_article_scope (scope_key, published_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wechat_monitor_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  article_id BIGINT UNSIGNED NOT NULL,
  content_hash CHAR(64) NOT NULL,
  blocks MEDIUMTEXT NOT NULL,
  plain_text MEDIUMTEXT NOT NULL,
  style_blocks MEDIUMTEXT NOT NULL,
  visual_features TEXT NOT NULL,
  metadata TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wechat_monitor_revision (article_id, content_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wechat_monitor_analyses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  article_id BIGINT UNSIGNED NOT NULL,
  revision_id BIGINT UNSIGNED NOT NULL,
  protocol_version VARCHAR(32) NOT NULL,
  model VARCHAR(160) NOT NULL,
  scene VARCHAR(48) NOT NULL,
  analysis MEDIUMTEXT NOT NULL,
  features MEDIUMTEXT NOT NULL,
  tokens_used INT NOT NULL DEFAULT 0,
  duration_ms INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wechat_monitor_analysis (revision_id, protocol_version),
  KEY ix_wechat_monitor_scene (scene, article_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wechat_monitor_relations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  scope_key VARCHAR(80) NOT NULL,
  article_low BIGINT UNSIGNED NOT NULL,
  article_high BIGINT UNSIGNED NOT NULL,
  revision_low BIGINT UNSIGNED NOT NULL,
  revision_high BIGINT UNSIGNED NOT NULL,
  similarity DOUBLE NOT NULL,
  summary TEXT NOT NULL,
  evidence TEXT NOT NULL,
  UNIQUE KEY uq_wechat_monitor_relation (article_low, article_high)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wechat_monitor_groups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  scope_key VARCHAR(80) NOT NULL,
  group_key CHAR(64) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  name VARCHAR(120) NOT NULL,
  account_id BIGINT UNSIGNED NULL,
  summary MEDIUMTEXT NULL,
  summary_fingerprint CHAR(64) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wechat_monitor_group (scope_key, group_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wechat_monitor_memberships (
  group_id BIGINT UNSIGNED NOT NULL,
  article_id BIGINT UNSIGNED NOT NULL,
  revision_id BIGINT UNSIGNED NOT NULL,
  evidence TEXT NOT NULL,
  confidence DOUBLE NOT NULL,
  PRIMARY KEY (group_id, article_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wechat_monitor_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  scope_key VARCHAR(80) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(24) NOT NULL,
  dedupe_key CHAR(64) NOT NULL,
  payload MEDIUMTEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_run_at BIGINT NOT NULL DEFAULT 0,
  started_at BIGINT NULL,
  finished_at BIGINT NULL,
  error_code VARCHAR(64) NULL,
  error_message TEXT NULL,
  result TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wechat_monitor_job (dedupe_key),
  KEY ix_wechat_monitor_job_due (status, next_run_at, id),
  KEY ix_wechat_monitor_job_scope (scope_key, account_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wechat_monitor_job_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  job_id BIGINT UNSIGNED NOT NULL,
  attempt INT NOT NULL,
  status VARCHAR(16) NOT NULL,
  error_code VARCHAR(64) NULL,
  error_message TEXT NULL,
  created_at BIGINT NOT NULL,
  KEY ix_wechat_monitor_event (job_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
