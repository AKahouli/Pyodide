# Backend instructions

Inherits the repository `AGENTS.md`. Apply these rules to `YellowStorm/back/**`.

## Before editing

- Reuse a sibling feature module and existing package dependencies before adding a pattern or library. Inspect only relevant source, tests and linked context.
- Use NestJS feature ownership: controllers wire DTOs to services; owning modules register schemas and export only needed services. Reuse owning services across modules.
- Use configured aliases (`@modules/*`, `@common/*`, `@config/*`), strict types and explicit public return types. Avoid `any` and deep relative imports.

## Invariants

- Preserve the global response/error envelopes and pagination shape. Use validated DTOs and domain exceptions with registered error codes; mirror code/messages in frontend EN/FR locales.
- JWT authentication is global; public routes need explicit `@Public()` and rate limits. Widget routes reuse `WidgetTokenGuard`; never retain plaintext tokens after creation.
- Services use typed configuration, never direct `process.env`. Keep namespace loading, Joi validation and exports aligned. Trace every rollout-flag consumer.
- Conversation data uses PostgreSQL store tokens and Drizzle migrations; Mongo conversation collections are legacy. Other Mongo domains use owning schemas, indexes, projections and safe serialization.
- Concurrent updates require expected revisions; leased workers heartbeat and check their lease before publishing results. Jobs and event handlers must be idempotent.
- Verify both ends of REST/gRPC/SSE contracts. Wrap protobuf Struct values with `toGrpcStruct()`; validate proto mirrors and standalone/Docker packaging.
- Streams clean up on disconnect, preserve ordered cursors, and remain unbuffered. Browser-session viewport, acknowledgements and safety controls are cross-boundary contracts.
- Use the shared observability SDK, registered events and trusted correlation; follow [logging contract](../../docs/observability/logging-contract.md). Never log secrets or swallow errors.

## Load context only when relevant

| Change | Detailed context |
| --- | --- |
| Module organization, imports, types or naming | [Structure](../../docs/agent-context/backend/foundation.md) |
| Bootstrap, configuration or feature flags | [Configuration](../../docs/agent-context/backend/configuration.md) |
| DTOs, REST responses, errors or frontend boundary | [API contracts](../../docs/agent-context/backend/api-contracts.md) |
| Auth, widget tokens or rate limits | [Security](../../docs/agent-context/backend/security.md) |
| Mongo, PostgreSQL, migrations or worker leases | [Persistence](../../docs/agent-context/backend/persistence.md) |
| ADK, protobuf or gRPC packaging | [gRPC](../../docs/agent-context/backend/grpc.md) |
| SSE, browser-session or app-runtime sockets | [Real-time](../../docs/agent-context/backend/realtime.md) |
| Scheduling, email, uploads or health | [Operations](../../docs/agent-context/backend/operations.md) |
| Outbox, governance, artifacts or knowledge extraction | [Domain patterns](../../docs/agent-context/backend/domains.md) |
| Tests or relevant delivery checks | [Verification](../../docs/agent-context/backend/verification.md) |

## Focused verification

- From this directory run `npm test -- <pattern>`; run lint/build only when affected. Tests are colocated `*.spec.ts`, use Nest test modules and mock owned persistence tokens.
- PostgreSQL integration tests use `describeIntegration`/`makeTestDb` and `POSTGRES_TEST_DB`; never write test data into `agentstore`.
- For runtime logging changes, run `node scripts/observability/check-policy.mjs` from the repository root. For SDK/contract changes run the observability unit gates.
- For schema/proto/auth/streaming changes, verify affected producers and consumers plus the relevant checklist in [Verification](../../docs/agent-context/backend/verification.md); apply the repository risk gates.
