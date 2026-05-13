# Playbook Backend Overview

## Scope

This document covers the NestJS backend implementation in:

- `back/src/modules/playbook`

## Responsibilities

The backend is responsible for:

- playbook CRUD and authorization
- design generation and design-history persistence
- execution orchestration and persistence
- active-execution catch-up
- SSE fan-out
- replay baseline management
- output-format template management
- semantic evaluation persistence
- partial re-execution flows

## Main Components

### Controllers

- `playbook.controller.ts`
- `playbook-execution.controller.ts`
- `playbook-stream.controller.ts`

### Core Services

- `playbook.service.ts`
- `playbook-execution.service.ts`
- `playbook-design.service.ts`
- `playbook-grpc.service.ts`
- `playbook-stream-gateway.service.ts`

### Supporting Services

- `playbook-replay.service.ts`
- `playbook-output-format.service.ts`
- `playbook-evaluation.service.ts`
- `playbook-semantic-enrichment.service.ts`
- `playbook-context.service.ts`

## Persistence Model

The backend persists:

- playbooks
- execution history
- design history
- validated replays
- output-format templates

Execution records also store:

- playbook snapshot
- thread id
- interrupt payload
- task results
- replay provenance
- attempt history
- token totals

## Active Execution Strategy

The backend keeps in-memory step buffers during workflow streaming.

This allows:

- fresher execution state than the latest durable Mongo write
- active-execution recovery after refresh
- fewer writes during long-running workflows

## Enabled-Graph Behavior

Execution operates on the enabled subset of the graph.

That means:

- tasks with `enabled === false` are excluded from full execution
- edges are filtered so only enabled source/target pairs remain
- single-step execution rejects disabled steps

## Mental Model

The backend is the source of truth for:

- persistence
- authorization
- orchestration policy
- execution lifecycle state
- SSE event emission
- translation between app models and gRPC contracts

