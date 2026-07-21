# ADR-009: Due reviews change validity state without inventing expiry

## Context

Sources with an explicit review schedule need a durable indication that a human decision is due. A missed review must not silently create an expiry date.

## Decision

An hourly, feature-flagged scheduler scans a bounded batch of active source versions whose `nextReviewAt` has elapsed. It atomically changes their business status to `needs_review` and writes one idempotent source event per review date.

## Consequences

Archived sources are ignored. The scheduler does not publish, suspend, or alter effective dates; later policy work may decide how a due review affects snapshots or deployment readiness.

## Migration and rollback

This is additive. Turning off validity intelligence stops scheduled processing and preserves the audit trail.

## Operations

Replica-set MongoDB uses an atomic transaction. Standalone MongoDB uses a compensating fallback that restores the prior status if audit creation fails.
Each run also repairs a due-review audit record that may be missing after a double failure.
