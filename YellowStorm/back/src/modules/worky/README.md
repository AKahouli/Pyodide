# Worky Module (Backend)

The Worky module implements Chief of Staff streams, orchestrated through the
`WorkyOrchestratorGrpcClientService`. Manager-owned Postgres state is consumed
through Electric, mirrored into the app database (`worky` schema, migration
0038), and broadcast to the frontend over the Worky SSE channel.

## Runtime Flow

1. Authenticated Worky controllers validate the stream and persist owner input.
2. The backend starts or controls the manager session over gRPC.
3. `WorkyElectricConsumerService` consumes manager messages, plans, steps,
   components, and artifacts.
4. The `worky.*` tables back the Worky REST reads; `persistence/` holds one
   Drizzle repository per aggregate.
5. `WorkyEventService` notifies connected frontend clients over SSE.

The former standalone HTTP/SSE runtime and `/worky/internal/*` callback API
have been retired.

## Main Entry Points

| Area | Entry point |
|------|-------------|
| Stream CRUD | `controllers/worky-stream.controller.ts` |
| Messages and manager kickoff | `controllers/worky-message.controller.ts` |
| Turn controls | `controllers/worky-message.controller.ts` |
| Board and task operations | `controllers/worky-board.controller.ts`, `controllers/worky-task.controller.ts` |
| Electric projections | `services/worky-electric-consumer.service.ts` |
| Orchestrator client | `services/worky-orchestrator.grpc-client.service.ts` |
| Browser updates | `controllers/worky-events.controller.ts`, `services/worky-event.service.ts` |
| Persistence | `persistence/*.repository.ts`, tables in `src/modules/postgres/schema/worky.schema.ts` |

## Configuration

Worky feature configuration is defined in `src/config/worky.config.ts`.
Orchestrator endpoint and transport security settings are defined separately in
`src/config/worky-orchestrator.config.ts` and
`src/config/grpc-security-worky-orchestrator.config.ts`.
