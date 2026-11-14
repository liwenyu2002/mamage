-- 保存 IdP 每次登录返回的完整资料（IAM profile / Keycloak id_token+userinfo），便于排查字段缺失与后续人物档案。
CREATE TABLE IF NOT EXISTS iam_identity_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key CHAR(64) NOT NULL,
  subject_id VARCHAR(255) NOT NULL,
  user_id INT UNSIGNED DEFAULT NULL,
  provider VARCHAR(16) NOT NULL DEFAULT 'iam' COMMENT 'iam|oidc',
  profile JSON DEFAULT NULL COMMENT 'IdP 原样返回（IAM profile / Keycloak claims 合并）',
  claims JSON DEFAULT NULL COMMENT '映射后的规范字段 name/email/studentNo',
  bytes INT UNSIGNED NOT NULL DEFAULT 0,
  login_count INT UNSIGNED NOT NULL DEFAULT 1,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_idp_profile_identity (source_key, subject_id),
  KEY idx_idp_profile_user (user_id),
  KEY idx_idp_profile_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
