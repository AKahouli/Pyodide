# Production Readiness Audit — YellowStorm ADK-LangGraph API

**Scope:** `yellowstorm-adk/src/` (routers, langgraph_engine, middleware, authentification, dependencies, grpc_server, infrastructure, attribute_extraction/core).
**Target:** Scale to 100+ concurrent users.
**Date:** 2026-04-23

---

## Executive Summary

The codebase has solid structural patterns (singleton DI, async routers, SSE streaming, Celery offload) but multiple blockers prevent safe production scale-out. The most serious issues are process-local in-memory state that breaks under `UVICORN_WORKERS > 1`, a single-node SQLite LangGraph checkpointer, wide-open CORS with no rate limiting, `asyncio.new_event_loop()` inside running loops (hard deadlock risk), and secrets/PII logged at INFO.

### Top Blockers
1. **LangGraph state (graph cache, thread graphs, pending indexing futures, active tasks, queues) is in-process dict** — `graph_cache.py:16,20`, `action_executor.py:32`, `playbook_queue.py:17-18`. Any horizontal scaling or Uvicorn multi-worker run breaks resume, webhook resolution, and cancellation.
2. **SQLite checkpointer on local tmp dir** — `checkpointer.py:22-27`. Single-writer, not durable across pods, lost on restart; hard-blocks multi-replica deployment.
3. **`asyncio.new_event_loop()` inside `sync_*` methods called from async-threaded Celery worker** — `extraction_service.py:613-630, 695-705, 737-742`. Creates/destroys a loop per tool call; under the `threads` Celery pool this will break shared async clients and cause connector leaks / hangs.
4. **CORS `allow_origins=["*"]` and no rate limiting / request size limits / per-user quotas** — `middleware/cors.py:10`. Unsafe for any authenticated API and exposes LLM spend.
5. **JWT secret + Redis creds flow through `get_settings()` with no rotation; JWT tokens logged and username logs leak PII; no refresh/revocation** — `authentification/get_current_user.py:77,86`, `routers/authentification.py:125-144`.
6. **Webhook endpoint `/playbook/index/webhook` is unauthenticated** — `routers/playbook.py:41-62`. Any caller can resolve/cancel indexing futures for known `external_id`.
7. **`AttributeExtractionService` stateful across calls (messages/search_queries accumulate)** and used via singleton-adjacent pattern — `extraction_service.py:82-83`. Concurrent extraction requests cross-contaminate conversation state.
8. **gRPC server runs `add_insecure_port` and shares `ThreadPoolExecutor(max_workers=10)`** — `grpc_server/server.py:47,80`. TLS missing; worker pool caps throughput.
9. **No graceful shutdown of in-flight background tasks** in SSE endpoints — `routers/chatbot.py:152,208,260`. Client disconnect cancels the task, but service-shutdown path does not drain.
10. **Blocking I/O in async paths**: `aiohttp.ClientSession` is recreated per action call (`action_executor.py:94,329`) and bcrypt `verify_password` (`routers/authentification.py:32-34,131`) runs on the event loop. Under load both block the loop.

---

## 1. Critical Bugs

- **Nested event loops via `asyncio.new_event_loop()`** — `src/attribute_extraction/core/extraction_service.py:613-630, 695-705, 737-742` — `sync_search_documents`, `sync_get_document_chunks`, `sync_calculator` create a fresh loop, `loop.close()` it, repeat. If invoked from a thread that already has a running loop (Celery `threads` pool does not, but any misuse from `run_in_executor` or future FastAPI integration will), this deadlocks. Closing loops also tears down `aiohttp`/`httpx` resources bound to prior loops. **Severity: Critical.** **Fix:** remove sync variants; use `asgiref.sync.async_to_sync` once, or refactor Celery task to be fully sync with a sync HTTP client.
- **Singleton `AttributeExtractionService` would leak state**, but it is constructed per-request inside `webhook_processor.py:38-47` — *good*. However, `self.messages` and `self.search_queries` are still instance-scoped and `sync_execute` resets them while `execute` does not — `extraction_service.py:241-242, 411-412`. Calling `execute` twice on the same instance concatenates prior messages into the second call. **Severity: High.** **Fix:** reset `messages`/`search_queries` at start of `execute` like `sync_execute`.
- **`_pending_indexing` future registry keyed by `doc_id` only, no per-thread namespace** — `action_executor.py:32,35-38`. If two playbooks index the same `document_id` concurrently, the second overwrites the first future; the first awaits forever and eventually times out. **Severity: High.** **Fix:** key by `(thread_id, doc_id)` and include in webhook payload.
- **`aiohttp.ClientSession` created per call** — `action_executor.py:94,329`. Expensive TCP/TLS setup; connection pool benefits lost. **Severity: High.** **Fix:** module-level session created in lifespan, closed at shutdown.
- **Fire-and-forget `asyncio.create_task` without `add_done_callback` in several places** — `routers/chatbot.py:154,210,262`, `routers/playbook.py:102,153`. `_handle_task_result` exists but is only attached to the attribute-extraction task (`chatbot.py:444`). Unhandled exceptions in other streaming bg tasks are silently swallowed once the SSE stream ends. **Severity: Medium.** **Fix:** attach `_handle_task_result` to all background tasks.
- **`_event_stream` cancels bg task on client disconnect but does not await it** — `routers/chatbot.py:74-77`, `routers/playbook.py:35-38`. `bg_task.cancel()` returns immediately; resources (LLM streams, DB cursors, aiohttp sessions) may still be tearing down when next request reuses them. **Severity: Medium.** **Fix:** `await asyncio.shield(asyncio.wait([bg_task]))` or at least `await asyncio.sleep(0)` to yield.
- **Database table creation disabled** — `main.py:86-88` is commented out. If the DB schema is not bootstrapped externally, first run fails opaquely. **Severity: Medium.**
- **`close_checkpointer()` never called** — `checkpointer.py:33` exists but is not wired to `lifespan` shutdown in `main.py`. SQLite file handle leaks on reload. **Severity: Low.**

## 2. Concurrency & Scalability (100+ concurrent users)

- **In-memory `_graph_cache` and `_thread_graphs`** — `langgraph_engine/graph_cache.py:16, 20`. Process-local; `UVICORN_WORKERS > 1` breaks resume (thread goes to a worker that doesn't hold the graph). **Severity: Critical.** **Fix:** Redis-backed registry + rehydrate from checkpointer on miss.
- **In-memory `_pending_indexing`** — `action_executor.py:32`. Indexing webhook arriving at a different worker cannot resolve the future. **Severity: Critical.** **Fix:** Redis pub/sub or database-persisted completion table; poll or subscribe.
- **In-memory `_active_tasks` and `_step_update_queues`** — `playbook_queue.py:17-18`. Cancellation and streaming broken across workers. **Severity: Critical.** **Fix:** Redis registry + pub/sub for cancel signal; SSE via Redis streams.
- **SQLite checkpointer** — `checkpointer.py:17-27`. Single writer, local disk. **Severity: Critical.** **Fix:** use `AsyncPostgresSaver` against a managed Postgres.
- **bcrypt on event loop** — `routers/authentification.py:32-34,131`. CPU-bound hash (~100ms) blocks the loop; login throughput capped at ~10 RPS per worker. **Severity: High.** **Fix:** `await anyio.to_thread.run_sync(verify_password, ...)`.
- **Redis pool max=20** — `authentification/get_current_user.py:37`. With auth on every request and 100 concurrent users doing SSE, 20 is tight. **Severity: Medium.** **Fix:** raise to 100+, tune based on load test.
- **Shared `ThreadPoolExecutor(max_workers=10)` for gRPC** — `grpc_server/server.py:47`. `grpc.aio` doesn't actually need this for async handlers, but any sync handler blocks 10 at a time. **Severity: Medium.**
- **`lru_cache()` on `get_*_service` factories** — `dependencies.py:19-95`. Services cache OpenAI clients internally; if any hold per-request state (as `AttributeExtractionService` does, though not DI'd), concurrent requests share it. Audit each service for per-instance mutable state. **Severity: Medium.**
- **`cleanup_stale_graphs()` called on every `run_playbook` invocation** — `workflow_service.py:214`. O(N) scan on every run, racy dict mutation during iteration. **Severity: Low.** **Fix:** periodic background task.
- **Full conversation `self.messages` kept in memory across agent iterations** — `extraction_service.py:277-374`. For long tool loops, each request grows unbounded; no token budget check. **Severity: Medium.**

## 3. Performance

- **No LLM prompt caching / embedding cache** visible. Every extraction call rebuilds schema, prompt, and tool descriptions (`extraction_service.py:233-269`). **Severity: Medium.**
- **Token fetched once then cached 15+ min** — `action_executor.py:28-29, 80-113`. Good, but cache is unbounded per-process and never refreshed on 401. **Severity: Low.** **Fix:** on 401, invalidate and retry once.
- **Sequential `for doc in documents` POST in `_action_index_trigger`** — `action_executor.py:330-373`. For a 100-doc batch, sequential HTTP blocks the step. **Severity: Medium.** **Fix:** `asyncio.gather` with a semaphore of 10.
- **`_compute_content_hash` serializes full tasks+edges JSON every call** — `graph_cache.py:25-27`. Negligible for small playbooks, but O(size) per dispatch. **Severity: Low.**
- **`get_or_create_graph` always called with `force_rebuild=True`** — `workflow_service.py:230`. The cache is effectively disabled for `run_playbook`. **Severity: Medium.** **Fix:** pass `force_rebuild=False` so content-hash dedupe works.
- **Excessive INFO logging in auth hot path** — `authentification/get_current_user.py:60-94`, `routers/authentification.py:124-144`. ~10 log lines per authenticated request. **Severity: Medium.**

## 4. Security

- **CORS `allow_origins=["*"]`** — `middleware/cors.py:10`. **Severity: High.** **Fix:** explicit origins list from settings.
- **Unauthenticated webhook** — `routers/playbook.py:41-62` (`/playbook/index/webhook`). Any external caller can inject/resolve indexing state for a guessed `external_id`. **Severity: High.** **Fix:** HMAC signature header shared with vectorstores service.
- **Service-account credentials sent as form POST to obtain token** — `action_executor.py:86-92`. `AUTH_USERNAME`/`AUTH_PASSWORD` in settings env. **Severity: Medium.** **Fix:** move to mTLS or service-to-service OAuth client-credentials.
- **JWT validated with `jwt.decode` but no `aud`/`iss` claim check** — `authentification/get_current_user.py:77`. **Severity: Medium.** **Fix:** enforce `audience=` parameter.
- **No JWT revocation list, no refresh tokens** — `routers/authentification.py:82-102`. Stolen token valid until `exp`. **Severity: Medium.**
- **`/register` is unauthenticated and unthrottled** — `routers/authentification.py:148-196`. Any client can populate Redis. **Severity: High.** **Fix:** admin-only or disabled in prod.
- **Secrets/usernames logged at INFO** — `routers/authentification.py:125-144`, `routers/chatbot.py:100,434-437`. Usernames, brain_ids, and webhook URLs appear in logs. **Severity: Medium.**
- **`webhook_url` is user-supplied and POSTed server-side** — `attribute_extraction/core/webhook_processor.py:70-76`. Classic SSRF: an attacker can aim it at `http://169.254.169.254/` (cloud metadata) or internal services. **Severity: High.** **Fix:** allowlist domains; block RFC1918/link-local; require pre-registered webhook.
- **gRPC insecure port** — `grpc_server/server.py:80`. Production path exists (`start_grpc_server_with_ssl`) but `main.py:100-102` uses the insecure one. **Severity: High.**
- **Password register stores bcrypt hash — good.** Cost factor default. **Severity: Low.** Consider bumping rounds and confirming `pwd_context` uses argon2 if available.

## 5. Code Duplication & Inconsistency

- **Duplicate `get_user` / `get_redis_connection`** across `authentification/get_current_user.py:58-67`, `authentification/get_user.py:14-36`, and `routers/authentification.py:37-55`. Three slightly different implementations. **Severity: Medium.** **Fix:** consolidate to one.
- **`_event_stream` duplicated** between `routers/chatbot.py:58-77` and `routers/playbook.py:21-38`. **Severity: Low.** **Fix:** move to shared `src/middleware/streaming.py`.
- **Dual `execute` / `sync_execute` in `AttributeExtractionService`** — `extraction_service.py:210, 392`. Nearly 200 lines duplicated. **Severity: Medium.** **Fix:** keep async; run via `asgiref.sync.async_to_sync` in Celery.
- **Interrupt extraction logic** duplicated between `workflow_service.py:34-54` and `step_executor._extract_interrupt_from_snapshot`. **Severity: Low.**
- **`logger.info` style is inconsistent**: some modules use structlog kwargs, others use f-strings passed to structlog (which strips structured fields). E.g. `routers/chatbot.py:148` vs `workflow_service.py:268-275`. **Severity: Low.**

## 6. Observability & Ops

- **Correlation ID middleware exists and is good** — `middleware/correlation.py`. But it does not propagate to background tasks (`asyncio.create_task` loses contextvars by default only if you `copy_context()`; Python does copy, but subsequent spawns inside the bg task do not re-bind user/corr from the original request). Verify in `process_chat_request` paths. **Severity: Medium.**
- **No `/health` or `/ready` endpoint** visible in `main.py`. K8s probes impossible. **Severity: High.** **Fix:** add liveness (process up) and readiness (Redis + checkpointer + LLM ping).
- **No metrics endpoint** (Prometheus). Only logs + Azure App Insights via OTEL. **Severity: Medium.**
- **Graceful shutdown incomplete** — `main.py:143-159` disposes DB engine and cancels gRPC, but does not: drain in-flight SSE streams, close `redis_manager._redis_pool`, close checkpointer, cancel pending indexing futures. **Severity: High.**
- **`adk.log` / `adk.err` written to repo root** (observed in directory listing). Suggests file-logging config outside the container log pipeline. **Severity: Low.**
- **No request body size limits**, no slowloris protections. Large SSE request bodies can be posted. **Severity: Medium.**

## 7. Config & Dependency Management

- **`get_settings()` called at module import in many files** — `routers/chatbot.py:53`, `routers/playbook.py:16`, `middleware/middleware.py:17`, `infrastructure/celery_app.py:6`, `authentification/get_current_user.py:14`, `attribute_extraction/core/webhook_processor.py:13`. Settings evaluated before env is normalized in tests. **Severity: Low.**
- **`UVICORN_WORKERS` from settings** — `main.py:202`. Given in-memory state issues (§2), values > 1 will silently break features. **Severity: Critical.** **Fix:** document workers=1 until state is externalized.
- **Settings module not shown here, but `ACCESS_TOKEN_EXPIRE_MINUTES`, `SECRET_KEY`, `AUTH_PASSWORD`, etc. read via pydantic Settings** — ensure no `.env` committed and secrets come from a vault/KeyVault. **Severity: High (process).**
- **No dependency version pinning visible** — need to audit `requirements.txt` separately; transitive CVEs risk.

## 8. Reliability

- **No retries on vectorstores API call** — `action_executor.py:356-368`. Any transient 5xx fails the whole action. **Severity: High.** **Fix:** `tenacity` retry on 5xx / connect errors with exponential backoff.
- **No circuit breaker around LLM/vectorstores/Redis**. One dependency flap will cascade to user errors. **Severity: High.** **Fix:** `purgatory` / `pybreaker` wrapper on external call sites.
- **Webhook POST in `webhook_processor.py:70-76` has only 30s timeout, no retry**. Lost result on transient network failure. **Severity: Medium.**
- **No idempotency on `/attribute_extraction`** — resubmitting same request creates duplicate job, potentially duplicate webhook delivery. **Severity: Medium.** **Fix:** accept `Idempotency-Key` header.
- **OpenAI `max_retries=2`** — `extraction_service.py:56, 63`. Reasonable, but without jitter and no 429 backoff visibility. **Severity: Low.**
- **Timeouts inconsistent**: 15s for auth/token (`action_executor.py:93`), 30s for indexing trigger (`action_executor.py:327`), 30s for webhook (`webhook_processor.py:70`), 120s for LLM (`extraction_service.py:32`), 600s for indexing completion (`action_executor.py:382`). No per-request total budget. **Severity: Medium.**

---

## Remediation Roadmap

### Week 1 — Stop the bleeding (must-have for any prod traffic)
- Lock CORS to explicit origins; enable gRPC TLS path in `main.py`.
- Add `/health` + `/ready` endpoints.
- Add authentication (HMAC) to `/playbook/index/webhook`.
- Validate & allowlist user-supplied `webhook_url` (SSRF fix).
- Disable `/register` in prod or guard behind admin.
- Move bcrypt verification to `anyio.to_thread`.
- Attach `_handle_task_result` to every `asyncio.create_task` in routers.
- Reset `messages`/`search_queries` at start of `AttributeExtractionService.execute`.
- Fix `_pending_indexing` key collision (`(thread_id, doc_id)`).
- Remove `loop = asyncio.new_event_loop()` blocks in `extraction_service.py` sync paths (or delete sync paths entirely).
- Pin `UVICORN_WORKERS=1` and document why.
- Wire `close_checkpointer()` and `redis_manager.close_pool()` into lifespan shutdown.

### Week 2 — Externalize state (enables horizontal scaling)
- Replace SQLite checkpointer with `AsyncPostgresSaver`.
- Move `_graph_cache`, `_thread_graphs`, `_active_tasks`, `_pending_indexing`, `_step_update_queues` to Redis. Use Redis pub/sub for cross-worker step updates, cancellation, and indexing completion.
- Replace per-call `aiohttp.ClientSession` with a lifespan-managed shared session.
- Add retries (tenacity) + circuit breaker (pybreaker) around vectorstores, LLM, and webhook POSTs.
- Raise Redis pool `max_connections` to 100+; load-test to confirm.
- Add rate limiting (slowapi or Envoy/API gateway) per user/IP.
- Add request body size limits via Starlette / ingress.
- Consolidate duplicated `get_user`/`get_redis_connection`/`_event_stream`.

### Week 3 — Scale, observe, harden
- Introduce Prometheus metrics (FastAPI middleware + custom counters for LLM tokens, tool calls, SSE streams open, task queue depth).
- Parallelize `_action_index_trigger` document POSTs with a bounded semaphore.
- Implement idempotency key handling on `/attribute_extraction` and `/batch_attribute_extraction`.
- JWT: add `aud`/`iss` claims, short-lived access + refresh, introduce revocation list in Redis.
- Pass `force_rebuild=False` to `get_or_create_graph` in `run_playbook`; move `cleanup_stale_graphs` to a periodic background task.
- Merge `execute` and `sync_execute` in `AttributeExtractionService`; run sync entrypoint via `asgiref.sync.async_to_sync`.
- Load test at 150 concurrent SSE streams; verify event loop latency <50ms p99, Redis pool not saturated, checkpointer write throughput.
- Secrets rotation procedure (SECRET_KEY, AUTH_PASSWORD) documented and automated.
- Dependency CVE scan + pin + SBOM.

---

*End of audit.*
