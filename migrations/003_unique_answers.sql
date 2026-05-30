-- Add unique constraint to prevent duplicate answers
-- Migration 003: Ensure a user can only answer each question once per session

-- First, remove any existing duplicates by keeping the one with the most recent timestamp
DELETE FROM answers a1
USING answers a2
WHERE a1.timestamp < a2.timestamp
  AND a1.user_id = a2.user_id
  AND a1.session_id = a2.session_id
  AND a1.question_id = a2.question_id;

-- In case of identical timestamps, remove duplicates based on ctid (internal row ID)
DELETE FROM answers a1
USING answers a2
WHERE a1.ctid < a2.ctid
  AND a1.user_id = a2.user_id
  AND a1.session_id = a2.session_id
  AND a1.question_id = a2.question_id;

-- Remove the constraint if it already exists to avoid "relation already exists" error
ALTER TABLE answers DROP CONSTRAINT IF EXISTS answers_user_session_question_unique;

-- Add unique constraint
ALTER TABLE answers
ADD CONSTRAINT answers_user_session_question_unique
UNIQUE (user_id, session_id, question_id);
