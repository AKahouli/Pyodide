# Agent Orchestrator API

Production multi-agent planning/execution service. **CQRS**: commands over gRPC,
reads over ElectricSQL. Single datastore — **Postgres only** (no Mongo).

## Surface

### Write side — gRPC (`orchestrator.proto`)

| RPC | Purpose |
|-----|---------|
| `CreateSession` | create an empty session → `session_id` |
| `RunTask` | submit a message (new turn **or** a reply that resumes a blocked plan); runs in the background, acks immediately |
| `GetSession` | one-shot snapshot (title, status, current plan) for initial load |
| `StopSession` | cancel a running/blocked session |

`RunTask` is unary and fire-and-forget. It carries `idempotency_key` — the server
runs a given key **at most once per session**, so a client retry never
double-starts a turn.

### Read side — ElectricSQL (the live UI)

Progress is **not** streamed over gRPC. The orchestrator projects into Postgres;
the client syncs these shapes per session (through the trusted proxy that injects
`ELECTRIC_SECRET` and pins `where = session_id = '<owned>'`):

```sql
sessions   (id, user_id, title, status, created_at, updated_at)
plans      (session_id, id, title, goal, status, updated_at)
plan_steps (session_id, step_id, ordinal, wave, status, description,
            depends_on, agent, result, blocked_reason, updated_at)  -- one row per step
messages   (id, session_id, role, content, created_at)             -- one row per message
```

`plan_steps` is **row-per-step** so parallel work shows as many rows updating
independently, and a `blocked` step renders as "waiting on you". These four
tables are the only ones published to Electric — ADK's session tables and the
`mcp_tasks` queue stay internal.

## Status value sets (strings, matching the existing client contract)

- session / plan / step: `pending | running | blocked | completed | failed`
- session adds: `waiting` (suspended on a block, awaiting a resuming `RunTask`)

## How one `RunTask` drives everything

```
RunTask(message) ─► root orchestrator (background)
   planner (LLM)         → Plan{ steps + depends_on }
   orchestrator (code)   → topological waves
     wave of independent steps → executor sub-agents run IN PARALLEL
     dependent steps            → run after their deps (SEQUENTIAL)
   events → project to Postgres → Electric → client
   • step needs input   → ask_user (long-running tool) → step=blocked,
                          session=waiting; resume with the next RunTask
   • step calls a slow  → MCP task pending → row in mcp_tasks → poller resumes
     MCP tool             (Postgres queue claimed with FOR UPDATE SKIP LOCKED)
```

## Deliberately omitted vs. the old ConversationV2

Dropped as unnecessary here: VNC signed URLs, Pause/Resume RPCs, the streaming
`Chat` RPC (reads are via Electric), and the browser/shell/file/search tool
content variants (tools are MCP-driven). Add back only if a real need appears.

## Generate the stubs

```bash
python grpc/proto/orchestrator/generate.py   # → src/grpc_generated/orchestrator_pb2*.py
```

Generate with the project's pinned `grpcio-tools` so the output matches the
runtime grpc version, then restart the gRPC server.
