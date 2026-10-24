-- Keep the existing short description and legacy rows unchanged.
ALTER TABLE photos ADD COLUMN detailed_description TEXT NULL AFTER description;
