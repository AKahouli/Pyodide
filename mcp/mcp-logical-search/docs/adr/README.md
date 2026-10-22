# Architecture Decision Records

ADRs explain why a significant architecture choice was made, the alternatives,
and its consequences. The [architecture guide](../logical-search.md) describes
current behavior; an ADR with status **Proposed** describes a target, not an
implemented security control.

## Records

| ID | Decision | Status |
| --- | --- | --- |
| [0001](0001-identity-bound-workspace-authorization.md) | Bind workspace authorization to validated identity | Superseded by ADR-0002 |
| [0002](0002-dynamic-workspace-scope-from-trusted-header.md) | Dynamic workspace scope from the trusted header | Accepted; gateway verification pending |
| [0003](0003-patched-frameworks-with-stable-retrieval-contracts.md) | Patched frameworks with stable retrieval contracts | Accepted |

## Workflow

1. Copy [template.md](template.md) to `NNNN-short-decision-name.md`, using the
   next sequential number. Keep one significant decision per record.
2. Describe the real context, alternatives, consequences, and evidence needed
   to implement and verify the choice. Identify unresolved ownership explicitly.
3. Open a documentation PR with status **Proposed**. The project maintainers
   and affected system owners review it before changing the status to **Accepted**.
4. Track implementation separately. Acceptance records agreement, not completion.
   Link the implementation PRs and validation evidence when available.
5. Preserve accepted records. When a decision changes, add a new ADR and link
   both records using **Superseded by ADR-NNNN** rather than rewriting history.

Statuses: **Proposed**, **Accepted**, **Rejected**, **Superseded by ADR-NNNN**.
Use **Recorded** only for a retrospective decision with linked evidence of the
original agreement; do not infer approval from existing code alone.

The [security cleanup plan](../security-cleanup-plan.md) tracks audit findings.
Use issues or that plan for tasks; reserve ADRs for consequential choices such as
identity trust, model data processing, and ingestion/schema ownership. Plain
Markdown is sufficient; no ADR generator or runtime dependency is needed.
