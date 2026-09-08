# Worky Module (Backend)

The Worky module implements Chief of Staff streams, orchestrated through the
`WorkyOrchestratorGrpcClientService`. Manager-owned Postgres state is consumed
through Electric, projected into MongoDB, and broadcast to the frontend over
the Worky SSE channel.

## Runtime Flow

1. Authenticated Worky controllers validate the stream and persist owner input.
2. The backend starts or controls the manager session over gRPC.
3. `WorkyElectricConsumerService` consumes manager messages, plans, steps,
   components, and artifacts.
4. MongoDB projections back the Worky REST reads.
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
| WhatsApp integration | `controllers/worky-whatsapp-integration.controller.ts` |

## Configuration

Worky feature configuration is defined in `src/config/worky.config.ts`.
Orchestrator endpoint and transport security settings are defined separately in
`src/config/worky-orchestrator.config.ts` and
`src/config/grpc-security-worky-orchestrator.config.ts`.
