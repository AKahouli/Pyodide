# Agent context index

Use this index to locate reviewed engineering knowledge. Match the task's changed paths and interfaces, then read only the linked records. Source code, schemas, protos, and tests establish current behavior; these records explain approved intent. The code graph supplies callers, dependencies, and impact. Hindsight supplies unreviewed experience from prior interactions.

| Scope | Reviewed context | Direct checks |
| --- | --- | --- |
| Background handoff, compact instructions and asynchronous maintainer | [Agent delivery](architecture/agent-delivery.md), [ADR-0013](decisions/ADR-0013-background-handoff-and-scoped-instructions.md), [Workflow recipes](../../tools/opencode-harness/docs/WORKFLOW.md) | native background completion, checkpoint child references, disjoint ownership and documentation in the implementation branch/PR; ADR-0013 accepted |
| Existing product features and reusable implementation | [Feature index](features/README.md), [Documentation workflow](documentation-workflow.md), [ADR-0012](decisions/ADR-0012-feature-documentation-and-branch-maintenance.md) | task-relevant feature page, linked code/tests, maintainer updates in the implementation branch/PR |
| Developer installation, daily use and sharing | [One-click installer](../../tools/opencode-harness/docs/DEVELOPER-SETUP.md#one-click-installer), [Developer user guide](../../tools/opencode-harness/docs/DEVELOPER-SETUP.md), [Hindsight setup](../../tools/opencode-harness/docs/HINDSIGHT-SETUP.md), [Operations/recovery](../../tools/opencode-harness/docs/OPERATIONS.md), [Parallel verification](../../tools/opencode-harness/docs/PARALLEL-VERIFICATION.md) | installation, checkpoints/resume, background work, branch documentation, upgrades/recovery and advanced two-host startup checks |
| Session startup integration readiness | [ADR-0009](decisions/ADR-0009-native-startup-readiness.md) (current mechanism), [ADR-0008](decisions/ADR-0008-session-integration-health.md) (original decision), [Harness guide](../../tools/opencode-harness/README.md) | automatic current-root graph/bank reads, capture configuration, per-session checkpoint receipt and loaded runtime version |
| Shell execution and runtime diagnosis | [ADR-0010](decisions/ADR-0010-native-shell-permissions.md), [ADR-0011](decisions/ADR-0011-advisory-integrations-and-native-policy.md), [Harness guide](../../tools/opencode-harness/README.md) | native OpenCode permissions, existing startup scripts and logs; checkpoint/read/ownership protection guards native source edits |
| Non-blocking graph/memory and response policy | [ADR-0011](decisions/ADR-0011-advisory-integrations-and-native-policy.md) | graph/memory failures use source/docs fallback; checkpoints and file ownership remain enforced; clear next action in human replies |
| New schema/service/module/runtime or changed architecture | [Architecture change control](architecture/change-control.md), [ADR-0007](decisions/ADR-0007-architecture-approval-and-documentation.md) | confirmed design scope, source/contract verification and documentation-impact checkpoint |
| System architecture baseline (components, runtimes, flows) | [Overview](architecture/overview.md), [Component map](architecture/component-map.md), [Gaps](architecture/baseline-gaps.md) | source paths + verification date in each record; unresolved items in gaps |
| Agent harness and knowledge workflow | [ADR-0001](decisions/ADR-0001-agent-knowledge.md), [ADR-0002](decisions/ADR-0002-fast-validation-and-parallel-work.md), [ADR-0003](decisions/ADR-0003-autonomy-and-qa-sign-in.md), [ADR-0004](decisions/ADR-0004-private-qa-and-regression-fixtures.md) (current browser policy) | `AGENTS.md`, OpenCode user settings |
| Task checkpoints, interruption/resume, and reuse before edits | [ADR-0005](decisions/ADR-0005-task-checkpoints-and-reuse-gates.md), [Harness guide](../../tools/opencode-harness/README.md) | native plugin hooks, SQLite ownership, scoped diffs, and harness tests |
| Frontend (`YellowStorm/front/**`) | [Scoped instructions and topic links](../../YellowStorm/front/AGENTS.md); read only matching references | frontend source and tests |
| Browser QA accounts/data and user-reported regressions | [QA fixtures](testing/qa-fixtures.md), [E2E README](../../YellowStorm/front/tests/e2e/README.md) | run context, auth setup, fixture teardown, and regression tests |
| Backend (`YellowStorm/back/**`) | [Scoped instructions and topic links](../../YellowStorm/back/AGENTS.md); read only matching references | backend source and tests |
| Agent runtime (`yellowstorm-adk/**`) | [ADK README](../../yellowstorm-adk/README.md), [gRPC README](../../yellowstorm-adk/grpc/README.md), [ADK runtime](architecture/adk-runtime.md) | Python source, tests, and protos |
| Playbook MCP (`mcp/mcp-playbook/**`) | [Playbook MCP README](../../mcp/mcp-playbook/README.md) | MCP source, ADK flow proto, and callers |
| Conversation (`YellowStorm/front/src/modules/conversation/**`, matching backend routes) | [Feature behavior/reuse](features/conversations.md), [Conversation README](../../YellowStorm/front/src/modules/conversation/README.md), [Persistence](backend/persistence.md) | frontend and backend tests |
| Semantic models (frontend/backend module and semantic runtime) | [Feature behavior/reuse](features/semantic-model.md); linked runtime/contracts and owning tests | catalog/editor, source mapping, population/search and version behavior |
| Authorization (`YellowStorm/back/src/modules/authorization/**`) | [Authorization README](../../YellowStorm/back/src/modules/authorization/README.md) | guards, callers, and permission tests |
| Cross-service REST, gRPC, and proto | [Cross-service contracts](architecture/cross-service-contracts.md); matching API/contract references linked by both scoped instruction files | sender, receiver, schemas, and protos |
| Observability (`contracts/observability/**`, logging changes) | [Logging contract](../observability/logging-contract.md), [event registry README](../../contracts/observability/README.md) | `node scripts/observability/check-policy.mjs` |

## Record rules

Documentation layout and scoped edit evidence: [ADR-0006](decisions/ADR-0006-scoped-instructions-and-topic-references.md).

- Put a durable choice in `decisions/ADR-NNNN-topic.md` with status, scope, source paths, decision, rationale, and verification. Supersede a decision with a new record; preserve the old one.
- Link a contract to its executable schema, proto, test, or owning source. Do not duplicate field definitions that code already owns.
- Add or update an index row when a reviewed record is added or its scope changes.
- Hindsight and agent conversations are evidence for a proposal, never authority for an accepted record. Review Git changes before treating them as approved.
