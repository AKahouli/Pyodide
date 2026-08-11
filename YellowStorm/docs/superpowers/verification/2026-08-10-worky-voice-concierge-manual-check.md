# Worky Realtime Voice Concierge — Manual Verification

**Status:** Automated tests + typechecks green (see below). Live manual run **pending** — requires a Gemini API key with Live API access (`WORKY_VOICE_API_KEY`), which was not available during implementation.

## Automated verification (done)

Backend (Jest):
- `worky.config.spec.ts` — voice config defaults/overrides ✅
- `voice-concierge.config.spec.ts` — tools + locked live constraints ✅
- `gemini-token.service.spec.ts` — constrained ephemeral token minting, opaque envelope, no-key error ✅
- `voice-tool.service.spec.ts` — dispatch → gRPC, status read ✅
- `worky-voice.controller.spec.ts` — session/dispatch/status/transcript routing ✅
- `worky-planning.voice.spec.ts` — voice-origin transcript persistence ✅
- Backend `tsc --noEmit`: **0 errors**

Frontend (Vitest):
- `api.voice.test.ts`, `pcmAudio.test.ts`, `geminiLiveClient.test.ts`, `toolCallRelay.test.ts`, `milestoneInjector.test.ts`, `reconnectPolicy.test.ts`, `voiceSettings.test.ts` — all ✅ (36 voice tests incl. the pre-existing `useVoiceSession` suite, confirming the legacy path is intact)
- Frontend `tsc --noEmit`: **0 errors**

## Required environment (backend)

All server-side; **nothing is added to the frontend bundle**. Defaults live in `back/src/config/worky.config.ts` + validated in `config.schema.ts`.

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `WORKY_VOICE_API_KEY` | **yes** | `''` | Gemini API key with Live API access. Without it, `POST /worky/voice/session` returns a clear "not configured" error. |
| `WORKY_VOICE_MODEL` | no | `gemini-3.1-flash-live-preview` | Confirm the current Live model id before go-live. |
| `WORKY_VOICE_NAME` | no | `Kore` | Reuses the existing Gemini TTS voice set. |
| `WORKY_VOICE_WS_BASE_URL` | no | `wss://…/BidiGenerateContentConstrained` | Constrained endpoint. |
| `WORKY_VOICE_TOKEN_TTL_SEC` | no | `1800` | Ephemeral token lifetime. |
| `WORKY_VOICE_SESSION_START_TTL_SEC` | no | `60` | Window to open the first session. |

> For EU data residency, provision the Gemini/Google Cloud project accordingly before production use.

## Manual test script (run once the key is set)

Start backend + frontend, open a worky stream, open the voice dock, ensure **Realtime voice** is ON in voice settings.

- [ ] **Small talk** — a casual question is answered by the concierge with **no** worky task created (nothing appears on the board).
- [ ] **Dispatch** — "worky, research X" → hear an acknowledgement ("on it"), an **owner** message appears in chat history, and a plan/task starts on the board.
- [ ] **Milestone narration** — as the task progresses, the concierge speaks milestone updates unprompted (plan created, step finished, final result).
- [ ] **Status query** — "is it done?" → the concierge states the current status.
- [ ] **Barge-in** — interrupt the concierge mid-sentence; it stops and listens (Gemini native VAD).
- [ ] **Session resumption** — keep a conversation going past the Live session cap (~10–15 min); it resumes seamlessly with no lost context and no audible drop.
- [ ] **Fallback** — kill the network briefly (or set an invalid `WORKY_VOICE_API_KEY`); the UI falls back to the legacy STT/TTS pipeline and voice still works.
- [ ] **Transcript unification** — voice turns (yours and the concierge's) appear in the normal chat history, tagged `origin: 'voice'`.
- [ ] **BFF secrecy** — build the frontend and grep the output bundle: **no** Gemini API key, model name, system prompt, or voice name is present. Only the opaque token/envelope crosses to the client.

## Results

_(fill in during the live run)_

---

# Inline voice dock + per-stream prompt (2026-08-11)

Automated: backend Jest (planning voice-prompt, config/token prompt override, controller GET/PUT + session prompt) and frontend Vitest (voice API, shared hook, dialog, dock) all green; both typechecks clean.

Manual (desktop stream, backend restarted + frontend rebuilt):
- [ ] Clicking the dock starts voice **inline** — no full-screen sheet; the stream stays visible and scrollable.
- [ ] The dock mic animates between idle / listening (pulses with your voice) / speaking.
- [ ] Hang-up stops voice; the dock returns to the "tap to talk" pill.
- [ ] The gear opens voice settings; the message icon opens the Concierge instructions dialog.
- [ ] Editing + Save persists — reload the page, reopen the dialog → the text is retained.
- [ ] Reset to default clears it (dialog shows the "using default" note).
- [ ] Start voice again → the saved persona takes effect (behavior reflects the custom prompt).
- [ ] On a phone viewport, the mobile full-screen sheet still works (and only one session runs).
