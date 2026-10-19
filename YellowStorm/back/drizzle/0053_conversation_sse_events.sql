SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE conversation.sse_events (
  id bigserial PRIMARY KEY,
  user_id char(24) NOT NULL CHECK (user_id ~ '^[0-9a-f]{24}$'),
  conversation_id char(24) REFERENCES conversation.conversations(id) ON DELETE CASCADE,
  event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object' AND octet_length(event::text) <= 1100000),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX idx_sse_events_user_cursor ON conversation.sse_events(user_id, id);
--> statement-breakpoint
CREATE INDEX idx_sse_events_expiry ON conversation.sse_events(created_at);
