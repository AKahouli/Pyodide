DROP INDEX IF EXISTS conversation.idx_conversations_owner_last_message;
--> statement-breakpoint
DROP INDEX IF EXISTS conversation.idx_conversations_owner_created;
--> statement-breakpoint
DROP INDEX IF EXISTS conversation.idx_conversations_owner_project_last_message;
--> statement-breakpoint
DROP INDEX IF EXISTS conversation.idx_conversations_runtime_purpose;
--> statement-breakpoint
DROP INDEX IF EXISTS conversation.idx_conversations_initialization_status;
--> statement-breakpoint
DROP INDEX IF EXISTS conversation.idx_conversation_group_invites_email;
--> statement-breakpoint
DROP INDEX IF EXISTS conversation.idx_messages_conversation_created;
--> statement-breakpoint
DROP INDEX IF EXISTS conversation.idx_messages_conversation_type;
--> statement-breakpoint
DROP INDEX IF EXISTS conversation.idx_messages_question_type_created;
--> statement-breakpoint
DROP INDEX IF EXISTS conversation.idx_messages_streaming_updated;
--> statement-breakpoint
DROP INDEX IF EXISTS conversation.idx_messages_reliability_heartbeat;
--> statement-breakpoint
DROP INDEX IF EXISTS conversation.idx_shared_conversations_expires;
--> statement-breakpoint
DROP INDEX IF EXISTS conversation.idx_conversation_playbook_handoffs_expires;
--> statement-breakpoint
DROP INDEX IF EXISTS conversation.idx_reports_status_created;
--> statement-breakpoint
CREATE INDEX idx_conv_owner_ready_last_v2 ON conversation.conversations (created_by, last_message_at DESC NULLS LAST, id DESC) WHERE initialization_status = 'ready' AND runtime_purpose <> 'platform_copilot';
--> statement-breakpoint
CREATE INDEX idx_conv_owner_ready_created_v2 ON conversation.conversations (created_by, created_at DESC, id DESC) WHERE initialization_status = 'ready' AND runtime_purpose <> 'platform_copilot';
--> statement-breakpoint
CREATE INDEX idx_conv_owner_ready_title_v2 ON conversation.conversations (created_by, title, id) WHERE initialization_status = 'ready' AND runtime_purpose <> 'platform_copilot';
--> statement-breakpoint
CREATE INDEX idx_conv_owner_project_last_v2 ON conversation.conversations (created_by, project_id, last_message_at DESC NULLS LAST, id DESC);
--> statement-breakpoint
CREATE INDEX idx_conv_platform_owner_last_v2 ON conversation.conversations (created_by, last_message_at DESC NULLS LAST, created_at DESC, id DESC) WHERE runtime_purpose = 'platform_copilot';
--> statement-breakpoint
CREATE INDEX idx_conv_platform_agent_last_v2 ON conversation.conversations (created_by, pinned_agent_id, last_message_at DESC NULLS LAST, created_at DESC, id DESC) WHERE runtime_purpose = 'platform_copilot';
--> statement-breakpoint
CREATE INDEX idx_conv_initializing_updated_v2 ON conversation.conversations (updated_at, id) WHERE initialization_status IN ('pending', 'seeding', 'cleanup_pending');
--> statement-breakpoint
CREATE INDEX idx_conv_orphan_created_v2 ON conversation.conversations (created_at, id) WHERE message_count = 0 AND is_first_message = true AND is_shared = false;
--> statement-breakpoint
CREATE INDEX idx_group_members_user_conversation ON conversation.conversation_group_members (user_id, conversation_id);
--> statement-breakpoint
CREATE INDEX idx_group_invites_conversation_email ON conversation.conversation_group_invites (conversation_id, normalized_email);
--> statement-breakpoint
CREATE INDEX idx_mentions_user_unseen_conversation ON conversation.conversation_member_mentions (user_id, conversation_id) WHERE seen_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_messages_conv_created_v2 ON conversation.messages (conversation_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX idx_messages_conv_type_created_v2 ON conversation.messages (conversation_id, conversation_type, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX idx_messages_ai_question_created_v2 ON conversation.messages (question_message_id, created_at, id) WHERE conversation_type = 'ai';
--> statement-breakpoint
CREATE INDEX idx_messages_streaming_updated_v2 ON conversation.messages (updated_at, id) WHERE is_streaming = true;
--> statement-breakpoint
CREATE INDEX idx_messages_pending_reliability_v2 ON conversation.messages (reliability_evaluation_heartbeat_at, id) WHERE reliability_evaluation->>'status' = 'pending';
--> statement-breakpoint
CREATE INDEX idx_shared_original_created_v2 ON conversation.shared_conversations (original_conversation_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX idx_shared_expires_v2 ON conversation.shared_conversations (expires_at, id) WHERE expires_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_handoffs_expires_v2 ON conversation.conversation_playbook_handoffs (expires_at, id);
--> statement-breakpoint
CREATE INDEX idx_reports_created_v2 ON conversation.reports (created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX idx_reports_status_created_v2 ON conversation.reports (status, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX idx_reports_reason_created_v2 ON conversation.reports (reason, created_at DESC, id DESC);
