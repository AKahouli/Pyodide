# Feature documentation, maintenance and branch sharing

## Read only what the task needs

1. Read the [context index](README.md) and relevant scoped `AGENTS.md`.
2. Match the user workflow/source paths in the [feature index](features/README.md)
   and read the affected page. Read linked architecture/contracts/ADRs only when
   those boundaries or decisions matter.
3. Verify current code/tests and use graph queries or focused search to find reuse
   candidates. Documents explain intent and entry points, not proof of correctness.
4. Include relevant page paths in edit preparation and task checkpoints. The harness
   routes conversation/semantic-model targets to mandatory current read evidence.
   Hash-bound receipts invalidate when a consulted document changes.

## Update alongside implementation using maintainer

The primary owns implementation and integration. It assesses documentation impact
at planning and again after changes, and launches `maintainer` when affected source
is stable. Maintenance can run alongside focused checks or independent work.

Handoff:

- Exact repository root, branch, checkpoint task ID and owned documentation paths.
- Changed behavior and rationale, stable source paths/task-scoped diff or revision.
- Acceptance/check outcomes, verification gaps and required review status.
- Relevant feature/architecture/contract records, confirmed design decisions and
  any required index updates or shared paths owned elsewhere.

Maintainer updates affected feature pages, plus architecture/contracts/ADRs when
required. It reuses evidence rather than rerunning discovery/QA. The primary owns
module READMEs/scoped instructions outside `docs/agent-context/`, reviews the doc
diff and integrates shared index changes. Concurrent maintainers get disjoint
pages; the primary coordinates a shared page/index rather than overlapping edits.

Ready-to-test delivery may precede maintenance; identify it as pending. Full task
completion requires reviewed updates or a specific documentation-unaffected reason.
Checkpoints retain maintainer task ID, updated/pending paths and exact next action,
so resumed sessions can finish the same work. Never claim pending docs are updated.

## Keep pages small and factual

Use [feature template v1](templates/feature.md) for every feature page. Preserve
`feature_doc_schema: 1`, a stable `feature_id`, and its seven H2 headings in order.
Use H3 subsections for extra detail; mark genuinely inapplicable sections with a
reason. The primary checks this format before accepting a maintainer update.

For every documentation task, maintainer assesses the root context index, feature
index and any affected subfolder index. Add a row when adding a record, update paths
and inbound links when moving/renaming, and remove obsolete links when deleting.
Do not delete unrelated pages or replace folders wholesale. Shared indexes require
explicit file ownership; otherwise return exact pending edits to the primary.
Return index changes or a specific no-change reason, format result, link checks and
remaining work. Full completion includes resolving pending index changes.

Each feature page includes purpose/user workflows, implemented behavior, limits,
frontend/backend/runtime entry points, existing code to reuse, relevant contracts
and tests, source revision/date and verification level. Link executable contracts
instead of duplicating fields. Clearly mark proposals, unmerged changes and unknowns.
Source inspection alone does not establish live behavior or passing tests.

Change an existing page when behavior changes; add a page/index row for a new
feature. An ADR is for a durable design decision, not every feature or bug fix.
New ADRs stay proposed until design approval and implementation evidence review;
preserve accepted records and supersede them with a new record when necessary.

## Share through Git

- Documentation stays in this repository and the implementation's branch/PR.
- Main contains the reviewed shared baseline; developers merge/rebase it into
  their branches using their normal workflow. No automatic cross-branch edits.
- Unmerged feature docs can be shared through a branch/PR link, labeled provisional;
  they must not override conflicting current-branch code or approved constraints.
- Resolve concurrent proposed ADR numbering conflicts before acceptance, including
  inbound links. Resolve feature-page conflicts against both source changes.
- Keep local checkpoint databases, browser state and raw experience history out of
  Git. Hindsight is fallible experience; it is not shared architectural authority.

## Initial baseline

The first feature pages cover committed conversation and semantic-model source.
Concurrent local application edits are excluded from the baseline. Their owning
implementation task must update the affected page with its verification evidence
before claiming full completion; this initialization does not approve those edits.
