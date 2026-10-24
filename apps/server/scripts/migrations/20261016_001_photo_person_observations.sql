-- Per-face visual observations never store a person's mutable name or cluster ID.
CREATE TABLE IF NOT EXISTS photo_person_observations (
  face_id BIGINT UNSIGNED NOT NULL,
  source_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  observation_json JSON NOT NULL,
  analyzed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (face_id),
  CONSTRAINT fk_photo_person_observation_face FOREIGN KEY (face_id)
    REFERENCES photo_faces(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
