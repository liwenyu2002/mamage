-- Original upload names are independent of editable titles and generated object keys.
ALTER TABLE photos ADD COLUMN original_filename VARCHAR(512) NULL AFTER title;
