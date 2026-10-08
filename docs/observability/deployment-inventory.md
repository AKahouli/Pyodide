# Deployment inventory — unified logging

P00, branch `adk11-migration`, HEAD `35741c2d1`. Facts verified from Dockerfiles and `.github/workflows/`. Host-side compose files are NOT in the repository.

## Services and images

| Service | Build context | Dockerfile base | Deployed by | Deploy target |
|---|---|---|---|---|
| Backend | `YellowStorm/back` | build `node:20-alpine`, runtime `node:22-bookworm-slim`, `CMD ["node","dist/main.js"]` | `deploy-backend.yml` (PR closed on main, path `YellowStorm/back/**`) | ACR `yscrmetachatbot001.azurecr.io/yellowstorm-back-poc`; compose rewritten at `~/yellowstorm/${ENV_NAME}/back/docker-compose.yaml`, `docker compose down/up -d` |
| ADK API | `yellowstorm-adk` | `ubuntu:22.04` pinned digest, `PYTHON_VERSION=3.11` | `deploy-adk.yml` (path `yellowstorm-adk/**`) | compose at `~/yellowstorm/${ENV_NAME}/api/yellowstorm-api-adk/docker-compose.yaml` |
| Frontend | `YellowStorm/front` | `node:22.14.0-alpine` → `nginx:stable-alpine-slim` | `deploy-frontend.yml` | compose at `~/yellowstorm/${ENV_NAME}/front/docker-compose.yaml` |
| Code runtime | `yellowstorm-code-runtime` | `node:20-bookworm-slim` both stages, `CMD ["node","dist/src/main.js"]` | `build-code-runtime.yml` (build+push only) | compose external, see `yellowstorm-code-runtime/DEPLOYMENT.md` |
| MCP agent / playbook / semantic-model | `mcp/mcp-*` | `python:3.12-slim`, `CMD ["python","server.py"]`, ports 8026/8025/8027 | **none** | unknown — operator check |
| Semantic-model runtime | `YellowStorm/semantic-model-runtime` | none | none | unknown — operator check |
| Celery worker (attribute extraction) | (ADK image) | same as ADK | dev compose `yellowstorm-adk/docker-compose.yaml` only | production placement unknown — operator check |

## CI (`.github/workflows/ci.yml`)

Guards + tests: semantic-r1-guard, code-runtime tests, proto-drift diff, backend jest, backend pg-integration (`pgvector/pgvector:pg17`), frontend vitest, python-tests (Python **3.11**, pytest on `src/flow_engine/tests/ tests/orchestrator/`), sonarcloud. `pr-ticket-validation.yml` requires `#NNN`. No observability gates exist yet (P08). Coverage steps that swallow failures (`|| true`) must not be relied on as enforcement.

## Repo compose files

- `yellowstorm-adk/docker-compose.yaml` (dev): `yellowstorm-adk-dev`, `yellowstorm-code-runtime`, `celery-worker-attribute-extraction`, `electric`.
- `YellowStorm/semantic-model-runtime/deploy/data-plane/docker-compose.dev.yml`: supabase realtime data-plane only.

## Container logging defaults

No `logging:` driver options are pinned anywhere in the repo. Production containers are created by host-side compose files outside this repository — the non-blocking json-file profile (plan §7.2) must be applied there via a managed overlay and verified against the effective config (operator check, P04/P10).

## Deployment unknowns recorded as operator checks

1. Actual host compose file contents and whether they are generated or hand-maintained.
2. Where MCP services and semantic-model-runtime actually run in shared environments.
3. Existing Grafana/Loki/Prometheus installations, if any, and their versions.
4. Docker daemon version and whether `json-file` non-blocking options are accepted.
5. Log volume per service (needed to size Loki storage); nothing measured yet.
6. Secrets management in use (ACR credentials exist in workflows; Grafana/Loki credentials must go to the existing secret manager).
7. Branch protection / rulesets for `adk11-migration` and `main` (plan R00): metadata review said unprotected; rulesets must be inspected by an authorized administrator before governance completion.
