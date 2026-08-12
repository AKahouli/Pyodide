# ADR-002: Logical sources have immutable versions

## Status

Superseded by ADR-011 on 2026-07-30.

## Context

A governance source needs stable identity while its captured content changes.

## Decision

`GovernanceSource` is the logical identity; `GovernanceSourceVersion` is immutable content state allocated with an atomic sequence.

## Rejected alternatives

Overwriting a source or allocating versions with `count + 1` was rejected.

## Consequences

Lifecycle and technical state are version-level data. A unique `(sourceId, versionNumber)` index is the safety net.

## Migration and rollback

Backfill creates version 1 for legacy sources. Rollback preserves those versions.

## Operations

Investigate duplicate-key errors as concurrency signals, not corruption by default.
