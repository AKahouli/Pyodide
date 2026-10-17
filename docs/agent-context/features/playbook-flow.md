---
feature_doc_schema: 1
feature_id: playbook-flow
---

# Playbook flow

## Evidence and scope

- Source revision/branch: `2d441a7cc` / `baseline/semantic-model-001`; inspected 2026-10-14.
- Verification level: frontend README, MCP README and backend module source inspection only; tests not run.
- Scope: Playbook canvas, workflow management/execution and Playbook MCP adapter. Detailed backend module README is absent at the expected `playbook-flow/README.md` path.

## Purpose and workflows

The feature lets users visually create and edit multi-step AI workflows, then execute, monitor, inspect and share them. The frontend README documents canvas editing, autosave, execution SSE and results; Nest module registration establishes its controllers/services.

| Workflow | Implemented behavior and source |
| --- | --- |
| Edit and run a playbook | [frontend module README](../../../YellowStorm/front/src/modules/playbook/README.md), backend [module registration](../../../YellowStorm/back/src/modules/playbook-flow/playbook-flow.module.ts) |
| Use Playbook assistant tools | [MCP adapter README](../../../mcp/mcp-playbook/README.md); NestJS remains authoritative for permissions, validation and execution |

## Ownership and boundaries

- Frontend owner: `YellowStorm/front/src/modules/playbook/`.
- Backend owner: `YellowStorm/back/src/modules/playbook-flow/`; runtime owner: `yellowstorm-adk/src/flow_engine/`; adapter: `mcp/mcp-playbook/`.
- Backend module registers repository providers and Playbook REST, stream, execution, HITL, Advisor and assistant controllers; see [module registration](../../../YellowStorm/back/src/modules/playbook-flow/playbook-flow.module.ts).
- Persistence: backend repositories are registered by the module; exact stores/schema ownership is not verified in this bounded read. See [baseline gaps](../architecture/baseline-gaps.md).
- Contracts include REST `/api/v1/playbooks/**`, construction/execution streams, ADK `playbook-flow.proto` gRPC, and MCP Streamable HTTP delegated to NestJS. See [cross-service contracts](../architecture/cross-service-contracts.md) and MCP README.

## Reuse map

| Change | Existing owner to extend |
| --- | --- |
| Canvas, API, execution views | [Playbook frontend README](../../../YellowStorm/front/src/modules/playbook/README.md) and its `api.ts` / store / component tests |
| Backend behavior | [playbook-flow module](../../../YellowStorm/back/src/modules/playbook-flow/) and [module registration](../../../YellowStorm/back/src/modules/playbook-flow/playbook-flow.module.ts); no module README was present at the expected path |
| MCP behavior | [Playbook MCP README](../../../mcp/mcp-playbook/README.md); keep NestJS authoritative |

## Constraints and limitations

- MCP callers do not own authorization or execution confirmation; NestJS validates current access.
- No complete persistence inventory or full route/test matrix was read; do not infer missing ownership/rationale from module registration. See [baseline gaps](../architecture/baseline-gaps.md).

## Focused verification

Local readiness investigation on 2026-10-17 confirmed the configured MCP was not
listening on port 8025 although its JWT configuration validated. The platform/core
restart scripts had omitted this existing service. Both scripts now include it;
targeted selection accepts `playbook` or `mcp-playbook`. Authentication, tools and
readiness semantics are unchanged (ADR-0017). Hidden process logs are written under
`%TEMP%\YellowStorm-platform`.

The focused `scripts/test-restart-platform.ps1` regression checks full-service
selection, both targeted aliases, the real launch block and core-script named
parameter/switch forwarding without starting any service. Core forwarding now
uses a named hashtable splat; its former positional array failed parameter binding.
A real targeted restart passed. Local MCP `/health/ready` and backend
`/api/v1/health/ready` returned HTTP 200 afterward, with all backend readiness
components passing. No tool execution or frontend change was needed.

| Area | Command, working directory and evidence/gap |
| --- | --- |
| Frontend | From `YellowStorm/front`: `npm test -- src/modules/playbook/`; README describes module tests, but no individual test paths were inspected |
| Backend | From `YellowStorm/back`: `npm test -- playbook-flow`; test paths not inspected in this batch |
| MCP/ADK | MCP and ADK test commands/test paths not inspected; identify both sides for boundary changes |

## Related context and maintenance

- [Feature index](README.md), [component map](../architecture/component-map.md), [cross-service contracts](../architecture/cross-service-contracts.md), [change control](../architecture/change-control.md).
- **Out-of-scope proposal:** primary/build should add or update the backend `playbook-flow` module README with verified store/schema and focused test paths; maintainer cannot edit it.
