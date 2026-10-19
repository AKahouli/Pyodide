---
id: ADR-0006
status: accepted
scope: frontend-and-backend-context-routing
source_paths:
  - YellowStorm/front/AGENTS.md
  - YellowStorm/back/AGENTS.md
  - docs/agent-context/frontend/**
  - docs/agent-context/backend/**
  - tools/opencode-harness/policy.json
reviewed_at: 2026-10-13
---

# Short scoped instructions and topic references

## Decision

Replace the frontend/backend guideline monoliths with short scoped `AGENTS.md`
files and topic references indexed under `docs/agent-context/frontend/` and
`docs/agent-context/backend/`. Preserve detailed guidance as on-demand references,
not automatically loaded instructions. Existing source, schemas, tests and module
READMEs remain authoritative for current implementation.

The edit gate requires the context index and matching scoped instruction file.
Agents explicitly read these through the native Read tool even when instructions
were automatically injected, then read only the references relevant to the change.
Additional references belong in the preparation evidence when used. Cross-service
work requires both sides' API/contract context and executable boundary checks.

Keep one owning topic for migrated guidance. Link module-specific implementation
documentation instead of copying future changes into another overview. Update the
owning topic and index when durable knowledge changes; preserve accepted ADRs and
supersede decisions through a new record. Historical changelog/audit mentions of
the removed filenames remain historical evidence.

## Rationale

The old files contained 521 frontend and 592 backend lines. Requiring a small
scoped entry point reduces default context while keeping load-bearing details
available by topic. It also avoids maintaining old and new copies in parallel.

## Verification

Verify migrated section coverage, local Markdown links, removal of obsolete
active references, and that policy routes point to existing scoped instructions.
A focused harness test uses the actual policy to reject missing scoped evidence,
allow prepared frontend/backend edits, and reject stale instruction receipts.
