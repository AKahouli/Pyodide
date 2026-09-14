import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function main(): Promise<void> {
  const database = process.env.POSTGRES_TEST_DB;
  if (!database || database === process.env.POSTGRES_DB) {
    throw new Error('A dedicated POSTGRES_TEST_DB is required');
  }

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });

  try {
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
    const result = await pool.query<{
      tables: number;
      usage_tables: number;
      trgm: boolean;
      trigram_indexes: number;
      expected_indexes: number;
      invalid_indexes: number;
      superseded_indexes: number;
    }>(`
       SELECT
         (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'conversation') AS tables,
        (SELECT count(*)::int FROM information_schema.tables
          WHERE table_schema = 'conversation' AND table_name IN ('usage_windows', 'usage_logs')) AS usage_tables,
        EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS trgm,
        (SELECT count(*)::int FROM pg_indexes
          WHERE schemaname = 'conversation' AND indexdef ILIKE '%gin%gin_trgm_ops%') AS trigram_indexes,
        (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'conversation' AND indexname = ANY(ARRAY[
          'idx_conv_owner_ready_last_v2', 'idx_conv_owner_ready_created_v2',
          'idx_conv_owner_ready_title_v2', 'idx_conv_owner_project_last_v2',
          'idx_conv_platform_owner_last_v2', 'idx_conv_platform_agent_last_v2',
          'idx_conv_initializing_updated_v2', 'idx_conv_orphan_created_v2',
          'idx_group_members_user_conversation', 'idx_group_invites_conversation_email',
          'idx_mentions_user_unseen_conversation', 'idx_messages_conv_created_v2',
          'idx_messages_conv_type_created_v2', 'idx_messages_ai_question_created_v2',
          'idx_messages_streaming_updated_v2', 'idx_messages_pending_reliability_v2',
          'idx_shared_original_created_v2', 'idx_shared_expires_v2',
          'idx_handoffs_expires_v2', 'idx_reports_created_v2',
          'idx_reports_status_created_v2', 'idx_reports_reason_created_v2',
          'uq_usage_windows_user_window', 'idx_usage_windows_user_end',
          'idx_usage_windows_start_plan', 'idx_usage_logs_user_created',
          'idx_usage_logs_type_model_created', 'idx_usage_logs_created',
          'uq_conversation_usage_events_event_key',
          'idx_conversation_usage_events_conversation_created',
          'idx_conversation_usage_events_model_created'
        ])) AS expected_indexes,
        (SELECT count(*)::int FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'conversation' AND (NOT i.indisready OR NOT i.indisvalid)) AS invalid_indexes,
        (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'conversation' AND indexname = ANY(ARRAY[
          'idx_conversations_owner_last_message', 'idx_conversations_owner_created',
          'idx_conversations_owner_project_last_message', 'idx_conversations_runtime_purpose',
          'idx_conversations_initialization_status', 'idx_messages_conversation_created',
          'idx_messages_conversation_type', 'idx_messages_question_type_created',
          'idx_messages_streaming_updated', 'idx_messages_reliability_heartbeat'
        ])) AS superseded_indexes
    `);
    const summary = result.rows[0];
    if (summary.usage_tables !== 2 || !summary.trgm || summary.trigram_indexes !== 2 || summary.expected_indexes !== 31 || summary.invalid_indexes !== 0 || summary.superseded_indexes !== 0) {
      throw new Error(`Unexpected migration summary: ${JSON.stringify(summary)}`);
    }
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Migration test failed'}\n`);
  process.exitCode = 1;
});
