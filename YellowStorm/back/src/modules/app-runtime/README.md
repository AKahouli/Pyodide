# App Runtime

Server side of the App Builder browser runtime. OpenCode (hosted in APImanus)
calls Runtime MCP tools; this module relays them to a Nodepod filesystem living
in the user's browser and returns the result.

```
OpenCode -> Runtime MCP (APImanus) -> POST /internal/app-runtime/tool-invoke
         -> AppRuntimeGateway (Socket.IO /app-runtime) -> browser Nodepod
```

## Credentials

Two secrets, never mixed:

| Secret | Holder | Issued by | Storage |
|---|---|---|---|
| `mcpToken` | APImanus | `POST /internal/app-runtime/bind` | SHA-256 in `app_runtime_bindings.mcpTokenHash` |
| `ticket` | Browser | `POST /conversation-v2/sessions/:id/runtime-ticket` | SHA-256 in `app_runtime_tickets.ticketHash` |

The browser never sees the `mcpToken`. A ticket is single use and short lived
(`APP_RUNTIME_TICKET_TTL_MS`); redeeming it is an atomic `findOneAndUpdate`, so a
replayed ticket is rejected even under a race. A reconnect needs a fresh ticket.

## Socket protocol (`/app-runtime`)

Connect with the ticket in the handshake:

```ts
io('/app-runtime', { auth: { ticket } }); // or the x-runtime-ticket header
```

An invalid, expired or already consumed ticket is disconnected immediately.

### Browser to server

| Event | Payload | Notes |
|---|---|---|
| `runtime.register` | `{ runtimeSessionId, workspaceId, revisionId, capabilities, browserRuntimeId? }` | Must match the ticket, otherwise the socket is dropped. Moves the binding to `browser_active`. |
| `runtime.heartbeat` | `{ workspaceId, revisionId? }` | Persisted to Mongo at most every 15s. |
| `tool.progress` | `{ toolCallId, phase?, message? }` | Rearms the tool timeout for long-running work. |
| `tool.completed` | `{ toolCallId, result }` | `result` is the Runtime MCP output object, camelCase. |
| `tool.failed` | `{ toolCallId, error: { code, message, data? } }` | `code` is relayed verbatim to APImanus. |

### Server to browser

| Event | Payload |
|---|---|
| `tool.invoke` | `{ toolCallId, workspaceId, tool, arguments, baseRevisionId, timeoutMs }` |
| `runtime.rehydrate` | `{ workspaceId, expectedRevisionId, actualRevisionId }` |

## Capabilities

`runtime.register` advertises `filesystem`, `npm`, `previewInspection` and
`nativeBinaries`. A tool whose required capability is missing fails with
`UNSUPPORTED_CAPABILITY` and no microVM is started; escalation is phase 5.

## Error codes

Mirrors `McpErrorCode` in APImanus, so `error.code` maps straight onto an
`McpError`:

| Code | Meaning |
|---|---|
| `-32001` | `UNSUPPORTED_CAPABILITY` |
| `-32002` | `RUNTIME_OFFLINE` (no socket, or heartbeat timed out) |
| `-32003` | `REVISION_CONFLICT` (browser filesystem is stale) |
| `-32005` | `TOOL_TIMEOUT` (tool or mutation lock) |

`POST /internal/app-runtime/tool-invoke` always answers HTTP 200 with a flat
`{ ok: true, result }` or `{ ok: false, error }` body, outside the global
`{ success, data }` wrapper.

## Consistency guarantees

- **Idempotence**: `toolCallId` is unique in `app_runtime_tool_calls`. A settled
  call replays its stored outcome instead of mutating twice.
- **One mutation at a time**: `write`, `apply_patch` and `delete` serialize on a
  per-workspace lock; waiting longer than `APP_RUNTIME_MUTATION_WAIT_MS` yields
  `TOOL_TIMEOUT`.
- **Revision guard**: a mutation is refused when the browser revision differs
  from the binding revision, and `runtime.rehydrate` is emitted first.

## Known limitation

The socket registry is process-local and there is no Redis Socket.IO adapter, so
`tool-invoke` only reaches the browser on the instance holding the socket. Same
constraint as `BrowserSessionService`. Running more than one backend replica
requires a Redis adapter plus routing tool dispatch to the owning instance.
