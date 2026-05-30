-- Migration 006: Normalize answers table by removing redundant data
-- We remove columns that are already present in the questions table or are derived data.

ALTER TABLE answers DROP COLUMN IF EXISTS section_id;
ALTER TABLE answers DROP COLUMN IF EXISTS question_text;
ALTER TABLE answers DROP COLUMN IF EXISTS reponse;
