ALTER TABLE wechat_compositions
  ADD COLUMN draft_kind VARCHAR(16) NOT NULL DEFAULT 'layout',
  ADD COLUMN source_document MEDIUMTEXT NULL;
