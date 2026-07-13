# ADR-004: Persist cross-domain integration events

## Context

Cross-domain work must survive process failures and retries.

## Decision

Use a generic persistent outbox with versioned event names, atomic locks, retries, and dead letters.

## Rejected alternatives

In-memory event emitters and direct domain imports were rejected.

## Consequences

Delivery is at-least-once; consumers must be idempotent.

## Migration and rollback

Flags can stop producers and dispatching without deleting history.

## Operations

Alert on stale locks, dead letters, and old pending events.
