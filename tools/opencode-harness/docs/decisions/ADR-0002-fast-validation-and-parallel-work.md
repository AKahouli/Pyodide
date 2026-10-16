---
id: ADR-0002
status: accepted
scope: sdlc-workflow
source_paths:
  - AGENTS.md
reviewed_at: 2026-10-12
---

# Early local testing and bounded parallel work

## Decision

Deliver ordinary changes for user testing as soon as focused checks and applicable frontend QA pass. The primary agent performs self-review; an independent reviewer is required for high risk changes or an explicit review request. Required review can run alongside browser QA. High risk work may be ready for local testing while review is pending, but is not fully complete or ready to merge/deploy until that gate passes.

Run documentation maintenance in the background only for durable changed knowledge. Run independent implementation through workers with disjoint owned files; the primary agent owns shared contracts and integration. Reuse scoped context and verification evidence instead of repeating discovery in every specialist. Keep per-user-message experience capture and concise visible follow-up; internal background notifications do not restart the task.

## Rationale

Mandatory serial review and documentation delayed user testing even after browser validation. Risk-based review keeps stronger checks where failures have significant consequences. Native background tasks and independent checks overlap useful work while bounded handoffs reduce duplicated context.

## Verification

Confirm that ordinary UI work reports ready to test after checks and QA without waiting for a reviewer or maintainer. For high risk work, confirm that pending review remains explicit. Verify native background dispatch returns before child completion and delivers its result once; independent workers must have disjoint file ownership.
