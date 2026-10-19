# Direct Azure and LiteLLM Responses comparison

Verified 2026-10-17 using `yellowstorm-adk/scripts/compare_azure_gateway.py`.
This is an isolated provider diagnostic: it does not change model configuration,
conversation sessions, history, services or gateway settings.

## Result

Twelve successful streaming greeting requests: one cold and five reused-connection
samples per route, alternating which route goes first. Both routes used HTTP/2,
zero SDK retries, the same request-body SHA-256, 6,960 input tokens and
Auto reasoning summaries. All ten warm requests reported 6,957 cached tokens.

| Median, reused connections | Direct Azure | LiteLLM |
| --- | ---: | ---: |
| Response headers | 382 ms | 998 ms |
| First native stream event | 384 ms | 1,088 ms |
| First answer text | 1,677 ms | 1,177 ms |
| Completed stream | 1,913 ms | 1,307 ms |

Cold first-text times were 3,814 ms direct and 2,817 ms through LiteLLM. A single
cold sample is descriptive, not a reliable estimate. Warm direct first-text
times ranged from 1,515 to 3,538 ms; gateway times from 1,027 to 1,321 ms.
Gateway-reported overhead was 4.7–8.5 ms across all six calls.

**This does not demonstrate that bypassing LiteLLM improves answer latency.**
Direct Azure emitted lifecycle events earlier but delivered answer text later.
The gateway targets Azure resource `ysoaimetachatbotprd0001`; the supplied direct
endpoint targets `ysoaimetachatbotbackup`. Both expose deployment `gpt-6-luna`
with API version `2025-04-01-preview`, but different resources introduce provider
routing, deployment and capacity differences. No existing gateway Luna alias
targets the backup resource. Queue duration is not established by these timings.
A causal gateway comparison requires the same resource/deployment on both paths.

## Request and safety boundaries

The frozen request was reconstructed from the existing Luna session's private
application-managed history, the stored Yellowmind instruction, native
`present_choices`, web search, and the existing deferred connector catalog
(50 actions reachable through `load_connector_tools`). It contains nine input
items after appending a greeting and applying the saved Auto replay policy.
That policy omits prior-turn reasoning; no provider response ID is shared across
resources. The saved reasoning request has `summary: auto` and no explicit effort
override; both routes preserve that setting. The output budget is 20,000 tokens.

This is the same reconstructed payload on both routes, not a capture of every
dynamic instruction/callback in a live application turn. It excludes backend
preparation, ADK setup and application capacity admission. No tools were executed:
this qualifies greeting streaming with tools available, not tool execution.
Reasoning output is model-dependent; some greetings use zero reasoning tokens.

The credential is supplied through an environment variable or a hidden terminal
prompt, never a CLI argument or report. Request/history fixtures remain private
and ignored under `yellowstorm-adk/temp/`; reports contain numeric timings,
counts and a request hash, not prompts, credentials or encrypted reasoning.

## Repeat

Run under conda `meta`, from `yellowstorm-adk`, with a private Responses request
JSON file containing `model`, `input`, `instructions`, `tools`, `reasoning` and
`store: false`. Do not include `previous_response_id` or a provider conversation.

```powershell
conda run --no-capture-output -n meta python scripts/compare_azure_gateway.py `
  --request temp/azure-comparison-request.json `
  --azure-endpoint https://ysoaimetachatbotbackup.openai.azure.com/ `
  --api-version 2025-04-01-preview `
  --output temp/azure-gateway-comparison.json
```

The script reads existing gateway configuration from the ADK environment and
prompts for the direct Azure key when `AZURE_OPENAI_API_KEY` is absent. It rejects
provider-managed history, tracks native events separately from answer text,
classifies reused connections from TCP/TLS traces, and stops after a failed pair.
Do not interpret lifecycle-event latency as user-visible answer latency.
