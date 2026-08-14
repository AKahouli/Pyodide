# Worky Inline Voice + Per-Stream Concierge Prompt — Design

**Date:** 2026-08-11
**Status:** Approved design, pending implementation plan
**Branch:** feature/worky_realtime_voice
**Builds on:** 2026-08-10-worky-realtime-voice-concierge-design.md (the working realtime concierge)

## Problem

Two follow-up gaps in the now-working realtime voice concierge:

1. **Modal takeover.** Clicking the mic opens a full-screen `VoiceSession` sheet, so the user
   can't talk to the concierge while inspecting their worky stream. Voice should be an ambient,
   inline experience on the stream, not a takeover.
2. **Fixed persona.** The concierge system prompt is a single global constant. Users want to
   configure it per worky stream (with the current prompt as the default).

## Decisions (locked)

| Decision | Choice |
|---|---|
| Inline control | The existing bottom **voice dock** toggles live voice in place; its mic animates idle/listening/speaking. No sheet on desktop. |
| Full-screen sheet | **Removed on desktop** (dock only). **Mobile keeps** the sheet (small screens need the takeover). |
| Prompt editing | **Dedicated "Concierge instructions" dialog** opened from the dock gear (textarea, save, reset-to-default). |
| Prompt storage | Persisted **per worky stream**; default = current global `CONCIERGE_SYSTEM_PROMPT`. |
| Prompt application | Resolved server-side at session mint; takes effect on the next voice start. |

## Section 1 — Inline voice on desktop

**Shared hook (refactor).** Extract the realtime-vs-legacy selection + fallback that currently
lives in `VoiceSession.tsx` into `useWorkyVoiceSession(streamId, { active })`, returning the
existing `VoiceSessionApi` plus `usingRealtime: boolean`. Both the desktop dock and the mobile
sheet consume it — single source of truth, no duplication.

**Desktop (`WorkyStreamPage` + `WorkyVoiceDock`):**
- The page hosts the shared hook and renders the dock; the desktop `<VoiceSession>` usage is removed.
- **Idle:** today's "tap to talk" gold pill.
- **Live:** the dock morphs in place into a compact bar — an animated mic reflecting state
  (idle glow → listening pulse driven by the `level` meter → speaking animation), plus mute,
  hang-up, and a settings gear. The full stream stays visible/interactive behind it.
- **Stop:** hang-up or mic toggle ends the session; dock returns to idle.
- The `voiceOpen` UI-store flag is repurposed from "sheet open" to "voice active".

**Settings access:** the dock gear opens the existing `VoiceSettingsSheet` (device, realtime
toggle) plus the new prompt dialog.

**Fallback:** realtime→legacy fallback lives in the shared hook. If realtime errors, the dock
drops to the legacy STT/TTS loop and shows a press-to-talk affordance instead of always-listening.

**Mobile:** `WorkyMobileStream` keeps `VoiceSession`, switched to consume the shared hook.

## Section 2 — Per-stream concierge prompt

**Backend:**
- `WorkyStream` schema: add `voicePrompt?: string | null` (null → global default).
- Voice controller endpoints (ownership verified via stream load):
  - `GET /worky/voice/prompt?streamId=…` → `{ prompt: string; isDefault: boolean }`
    (stream's prompt, or the default text when unset).
  - `PUT /worky/voice/prompt { streamId, prompt }` → saves; blank/empty stores null (reset to default).
- Token minting per-stream: `POST /worky/voice/session` gains `streamId`.
  `mintSessionToken(userId, streamId, opts)` loads the stream's `voicePrompt` (or the default) and
  passes it to `buildSetupMessage(model, voice, opts, prompt)`. `CONCIERGE_SYSTEM_PROMPT` stays the
  default constant.

**Frontend:**
- `createVoiceSession(streamId, resumptionHandle?)` sends the streamId.
- **Concierge instructions dialog** (from the dock gear): textarea prefilled from `GET`,
  **Save** (PUT), **Reset to default**, char counter, and a note that it applies on next start.

## Section 3 — Testing

- **Backend:** prompt `GET`/`PUT` (ownership rejection, default fallback, reset-on-blank); token
  minting uses the per-stream prompt; `buildSetupMessage` accepts a prompt override.
- **Frontend:** shared hook selection + fallback; dock renders idle/listening/speaking; prompt
  dialog save/reset and prefill.
- Follow existing `*.spec.ts` (Jest) and Vitest conventions.

## Out of scope (deferred)

- Voice control tools (pause/stop/reconfigure a run) — still deferred from the prior spec.
- Prompt versioning/history, tone presets, examples in the dialog.
- Removing the now-unused `/worky/voice/tool/transcript` endpoint (separate cleanup).

## Open items for the plan

- Exact dock animation treatment for each state (reuse `VoiceOrb` motion vs. a dock-specific pulse).
- Whether the settings gear reuses `VoiceSettingsSheet` as-is or a slimmer popover on desktop.
