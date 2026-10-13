SET LOCAL lock_timeout = '5s';

-- Existing rows remain legacy/shared sessions and block isolated turns until settled.
ALTER TABLE conversation.conversation_executions ADD COLUMN IF NOT EXISTS native_session_id text;
ALTER TABLE conversation.conversations ADD COLUMN IF NOT EXISTS root_work_last_stop_foreground_message_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
DROP INDEX IF EXISTS conversation.uq_conversation_executions_running_conversation;
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_executions_running_session
  ON conversation.conversation_executions (conversation_id, COALESCE(native_session_id, 'legacy'))
  WHERE status = 'running';

-- Protect mixed-version writers as well as new admission code. A shared native
-- session must never overlap an isolated ROOT session in the same conversation.
CREATE OR REPLACE FUNCTION conversation.guard_foreground_session_admission() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'running' THEN
    PERFORM id FROM conversation.conversations WHERE id = NEW.conversation_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM conversation.conversation_executions
      WHERE conversation_id = NEW.conversation_id AND status = 'running' AND id <> NEW.id
        AND (native_session_id IS NULL OR NEW.native_session_id IS NULL)) THEN
      RAISE EXCEPTION 'Foreground shared session is busy' USING ERRCODE = '23505',
        CONSTRAINT = 'uq_conversation_executions_running_session';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS guard_foreground_session_admission ON conversation.conversation_executions;
CREATE TRIGGER guard_foreground_session_admission
  BEFORE INSERT OR UPDATE OF native_session_id, status ON conversation.conversation_executions
  FOR EACH ROW EXECUTE FUNCTION conversation.guard_foreground_session_admission();
