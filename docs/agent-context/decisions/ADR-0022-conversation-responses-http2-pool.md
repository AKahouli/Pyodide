---
id: ADR-0022
status: proposed
scope: conversation-responses-http-transport
source_paths:
  - yellowstorm-adk/src/smart_rag/infrastructure/factories/llm_factory.py
  - yellowstorm-adk/main.py
  - yellowstorm-adk/requirements.txt
reviewed_at: 2026-10-17
---

# Reuse Responses connections without sharing turn identity

## Context and scope

The user requested investigating the remaining 3–5 seconds through LiteLLM and
reducing it without weakening reasoning or tools. No accepted platform ADR directly
governs this transport optimization. This proposed record introduces no module,
service, schema or setting and does not supersede connector security ADRs.

Matched gateway probes measured only 4–8 ms of reported LiteLLM overhead. With the
installed OpenAI SDK, consuming the SSE `[DONE]` marker ends the SDK iterator and
closes the response before HTTP body EOF. HTTP/1.1 therefore reconnected even when
the same SDK client was reused: approximately 89 ms TCP plus 94 ms TLS. Direct
CapacityClient probes reproduced this without ADK. HTTP/2 negotiation succeeded and
subsequent requests reused the connection despite the per-stream response close.

## Choice and constraints

The existing LLM factory owns one HTTP/2-capable network pool per running event loop.
Each Responses turn retains its own SDK client and HTTP client, including independent
headers, credentials and cookie jar. A thin borrowed transport forwards only the
request to the owner's HTTPX-selected transport. It does not call the owner's HTTP
client request pipeline or use its identity/cookies. Owner selection preserves
HTTPX environment-proxy routing; forwarding depends on pinned HTTPX 0.28.1's
`_transport_for_url` and needs requalification on upgrade.

Closing a turn closes its client without closing another turn's pool. The application
lifespan closes the pool after stopping gRPC. SDK default connection limits and
five-second idle expiry are retained. Calls constructed without a running loop use
an independently owned client. HTTP/1.1 fallback remains supported. Declare
`httpx[http2]==0.28.1` so clean deployments install HTTP/2 dependencies.

No model, reasoning effort, output budget, tool, replay, history, retry or capacity
policy changes. In particular uncertain dispatched failures retain their existing
`outcome_unknown` occupancy; transport reuse never authorizes an overlapping retry.

## Evidence and limits

Tests verify independent credentials/cookies, closing one turn while another uses
the pool, owner routing, HTTP/2/default idle configuration and lifecycle cleanup.
Independent review passed. Three-pair gateway comparisons created and closed SDK
clients for every turn, retained identical 2,268-token input and 2,265 cached warm
tokens, and released all six permits. A pair with essentially equal reported provider
processing isolated about 177 ms transport savings. The final five-second-idle probe
confirmed reuse; its provider durations varied, so aggregate latency differences are
not all transport gains. Savings apply while a connection remains warm, especially
within tool loops; this does not remove seconds of provider processing.

Numeric-only diagnostics now correlate TCP/TLS, response-header timing, negotiated
HTTP/2, two allowlisted gateway timing headers, first model output and final token
usage. No prompts, URLs, arbitrary headers or opaque reasoning state are logged.
Verification: `tests/test_native_responses.py`, existing latency/history tests and
`tests/wp10/qualify_native_responses.py --deferred-tools` through the real gateway.
Rollback is the existing per-turn default HTTP client; no durable data changes.
