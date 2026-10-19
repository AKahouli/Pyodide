# R01 internal principal and caller inventory

Snapshot: `abe23f8f99d6d371f0bfd9155d5727327d0f3a17`; audit baseline
`86bf7972de6ab22e6aaf732da291a5c6e3280c98` is an ancestor. The intervening
commits add conversation assets/preview verification and remove unused Studio
stream connections; their internal asset callers are included below.

Status: **implementation in progress; not a go-live sign-off**. Inventory is of
tracked source, not proof of deployed mounts or absence of external clients.
No secret values or production data were retrieved. Paths below are relative to
the repository root. HTTP routes omit any global API prefix/version.

## Trust-domain matrix

| Route group | Baseline machine guard | Verified tracked caller / credential | Required authority / planned migration |
| --- | --- | --- | --- |
| `internal/agent-crud` Agent + Team | `InternalServiceGuard` + `DelegatedActorGuard` | `mcp/mcp-agent/clients/yellowstorm_agent_client.py`; generic `YELLOWSTORM_INTERNAL_SERVICE_TOKEN` / `X-Internal-Token` | `mcp-agent` + `AGENT_MCP_BACKEND_SERVICE_TOKEN`, fixed audience `mcp-agent`; current account/roles/resource permissions. Connector slug `agent-mcp` is not the machine identity. |
| `internal/playbook-assistant` | Same generic guard + delegated actor | `mcp/mcp-playbook/clients/yellowstorm_playbook_client.py`, including SSE stream; same generic env/header | `mcp-playbook` + `PLAYBOOK_MCP_BACKEND_SERVICE_TOKEN`, fixed audience `mcp-playbook`; current Playbook/task/execution rights. |
| `internal/semantic-model-assistant` | `SemanticMcpServiceGuard` + delegated actor + model/permission guards | `mcp/mcp-semantic-model/clients/yellowstorm_semantic_model_client.py` requires redundant generic credential alongside semantic principal | Preserve `semantic-model-mcp` + `SEMANTIC_MODEL_MCP_SERVICE_TOKEN`; remove generic dependency entirely; fixed audience `mcp-semantic-model`; current model/source rights. |
| `workspaces/internal/semantic-*` (five asset operations) | Generic machine guard + caller-selected `actorUserId` checked against workspace | `YellowStorm/semantic-model-runtime/app/datasource/asset_delivery.py`; generic `YELLOWSTORM_INTERNAL_SERVICE_TOKEN` | `semantic-runtime` + `SEMANTIC_RUNTIME_BACKEND_SERVICE_TOKEN`; signed admission + live canonical task/lease/opaque capability proof; exact actor/doc/version/operation and model/source for population. |
| `internal/root-work` including conversation assets/images | Generic machine guard | ADK `src/root_runtime/delegate_resolver.py`; `src/smart_rag/tools/utilities/{conversation_assets,generate_image,connector_tools}.py` | `adk-root-runtime` + `ADK_ROOT_RUNTIME_SERVICE_TOKEN`; separately verified live execution/conversation authority, actor from proof not body. Existing owner/fence checks remain necessary but are not an unforgeable admission by themselves. |
| `internal/playbook-artifacts/executions/:executionId` | Generic machine guard; owner from user header | ADK `src/flow_engine/runtime/artifact_publication.py` | `adk-playbook-artifact` + `ADK_PLAYBOOK_ARTIFACT_SERVICE_TOKEN`; signed live execution authority, server-derived owner, existing `findOwned` and artifact constraints. |
| `connectors/internal/mcp-token` | `AdkRuntimeMcpRenewalGuard` | ADK `src/mcp/jwt_auth.py` | Preserve `adk-runtime` / `ADK_RUNTIME_MCP_RENEWAL_TOKEN`; connector-bound signed proof and current revision. |
| `internal/app-runtime/{bind,tool-invoke}` | `AppRuntimeServiceGuard` | Existing app runtime clients | Preserve `app-runtime` / `APP_RUNTIME_BIND_TOKEN` and app capabilities; do not repurpose for other routes. |
| `workspaces/:workspaceId/documents/ingest-url` | Generic machine guard | ADK `connector_tools.py`; extended connector-tool tests | `AdkNativeActorGuard`: only `adk-root-runtime` or `adk-playbook-artifact` with matching live private dispatch purpose. Actor is derived; workspace must be in the owning conversation/canonical Root or child source scope, or Playbook dispatch snapshot; current workspace owner check remains. |
| `connectors/internal/transfer/import` | Generic guard; body `userId` | ADK `connector_tools.py` internal transfer helpers | Same fixed native-tool caller set and live proof; caller-selected user mismatch denies. Current workspace write/provider-account checks remain in transfer service. |
| `telegram/internal/validations` | Generic guard | ADK `owner_validation.py`, tests `src/smart_rag/tools/tests/test_owner_validation.py` | Live native proof plus exact conversation; current integration owner and conversation binding checked before bot-token decryption/send. No generic-key fallback; client accepts the actual HTTP 201 success response. |
| `workspaces/internal/resolve-names` | Generic guard | No verified tracked caller | Generic service access retired. Existing route now uses normal access JWT authentication and current account/workspace authorization for the whole batch; no guessed machine principal. Unknown external consumers need an explicit authorized cutover. |
| `internal/documents/download-url` | Generic guard; arbitrary raw key/TTL | No verified tracked consumer | User selected removal, not a guessed new presign principal. Use existing authorized resource-ID APIs; unknown external consumers remain a cutover dependency. |

`InternalServiceGuard` compares a shared `INTERNAL_SERVICE_SECRET` to
`X-Internal-Token`; it proves no domain or actor. The existing scoped factory is
`YellowStorm/back/src/modules/auth/guards/internal-service-principal.guard.ts`.
Every migrated route must fix its allowed principal and expected actor audience
in trusted controller/guard configuration; request headers never define policy.

Current child native routes use
`auth/guards/adk-native-actor.guard.ts`: principal verification is followed by the
owning Root/native or Playbook live authorizer, never an MCP assertion. Root
definition rights are rechecked; Playbook workspace selection comes from the
canonical execution snapshot. Owning authorizers are resolved after bootstrap to
avoid importing the entire Playbook module into Workspace's documented DI cycle.
Focused native HTTP/controller/Telegram and ADK client tests passed; required
review and complete dispatch qualification are still pending. Name lookup has
10 real access-JWT/current-share tests, including two users and revocation.
The legacy guard may remain exported as unused compatibility code, but no route
in this tracked child inventory should rely on it after these migrations.

Root scope is role/mode-aware: root and selected-worker snapshot digests are
different authorities. A library worker's canonical `source_workspace_ids` can
include its own native workspace outside conversation links; `root_constrained`
mode additionally enforces the frozen parent ceiling. Temporary child sources are
the intersection of its canonical admitted source IDs and the frozen parent
ceiling. Current resource owner/write checks and conversation-output policy remain
necessary. Both foreground and background HTTP cases cover distinct workspaces,
unadmitted targets and revocation; foreground cases have no scheduler job row and
are bound to the parent's exact live message lease.

Foreground child admission returns proof only through
`X-YellowStorm-Child-Authority`; it never enters the JSON definition, protobuf
Struct or tool result. ADK installs a separate task-local child-native context,
keeps parent callbacks/control authority intact, renews every 120 seconds and
cleans up on exit. Missing/failed child authority cannot fall back to the parent.
Required scoped review passed after the role-aware source/transport corrections:
latest affected backend checks **4 suites / 120 PASS**, production build-config
typecheck PASS and private-context Python **54 PASS / 2 skipped**. This does not
certify full bootstrap/provider/deployment behavior. Connector encryption also
subsequently passed its scoped required review and final **9 suites / 170 tests**;
see the [migration contract](connector-url-secret-migration.md) for its explicit
PostgreSQL atomicity and rollout gaps.

## Exact baseline guarded route declarations

Source owners: `YellowStorm/back/src/modules/` paths shown below. These tables
describe the baseline; removed/new routes must be reconciled in the final diff.

### `agent/controllers/agent-crud-internal.controller.ts`, prefix `internal/agent-crud`

- GET `agent-types`, `models`, `agents`, `agents/:id`
- POST `agents`; PATCH `agents/:id`; DELETE `agents/:id`

### `team/controllers/team-crud-internal.controller.ts`, same `internal/agent-crud` prefix

- GET `teams`, `teams/:id`; POST `teams`; PATCH `teams/:id`
- PATCH `teams/:id/hierarchy`; DELETE `teams/:id`

### `playbook-flow/controllers/playbook-assistant-internal.controller.ts`, prefix `internal/playbook-assistant`

- GET `playbooks`, `executions`, `executions/:executionId/diagnostics`
- POST `playbooks/:id/context`
- GET `playbooks/:id/summary`, `playbooks/:id/tasks/:taskId`, `playbooks/:id/tasks/:taskId/dependencies`, `playbooks/:id/validation`
- POST `playbooks/:id/constructions`, `requests/:requestId/assessment`, `clarifications/:continuationId`, `requests/:requestId/constructions`, `requests/:requestId/generation`, `generation`, `playbooks/:id/current-turn/modification`
- GET `playbooks/:id/constructions/:operationId`, `playbooks/:id/constructions/:operationId/events`
- POST `playbooks/:id/constructions/:operationId/cancel`, `playbooks/:id/constructions/:operationId/revert`, `playbooks/:id/tasks/:taskId/optimization`, `playbooks/:id/advisor-remediation-constructions`, `playbooks/:id/workflow-optimization`
- POST `playbooks`, `playbooks/:id/clone`, `playbooks/:id/executions`
- GET `playbooks/:id/executions`, `executions/:executionId`
- POST `executions/:executionId/cancel`, `executions/:executionId/trace-replay`, `executions/:executionId/re-execute`, `executions/:executionId/run-from-step`
- DELETE `executions/:executionId`

### `semantic-model/controllers/semantic-model-assistant-internal.controller.ts`, prefix `internal/semantic-model-assistant`

- GET `models`; POST `models`, `models/:modelId/clone`; DELETE `models/:modelId`
- GET `models/:modelId`, `models/:modelId/check`, `models/:modelId/changes`
- POST `models/:modelId/changes`, `models/:modelId/changes/undo`, `models/:modelId/changes/:changeId/undo`
- GET `workspaces`, `workspaces/:workspaceId/files`
- POST `models/:modelId/sources/profile`, `models/:modelId/sources/spreadsheet`, `models/:modelId/sources/documents`, `models/:modelId/source-suggestions`
- GET `models/:modelId/source-suggestions`; DELETE `models/:modelId/sources/:sourceId`
- POST `models/:modelId/runs`; GET `models/:modelId/runs/active`, `models/:modelId/runs/:jobId`
- POST `models/:modelId/runs/stop`, `models/:modelId/runs/:jobId/stop`
- POST `models/:modelId/graph-search`, `models/:modelId/graph-expand`
- GET `models/:modelId/data-description`
- POST `models/:modelId/records-query`, `models/:modelId/records-traverse`, `models/:modelId/records-connect`, `models/:modelId/publish`

### `conversation/controllers/root-delegate-internal.controller.ts`, prefix `internal/root-work`

All POST: `assets/list`, `assets/inspect`, `assets/read`, `assets/prepare`,
`assets/register`, `images/generate`,
`:executionId/conversation-replies/:messageId/cancel`, `:executionId/background-task`,
`:executionId/background-fanout`, `:executionId/background-tasks/:childId/status`,
`:executionId/background-tasks`, `:executionId/background-tasks/:childId/result`,
`:executionId/background-tasks/:childId/cancel`, `:executionId/background-definition`,
`:executionId/background-events`, `:executionId/background-items/:itemId/definition`,
`:executionId/background-items/:itemId/permit`, `:executionId/background-items/:itemId/lifecycle`,
`:executionId/background-items/:itemId/evidence-page`, `:executionId/background-evidence-page`,
`:executionId/background-lifecycle`, `:executionId/fanout-manifest`,
`:executionId/children/:childId/permit`, `:executionId/temporary-definition`,
`:executionId/background-synthesis-results/:producerId`, `:executionId/delegate-definition`,
`:executionId/children/:childId/lifecycle`, `:executionId/children/:childId/evidence-page`.

### Other internal controllers

- `workspace/workspace-asset-internal.controller.ts`, `workspaces/internal`: GET `semantic-asset-metadata`, GET `semantic-asset`, PUT `semantic-derived-file`, PUT `semantic-dataset`, GET `semantic-dataset`.
- `workspace/workspace-ingest.controller.ts`: POST `workspaces/:workspaceId/documents/ingest-url`.
- `workspace/workspace-internal.controller.ts`: POST `workspaces/internal/resolve-names`.
- `connector/controllers/connector-internal.controller.ts`: POST `connectors/internal/mcp-token`, POST `connectors/internal/transfer/import`.
- `document/document.controller.ts`: POST `internal/documents/download-url` (removed in child).
- `playbook-flow/controllers/playbook-flow-internal-artifact.controller.ts`: POST `internal/playbook-artifacts/executions/:executionId` (version-neutral).
- `telegram/controllers/telegram-validation-internal.controller.ts`: POST `telegram/internal/validations`.
- `app-runtime/controllers/app-runtime-internal.controller.ts`: POST `internal/app-runtime/bind`, POST `internal/app-runtime/tool-invoke`.
- Adjacent `workspace/workspace-access-check.controller.ts`: GET `workspaces/internal/check-access`. Do not infer machine protection from the path; independently inspect its actual guards during final review.

## Canonical semantic job authority

Runtime owner: `YellowStorm/semantic-model-runtime/app/persistence/postgres_jobs.py`:
`admit` transactionally stores job, task, dispatch outbox and event; source-event
discovery also enqueues model-less jobs. `claim_task` increments `lease_epoch`,
sets `lease_owner`/`lease_expires_at`; renew/checkpoint/complete fence the live tuple.
Schema: `migrations/001_durable_jobs.sql`. Population admission:
`app/api/population_routes.py` -> `admit`; backend caller
`semantic-model/services/semantic-runtime-client.service.ts::requestPopulationRun`.

The baseline asset client propagates none of that live authority. A job ID plus
owner/epoch is only a selector, not a capability. The approved design adds signed
backend admission and an opaque claim-time proof with a persisted digest; each
asset operation verifies live task, exact admission/document version and rights.
User-approved exception: model-less discovery is limited to exact uploaded
document/version and profiling operations; population remains model/source-bound.
The implemented [semantic asset contract](semantic-asset-grant-contract.md) records
canonical UUID binding, scoped storage, current-rights checks, scoped review and
the exact PostgreSQL evidence limits.

## Adjacent indexing permission check

`WorkspaceAccessCheckController` does not use `InternalServiceGuard`: it verifies
`x-api-key` against `indexing.apiKey` (`INDEXING_API_KEY`) with constant-time
comparison, then returns only the current `WorkspaceShareService.hasAccess`
decision. It does not issue document bytes, presigned URLs or execution grants;
its user/workspace inputs are permission-query selectors, not an asset actor
admission. Keep its indexing credential isolated from all MCP/native credentials.
Actual external indexing deployments/mounts remain unverified.

## Deployment / external gaps (not closed by source tests)

- `.github/workflows/deploy-mcp.yml` describes secret-manager injection, not
  exhaustive effective container environment or mounts. Actual ACA/Kubernetes/
  Compose mounted-secret inventories and external repositories remain unverified.
- Verify removal of generic keys from each MCP deployment, not merely renaming
  source environment variables. Semantic workers must not receive MCP keys.
- Identify external raw-presign and workspace-name clients before cutover;
  unsafe authorization remains disabled rather than allowing a generic fallback.
- Real PostgreSQL/Ceph integration and rollout/rotation evidence are pending.
  Runtime integration fixtures can drop schemas; use a confirmed disposable test
  database, never the application database or an assumed test connection.
