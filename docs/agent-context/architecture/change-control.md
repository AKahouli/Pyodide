# Architecture decisions, confirmation and documentation

Applies to all repository areas, including ADK, frontend, backend and standalone
services. The primary agent owns user questions and integration.

## Confirm before introducing a boundary

Obtain confirmation before implementing a new database schema/namespace, table,
collection, frontend/backend module or service, runtime, or independently deployed
microservice. Prepare a concrete proposal first; exploration and design work can
proceed. A new service class within an existing module also requires confirmation.
Ordinary fixes, components/helpers inside an existing module, or configuration
changes that introduce none of these structures retain the normal autonomy rules.
Existing-schema edits still follow migration/risk rules; a material change to an
approved design requires renewed confirmation.

The proposal contains:

- Existing implementation/ownership inspected and why reuse fits or falls short.
- The smallest viable design, exact proposed names/paths and data ownership.
- Alternatives when relevant: extend the existing module, add a local module or
  isolate an independently deployed service and separately owned database schema.
- API/event boundaries, authentication, migration/compatibility, deployment,
  observability, operational cost and rollback implications at the needed depth.
- Recommended option and one confirmation question covering the coherent scope.

Use an independent service/schema when a concrete deployment, scaling, security,
failure-isolation or data-lifecycle requirement justifies its operational cost.
Separate ownership must be explicit: version contracts, avoid cross-service direct
database access, and define consistency/transactions and migration responsibility.
A separate schema alone does not make a service autonomous. Avoid a new boundary
merely to parallelize agent work.

An explicit current request approving the named design is confirmation; do not ask
again. Generic feature approval, an end-to-end execution preference, prior approval
of another task, or an agent/maintainer recommendation is insufficient. No reply is
not approval. While pending, mark the dependent work blocked and continue only
independent authorized work. Specialists return proposals/questions to the primary.

Record the chosen design, exact approved scope and user message/turn reference in
`sdlc_checkpoint.decisions`; use `blockers`/`nextAction` while pending. Carry them in
worker handoffs and resume context. Approval is scoped to the named task/design;
another parallel session must not treat it as permission for a different boundary.
The same approved task/design can move to another worktree without renewed consent:
record the intended handoff and remap owned paths, preserving approval evidence.
A worker implementing that task receives the confirmed scope from the primary.

## Keep documentation aligned with verified changes

At planning and before full completion, assess whether the task changes ownership,
service/module relationships, persistence, data flow, API/event contracts,
runtime/deployment, security, or a durable architecture constraint.

- Update the existing owning architecture/topic reference and affected module
  README/scoped instructions. Update an existing diagram when its represented
  flow/topology changes; preserve its format and keep source and rendered artifact
  aligned. Create a diagram only when it clarifies the changed architecture.
- Add an ADR for a new or changed durable decision. Keep accepted ADRs unchanged;
  the new ADR identifies the superseded record and the exact changed decision.
  Link the new current record from the index. Proposal status remains explicit.
- Link executable schemas, source and verification instead of duplicating code
  inventories or field definitions. Update only the affected records/sections.
- If no durable documentation changed, record a concise no-impact reason.

Record a checkpoint check named `Documentation impact` with relevant source and
document input files. Use `PENDING` plus the maintainer/task reference while work
runs, `BLOCKED` for missing approval/evidence, `PASS` after reviewed updates, or
`SKIPPED` with a no-impact reason in decisions. Preserve this state on handoff/resume.
The checkpoint `checks` array replaces earlier checks: preserve existing verified
code/QA checks when adding or updating the documentation-impact result.

The maintainer edits only `docs/agent-context/`; the primary owns module READMEs,
scoped instructions and architecture artifacts elsewhere. Ready-to-test delivery
may precede documentation completion with that pending work stated explicitly.
Full completion requires reviewed updates or the no-impact reason. Design approval
does not establish implementation verification or authorize deployment.

## Enforcement scope

These are agent decision and delivery rules. The native edit gate verifies current
documentation/source read evidence and file ownership. It does not interpret user
approval or detect every semantic architecture change. Primary self-review and the
required high-risk reviewer check approval scope and documentation impact; never
describe a checkpoint note as independently verified user authorization.
