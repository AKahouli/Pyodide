# ADR-003: Workspace owns physical artifacts

## Context

Governance needs provenance but must not become a document store.

## Decision

Versions reference Workspace IDs, document IDs, hashes, and canonical URLs without copying files.

## Rejected alternatives

Duplicating blobs in Governance was rejected.

## Consequences

Physical deletion marks an artifact unavailable while history remains.

## Migration and rollback

Legacy references are retained. No data deletion occurs during rollback.

## Operations

Reconciliation detects missing physical artifacts.
