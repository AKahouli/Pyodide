---
id: HADR-0001
status: accepted
scope: decision-discovery-and-documentation-layout
source_paths:
  - AGENTS.md
  - docs/agent-context/decisions/README.md
  - tools/opencode-harness/docs/decisions/README.md
reviewed_at: 2026-10-16
---

# Separate platform decisions from harness workflow

## Decision

Keep Yellowmind architecture ADRs under `docs/agent-context/decisions/`. Move
OpenCode harness records to `tools/opencode-harness/docs/decisions/`, preserving
legacy IDs and accepted content, with updated relative links. New harness decisions
use `HADR-NNNN`; platform decisions retain `ADR-NNNN` and the next unused ID.

Before the first code edit, agents consult the appropriate small decision index,
read applicable current records and record IDs plus concrete constraints in task
context, an inline plan or checkpoint decisions. Handoffs and review reuse that
selection. An explicit no-applicable-ADR result is sufficient. Context already
verified for unchanged scope can be reused. Superseding decisions govern only the
scope they replace; proposed decisions are not accepted constraints.

## Rationale and verification limits

A shared folder and index mixed product architecture with historical harness
restrictions. Broad advice to read relevant docs did not make ADR selection
observable. Separate indexes reduce irrelevant context; explicit selection makes
compliance reviewable without introducing read receipts or edit gates.

Validate moved links and scope instructions. Instructions cannot independently
prove that every agent read and applied a record; source/tool evidence and review
establish compliance in each task. Checkpoints and editing remain advisory.
