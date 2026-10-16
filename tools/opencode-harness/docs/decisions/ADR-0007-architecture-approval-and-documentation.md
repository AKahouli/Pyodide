---
id: ADR-0007
status: accepted
scope: architecture-change-control
source_paths:
  - AGENTS.md
  - YellowStorm/front/AGENTS.md
  - YellowStorm/back/AGENTS.md
  - tools/opencode-harness/config/AGENTS.md
  - docs/agent-context/architecture/change-control.md
reviewed_at: 2026-10-13
---

# Confirm new structures and keep architecture knowledge current

## Decision

Require the user's confirmation of a concrete design before creating a database
schema/namespace, table, collection, frontend/backend module, service, runtime or
microservice. Reuse explicit current design authorization and preserve its scope
through task checkpoints and handoffs. General end-to-end execution authorization
does not approve new architectural structures. Independent services and separately
owned schemas are options when explicit isolation/deployment requirements justify
their cost; the agent proposes alternatives and the user chooses the boundary.

Assess documentation impact on every task. Changed architectural decisions require
new ADRs that preserve/supersede accepted history; changed relationships, contracts,
ownership or deployment require updated owning architecture references. Routine
changes with no durable impact record a reason instead of creating an ADR.
The [change-control guide](../../../../docs/agent-context/architecture/change-control.md) owns the procedure.

Background maintenance may follow ready-to-test delivery. Full completion requires
reviewed relevant documentation updates or a no-impact reason. The primary owns
documents outside the maintainer's `docs/agent-context/` edit scope.

## Rationale

Architecture and persistence ownership are deliberate user decisions. A focused
confirmation prevents unintended structures while preserving autonomy within the
approved design. Documentation impact checks keep future context aligned without
making every edit produce another record or delay initial user testing.

## Verification and limits

Repository, scoped and installed global instructions state the confirmation and
documentation obligations. Validate owning links and checkpoint-tool compatibility.
Approval and semantic documentation impact remain agent/review responsibilities;
the existing native gate validates read evidence and ownership, not human intent.
