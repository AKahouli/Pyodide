# ADR-0027: PostgreSQL recipient replay for classic conversation SSE

- Status: proposed
- Date: 2026-10-18
- Owner: ConversationModule
- Scope: classic conversation only; conversation-v2 unchanged
- User approval: named `conversation.sse_events` design approved in remediation session, reply to call_daaf9b69 (existing PostgreSQL and owning service, no new service/runtime).

## Context

Execution admission is distributed, but classic conversation SSE delivery and replay lived in process-local maps. A POST handled on one replica could not reach an SSE connection on another. Browser access JWTs also appeared in EventSource URLs.

## Decision proposed for review

Reuse the existing PostgreSQL pool and StreamGatewayService. Migration 0053 adds recipient-scoped `conversation.sse_events` rows with a globally increasing identity, conversation foreign key, JSON event and creation time. A single transaction advisory lock is acquired before allocating identities; batches therefore commit in cursor order. Cursor `pg:1:<id>` fits the existing opaque replay shape. Old process cursors trigger canonical resync.

Producers enqueue without awaiting database I/O. The existing gateway batches at most100 events after25ms; pending events are bounded at1000 events,8MiB total,1MiB per event. Overload replaces a recipient's pending deltas with a durable `stream_resync_required` marker. Recipient-cardinality overload replaces the queue with one payload-free global resync marker (reserved all-zero recipient) so remote replicas also reconcile. Failed writes retry recovery markers after1s and disconnect local connections; raw payloads/driver errors never enter logs. The shared database advisory lock deliberately serializes batch commits; partition only if measured throughput warrants a different ordering contract.

Each connected SSE polls committed rows every200ms; it reads only its recipient or payload-free global resync markers and rechecks current conversation owner/group membership before disclosing every payload. Polling stops on unsubscribe/disconnect/shutdown. A missing retained anchor or a legacy cursor emits canonical resync. First connections also resync before retained replay, because a producer can crash between enqueue and commit. Retention uses existing per-user max-event and TTL settings, bounded cleanup on writes. Historical idle rows are inaccessible after TTL even before physical cleanup.

Nest runtime requires the existing DRIZZLE_DB provider and probes the table on startup; a missing migration fails startup. Direct construction without a database retains the old in-memory behavior solely for existing gateway unit tests; production dependency injection cannot omit the provider. No migration is applied automatically to the application database.

Classic frontend uses fetch with an Authorization bearer header, bounded module-owned SSE parsing, AbortController and the existing shared refresh owner. Session replacement clears replay identity; refresh of the same session preserves it. Issuer/audience/algorithm/access-type/session verification are unchanged. The shared guard retains query-token support only for existing conversation-v2 paths.

## Guarantees and limits

Delivery is replayable with at-least-once semantics and canonical resync on detected retention/overload gaps. The frontend's existing reconciliation remains the duplicate sink. This queue is not a transactional outbox: process death can discard a pre-commit batch; recovery/canonical snapshots own durable message truth. A healthy remote connection receives a canonical resync at most every30s, bounding the unpublished-batch blind spot independently of reconnection. Do not claim exactly-once delivery. Up to200ms polling latency and database query load need deployment qualification at10/30 users; this change does not prove production TTFT or capacity. Per-user connection limits remain per replica, as before; fleet-wide connection admission is not added.

## Verification

Focused classic frontend transport/auth and backend guard tests; real isolated PostgreSQL two-instance publish/order/reconnect, retention, recipient isolation/current membership revocation and bounded-queue regressions. Tests must not use the application database. Deployment requires migration0053 before runtime startup and an explicit multi-replica canary/load assessment.
