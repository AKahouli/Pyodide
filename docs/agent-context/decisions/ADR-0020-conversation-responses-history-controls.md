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
Isolated root turns seed a fresh ADK session from local completed history. The
existing seed contract optionally identifies the last included completed answer's
source session. The runtime reads it under the same app/user, verifies its complete
visible transcript against the seed, and copies only private Responses context.
Its comparison projection is rebuilt for the text seed; original provider items
and the model/configuration signature remain intact. Missing, edited or truncated
source history starts a fresh chain; unrelated session state is never copied.
Comparison follows the pinned ADK seed-author conversion. The known `{time}`
runtime substitution is normalized for compatibility while the instruction
template and all other instruction content remain fingerprinted; fresh instructions
are still sent. A trusted private receipt maps the exact rendered current user
message back to the original visible text for seed validation. The backend sends
that original text in trusted root context before adding its client-page hint.
This handles page hints and the runtime's ongoing-request wrapper without parsing or stripping arbitrary text;
corrective replay does not issue such a receipt.
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
Seed-boundary tests cover ancestor selection, transcript mismatch, private-state
isolation and fresh-turn projection. Deployment verification must exercise real
isolated conversation turns, since a stable-session Runner alone cannot detect a
missing seed handoff.
Gateway qualification: `tests/wp10/qualify_native_responses.py` with application
Responses, provider Responses and Chat Completions. Browser fixture uses real
Admin components with isolated in-memory data, not a shared catalog migration.

Deployment integration on 2026-10-17 applied 0051 in the current checkout and
restarted backend, frontend and ADK. The three catalog columns and validated
constraints were checked in the shared database. The integration follow-up passed
158 focused backend/runtime tests, backend build, logging policy and independent
source/documentation review. All nine backend readiness components passed,
including LiteLLM, conversation gRPC and Playbook MCP. Gateway qualification
passed application Responses, provider Responses and Chat Completions with two
streamed turns, a tool call, instrumentation and capacity release in each case.
The signed-in Admin UI persisted both history modes across reload and enforced
provider Auto replay. Real isolated conversation turns confirmed stored provider
continuation (`provider_chained=true`), then switching the same model to Chat
Completions cleared private lineage while retaining the local transcript. The
test model's original Chat Completions/application/auto/off settings were restored.
Native summary delivery remains optional; the gateway qualification returned no
summary text, while controlled native-stream tests covered summary On/Off.

Follow-up summary investigation (2026-10-17): reasoning-heavy raw gateway probes
returned native summaries for GPT 5.4 Mini, GPT 6 Sol and GPT 5.6 Sol. The earlier
marker-only workload did not establish summary support. A live conversation also
revealed that stream bootstrap omitted `reasoningEffort` from its rebuilt request;
forwarding it preserves the selected effort for both API modes. The summary-required
gateway qualification now includes a scheduling puzzle, retaining its existing
stream/tool/instrumentation/capacity assertions. Private replay state records only
the effective requested effort/summary settings to distinguish parameter loss from
optional upstream omission. Existing output guardrail suppression remains intact.
Native completed snapshots can contain multiple summary text parts. Adjacent
thought parts are combined into one complete snapshot before activity tracking;
otherwise each part replaces the same row and only the last survives. Streamed
deltas, tool boundaries, private raw output and summary Off remain unchanged.

Live follow-up verification passed with GPT 5.4 Mini, High effort and Auto summary:
eight native sections (3,880 provider characters; 3,894 with snapshot separators)
remained visible after conversation reload. The gateway qualifier passed 428 native
summary events, a tool call, instrumentation and all three capacity releases.
Focused checks passed 90 backend stream tests and 39 runtime tests; independent
review found no critical/major issues. Temporary model settings were restored.
