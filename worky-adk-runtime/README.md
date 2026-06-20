
# worky-adk-runtime

Standalone FastAPI service for the **Worky (Chief of Staff)** agent runtime.
Sibling of `yellowstorm-adk/`. Isolated venv, own `requirements.txt`, own
`google-adk==2.2.0` pin. **No Python imports from `yellowstorm-adk/`.**

> **State authority:** NestJS owns all product state. The runtime reasons
> and executes only; every state mutation is a callback to
> `/worky/internal/*` on the backend (see `app/clients/backend_client.py`).
> See `WORKY_IMPLEMENTATION_PLAN.md` and `docs/worky/00_INDEX.md`.

## Part 1 scope (this scaffold)

- FastAPI app exposing:
  - `GET  /health` — liveness; returns `{status, adk_version, model_provider: "litellm"}`.
  - `POST /runtime/streams/{id}/planning-turn` — SSE stub that streams
    `planning.ack` → `planning.delta.applied` → `planning.done` and calls
    back to `POST /worky/internal/streams/{id}/plan-delta` with a
    hardcoded 1-task delta.
  - `POST /runtime/streams/{id}/{start|resume|replan|stop}` and
    `POST /runtime/tasks/{id}/cancel` — explicit `501 Not Implemented`
    stubs. They land in Part 3.
- LiteLLM-backed model factory (`app/agents/model.py`): constructs
  `LiteLlm(...)` from `google.adk.models.lite_llm`. Model id is **not
  hardcoded** — provider/model/keys come from the platform LiteLLM
  config.
- Backend client (`app/clients/backend_client.py`): async `httpx` client
  with one method per canonical §6.2 callback, sending
  `X-Service-Token` + `X-Event-Id`.
- Tests: `pytest -q`. The `LiteLlm` import is patched in `tests/test_model.py`
  so the test suite runs without `google-adk` installed.

## Configuration

| Env var | Default | Notes |
| --- | --- | --- |
| `PORT` | `8011` | FastAPI port. |
| `BACKEND_BASE_URL` | `http://yellowstorm-back:3000` | NestJS base. |
| `WORKY_SERVICE_TOKEN` | (empty) | Must match backend `WORKY_SERVICE_TOKEN`. |
| `LITELLM_*` | platform defaults | Provider, model, keys — see platform. |
| `REQUEST_TIMEOUT_SECONDS` | `15` | Outbound HTTP timeout. |
| `LOG_LEVEL` | `INFO` | Standard. |

## Run

```bash
pip install -r requirements.txt
python -m app.main
curl http://localhost:8011/health
```

## Docker

```bash
docker compose up --build
```

## Tests

```bash
pytest
```
