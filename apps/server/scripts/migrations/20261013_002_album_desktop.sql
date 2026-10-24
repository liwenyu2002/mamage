-- Preserve the legacy manual migration's schema and all existing folder data.
CREATE TABLE IF NOT EXISTS album_desktop_workspaces (
  organization_id BIGINT NOT NULL,
  unit_key BIGINT NOT NULL DEFAULT 0,
  state JSON NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, unit_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS album_desktop_users (
  user_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  unit_key BIGINT NOT NULL DEFAULT 0,
  state JSON NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, organization_id, unit_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
