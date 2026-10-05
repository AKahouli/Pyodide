# Rollout runbook — unified logging

Plan §14 requirements. Production rollout is **pending operator authorization** (P10 BLOCKED);
this runbook is the handoff artifact.

## Before first cutover (all REQUIRED)

1. Provision `infra/observability/` on the observability host; fill `.env` from the secret manager; generate `gateway/htpasswd` (`htpasswd -Bbn "$OBS_LOKI_USER" "$OBS_LOKI_PASSWORD"`); `docker compose up -d`; resolve and record image digests (see `versions.lock.json` predeploy checks).
2. Verify the canary: Grafana → Yellowmind → Incident Explorer shows canary events; stat panel green within ~1 min. Empty = unhealthy — do not proceed.
3. Verify operator Grafana login (admin user from secrets, anonymous disabled) before any business emitter changes.
4. Record historic cutoff: set `LOGGING_HISTORIC_CUTOVER_AT=<ISO timestamp>` in backend env at cutover time.
5. Confirm rollback image set: last known-good backend/ADK images + their compose files.

## Canary sequence

1. Deploy ONE service chain (recommend backend) with the new image. Since P11 the SQL write path is removed: `LOGGING_PERSISTENCE_ENABLED` (and the other retired `LOGGING_*` vars) are validated but unread — no switch to flip. Rollback for the SDK itself is a git revert.
2. Confirm in Grafana: `legacy.log`/registry events present, filters by username/request_id/trace_id/run_id work, no duplicate primary sinks (old console display stops, SQL writer stops).
3. Apply the non-blocking json-file logging overlay (infra/observability/README) to that service only; verify container recreation does not lose collection (Alloy re-discovers within 10s).
4. Expand service-by-service (ADK → MCP ×3 → code-runtime → semantic-model-runtime), respecting long-running executions: do NOT stop streams/jobs to apply logging config; drain or canary each service. Record per-service cutover timestamps in implementation-status.md.
5. ADK: `USE_YELLOWMIND_OBSERVABILITY` and `ENABLE_POSTGRESQL_LOGGING` are retired (P11 removed the legacy path) — stale values are harmless (settings ignore extras); no action needed.

## Promotion conditions

Searchable correlation across the canary chain; all filters working; stable queue/memory (SDK metrics); successful collector-restart recovery test; no new user-visible regression; zero diagnostic SQL writes (T18 evidence).

## Rollback triggers

Secret leakage, cross-user identity contamination, invalid-schema storms, log-induced request failures, unbounded buffering, material latency/throughput regression, unsafe admin access, unobservable collector failure.

## Rollback sequence

1. Halt promotion; preserve incident metrics and sanitized evidence.
2. Restore last known-good normalized SDK image/config with SQL logging still OFF; keep the collector running.
3. Pre-migration image fallback: set `LOGGING_PERSISTENCE_ENABLED=false` / `ENABLE_POSTGRESQL_LOGGING=false` explicitly; mark the degraded window; never re-enable SQL/DB logging as fallback.
4. Do not delete historic tables or roll back domain migrations.
5. Retest liveness, a synthetic correlated failure, drop metrics, operator access; record the degraded interval start/end.

## Runbook extensions required at P10

Collector restart, expired shipping credentials, high log volume, retention cleanup failure, full local storage, debug-scope expiry, safe recovery of retained local records.
