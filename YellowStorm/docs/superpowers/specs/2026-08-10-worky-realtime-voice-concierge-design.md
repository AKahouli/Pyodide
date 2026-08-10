# Worky Realtime Voice Concierge — Design

**Date:** 2026-08-10
**Status:** Approved design, pending implementation plan
**Branch:** feature/worky_realtime_voice

## Problem

Worky's current voice experience is a half-duplex ("walkie-talkie") STT + TTS pipeline
(record fully → Whisper STT via OpenRouter → orchestrator turn → chunked Gemini TTS via
OpenRouter). It is explicitly not backed by a realtime model. The UX is not good enough:
turns are laggy, there is no natural turn-taking or interruption, and the round-trip through
batch STT/TTS plus an async orchestrator produces long dead air.

We want a realtime, human-feeling voice conversation.

## Key constraint: Claude has no speech-to-speech API

Worky's conversational "brain" is a model-agnostic, **asynchronous multi-agent orchestrator**
(planner → deterministic wave scheduler → parallel executor sub-agents), reached over gRPC
(`yellowstorm.orchestrator.v1.CompanionAi`), with results arriving seconds-to-minutes later
via ElectricSQL → SSE. A realtime speech-to-speech model **cannot be** this orchestrator, and
Anthropic/Claude offers no S2S API. Therefore the realtime model is layered *in front of*
worky as a conversational concierge, not as a replacement for the orchestrator.

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Concierge role | **Conversational front agent** | Handles small talk / clarification itself; calls worky only for real work; narrates progress. Best UX. |
| Provider | **Gemini Live** | Reuses existing Gemini TTS voices (Kore, etc.); native VAD/barge-in + function calling; EU data residency via Google Cloud. |
| Transport | **Direct browser↔Gemini WS with backend-minted ephemeral token (BFF)** | Lowest latency, no audio-relay infra. |
| Config posture | **BFF — zero config/secrets on frontend** | Ephemeral token binds model, voice, system prompt, tool schemas via `liveConnectConstraints`; client cannot deviate. |
| Tool surface | **`dispatch_task` + `query_status`** | Lean; control/config tools deferred (YAGNI). |
| Tool logic location | **(A) Thin BFF endpoints** | Orchestrator logic, gRPC, auth stay 100% server-side; browser is a dumb relay. |
| Progress narration | **Proactive milestones** | Backend/SSE milestones (plan-created, wave-complete, final-result) injected into the live session; not every event. |

## Architecture

```
   ┌──────────────────────────── BROWSER ────────────────────────────┐
   │ 1. POST /worky/voice/session ──────────────► BACKEND mints token │
   │ 2. receives { tokenName }  (opaque, no config)                   │
   │ 3. WS direct ──► wss://…BidiGenerateContentConstrained?token=…    │
   │    mic PCM 16k up / audio 24k down / native VAD+barge-in         │
   │ 4. toolCall arrives here ─┐   5. SSE milestones arrive here ─┐   │
   └───────────────────────────┼──────────────────────────────────┼───┘
                               │ (thin control calls to BFF)      │ (inject as
        ┌──────────────────────▼──────────────────────┐           │  text turn into
        │  BACKEND (BFF)                               │           │  the Gemini WS)
        │  • POST /voice/session  → mint locked token  │           │
        │  • POST /voice/tool/dispatch → gRPC RunTask  │◄──────────┘
        │  • POST /voice/tool/status   → read state    │  browser already
        │  • system prompt + tool schemas (server-only)│  holds the SSE sub
        └──────────────────────────────────────────────┘
```

### Flow

1. User speaks → browser streams raw PCM (16 kHz) up its WS → Gemini Live. Gemini's native
   VAD/barge-in handles turn-taking (no record-then-upload).
2. Gemini answers small talk / clarifies itself, speaking straight back down the WS (24 kHz).
3. When the user wants work, Gemini emits a `dispatch_task` toolCall → browser relays it to
   `POST /worky/voice/tool/dispatch` → backend runs `orchestrator.runTask` (gRPC), gets the
   immediate 202/taskId → returns it → browser sends it back as the tool response → concierge
   says "on it."
4. `milestoneInjector` (browser, using the **existing** SSE subscription) watches for
   plan-created / wave-complete / final-result and injects `[worky update: …]` text turns
   into the live session, so the concierge speaks them unprompted.
5. `query_status` toolCall → `POST /worky/voice/tool/status` → backend reads current plan/task
   state → concierge narrates on demand.
6. Gemini `inputTranscription`/`outputTranscription` → `POST /worky/voice/transcript` →
   written to worky's existing message store (tagged voice-origin) → voice conversations
   appear in normal chat history.

### Why direct + BFF is airtight

Ephemeral tokens support `liveConnectConstraints`, locking model + voice + **system
instruction + tool declarations** + transcription + `sessionResumption` +
`contextWindowCompression` into the token at mint time. The client receives only an opaque
token name and connects to the constrained endpoint
(`…GenerativeService.BidiGenerateContentConstrained?access_token=…`); the endpoint rejects any
client deviation from server-bound config. No model name, API key, prompt, or env ever reaches
the browser.

**Consequence of going direct:** whoever holds the Gemini WS receives `toolCall`s and must
inject milestones — that is now the browser. Tool *logic* still runs server-side (choice A):
the browser only relays. Milestone injection is presentation-only (opaque text forwarded from
the SSE stream the UI already consumes); no business logic on the client.

## Components

### Backend (`back/src/modules/worky/voice/`)

| Unit | Responsibility | Depends on |
|---|---|---|
| `VoiceSessionController` | BFF REST: `POST /voice/session` (mint token), `POST /voice/tool/dispatch`, `POST /voice/tool/status`, `POST /voice/transcript`. Auth-guarded by existing JWT + `WORKY_STREAM_WRITE`. | services below |
| `GeminiTokenService` | `@google/genai` `authTokens.create({ liveConnectConstraints })` binding model, voice, system prompt, tool schemas, transcription, `sessionResumption`, `contextWindowCompression`, VAD. Returns opaque token name. Values from server-side config. | `@google/genai`, `worky.config` |
| `VoiceToolService` | Executes the two tools. `dispatch` → existing `orchestrator.runTask` via `ensureKickoffContext`. `status` → reads plan/task state from the Mongo mirror. | existing `WorkyOrchestrator` gRPC client, `worky-stream`/`worky-planning` services |
| `voiceConciergeConfig.ts` | Persona system-prompt + two `FunctionDeclaration` schemas + voice/model IDs. Server-side only; never shipped to client. | — |

New config (`worky.config.ts` + `config.schema.ts`): `GEMINI_API_KEY`, `WORKY_VOICE_MODEL`
(e.g. `gemini-3.1-flash-live-preview`), `WORKY_VOICE_NAME` (default `Kore`), token TTLs.

### Frontend (`front/src/modules/worky/voice/`)

| Unit | Responsibility |
|---|---|
| `geminiLiveClient.ts` | Thin WS wrapper: connect with token to constrained endpoint; send/receive audio; surface `toolCall` / transcription / `sessionResumptionUpdate` / `goAway`. Knows nothing about worky. |
| `useRealtimeVoiceSession.ts` | Session orchestration: fetch token → open WS → wire audio → relay tool calls → inject milestones → handle resumption. Replaces the STT/TTS guts of today's `useVoiceSession.ts`; keeps its `idle/listening/thinking/speaking` state machine, `VoiceOrb`, and settings UI. |
| `pcmAudioIO.ts` | AudioWorklet: mic → PCM 16 kHz up; PCM 24 kHz down → speaker. Replaces the `MediaRecorder` batch recorder. Client-side silence detection retires (native VAD now lives in Gemini). |
| `toolCallRelay.ts` | On `toolCall` → `POST /voice/tool/*` → return result as tool response. Dumb relay. |
| `milestoneInjector.ts` | Subscribes to the existing SSE store; on milestone, sends a `[worky update: …]` text turn into the WS. |

The old OpenRouter STT/TTS controllers/services are **retained as a fallback path**, not
deleted.

## Session lifetime, resilience, persistence

**Session lifetime.** Gemini Live audio sessions are time-capped (~10–15 min); tokens are
short-lived. The conversation feels unbounded via:
- **Session resumption:** `sessionResumption` bound in the token; client stores the rolling
  handle and, on `goAway`/expiry, re-mints a fresh token via the BFF and reconnects with the
  handle — no lost context, silent to the user.
- **Context-window compression:** `slidingWindow` compression bound server-side so long
  conversations don't exceed context.

**Long worky tasks vs. session.** The task runs async on the orchestrator regardless. If the
user hangs up mid-task, milestones fall back to the normal text/SSE UI — nothing is lost. If
they stay, milestones narrate across resumptions.

**Resilience / degradation.**
- Token mint fail → don't open WS; surface a clear error.
- WS unrecoverable → fall back to the existing turn-based STT/TTS pipeline (kept alive for
  exactly this) — voice never hard-fails.
- Tool endpoint error → return an error tool-response so the concierge can say it couldn't
  reach worky.
- Mic permission denied → existing handling.

**Persistence.** `inputTranscription`/`outputTranscription` POSTed to `/voice/transcript` and
written to worky's existing message store, tagged voice-origin, so voice conversations appear
in normal chat history.

## Testing

- **Backend unit:** `GeminiTokenService` (constraints correctly bound; no secrets in returned
  payload), `VoiceToolService` (dispatch → gRPC call shape; status → correct state read),
  controller auth guards. Mock `@google/genai` and the gRPC client.
- **Frontend unit:** `toolCallRelay`, `milestoneInjector` (SSE event → correct text turn),
  resumption/reconnect logic against a mock WS.
- **Integration:** a mock Gemini WS server drives the full `toolCall → BFF → gRPC` loop.
- Follow existing `*.spec.ts` + Playwright e2e conventions.

## Out of scope (deferred)

- Control tools (pause/stop/resume) and configure tools (agent/connector/model selection by
  voice).
- Replacing worky's orchestrator with a realtime model (not feasible; not desired).
- Removing the OpenRouter STT/TTS pipeline (retained as fallback).

## Open items for the implementation plan

- Exact `WORKY_VOICE_MODEL` id to pin (confirm current Gemini Live model at build time).
- Precise milestone taxonomy mapping from Electric/SSE event types to spoken updates.
- Transcript batching cadence to `/voice/transcript`.
