---
id: ADR-0021
status: proposed
scope: conversation-connector-schema-disclosure
source_paths:
  - yellowstorm-adk/src/smart_rag/tools/utilities/connector_tools.py
  - yellowstorm-adk/src/smart_rag/engines/multi_agent/team_orchestrator.py
  - yellowstorm-adk/src/smart_rag/infrastructure/monitoring/responses_history.py
reviewed_at: 2026-10-17
---

# Conversation connector schemas on demand

## Scope and intent

The user requested separating capacity admission from upstream timing and reducing
the always-loaded tool catalog without losing capabilities. This record describes
the implemented approach; proposed status does not supersede accepted ADR-0017 or
ADR-0018. It introduces no module, service, schema, setting or migration.

## Choice

Fresh single-agent conversation parents, in both API modes, expose one
`load_connector_tools` declaration containing every authorized connector action's
exact name and a compact description. Loading exact names advertises their original
complete schemas on the next model step. Loaded names belong to one invocation,
not durable history. Workers, manager/team execution, built-ins and orchestration
controls retain their existing tool declarations.

Only locally marked connector wrappers participate. Original tool identities,
execution-kind registration, argument validation, actor bindings, authorization,
confirmation, citation handling and dispatch remain intact. Historical/direct calls
still resolve to those originals. Discovery cannot introduce an unbound action;
mixed known/unknown loading requests fail without partially loading names.

Responses lineage fingerprints the full trusted catalog plus other tool schemas,
not the currently disclosed subset. Loading therefore preserves encrypted replay
and provider response chains; catalog/schema, model, agent and transcript changes
still rebase. The catalog fingerprint is request-private and never sent as model
content or public activity data.

## Tradeoffs and rollback

First use of a deferred connector can add a loading/tool/model round trip. Names
and compact descriptions remain in the initial prompt; full schemas are not sent
until loaded. This preserves reachability rather than guessing relevant tools from
user text. Dynamic toolset refresh is qualified against pinned ADK 2.11.0 and must
be rechecked on upgrades. Reverting the orchestrator installation restores full
initial declarations; authorization and durable history formats are unchanged.

## Verification

Focused tests cover invocation isolation, same-loop refresh, original identity,
validation and stable replay guards. The real LiteLLM gateway passed two-turn tool
loading in Chat Completions, Responses application history with encrypted replay,
and Responses provider history with continued chains; all twelve permits released.
The configured 50-action schema fixture shrank from 60,071 to 10,221 JSON characters
(83%). Three paired synthetic Luna greetings, with the same catalog and instruction,
used 10,924 versus 2,268 input tokens; median elapsed time was 2,048.7 versus
1,526.7 ms. These small local samples do not establish a production latency SLO.

Source checks: `tests/test_tools/test_utilities/test_deferred_connector_tools.py`,
`tests/test_responses_history.py`, and opt-in `tests/wp10/qualify_native_responses.py
--deferred-tools`. Independent review found no critical/major issues.
