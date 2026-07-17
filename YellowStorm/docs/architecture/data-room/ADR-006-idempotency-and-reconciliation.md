# ADR-006: At-least-once delivery with reconciliation

## Context

The POC may not have Mongo transactions available across every Workspace mutation.

## Decision

Treat duplicate event insertion as success, use event IDs at consumers, and reconcile missing state.

## Rejected alternatives

Exactly-once claims and best-effort-only integration were rejected.

## Consequences

Handlers must not create duplicate versions and reconciliation must be safe to rerun.

## Migration and rollback

Backfill and reconciliation are dry-run capable; rollback preserves their audit trail.

## Operations

Inspect reconciliation repairs and dead letters.
