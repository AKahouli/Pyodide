# Yellowmind observability stack (Grafana + Loki + Alloy)

Local/integration profile of plan §7. Isolated, single-host, **not high availability**.
Production sizing, storage choice (shared object store vs filesystem), and log volumes are
operator decisions recorded in `docs/observability/deployment-inventory.md`.

## What runs

| Component | Role |
|---|---|
| `loki` | Log store. TSDB v13, structured metadata ON, 30d retention via compactor. Network-internal. |
| `gateway` (nginx) | The ONLY path to Loki: basic auth, published on `127.0.0.1:3100`. |
| `alloy` | Collection: docker socket (read-only) → only containers labelled `logging=yellowmind` → JSON parse → 3 index labels (`service_name`, `environment`, `severity_text`) + structured metadata → gateway. Bounded batch/retry (429-retry on, max_backoff_retries 10). |
| `grafana` | UI on `127.0.0.1:3300`, anonymous auth OFF, provisions datasource + **Yellowmind — Incident Explorer**. |
| `prometheus` | Pipeline-health metrics (alloy retry/drop, loki, service `/metrics` via file_sd). 15d retention. |
| `canary` | Synthetic event every 30s through the real collection path. An absent canary result means UNHEALTHY (dashboard states this explicitly). |

## Run

```bash
cp env.example .env         # fill placeholders; never commit .env
docker compose up -d
# Grafana: http://127.0.0.1:3300  → Yellowmind folder → Incident Explorer
```

## Index-label policy (plan §7.4)

Exactly three stream labels exist: `service_name`, `environment`, `severity_text` (+ collector
metadata `container`, `source`). High-cardinality context (user, request, trace, run, conversation,
job, agent, event_id, event_name, version, instance) is **structured metadata** — queryable, not indexed.
Changing the label allowlist requires a reviewed contract change and a test update (T25).

## Known limitations (documented, deliberate)

- Non-HA filesystem storage; shared-storage contention accepted where physical isolation is unavailable.
- Malformed/non-JSON lines (native runtime output, third-party containers) pass through with
  container labels only — a transitional adapter behavior; no raw-secret dead-letter dump exists.
- Loki `auth_enabled: false`: authentication is enforced by the gateway and network placement;
  multi-tenancy is intentionally off in this profile (tenant headers are not authorization).
- Image digests are resolved and recorded at predeploy time (`versions.lock.json` predeploy checks).

## Container log delivery

Business services must run with non-blocking json-file delivery (plan §7.2). Overlay fragment:

```yaml
logging:
  driver: json-file
  options: { mode: non-blocking, max-buffer-size: "4m", max-size: "20m", max-file: "5" }
```

Apply via the host-side compose overlay (see deployment-inventory): changing daemon defaults does
not update already-created containers; use canary or per-service drain/recreate.
