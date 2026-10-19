# Sticky routing for multi-pod MCP deployment

The MCP server keeps an **in-memory registry** of sandbox clients per `scope_id:lane_id`.
With multiple replicas, requests for the same conversation must hit the **same pod** unless
the MCP uses a shared registry (not implemented — Redis deferred).

## Recommended approach: header-based sticky routing

Hash on canonical scope headers set by YellowStorm:

- `x-sandbox-scope-id`
- `x-sandbox-lane-id`

Fallback (legacy): `x-user-id` + `x-conversation-id` / `x-execution-id`.

## Nginx example

```nginx
upstream mcp_backend {
    hash $http_x_sandbox_scope_id$http_x_sandbox_lane_id consistent;
    server mcp-1:8001;
    server mcp-2:8001;
    server mcp-3:8001;
}

server {
    location /mcp {
        proxy_pass http://mcp_backend;
        proxy_set_header x-sandbox-scope-id $http_x_sandbox_scope_id;
        proxy_set_header x-sandbox-lane-id $http_x_sandbox_lane_id;
    }
}
```

## Kubernetes / Ingress

Use an ingress controller that supports session affinity on custom headers, or a service mesh
route rule keyed on `x-sandbox-scope-id`.

If header-based affinity is unavailable, use **one replica** until coordinator-side lease
lookup (`SANDBOX_USE_LEASE_LOOKUP=true`) is deployed — then pods can be stateless-ish.

## Pod death behavior

1. Sticky route lands on pod B (pod A died)
2. Pod B has empty cache → `SandboxRuntime.acquire()` runs
3. `GET /sandbox/lease` or idempotent `POST /sandbox/create` reconnects to live VM
4. No user-visible failure if coordinator lease still exists

## TTL alignment

Set `SANDBOX_TTL_MINUTES` on MCP **≤** coordinator lease TTL so the MCP evicts idle sandboxes
before the coordinator destroys the lease, avoiding stale-cache probes.

MCP eviction: [`sandbox_mcp/eviction.py`](../sandbox_mcp/eviction.py) — background loop every 60s.

## Auth reminder

MCP must sit behind a gateway that sets identity headers and enforces `MCP_API_KEY`. Do not
expose the MCP port publicly without auth.
