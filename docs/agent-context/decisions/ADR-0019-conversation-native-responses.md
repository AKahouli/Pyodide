# ADR-0019: Native Responses for the conversation parent

- Status: proposed
- Date: 2026-10-16
- Scope: the existing single-agent conversation runtime and provider boundary.
- Implementation authorization: user requested the native Responses adapter,
  application-managed history, preserved streaming/tools/instrumentation/capacity,
  a gateway test and a dedicated worktree in this chat.

## Decision

Use the explicit per-model **Conversation API** setting in **Admin > Models** to
adapt the library-built conversation parent to ADK's native `OpenAIResponsesLlm`
through the existing LiteLLM gateway only when `responses` is selected. Default
existing/new models and missing settings to `chat_completions`, retaining the
instrumented LiteLLM adapter. The user's 2026-10-17 correction authorizes this
model-level choice because some models lack Responses support. Persist it in the
existing catalog and pass it through existing agent parameters; no model-name
heuristic or automatic retry on another API. Keep the exact model
alias and agent tools/callbacks. Retain application-owned history, disable provider
storage/linkage, and preserve the existing gRPC/SSE contract. Leaf workers and
manager/team paths keep their current adapters.

Use the existing durable provider slots for native SDK requests. Disable SDK retries
under capacity enforcement, close streams/clients, and reject EOF without a terminal
Responses event. Never free an uncertain dispatched call automatically.

## Rationale and limits

The pinned ADK 2.11.0 and LiteLLM 1.101.0 already support the native path. This avoids
a dependency upgrade or new state owner. A compatibility bridge remains an alternative
but retains chat-format translation. Provider-managed chaining is excluded because
branching, deletion, compaction and recovery would need separate design/verification.
The pinned adapter skips historical reasoning-item replay; native protocol use alone
does not provide reasoning continuity. Administrators select an API supported by
the gateway model alias, including custom aliases. Backend migration
`0050_model_conversation_api.sql` adds a constrained column defaulting to completions.

## Source and verification

`yellowstorm-adk/src/smart_rag/engines/multi_agent/team_orchestrator.py`,
`src/smart_rag/infrastructure/factories/llm_factory.py`,
`src/smart_rag/infrastructure/monitoring/{instrumented_lite_llm,model_response_recovery}.py`,
`src/root_runtime/model_capacity.py`; paths after the first are relative to yellowstorm-adk.

Focused regression coverage is in `tests/test_native_responses.py` plus existing
factory/latency/orchestrator tests. `tests/wp10/qualify_native_responses.py` verifies
synthetic streamed tool execution, multi-turn history and instrumentation through
the configured gateway with optional real capacity enforcement. It does not reset
shared slots or alter application conversations. UI/end-user QA remains separate.

Verification on 2026-10-16: 107 focused regressions passed; after the final teardown
assertion, the affected native/orchestrator subset passed 37 tests. Independent
review resolved the premature-EOF finding and reported no critical/major findings.
Live gateway runs with `gpt-5.4-mini` and `gpt-6-sol` each made three native requests,
executed one local tool, streamed two turns and released all three owned permits.
Observability policy and whitespace checks passed. No running service was restarted.

The 2026-10-17 API-selector correction passed 43 affected ADK tests. Live
`gpt-5.4-mini` qualification passed separately for Chat Completions and Responses:
each executed one tool across two streamed turns, replayed history, preserved
latency markers and released all three owned capacity permits. The constrained
column migration passed against an isolated test-database schema with rollback,
covering defaults for existing/new rows, both switches and invalid-value rejection.
Focused backend DTO/catalog and agent-parameter tests passed. Independent review
found no critical/major issues in the selection flow.
