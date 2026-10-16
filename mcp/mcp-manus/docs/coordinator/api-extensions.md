# Coordinator API extensions for reliable sandbox lifecycle

This document specifies coordinator endpoints that complement the MCP `SandboxRuntime`
acquire flow. The MCP implements these clients behind feature flags.

## GET /sandbox/lease

Resolve an existing lease without creating a new microVM.

### Query parameters

| Parameter    | Required | Description                          |
|-------------|----------|--------------------------------------|
| scope_type  | yes      | e.g. `conversation`, `playbook`      |
| scope_id    | yes      | Canonical scope id                   |
| lane_id     | no       | Defaults to `main`                   |

### Response 200

```json
{
  "lease_id": "conversation:abc:main",
  "sandbox_id": "conversation:abc:main",
  "ip": "10.0.0.42",
  "cdp_url": "http://10.0.0.42:9222",
  "vnc_ws_url": "ws://10.0.0.42:5901",
  "status": "ready",
  "reused": true
}
```

`status` values:

- `creating` — VM allocated, not yet executable
- `ready` — executable and supervisor ready (preferred for MCP reuse)
- `running` / `busy` — legacy aliases treated as ready by MCP
- `failed` — creation failed

### Response 404

No active lease for the given scope/lane.

## GET /sandbox/lease/{lease_id}/health

Deep health check for a specific lease.

### Response 200

```json
{
  "executable": true,
  "supervisor_ready": true,
  "mounts_ok": true,
  "message": ""
}
```

| Field              | Meaning                                              |
|--------------------|------------------------------------------------------|
| executable         | `POST /sandbox/execute` succeeds for a probe command |
| supervisor_ready   | All supervisord services RUNNING                     |
| mounts_ok          | `/mnt/workspace` and output paths are mounted        |

## POST /sandbox/create — readiness enrichment

When polling `GET /sandbox/queue/status`, return `status: ready` only when:

```
executable && supervisor_ready
```

This removes boot races where the MCP must poll execute separately.

## Idempotency contract

`POST /sandbox/create` with the same `(scope_type, scope_id, lane_id)` must:

1. Return the existing lease if still alive (`reused: true`)
2. Recreate only if the previous lease was destroyed or expired

## MCP integration

| Setting                    | Default | Effect                                      |
|---------------------------|---------|---------------------------------------------|
| `SANDBOX_USE_LEASE_LOOKUP`| `true`  | MCP calls `GET /sandbox/lease` before create |

**Status:** `GET /sandbox/lease` is implemented in sandbox-manager (`resolve_lease_by_scope`).

Implementation: [`sandbox_mcp/client.py`](../sandbox_mcp/client.py) — `SandboxClient.resolve_lease()`.

## Optional future: webhook

```
POST {mcp_internal_url}/internal/lease-expired
{ "scope_id": "...", "lane_id": "main", "lease_id": "..." }
```

Allows proactive cache invalidation across MCP pods without waiting for probe failure.
