# ADR-008: Knowledge intelligence begins with idempotent extraction jobs

## Context

Temporal intelligence must run only after a governed source version is technically ready. It must not delay the integration-event dispatcher or make technical freshness a business-validity decision.

## Decision

On a ready indexing event, Governance enqueues a `technical_metadata` job for each ready, non-terminal source version when the persisted `dataRoomValidityIntelligence` feature is enabled. Job identity is the source version, job type, deterministic input hash, and engine version.

## Rejected alternatives

Running extraction inside the event dispatcher and invoking an unverified Logical Search or LLM contract were rejected.

## Consequences

Duplicate deliveries reuse one job, while a new indexing attempt or content hash creates a distinct job. Technical-metadata jobs remain pending until a later worker is introduced; they do not alter business validity.

## Migration and rollback

The collection is additive. Disabling the feature flag stops new enqueueing and leaves existing audit-safe job records intact.

## Operations

Monitor pending, running, and failed jobs. Retry behavior is explicit through attempts and terminal timestamps.
