CREATE TABLE IF NOT EXISTS wechat_content_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  unit_id BIGINT UNSIGNED NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  outline TEXT NOT NULL,
  review_credits TINYINT(1) NOT NULL DEFAULT 1,
  visibility VARCHAR(16) NOT NULL DEFAULT 'private',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wechat_template_scope (organization_id, unit_id, visibility, owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
