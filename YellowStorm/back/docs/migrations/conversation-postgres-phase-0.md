# Conversation PostgreSQL Migration: Phase 0

> Historical checkpoint. The preflight and repair tooling described by the original Phase 0 implementation was retired after the PostgreSQL-only fresh-development-database scope was approved.

## Historical Result

- The 2026-08-29 development preflight found 1,085 orphan Messages and 5 legacy tagged-agent entries.
- The approved development repair deleted those orphan Messages, normalized the tagged-agent entries, and proved idempotent on reapplication.
- The final strict preflight reported no blocking candidates. Preserved `messageCount`, `lastMessageAt`, and weak Report-reference anomalies were informational.
- These findings informed the PostgreSQL schema constraints but do not create a current backfill or production-migration requirement.

## Current Status

- Existing development Conversation data is disposable.
- The preflight/repair source, tests, CLI entry points, and package commands have been removed.
- No operational script reads or mutates the retired Conversation Mongo collections.
- PostgreSQL schema and store verification replace Mongo source-data verification for the approved development cutover.
- Production backfill, strict parity verification, writer freeze, rollback, staging/production rehearsal, monitoring, and Mongo collection archive/drop are excluded.

Git history remains the source for the retired implementation and its detailed 2026-08-29 artifacts.
