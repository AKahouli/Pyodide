# Agent context index

Use this index to locate reviewed engineering knowledge. Match the task's changed paths and interfaces, then read only the linked records. Source code, schemas, protos, and tests establish current behavior; these records explain approved intent. The code graph supplies callers, dependencies, and impact. Hindsight supplies unreviewed experience from prior interactions.

| Scope | Reviewed context | Direct checks |
| --- | --- | --- |
| New schema/service/module/runtime or changed architecture | [Architecture change control](architecture/change-control.md), [ADR-0007](decisions/ADR-0007-architecture-approval-and-documentation.md) | confirmed design scope, source/contract verification and documentation-impact checkpoint |
| System architecture baseline (components, runtimes, flows) | [Overview](architecture/overview.md), [Component map](architecture/component-map.md), [Gaps](architecture/baseline-gaps.md) | source paths + verification date in each record; unresolved items in gaps |
| Agent harness and knowledge workflow | [ADR-0001](decisions/ADR-0001-agent-knowledge.md), [ADR-0002](decisions/ADR-0002-fast-validation-and-parallel-work.md), [ADR-0003](decisions/ADR-0003-autonomy-and-qa-sign-in.md), [ADR-0004](decisions/ADR-0004-private-qa-and-regression-fixtures.md) (current browser policy) | `AGENTS.md`, OpenCode user settings |
| Task checkpoints, interruption/resume, and reuse before edits | [ADR-0005](decisions/ADR-0005-task-checkpoints-and-reuse-gates.md), [Harness guide](../../tools/opencode-harness/README.md) | native plugin hooks, SQLite ownership, scoped diffs, and harness tests |
| Frontend (`YellowStorm/front/**`) | [Scoped instructions and topic links](../../YellowStorm/front/AGENTS.md); read only matching references | frontend source and tests |
| Browser QA accounts/data and user-reported regressions | [QA fixtures](testing/qa-fixtures.md), [E2E README](../../YellowStorm/front/tests/e2e/README.md) | run context, auth setup, fixture teardown, and regression tests |
| Backend (`YellowStorm/back/**`) | [Scoped instructions and topic links](../../YellowStorm/back/AGENTS.md); read only matching references | backend source and tests |
| Agent runtime (`yellowstorm-adk/**`) | [ADK README](../../yellowstorm-adk/README.md), [gRPC README](../../yellowstorm-adk/grpc/README.md), [ADK runtime](architecture/adk-runtime.md) | Python source, tests, and protos |
| Playbook MCP (`mcp/mcp-playbook/**`) | [Playbook MCP README](../../mcp/mcp-playbook/README.md) | MCP source, ADK flow proto, and callers |
| Conversation (`YellowStorm/front/src/modules/conversation/**`, matching backend routes) | [Conversation README](../../YellowStorm/front/src/modules/conversation/README.md), [Postgres migration](../../YellowStorm/back/docs/migrations/conversation-postgres-phase-1.md) | frontend and backend tests |
| Authorization (`YellowStorm/back/src/modules/authorization/**`) | [Authorization README](../../YellowStorm/back/src/modules/authorization/README.md) | guards, callers, and permission tests |
| Cross-service REST, gRPC, and proto | [Cross-service contracts](architecture/cross-service-contracts.md); matching API/contract references linked by both scoped instruction files | sender, receiver, schemas, and protos |
| Observability (`contracts/observability/**`, logging changes) | [Logging contract](../observability/logging-contract.md), [event registry README](../../contracts/observability/README.md) | `node scripts/observability/check-policy.mjs` |

## Record rules

Documentation layout and scoped edit evidence: [ADR-0006](decisions/ADR-0006-scoped-instructions-and-topic-references.md).

- Put a durable choice in `decisions/ADR-NNNN-topic.md` with status, scope, source paths, decision, rationale, and verification. Supersede a decision with a new record; preserve the old one.
- Link a contract to its executable schema, proto, test, or owning source. Do not duplicate field definitions that code already owns.
- Add or update an index row when a reviewed record is added or its scope changes.
- Hindsight and agent conversations are evidence for a proposal, never authority for an accepted record. Review Git changes before treating them as approved.
