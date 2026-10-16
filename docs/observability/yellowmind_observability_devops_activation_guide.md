# Yellowmind Unified Logging — DevOps Activation Guide

**Target branch:** `adk11-migration`  
**Audience:** DevOps / Platform team  
**Goal:** finish the runtime and infrastructure settings required to start analyzing Yellowmind logs centrally in Grafana.

> This guide covers activation and verification. The remaining application-level logging improvements are not blockers for initial centralized analysis.

---

## 1. Target state

```text
Backend / ADK / MCPs / Code Runtime / Semantic Runtime / Workers
                              |
                     JSON logs on stderr
                              |
                              v
                  Docker json-file driver
                              |
                              v
                       Grafana Alloy
                              |
                              v
                           Loki
                              |
                              v
                          Grafana
               Yellowmind — Incident Explorer
```

After this procedure, operators must be able to:

- select a date/time window;
- filter by service and severity;
- search event contents;
- search by `request_id` and `trace_id` when available;
- follow a request across Backend and ADK;
- distinguish “no business errors” from “the logging pipeline is down”.

### Known current limitation

Backend `username` / authenticated user propagation is not yet reliable for every event. This does **not** block ingestion or initial analysis. Do not use an empty username search as proof that a user generated no Backend events.

---

# 2. What already exists in `adk11-migration`

The branch already contains:

```text
contracts/observability/
packages/observability-ts/
packages/observability-python/
infra/observability/
scripts/observability/
```

The observability stack includes:

| Component | Purpose |
|---|---|
| Grafana | Operator UI |
| Loki | Central log storage |
| Grafana Alloy | Docker log collection and normalization |
| Nginx gateway | Authenticated access to Loki |
| Prometheus | Observability pipeline metrics |
| Canary | Synthetic log event every ~30 seconds |

Operational log writes to the application PostgreSQL database have been retired. Historical database logs remain readable separately.

---

# 3. Mandatory tasks before centralized analysis

Complete these items:

- [ ] Deploy `infra/observability`.
- [ ] Configure Grafana/Loki credentials from the secret manager.
- [ ] Regenerate `gateway/htpasswd`.
- [ ] Confirm Loki and Grafana health.
- [ ] Confirm the Canary appears in Grafana.
- [ ] Add Docker label `logging=yellowmind` to every service to collect.
- [ ] Set Docker log delivery to `mode: non-blocking`.
- [ ] Set explicit `OBS_SERVICE_NAME`, `OBS_ENVIRONMENT` and `OBS_SERVICE_VERSION`.
- [ ] Recreate selected containers so Docker applies labels/logging options.
- [ ] Confirm Backend and ADK logs appear in Grafana.
- [ ] Provide secure access to Grafana.

Start with Backend only, validate it, then onboard services incrementally.

---

# 4. Pre-flight checks

## 4.1 Use REC/POC first

Do not make the first end-to-end activation directly in production.

Record the existing running images:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```

Keep the current image tags for rollback.

## 4.2 Confirm the applications already emit logs

Before troubleshooting Alloy or Loki:

```bash
docker logs <backend-container> --tail 100 2>&1
docker logs <adk-container> --tail 100 2>&1
```

Migrated services should emit JSON events similar to:

```json
{
  "schema_version": "1.0",
  "event_name": "legacy.log",
  "severity_text": "INFO",
  "service_name": "yellowstorm-back",
  "environment": "rec"
}
```

If the service produces no unified JSON, first verify that the deployed image comes from a revision containing the unified logging implementation.

---

# 5. Deploy the observability stack

Work from:

```text
infra/observability/
```

## 5.1 Create `.env`

```bash
cd <yellowstorm-repository>/infra/observability
cp env.example .env
```

Populate from your secret manager:

```dotenv
OBS_ENVIRONMENT=rec
OBS_LOKI_USER=<secret>
OBS_LOKI_PASSWORD=<secret>
GRAFANA_ADMIN_USER=<secret>
GRAFANA_ADMIN_PASSWORD=<secret>
```

Rules:

- never commit the populated `.env`;
- do not reuse application database credentials;
- use different credentials between shared/pre-production and production.

## 5.2 Regenerate Loki gateway credentials

```bash
htpasswd -Bbn "$OBS_LOKI_USER" "$OBS_LOKI_PASSWORD" > gateway/htpasswd
chmod 600 gateway/htpasswd
```

If `htpasswd` is unavailable:

```bash
docker run --rm httpd:2.4-alpine   htpasswd -Bbn "$OBS_LOKI_USER" "$OBS_LOKI_PASSWORD"   > gateway/htpasswd

chmod 600 gateway/htpasswd
```

## 5.3 Validate the Compose configuration

```bash
docker compose config >/dev/null
```

This must exit successfully.

## 5.4 Start the stack

```bash
docker compose pull
docker compose up -d
docker compose ps
```

Expected services:

```text
loki
gateway
alloy
prometheus
grafana
canary
```

Inspect errors:

```bash
docker compose logs --tail 100 loki
docker compose logs --tail 100 gateway
docker compose logs --tail 100 alloy
docker compose logs --tail 100 grafana
docker compose logs --tail 100 canary
```

There must be no restart loop.

---

# 6. Validate the logging stack before adding business services

## 6.1 Loki readiness

The Loki gateway is intentionally bound to localhost.

```bash
curl -fsS   -u "$OBS_LOKI_USER:$OBS_LOKI_PASSWORD"   http://127.0.0.1:3100/ready
```

Expected:

```text
ready
```

## 6.2 Grafana health

```bash
curl -fsS http://127.0.0.1:3300/api/health
```

Expect a successful JSON response.

## 6.3 Canary validation

Open:

```text
Grafana
→ Dashboards
→ Yellowmind
→ Yellowmind — Incident Explorer
```

The Canary panel should become healthy within roughly one minute.

Direct Loki verification:

```bash
curl -fsS -G   -u "$OBS_LOKI_USER:$OBS_LOKI_PASSWORD"   http://127.0.0.1:3100/loki/api/v1/query   --data-urlencode 'query=count_over_time({service_name="observability-canary"}[2m])'
```

**Do not onboard business services if the Canary is absent.**

---

# 7. Give the team secure Grafana access

The repository profile exposes Grafana only on:

```text
127.0.0.1:3300
```

For initial validation:

```bash
ssh -L 3300:127.0.0.1:3300 <user>@<observability-host>
```

Then browse:

```text
http://127.0.0.1:3300
```

For shared team access, use the existing corporate ingress/reverse proxy with:

- HTTPS;
- authentication;
- restricted operator access;
- Grafana anonymous access disabled.

Do not expose Loki directly to the Internet.

---

# 8. Required Docker configuration on every collected service

Alloy only collects containers carrying:

```yaml
labels:
  logging: yellowmind
```

Without this label, `docker logs` can contain valid JSON while Grafana remains empty.

Use this standard fragment:

```yaml
services:
  <service>:
    environment:
      OBS_SERVICE_NAME: <canonical-service-name>
      OBS_ENVIRONMENT: rec
      OBS_SERVICE_VERSION: ${IMAGE_TAG}

    labels:
      logging: yellowmind

    logging:
      driver: json-file
      options:
        mode: non-blocking
        max-buffer-size: "4m"
        max-size: "20m"
        max-file: "5"
```

Use the real environment instead of `rec`.

### Why `mode: non-blocking` is mandatory

The logging path must never make a business request wait because log delivery is slow. Buffers are intentionally bounded; under extreme pressure, losing diagnostics is preferable to blocking the application.

---

# 9. Canonical service names

Set these explicitly:

| Runtime | `OBS_SERVICE_NAME` |
|---|---|
| Backend | `yellowstorm-back` |
| ADK | `yellowstorm-adk` |
| Agent MCP | `mcp-agent` |
| Playbook MCP | `mcp-playbook` |
| Semantic Model MCP | `mcp-semantic-model` |
| Code Runtime | `yellowstorm-code-runtime` |
| Semantic Model Runtime | `semantic-model-runtime` |
| Attribute Extraction Worker | `celery-worker-attribute-extraction` |

Do not accept names such as:

```text
backend
api
server
worker
unknown-service
```

in shared environments.

Recommended version:

```yaml
OBS_SERVICE_VERSION: ${IMAGE_TAG}
```

or an immutable Git SHA.

---

# 10. Modify the actual host-side Compose files

Current workflows deploy through host-side Compose files outside the repository.

Known paths include:

```text
~/yellowstorm/${ENV_NAME}/back/docker-compose.yaml
~/yellowstorm/${ENV_NAME}/api/yellowstorm-api-adk/docker-compose.yaml
```

The DevOps team must identify the live Compose location for:

```text
mcp-agent
mcp-playbook
mcp-semantic-model
yellowstorm-code-runtime
semantic-model-runtime
celery-worker-attribute-extraction
```

Add the `OBS_*`, label, and non-blocking Docker logging configuration to each real service definition.

---

# 11. ADK: check Application Insights mode

Inspect the currently deployed ADK environment:

```bash
docker inspect <adk-container>   --format '{{range .Config.Env}}{{println .}}{{end}}'   | grep '^APPLICATION_INSIGHTS_LOG='
```

At the current application stage, the unified logging bootstrap is guaranteed through the normal logging path when:

```text
APPLICATION_INSIGHTS_LOG=false
```

For the first Grafana/Loki activation, use that setting **only if the environment permits it**.

If Application Insights logging is mandatory, do not disable it merely to complete this rollout. Ask the application team to merge the pending correction that initializes unified logging regardless of Application Insights mode.

This does not block Backend activation.

---

# 12. Canary rollout — Backend first

Apply:

```yaml
services:
  backend:
    environment:
      OBS_SERVICE_NAME: yellowstorm-back
      OBS_ENVIRONMENT: rec
      OBS_SERVICE_VERSION: ${IMAGE_TAG}

    labels:
      logging: yellowmind

    logging:
      driver: json-file
      options:
        mode: non-blocking
        max-buffer-size: "4m"
        max-size: "20m"
        max-file: "5"
```

Recreate **only Backend** using the normal deployment procedure.

## 12.1 Verify the label

```bash
docker inspect <backend-container>   --format '{{ index .Config.Labels "logging" }}'
```

Expected:

```text
yellowmind
```

## 12.2 Verify Docker logging mode

```bash
docker inspect <backend-container>   --format '{{json .HostConfig.LogConfig}}'
```

Verify:

```text
Type = json-file
mode = non-blocking
max-buffer-size = 4m
max-size = 20m
max-file = 5
```

## 12.3 Verify raw JSON

```bash
docker logs <backend-container> --tail 100 2>&1
```

Look for:

```text
"schema_version":"1.0"
"service_name":"yellowstorm-back"
```

## 12.4 Verify Grafana

In Grafana Explore:

```logql
{service_name="yellowstorm-back"}
```

Generate several Backend requests and refresh.

If raw `docker logs` contains events but Grafana does not:

1. check `logging=yellowmind`;
2. check Alloy logs;
3. check the Canary;
4. check Loki gateway health.

Do not repeatedly restart Backend before checking these items.

---

# 13. Roll out ADK second

Use:

```yaml
environment:
  OBS_SERVICE_NAME: yellowstorm-adk
  OBS_ENVIRONMENT: rec
  OBS_SERVICE_VERSION: ${IMAGE_TAG}

labels:
  logging: yellowmind

logging:
  driver: json-file
  options:
    mode: non-blocking
    max-buffer-size: "4m"
    max-size: "20m"
    max-file: "5"
```

Verify:

```bash
docker inspect <adk-container>   --format '{{ index .Config.Labels "logging" }}'

docker inspect <adk-container>   --format '{{json .HostConfig.LogConfig}}'

docker logs <adk-container> --tail 100 2>&1
```

Grafana query:

```logql
{service_name="yellowstorm-adk"}
```

Then perform one real conversation operation that goes through Backend → ADK.

---

# 14. Verify Backend → ADK correlation

Find a recent Backend event:

```logql
{service_name="yellowstorm-back"}
```

Copy a `request_id` or `trace_id`.

Search globally:

```logql
{environment="rec"} | request_id="<REQUEST_ID>"
```

or:

```logql
{environment="rec"} | trace_id="<TRACE_ID>"
```

Expected result:

```text
Backend event(s)
ADK event(s)
```

sharing the same correlation identity where propagation applies.

If Backend is visible but ADK is absent, verify:

```text
ADK image
logging=yellowmind
Docker logging mode
OBS_SERVICE_NAME
APPLICATION_INSIGHTS_LOG
ADK raw docker logs
Alloy logs
```

---

# 15. Onboard the remaining services

Recommended order:

```text
1. mcp-agent
2. mcp-playbook
3. mcp-semantic-model
4. yellowstorm-code-runtime
5. semantic-model-runtime
6. celery-worker-attribute-extraction
```

For each service:

```text
configure
→ safely recreate/drain
→ inspect raw logs
→ verify logging label
→ verify Docker non-blocking mode
→ verify Grafana
→ execute one representative operation
```

Do not terminate long-running conversations, playbooks, or jobs merely to apply logging configuration.

---

# 16. Record the Backend historic cutover

Once Grafana becomes the source of truth for new operational logs, configure Backend:

```dotenv
LOGGING_HISTORIC_CUTOVER_AT=<UTC ISO TIMESTAMP>
OBS_GRAFANA_BASE_URL=https://<grafana-domain>
OBS_GRAFANA_DASHBOARD_UID=yellowmind-incident-explorer
```

Example format:

```text
2026-10-07T12:00:00Z
```

Do not delete historical PostgreSQL log tables during this rollout.

---

# 17. Useful Grafana Explore queries

The current dashboard does not yet wire every textbox variable into its panel query. For precise investigation, use **Grafana Explore** and LogQL directly.

## Backend

```logql
{service_name="yellowstorm-back"}
```

## ADK

```logql
{service_name="yellowstorm-adk"}
```

## All errors

```logql
{environment="rec", severity_text=~"ERROR|FATAL"}
```

## WARN+ for one service

```logql
{environment="rec", service_name="yellowstorm-adk", severity_text=~"WARN|ERROR|FATAL"}
```

## Request ID

```logql
{environment="rec"} | request_id="<REQUEST_ID>"
```

## Trace ID

```logql
{environment="rec"} | trace_id="<TRACE_ID>"
```

## Conversation ID

```logql
{environment="rec"} | conversation_id="<CONVERSATION_ID>"
```

## Run ID

```logql
{environment="rec"} | run_id="<RUN_ID>"
```

## Event name

```logql
{environment="rec"} | event_name="tool.call.failed"
```

## Text search

```logql
{environment="rec"} |= "timeout"
```

## Username

Where populated:

```logql
{environment="rec"} | username="<USERNAME>"
```

Do not rely on Backend username completeness yet.

---

# 18. Monitoring the logging platform

The Canary proves that the collection path is alive.

If Canary events disappear, treat observability as unhealthy even if Yellowmind business services remain operational.

Check:

```bash
cd <yellowstorm-repository>/infra/observability

docker compose ps
docker compose logs --tail 100 canary
docker compose logs --tail 200 alloy
docker compose logs --tail 100 gateway
docker compose logs --tail 100 loki
```

---

# 19. Troubleshooting

## Raw logs exist but Grafana is empty

Check:

```bash
docker inspect <container>   --format '{{ index .Config.Labels "logging" }}'
```

It must return:

```text
yellowmind
```

Then inspect Alloy and verify the Canary.

## Canary is missing

Investigate:

```text
canary
→ Docker source
→ Alloy
→ gateway
→ Loki
```

Do not promote more services until the Canary is healthy.

## Backend visible, ADK missing

Check:

```text
ADK image version
logging label
Docker logging options
OBS_SERVICE_NAME
APPLICATION_INSIGHTS_LOG
raw ADK docker logs
```

## Service appears as `unknown-service`

Set:

```dotenv
OBS_SERVICE_NAME=<canonical-name>
```

and recreate the container.

## Wrong environment

Set explicitly:

```dotenv
OBS_ENVIRONMENT=<environment>
```

and recreate.

## Grafana reachable only on host

This is expected because the supplied profile binds to `127.0.0.1:3300`.

Use an SSH tunnel for validation or the corporate HTTPS reverse proxy for shared access.

---

# 20. Security requirements

Before enabling team access:

- [ ] Grafana anonymous access is disabled.
- [ ] Grafana is behind HTTPS when remotely exposed.
- [ ] Loki is not directly Internet-accessible.
- [ ] Loki gateway authentication is enabled.
- [ ] `gateway/htpasswd` was regenerated from deployment secrets.
- [ ] `.env` is not committed.
- [ ] Alloy's Docker socket mount remains read-only.
- [ ] Grafana access is restricted to authorized operators/developers.
- [ ] No password/token/authorization header is visible in test logs.

If a credential is found in Loki, stop rollout and treat it as a security incident.

---

# 21. Performance-safety validation

For each business container:

```bash
docker inspect <container>   --format '{{json .HostConfig.LogConfig}}'
```

Confirm non-blocking delivery.

During representative traffic:

```bash
docker stats
```

Observe:

```text
CPU
memory
restarts
request latency
ADK TTFT
```

In REC/POC, test collector failure isolation:

```text
1. Verify business service is healthy.
2. Stop the observability gateway or Loki.
3. Continue normal requests.
4. Verify business requests remain healthy.
5. Restore the logging component.
6. Verify Canary/log ingestion recovers.
```

Do not perform failure injection directly in production.

---

# 22. GO / NO-GO checklist

Centralized analysis can start when:

## Infrastructure

- [ ] Loki healthy.
- [ ] Alloy healthy.
- [ ] Grafana healthy and securely accessible.
- [ ] Loki gateway authenticated.
- [ ] Canary visible in the last two minutes.

## Backend

- [ ] Unified JSON visible through `docker logs`.
- [ ] `OBS_SERVICE_NAME=yellowstorm-back`.
- [ ] Correct `OBS_ENVIRONMENT`.
- [ ] Useful `OBS_SERVICE_VERSION`.
- [ ] `logging=yellowmind`.
- [ ] Docker `mode=non-blocking`.
- [ ] Backend events visible in Grafana.

## ADK

- [ ] Unified JSON visible through `docker logs`.
- [ ] `OBS_SERVICE_NAME=yellowstorm-adk`.
- [ ] Correct environment/version.
- [ ] `logging=yellowmind`.
- [ ] Docker `mode=non-blocking`.
- [ ] Application Insights setting reviewed.
- [ ] ADK events visible in Grafana.

## Investigation

- [ ] Time-window filtering works.
- [ ] Service filtering works.
- [ ] Severity filtering works through LogQL.
- [ ] A `request_id` or `trace_id` can locate a real operation.
- [ ] Backend → ADK correlation was observed.
- [ ] Canary remains green.

When these checks pass, developers can start using centralized logs immediately.

---

# 23. Not blockers for starting analysis

These improvements should continue but do not prevent DevOps from activating the platform:

```text
Backend username propagation correction
Grafana dashboard advanced-filter wiring
Python byte-budget enforcement correction
Python write-counter correction
event-specific attribute enforcement
stronger CI baseline fingerprinting
full 10/30/100-user performance qualification
```

Until dashboard filter wiring is corrected, use Grafana Explore queries from this guide.

---

# 24. Recommended rollout order

```text
Observability stack
        ↓
Canary green
        ↓
Backend
        ↓
Backend visible
        ↓
ADK
        ↓
Backend ↔ ADK correlation
        ↓
MCP Agent
        ↓
MCP Playbook
        ↓
MCP Semantic Model
        ↓
Code Runtime
        ↓
Semantic Model Runtime
        ↓
Workers
```

Do not expand while the previous stage is not observable.

---

# 25. Evidence DevOps must return to the application team

Fill and return this report:

```text
Environment:
Observability host:
Grafana URL:
Cutover UTC timestamp:

Canary:
  PASS / FAIL

Service                              Label   Non-blocking   Visible in Grafana
--------------------------------------------------------------------------------
yellowstorm-back                     YES/NO  YES/NO         YES/NO
yellowstorm-adk                      YES/NO  YES/NO         YES/NO
mcp-agent                            YES/NO  YES/NO         YES/NO
mcp-playbook                         YES/NO  YES/NO         YES/NO
mcp-semantic-model                   YES/NO  YES/NO         YES/NO
yellowstorm-code-runtime             YES/NO  YES/NO         YES/NO
semantic-model-runtime               YES/NO  YES/NO         YES/NO
celery-worker-attribute-extraction   YES/NO  YES/NO         YES/NO

Correlation smoke test:
  request_id:
  trace_id:
  services found:

Known deployment differences:
Rollback image tags:
```

Never include secrets, passwords, tokens, `.env` contents, or sensitive raw payloads in this report.

---

# 26. Final success condition

The first operational milestone is reached when a DevOps engineer can:

1. open Grafana securely;
2. see the Canary;
3. select the last 15 minutes;
4. query `yellowstorm-back`;
5. query `yellowstorm-adk`;
6. generate one Yellowmind request;
7. locate its Backend event;
8. copy its `request_id` or `trace_id`;
9. find the corresponding ADK event;
10. search WARN/ERROR/FATAL events across the platform.

At that point, centralized Yellowmind log analysis is active and usable.
