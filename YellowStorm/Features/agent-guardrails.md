---
project: YellowStorm
type: feature
slug: agent-guardrails
status: active
updated: 2026-07-09 12:00 UTC
source_paths:
  - YellowStorm/back/src/modules/guardrails/
  - YellowStorm/back/src/modules/agent/interfaces/agent.interface.ts
  - YellowStorm/back/src/modules/agent/dto/create-agent.dto.ts
  - YellowStorm/back/src/modules/agent/agent.service.ts
  - YellowStorm/back/src/modules/conversation/interfaces/message.interface.ts
  - YellowStorm/back/src/modules/conversation/schemas/message.schema.ts
  - YellowStorm/back/src/modules/conversation/services/stream.service.ts
  - YellowStorm/back/src/modules/conversation/services/message.service.ts
  - YellowStorm/back/src/modules/models/models.service.ts
  - YellowStorm/front/src/modules/admin/pages/GuardrailsPage.tsx
  - YellowStorm/front/src/modules/admin/types.ts
  - YellowStorm/front/src/modules/agent/components/AgentGuardrailsTab.tsx
  - YellowStorm/front/src/modules/agent/components/AgentFormSchema.ts
  - YellowStorm/front/src/modules/agent/types.ts
  - YellowStorm/front/src/modules/conversation/store.ts
  - yellowstorm-adk/src/guardrails/
  - yellowstorm-adk/src/grpc_server/chatbot_servicer.py
  - yellowstorm-adk/src/smart_rag/agents/core/runner.py
  - yellowstorm-adk/src/smart_rag/engines/multi_agent/agentic_workflows/
  - yellowstorm-adk/grpc/proto/chatbot.proto
tags:
  - yellowstorm
  - feature/agent-guardrails
  - backend
  - frontend
  - adk
  - safety
  - security
---

# Agent Guardrails

## Agent Quick Context
- **Entry points:** Admin `GuardrailsPage.tsx` (global settings), `AgentGuardrailsTab.tsx` (per-agent settings), backend `agent.service.ts` (gRPC agent build with `guardrails_json`), ADK `prompt_injection_guardrail.py` (runtime enforcement), `classifier.py` (LLM-based classification).
- **Runtime flow:** Admin/per-agent toggle config → serialized as `guardrails_json` into `agent_params` → ADK `resolve_effective_guardrails()` resolves effective config → `check_input`/`check_output`/`check_tool_call` → `classify_prompt_injection()` via LLM → block/sanitize/allow → `GuardrailResult` with metadata → streamed via `StreamChunk.metadata.guardrail_decision_json` → backend `stream.service.ts` attaches to component data → frontend store replaces unsafe text via `guardrailDecision` detection → persisted on message document.
- **Contracts:** `UpdateGuardrailsSettingsDto`, `UpdatePromptInjectionGuardrailsDto`, `PromptInjectionGuardrailsConfig` (TypeScript), `PromptInjectionConfig` (Python dataclass), `GuardrailDecisionMetadata` interface, `StreamChunk.metadata.guardrail_decision_json` (proto string field).
- **Invariants:** Enabled guardrails always enforce classifier decision directly — no configurable "protection mode" or severity level between enable and enforcement. Block/sanitize replace streamed text when `guardrailDecision` is present. Tool-call guardrail is stored/disabled (not enforced in current ADK workflow wiring). Classifier always fails open (allow) on errors.
- **Pitfalls:** Output guardrail runs after streamed content has been generated; replacement semantics prevent persisted/displayed unsafe text via `guardrailDecision` replacement. Silent fail-open means a broken classifier is invisible to users (logged at WARN only). Tool-call guardrail toggle is disabled in UI — re-enabling requires ADK workflow wiring.

## Purpose
Prompt injection detection for agent conversations via per-phase classifier LLM calls. Admins configure global defaults (with optional force activation) and per-agent overrides for input, output, and tool-call guardrail phases. The classifier's `block`/`sanitize`/`allow` decisions are enforced directly, with metadata propagated through the entire streaming pipeline for persistence and UI text replacement.

## Current Implementation

### Configuration Model
Three configurable guardrail phases, each with independent toggle, classifier prompt, and shared block message:
- **Input guardrail** — Classifies user messages before agent processing
- **Output guardrail** — Classifies agent responses before delivery
- **Tool-call guardrail** — Classifies tool name + arguments (stored/disabled, not enforced in ADK workflow)

Each phase has its own classifier prompt (defaulted from legacy single `classifierPrompt`). The `blockMessage` is shared across phases.

### Admin vs Agent Resolution
Two-tier configuration:
1. **Admin settings** (`GuardrailsSettings` collection): `forceActivation` flag + `promptInjection` config
2. **Per-agent settings** (`agent.guardrails.promptInjection`): per-agent overrides
3. **Resolution** in ADK `resolve_effective_guardrails()`: if `admin.forceActivation` is `true` → admin config wins with source `admin_forced`. Otherwise → agent config wins with source `agent`.

### Classifier Decision Flow
1. Enabled guardrail → `classify_prompt_injection()` via LLM
2. Classifier returns `block` → `GuardrailResult(blocked=True, text=_build_block_message(blockMsg, classifierReason))`
3. Classifier returns `sanitize` with `safe_rewrite` → `GuardrailResult(sanitized=True, text=safe_rewrite)`
4. Classifier returns `allow` (or any error) → `GuardrailResult(decision="allow", text=original)`

Block messages append a short sanitized classifier reason: sanitizes reason (240 char max, whitespace-collapsed), appends `"\n\nReason: {safe_reason}"` after the block message.

### Metadata Propagation
```
GuardrailResult.decision_metadata() → {
  phase, source, decision, confidence, attackType, target, reason
}
→ ADK formatters attach guardrail_decision to stream event
→ gRPC servicer _guardrail_decision_json() serializes to JSON string
→ StreamChunk.metadata.guardrail_decision_json (proto string field)
→ Backend parseGuardrailDecision() → object
→ applyChunkToBuffer() attaches to component data.guardrailDecision
→ Broadcast to frontend via WebSocket
→ Frontend mergeStreamingData() replaces unsafe text when guardrailDecision present
→ Message completion: message.service.ts persists on message document + component data scan fallback
```

### Output Text Replacement
When a guardrail blocks or sanitizes output, the replacement semantics work as follows:
- The guarded text (block message + reason, or sanitized rewrite) is streamed as a `final_response` update chunk with `guardrailDecision` metadata
- **Backend `mergeComponentData`** (text type): if incoming has `guardrailDecision`, replaces entire component data (`{...existing, ...incoming}`) instead of appending content
- **Frontend `mergeStreamingData`** (text type): same replacement logic (`{...existing, ...incoming}`)
- This ensures unsafe text that was already streamed before the guardrail event arrives is fully replaced

### Classifier Fail-Open
All failure paths return `decision="allow"` with original text unchanged:
1. No classifier model configured → allow with reason `missing_classifier_model`
2. LLM call failure (timeout, API error) → allow with reason `classifier_failed_open`
3. Invalid classifier JSON response → allow with reason `invalid_classifier_json`
4. Unknown decision value → defaults to `allow`
5. Invalid `guardrails_json` → empty payload → all toggles default to `False`
6. Guardrail disabled → `GuardrailResult(decision="allow")` with original text

## Key Files
- `yellowstorm-adk/src/guardrails/prompt_injection_guardrail.py` — `PromptInjectionGuardrail` class, `GuardrailResult` dataclass, `_build_block_message()`
- `yellowstorm-adk/src/guardrails/config.py` — `PromptInjectionConfig`, `EffectiveGuardrailsConfig`, `resolve_effective_guardrails()`, `_normalize_prompt_injection()`
- `yellowstorm-adk/src/guardrails/classifier.py` — `classify_prompt_injection()`, `ClassifierDecision`, LLM-based classification with fail-open
- `yellowstorm-adk/src/guardrails/audit.py` — `audit_prompt_injection_decision()` structured logging
- `yellowstorm-adk/src/grpc_server/chatbot_servicer.py` — `_guardrail_decision_json()` serializes metadata to `StreamChunk.metadata.guardrail_decision_json`
- `yellowstorm-adk/src/smart_rag/agents/core/runner.py` — Output guardrail check at line ~996 on final response text
- `yellowstorm-adk/src/smart_rag/engines/multi_agent/agentic_workflows/single_agent.py` — Input guardrail check at line ~88
- `yellowstorm-adk/src/smart_rag/engines/multi_agent/agentic_workflows/manual_agents.py` — Input guardrail check at line ~114
- `yellowstorm-adk/src/smart_rag/messaging/formatters.py` — Attaches `guardrail_decision` to streaming events
- `yellowstorm-adk/grpc/proto/chatbot.proto` — `Metadata.guardrail_decision_json` field (line ~379)
- `YellowStorm/back/src/modules/guardrails/` — `GuardrailsSettingsService`, DTOs, schema, controller
- `YellowStorm/back/src/modules/agent/agent.service.ts` — Builds `guardrails_json` + `guardrails_classifier_model` for gRPC agent params
- `YellowStorm/back/src/modules/agent/interfaces/agent.interface.ts` — `AgentGuardrails`, `PromptInjectionGuardrailsConfig` interfaces
- `YellowStorm/back/src/modules/conversation/services/stream.service.ts` — `parseGuardrailDecision()`, `applyChunkToBuffer()`, `mergeComponentData()` with guardrail replacement
- `YellowStorm/back/src/modules/conversation/services/message.service.ts` — Persists `guardrailDecision` on message, `findGuardrailDecision()` component scan fallback
- `YellowStorm/back/src/modules/conversation/interfaces/message.interface.ts` — `GuardrailDecisionMetadata`, `CompleteAIMessageData.guardrailDecision`
- `YellowStorm/back/src/modules/conversation/schemas/message.schema.ts` — Mongoose `guardrailDecision` field
- `YellowStorm/front/src/modules/admin/pages/GuardrailsPage.tsx` — Admin global guardrails settings UI
- `YellowStorm/front/src/modules/admin/types.ts` — `AdminGuardrailsSettings`, `PromptInjectionGuardrailsConfig` types
- `YellowStorm/front/src/modules/agent/components/AgentGuardrailsTab.tsx` — Per-agent guardrails UI tab
- `YellowStorm/front/src/modules/agent/components/AgentFormSchema.ts` — Zod schemas with defaults
- `YellowStorm/front/src/modules/conversation/store.ts` — `mergeStreamingData()` with guardrailDecision text replacement
- `yellowstorm-adk/tests/test_prompt_injection_guardrail.py` — Guardrail block/sanitize tests
- `yellowstorm-adk/tests/test_guardrails_config.py` — Config resolution tests
- `YellowStorm/back/src/modules/conversation/services/stream.service.spec.ts` — Guardrail metadata buffering tests

## API / Interfaces

### NestJS DTOs
**`UpdateGuardrailsSettingsDto`** (PUT /admin/guardrails):
- `forceActivation?: boolean`
- `promptInjection?: UpdatePromptInjectionGuardrailsDto`

**`UpdatePromptInjectionGuardrailsDto`**:
- `inputGuardrailEnabled?: boolean`
- `outputGuardrailEnabled?: boolean`
- `toolCallGuardrailEnabled?: boolean`
- `inputClassifierPrompt?: string` (max 20000)
- `outputClassifierPrompt?: string` (max 20000)
- `toolCallClassifierPrompt?: string` (max 20000)
- `blockMessage?: string` (max 1000)

### TypeScript Interfaces
**`PromptInjectionGuardrailsConfig`** (shared across admin/agent/conversation):
```typescript
{
  inputGuardrailEnabled: boolean;
  outputGuardrailEnabled: boolean;
  toolCallGuardrailEnabled: boolean;
  inputClassifierPrompt: string;
  outputClassifierPrompt: string;
  toolCallClassifierPrompt: string;
  blockMessage: string;
}
```

**`GuardrailDecisionMetadata`**:
```typescript
{
  phase: 'input' | 'output' | 'tool_call';
  source: 'agent' | 'admin_forced' | string;
  decision: 'allow' | 'sanitize' | 'block';
  confidence: number;
  attackType: string;
  target: string;
  reason?: string;
}
```

### Python Dataclasses
**`PromptInjectionConfig`**:
- Fields match TypeScript `PromptInjectionGuardrailsConfig` (snake_case)
- `source: str` — `"agent"` or `"admin_forced"`
- `classifier_prompt_for_phase(phase)` — returns per-phase prompt

**`GuardrailResult`**:
- `decision`, `text`, `blocked`, `sanitized`, `reason`, `confidence`, `attack_type`, `target`, `phase`, `source`
- `decision_metadata()` → dict for serialization

### Proto
**`Metadata.guardrail_decision_json`** (string) — serialized JSON of guardrail decision metadata attached to every `StreamChunk`.

### gRPC Agent Params
- `agent_params.params.guardrails_json` — JSON string `{ agent: {...}, admin: {...} }`
- `agent_params.params.guardrails_classifier_model` — model identifier string

## Design Decisions
| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Boolean toggles per phase (no protection mode) | Simpler UX — enable/disable directly maps to classifier enforcement; no "low/medium/high" abstraction that would need its own decision mapping | Configurable protection mode with block/sanitize/monitor levels (removed — added complexity without clear benefit) |
| Classifier block messages append sanitized reason | Users see why the guardrail fired without exposing raw classifier output | Raw reason (might leak prompt internals); silent block (no user feedback) |
| GuardrailDecisionMetadata on StreamChunk.metadata | Universal metadata attachment regardless of chunk type (usage, component, legacy) | Separate guardrail event type (more stream complexity) |
| Text replacement via guardrailDecision detection | Corrects previously streamed unsafe content after guardrail event arrives | Pre-scanning output before streaming (not possible with streaming) |
| `forceActivation` flag for admins | Override all per-agent guardrail settings for compliance enforcement | Separate admin-only policies (more complex) |
| Classifier fail-open on all errors | System continues operating even if classifier is unavailable | Fail-closed (would block all interactions — too risky) |
| Tool-call guardrail stored but UI-disabled / not wired in ADK | Infrastructure ready for future enablement; no current workflow need | Remove entirely (would need re-addition later) |
| `findGuardrailDecision()` component scan fallback | Catches guardrail decisions embedded in components when top-level is absent | Require top-level only (breaks if ADK sends decision inside component data) |

## Known Pitfalls
- **Output guardrail timing:** Output guardrail runs after streamed content has already been generated and partially streamed. The replacement semantics (component data merge with `guardrailDecision` detection) prevent persisted/displayed unsafe text, but the timing means a brief flash of unsafe text may be visible before the guardrail event arrives. This is a fundamental streaming guardrail limitation.
- **Silent fail-open:** If the classifier is broken or misconfigured, all guardrails silently allow everything. Only WARN-level logs indicate the failure — no user-visible indicator.
- **Tool-call guardrail toggle disabled in UI:** The toggle exists on both admin and agent guardrails pages but is `disabled={true}`. Re-enabling it alone will NOT work — the ADK workflow files (`single_agent.py`, `manual_agents.py`, `runner.py`) do not invoke `check_tool_call()`. Full enablement requires wiring the tool-call check into the ADK workflow.
- **Legacy single `classifierPrompt` fallthrough:** If the per-phase prompts are empty, the legacy `classifierPrompt` field is used as a fallback for all three phases. This means an admin setting only `classifierPrompt` (deprecated) will get the same classifier prompt for input, output, and tool-call phases.
- **`forceActivation` with missing classifier model:** If admin sets `forceActivation: true` but no `guardrails_classifier` model is configured, the guardrail is enabled but the classifier will fail open (allows everything with WARN log). Users cannot override this — they see "enabled" but no enforcement happens.
- **Proto field is a raw JSON string:** `guardrail_decision_json` is a proto `string` field, not a structured sub-message. The backend must `JSON.parse()` it. Invalid JSON is silently dropped (`parseGuardrailDecision()` returns `undefined`).

## Recent Changes
### 2026-07-09 12:00 UTC
- **Changed:** Protection level/mode concept fully removed across all layers. Guardrail enforcement now uses direct boolean toggles + classifier decisions (block/sanitize/allow) with no intermediate protection mode abstraction. Removed from: frontend UI (admin GuardrailsPage, AgentGuardrailsTab), frontend types, Zod schemas, backend DTOs, Mongoose schemas, `normalizePromptInjectionGuardrails()`, ADK `PromptInjectionConfig`/`EffectiveGuardrailsConfig`. Enabled input/output guardrails now enforce classifier block/sanitize directly. Classifier block messages append a short sanitized classifier reason (`_build_block_message()`). Guardrail decision metadata propagates via `StreamChunk.metadata.guardrail_decision_json` → parsed by `parseGuardrailDecision()` → attached to component `data.guardrailDecision` → persisted on message documents via `message.service.ts` with component scan fallback. Output block/sanitize text updates replace existing streamed text when `guardrailDecision` is present (both backend `mergeComponentData` and frontend `mergeStreamingData`). Tool-call guardrail remains stored/disabled/not enforced. Classifier fail-open behavior preserved.
- **Why:** Replace indirect protection mode UX with direct enable/disable per phase. Simplify admin and agent configuration to a single yes/no toggle per guardrail phase. Stream guardrail decisions end-to-end for persistence and correct text replacement.
- **Impact:** `GuardrailsPage.tsx`, `AgentGuardrailsTab.tsx`, `AgentFormSchema.ts`, `admin/types.ts`, `agent/types.ts`, `admin-guardrails.controller.ts`, `guardrails-settings.service.ts`, `guardrails-settings.schema.ts`, `guardrails-settings.dto.ts`, `agent.interface.ts`, `agent.service.ts`, `agent.schema.ts`, `create-agent.dto.ts`, `update-agent.dto.ts`, `message.interface.ts`, `message.schema.ts`, `message.service.ts`, `stream.service.ts`, `stream.service.spec.ts`, `models.service.ts`, `prompt_injection_guardrail.py`, `config.py`, `classifier.py`, `chatbot_servicer.py`, `runner.py`, `single_agent.py`, `manual_agents.py`, `formatters.py`, `chatbot.proto`, `conversation/store.ts`, `test_prompt_injection_guardrail.py`, `test_guardrails_config.py`. Build/Tests PASS; reviewer PASS.

## Related Notes
- [[flow-engine-tools]] — Peer feature: Python ADK runtime tool factory (same ADK layer)
- [[adk-architecture]] — ADK runtime architecture
- [[conversation-streaming]] — Streaming pipeline that carries guardrail decisions (entry points, buffer/merge semantics)
