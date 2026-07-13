# ADR-005: Unknown validity is a valid state

## Context

Many sources have no explicit business expiry.

## Decision

Store unknown validity explicitly with `mode=unknown` and `businessStatus=unknown`.

## Rejected alternatives

Rejecting ingestion when expiry is absent was rejected.

## Consequences

Review workflows can qualify validity later without blocking capture.

## Migration and rollback

Legacy sources backfill with unknown validity.

## Operations

Track unknown-validity volume as a review backlog, not an ingestion error.
