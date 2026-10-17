# ADR-0020: Conversation Responses history controls

- Status: proposed
- Date: 2026-10-17
- Scope: existing model catalog, single-agent conversation parent and ADK sessions.
- Authorization: user explicitly requested implementation of the proposed Admin
  controls, existing activity panel and both APIs' gateway qualification in a
  dedicated worktree. Extends the application-only boundary proposed in ADR-0019;
  no accepted decision is superseded.

## Decision

Extend existing `ai_models` with `responsesHistoryMode` (application/provider),
`reasoningHistory` (none/last/all/auto), and `reasoningSummary`
(off/auto/concise/detailed). Defaults are application/auto/off. Apply migration
`0051_model_responses_history_controls.sql` before backend deployment. Existing
agent parameter maps carry the effective answering model's policies. Chat
Completions ignores dormant Responses settings and clears stale native lineage.

Application mode sends `store=false` and replays original ordered Responses output
items with genuine IDs/encrypted content. `last` and `auto` retain reasoning only
inside the current user turn, preserving every tool call/result; `all` retains
compatible reasoning across turns; `none` omits reasoning items. Provider mode
uses `store=true` and `previous_response_id`, sending only new input. Provider mode
requires auto replay; selective chain filtering is not offered.

The local transcript remains authoritative for display, exports, branches and
recovery. Replay records live in existing ADK session state, keyed to model,
gateway endpoint, agent scope, instructions, tools and reasoning policy. A
projection prefix verifies that the transcript has not changed. Model/API/agent
switches, edited/compacted history and configuration changes rebase the chain.
Only explicit missing-response rejection is retried with full local context;
uncertain dispatch and transport failures are not replayed on another API.

Replay state is persisted through internal, non-yielded session events. Public
answer events contain neither encrypted thought signatures nor raw provider
output metadata. Native summary text uses existing thought/activity components;
summary Off suppresses thought text independently of private replay. A provider
may return no optional summary. Never synthesize a reasoning explanation.

Provider retention, upstream deployment affinity and request authorization remain
the gateway/provider's responsibility. Stored response IDs are not durable local
history or a token-cost exemption. Existing stream-terminal validation,
instrumentation, tool execution and capacity ownership remain enforced. No new
service, table, schema namespace or dependency is introduced. Workers and team
manager adapters remain unchanged.

## Verification

Focused model/DTO/construction and isolated transactional migration tests; Admin
form tests; runtime tests for exact item replay, reconstructed adapters, tool
loops, opaque-event isolation, policy/context resets and expired chain recovery.
Gateway qualification: `tests/wp10/qualify_native_responses.py` with application
Responses, provider Responses and Chat Completions. Browser fixture uses real
Admin components with isolated in-memory data, not a shared catalog migration.
