# App Runtime

Server side of the App Builder browser runtime. OpenCode (hosted in APImanus)
calls Runtime MCP tools on **YellowStorm**; this module relays them to a Nodepod
filesystem living in the user's browser and returns the result.

## Target architecture (default)

```
OpenCode → POST /api/v1/mcp/app-runtime (YellowStorm MCP, JSON-RPC)
         → RuntimeBrokerService → RuntimeToolDispatcherService
         → AppRuntimeGateway (Socket.IO /app-runtime) → browser Nodepod → Ceph
```

APImanus is limited to **OpenCode gateway + bind**: it calls
`POST /internal/app-runtime/bind` and passes the returned `mcpUrl` + `mcpToken`
to OpenCode. It does **not** host Runtime MCP on the main path.

## Legacy rollback

Set on APImanus: `APP_RUNTIME_MCP_LOCATION=apimanus` — MCP is served again at
`/api/v1/opencode/runtime-mcp` and tools go through `BrowserRuntimeAdapter` →
`POST /internal/app-runtime/tool-invoke`.

Set on YellowStorm: `APP_RUNTIME_LEGACY_TOOL_INVOKE=false` to return HTTP 410 on
tool-invoke once the YellowStorm MCP path is validated in production.

## Credentials

Two secrets, never mixed:

| Secret | Holder | Issued by | Storage |
|---|---|---|---|
| `mcpToken` | APImanus (config only) | `POST /internal/app-runtime/bind` | SHA-256 in `app_runtime_bindings.mcpTokenHash` |
| `ticket` | Browser | `POST /conversation-v2/sessions/:id/runtime-ticket` | SHA-256 in `app_runtime_tickets.ticketHash` |

The browser never sees the `mcpToken`. A ticket is single use and short lived
(`APP_RUNTIME_TICKET_TTL_MS`); redeeming it is an atomic `findOneAndUpdate`, so a
replayed ticket is rejected even under a race. A reconnect needs a fresh ticket.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `APP_RUNTIME_MCP_ENABLED` | `true` | When false, MCP endpoint returns 503 |
| `APP_RUNTIME_MCP_URL` | — | Explicit public MCP URL returned on bind |
| `APP_RUNTIME_PUBLIC_BASE_URL` | — | Used to derive MCP URL if `MCP_URL` unset |
| `APP_RUNTIME_LEGACY_TOOL_INVOKE` | `true` | Legacy APImanus HTTP bridge to dispatcher |
| `APP_RUNTIME_TICKET_TTL_MS` | `60000` | Browser runtime ticket lifetime |
| `APP_RUNTIME_HEARTBEAT_TIMEOUT_MS` | `45000` | Offline detection |
| `APP_RUNTIME_TOOL_TIMEOUT_MS` | `180000` | Default tool timeout |
| `APP_RUNTIME_MUTATION_WAIT_MS` | `30000` | Per-workspace mutation lock wait |

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
| `tool.failed` | `{ toolCallId, error: { code, message, data? } }` | `code` is relayed verbatim to MCP clients. |

### Server to browser

| Event | Payload |
|---|---|
| `tool.invoke` | `{ toolCallId, workspaceId, tool, arguments, baseRevisionId, timeoutMs }` |
| `runtime.rehydrate` | `{ workspaceId, expectedRevisionId, actualRevisionId }` |

## Runtime MCP tools

`list`, `read`, `search`, `write`, `apply_patch`, `delete`, `diff`, `run`,
`dev_server`, `preview_inspect`, `preview_action`, `finalize`.

Auth: `Authorization: Bearer <mcpToken>` on every MCP request after bind.

## Capabilities

`runtime.register` advertises `filesystem`, `npm`, `previewInspection` and
`nativeBinaries`. A tool whose required capability is missing fails with
`UNSUPPORTED_CAPABILITY` and no microVM is started; escalation is phase 5.

## Error codes

Mirrors APImanus `McpErrorCode`, so `error.code` maps straight onto JSON-RPC errors:

| Code | Meaning |
|---|---|
| `-32001` | `UNSUPPORTED_CAPABILITY` |
| `-32002` | `RUNTIME_OFFLINE` (no socket, or heartbeat timed out) |
| `-32003` | `REVISION_CONFLICT` (browser filesystem is stale) |
| `-32005` | `TOOL_TIMEOUT` (tool or mutation lock) |

Legacy `POST /internal/app-runtime/tool-invoke` always answers HTTP 200 with a flat
`{ ok: true, result }` or `{ ok: false, error }` body, outside the global
`{ success, data }` wrapper.

## Consistency guarantees

- **Idempotence**: `toolCallId` is unique in `app_runtime_tool_calls`. A settled
  call replays its stored outcome instead of mutating twice.
- **Duration telemetry (Phase 0)**: on `running`, the dispatcher stores `startedAtMs`;
  on settle (`succeeded` / `failed`) it writes `durationMs`. Query
  `app_runtime_tool_calls` by `workspaceId` / `tool` / `createdAt` for histograms.
- **One mutation at a time**: `write`, `apply_patch` and `delete` serialize on a
  per-workspace lock; waiting longer than `APP_RUNTIME_MUTATION_WAIT_MS` yields
  `TOOL_TIMEOUT`.
- **Revision guard**: a mutation is refused when the browser revision differs
  from the binding revision, and `runtime.rehydrate` is emitted first.

## Finalized versions

Successful `finalize` tool calls are recorded in Mongo (`app_finalized_revisions`)
via `RuntimeFinalizedRevisionService.record()`. These stable revision ids are
the only ones allowed for deployment (`GET /conversation-v2/sessions/:id/finalized-versions`,
deploy whitelist in `ConversationV2Controller`).

## Known limitation

The socket registry is process-local and there is no Redis Socket.IO adapter, so
tool dispatch only reaches the browser on the instance holding the socket. Same
constraint as `BrowserSessionService`. Running more than one backend replica
requires a Redis adapter plus routing tool dispatch to the owning instance.
