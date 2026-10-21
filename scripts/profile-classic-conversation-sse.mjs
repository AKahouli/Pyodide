#!/usr/bin/env node
// Read-only profile of the existing poll and cleanup plans, on isolated loopback PG only.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require = createRequire(new URL('../YellowStorm/back/package.json', import.meta.url));
const { Client } = require('pg');

async function main() {
  const [user, cursor, output] = process.argv.slice(2);
  if (!/^[a-f0-9]{24}$/i.test(user ?? '') || !/^\d{1,15}$/.test(cursor ?? '') || !output) throw new Error('arguments');
  const env = process.env;
  if (!['127.0.0.1', 'localhost', '::1'].includes(env.POSTGRES_HOST) || !env.POSTGRES_TEST_DB || env.POSTGRES_TEST_DB === env.POSTGRES_DB) throw new Error('isolated_database_required');
  const client = new Client({ host: env.POSTGRES_HOST, port: Number(env.POSTGRES_PORT ?? 5432),
    database: env.POSTGRES_TEST_DB, user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD,
    connectionTimeoutMillis: 5000, statement_timeout: 10000, application_name: 'pr06-readonly-profile' });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const rows = async (query, params = []) => (await client.query(query, params)).rows;
    // Mirrors gateway SELECT. Keep recipient predicate and current access checks.
    const poll = await rows(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT anchor.anchor_valid, event_rows.* FROM (
        SELECT ($2::bigint IS NULL OR EXISTS (SELECT 1 FROM conversation.sse_events
          WHERE (user_id = $1 OR user_id = '000000000000000000000000')
          AND id = $2::bigint AND created_at >= now() - $3 * interval '1 millisecond'
          AND id >= COALESCE((SELECT min(retained.id) FROM conversation.sse_events retained
            WHERE (retained.user_id = $1 OR retained.user_id = '000000000000000000000000')
            AND retained.event->>'type' <> 'stream_resync_required'
            AND retained.created_at >= now() - $3 * interval '1 millisecond'), id))) AS anchor_valid
      ) anchor LEFT JOIN LATERAL (SELECT e.id::text AS id, e.event,
        (e.conversation_id IS NULL OR EXISTS (SELECT 1 FROM conversation.conversations c
          WHERE c.id = e.conversation_id AND (c.created_by = $1 OR
            (c.is_group AND EXISTS (SELECT 1 FROM conversation.conversation_group_members m
              WHERE m.conversation_id = c.id AND m.user_id = $1))))) AS allowed
        FROM conversation.sse_events e WHERE (e.user_id = $1 OR e.user_id = '000000000000000000000000')
        AND e.id > COALESCE($2::bigint, 0) AND e.created_at >= now() - $3 * interval '1 millisecond'
        ORDER BY e.id LIMIT $4) event_rows ON true`, [user, cursor === '0' ? null : cursor, 120000, 200]);
    // Do not execute deletes while profiling: EXPLAIN only, never ANALYZE.
    const cleanup = await rows(`EXPLAIN (FORMAT JSON) DELETE FROM conversation.sse_events WHERE id IN (
      SELECT id FROM (SELECT id, created_at, row_number() OVER (PARTITION BY user_id
        ORDER BY (event->>'type' = 'stream_resync_required') DESC, id DESC) AS rank
        FROM conversation.sse_events WHERE user_id = $1) retained
      WHERE rank > 200 OR created_at < now() - interval '120 seconds')`, [user]);
    const ttl = await rows(`EXPLAIN (FORMAT JSON) DELETE FROM conversation.sse_events WHERE id IN (
      SELECT id FROM conversation.sse_events WHERE created_at < now() - interval '120 seconds' LIMIT 2000)`);
    const resources = await rows(`SELECT numbackends, xact_commit, xact_rollback, blks_read, blks_hit,
      temp_bytes, deadlocks, stats_reset FROM pg_stat_database WHERE datname = current_database()`);
    const locks = await rows(`SELECT wait_event_type, wait_event, count(*)::int AS connections,
      max(EXTRACT(epoch FROM (clock_timestamp() - query_start)) * 1000) AS oldest_query_ms
      FROM pg_stat_activity WHERE datname = current_database() GROUP BY wait_event_type, wait_event`);
    const indexes = await rows(`SELECT indexrelname, idx_scan, idx_tup_read, idx_tup_fetch
      FROM pg_stat_user_indexes WHERE schemaname = 'conversation' AND relname = 'sse_events'`);
    const retention = await rows(`SELECT count(*)::int AS rows, pg_total_relation_size('conversation.sse_events') AS bytes,
      count(*) FILTER (WHERE created_at < now() - interval '120 seconds')::int AS expired_rows,
      count(*) FILTER (WHERE user_id = '000000000000000000000000')::int AS global_markers FROM conversation.sse_events`);
    await client.query('ROLLBACK');
    // PostgreSQL plans can render bound values in expressions: redact fixture IDs.
    const report = JSON.stringify({ capturedAt: new Date().toISOString(), config: { ttlMs: 120000, replayMaxEvents: 200 },
      poll, cleanup, ttl, resources, locks, indexes, retention, cpu: 'external host/container collector required' }, null, 2)
      .replaceAll(user, '[recipient]');
    await writeFile(output, report, { flag: 'wx', mode: 0o600 });
  } finally { await client.end(); }
}
main().catch(() => { process.stderr.write('SSE profile failed; verify isolated loopback test database, fixture IDs and output path.\n'); process.exitCode = 1; });
