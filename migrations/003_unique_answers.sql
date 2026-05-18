-- Add unique constraint to prevent duplicate answers
-- Migration 003: Ensure a user can only answer each question once per session

-- First, remove any existing duplicates (keep the most recent one)
DELETE FROM answers a1
USING answers a2
WHERE a1.reponse_id < a2.reponse_id
  AND a1.user_id = a2.user_id
  AND a1.session_id = a2.session_id
  AND a1.question_id = a2.question_id;

-- Add unique constraint
ALTER TABLE answers
ADD CONSTRAINT answers_user_session_question_unique
UNIQUE (user_id, session_id, question_id);
