---
id: ADR-0012
status: proposed
scope: feature-context-and-maintenance
source_paths:
  - AGENTS.md
  - tools/opencode-harness/policy.json
  - tools/opencode-harness/config/agents/maintainer.md
  - docs/agent-context/features/
  - docs/agent-context/documentation-workflow.md
---

# Maintain branch-aligned feature documentation with implementation

## Decision

Keep feature documentation under `docs/agent-context/features/` in the code
repository, routed by a short feature index. Initialize conversation and semantic
model pages from committed source/tests, naming the revision and verification level.
Read only task-relevant pages and verify their linked current code/reuse candidates.
Add path routes to the existing read-evidence guard; do not add another validator.

New/changed feature behavior updates its owning page in the implementation's branch
and PR. The primary assigns exact owned documents, stable source evidence/checks
and branch to `maintainer`; maintainers update feature/architecture/contract pages,
while the primary owns scoped instructions/module READMEs outside the doc directory.
Ready-to-test does not wait for background maintenance, but full completion requires
reviewed updates or a specific no-impact reason. Checkpoints retain maintainer task
ID, updated/pending paths and next action through interruption.

Reviewed main-branch docs are the shared baseline after normal merge/rebase.
Another branch's unmerged docs remain provisional. Resolve proposed ADR numbering
conflicts before acceptance; preserve accepted ADRs. Local checkpoint databases and
raw experience are not shared Git documentation.

## Rationale

The user approved initialization and asked to use maintainer for affected docs.
Keeping code and docs together avoids coordinating a separate repository revision
for each developer branch. Feature pages expose behavior and reuse entry points;
the graph/source/tests establish implementation and coverage.

## Verification and limits

Initial pages come from committed revision `cc3d0e078`; initialization does not claim
runtime tests/live QA or approve concurrent application edits. Parallel uncommitted
feature-document additions remain with their owning implementation task.
Regression checks require feature-page evidence for mapped code targets and reject
stale documentation while preserving unrelated scoped routes. Local links resolve.
Native maintainer permissions include read-only Git revision/diff inspection.

Instructions guide documentary impact and quality; they cannot prove semantic
completeness. The existing guard verifies reads/ownership, not whether every needed
document was selected or every update is correct. Native shell trust and advisory
integration policy remain unchanged under ADR-0010/ADR-0011.
