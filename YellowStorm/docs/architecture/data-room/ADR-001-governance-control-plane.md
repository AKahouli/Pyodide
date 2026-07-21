# ADR-001: Governance is the control plane

## Context

Workspace owns physical artifacts and indexing. Governance owns the business decision to review, approve, and publish a source.

## Decision

Keep the domains separate. Workspace communicates governed-data-room changes only through persisted integration events.

## Rejected alternatives

Direct Workspace-to-Governance service calls and copying physical files into Governance were rejected.

## Consequences

An outbox and idempotent consumers are required. No source version publishes an agent.

## Migration and rollback

Existing sources remain readable. Rollback disables flags and preserves new collections.

## Operations

Monitor pending and dead-letter events.
