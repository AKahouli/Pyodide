# OpenCode harness decisions

These records describe agent tooling, delivery and documentation workflow. For
Yellowmind product architecture use the
[platform ADR index](../../../../docs/agent-context/decisions/README.md).

## Current policy and historical records

| Topic | Records | Current interpretation |
| --- | --- | --- |
| Git knowledge and experience | [ADR-0001](ADR-0001-agent-knowledge.md), [ADR-0012](ADR-0012-feature-documentation-and-branch-maintenance.md) | Reviewed Git knowledge and fallible Hindsight experience; ADR-0012 remains proposed |
| Fast validation and parallel work | [ADR-0002](ADR-0002-fast-validation-and-parallel-work.md) | Early verified testing, scoped parallel work and risk-based review |
| Autonomy, sign-in and QA | [ADR-0003](ADR-0003-autonomy-and-qa-sign-in.md), [ADR-0004](ADR-0004-private-qa-and-regression-fixtures.md) | Private QA policy in ADR-0004 supersedes shared-browser guidance in ADR-0003 |
| Checkpoints and reuse | [ADR-0005](ADR-0005-task-checkpoints-and-reuse-gates.md), [ADR-0006](ADR-0006-scoped-instructions-and-topic-references.md), [ADR-0014](ADR-0014-advisory-checkpoints-without-edit-locks.md) | ADR-0014 removes edit locks/read receipts; earlier enforcement is historical |
| Architecture confirmation and documentation | [ADR-0007](ADR-0007-architecture-approval-and-documentation.md) | User confirmation for named new structures; maintain relevant architecture records |
| Startup, integrations and permissions | [ADR-0008](ADR-0008-session-integration-health.md), [ADR-0009](ADR-0009-native-startup-readiness.md), [ADR-0010](ADR-0010-native-shell-permissions.md), [ADR-0011](ADR-0011-advisory-integrations-and-native-policy.md), [ADR-0014](ADR-0014-advisory-checkpoints-without-edit-locks.md) | Native permissions and advisory health/checkpoints; ADR-0014 supersedes old ownership enforcement |
| Background delivery | [ADR-0013](ADR-0013-background-handoff-and-scoped-instructions.md), [ADR-0016](ADR-0016-maintainer-capability-fallback.md) | ADR-0016 permits primary direct maintenance or supported foreground work when background is unavailable |
| Decision separation and lookup | [HADR-0001](HADR-0001-separate-decision-context.md) | Distinct platform/harness indexes and visible applicable-ADR selection |

Legacy IDs are preserved for stable references. Allocate new harness decisions as
`HADR-NNNN-topic.md`, separately from platform ADR numbering. Preserve accepted
records and describe supersession in a new record. Read relevant current decisions
before harness edits; never restore a superseded restriction from a historical ADR.
