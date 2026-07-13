# ADR-007: Workspace deletion does not erase Governance history

## Context

Physical storage retention and governance audit retention differ.

## Decision

Deleting a Workspace document must leave source/version history intact and mark the referenced artifact unavailable.

## Rejected alternatives

Cascading deletion from Workspace into Governance was rejected.

## Consequences

Users can audit an unavailable historical source without downloading it.

## Migration and rollback

No historical governance rows are deleted by rollback.

## Operations

Reconciliation flags missing artifacts for review.
