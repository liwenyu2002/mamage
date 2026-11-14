-- 人脸人物档案：补充消歧与档案字段（同名人物靠工号/部门/别名区分，后续用于智能人物档案）
ALTER TABLE face_persons
  ADD COLUMN alias VARCHAR(255) DEFAULT NULL COMMENT '别名/其他写法，逗号分隔',
  ADD COLUMN employee_no VARCHAR(64) DEFAULT NULL COMMENT '学工号/员工号，同名消歧主键之一',
  ADD COLUMN department VARCHAR(120) DEFAULT NULL COMMENT '部门/院系',
  ADD COLUMN title VARCHAR(120) DEFAULT NULL COMMENT '职位/身份',
  ADD COLUMN email VARCHAR(255) DEFAULT NULL,
  ADD COLUMN phone VARCHAR(64) DEFAULT NULL,
  ADD COLUMN tags JSON DEFAULT NULL COMMENT '标签数组，如 ["教师","校友"]',
  ADD COLUMN profile JSON DEFAULT NULL COMMENT '结构化档案：来源、关键事实、外部链接等',
  ADD COLUMN summary TEXT DEFAULT NULL COMMENT '档案摘要（可由 AI 生成）',
  ADD COLUMN importance TINYINT NOT NULL DEFAULT 0 COMMENT '0普通 1关注 2重要 3公众人物',
  ADD COLUMN source VARCHAR(24) NOT NULL DEFAULT 'manual' COMMENT 'manual|auto|import|merge',
  ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT 'active|merged|archived',
  ADD COLUMN merged_into BIGINT UNSIGNED DEFAULT NULL COMMENT '合并去向',
  ADD COLUMN updated_by INT UNSIGNED DEFAULT NULL,
  ADD KEY idx_face_persons_org_employee (organization_id, employee_no),
  ADD KEY idx_face_persons_org_status (organization_id, status);
