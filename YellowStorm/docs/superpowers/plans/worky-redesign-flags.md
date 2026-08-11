# Worky Redesign — Flags (design elements not fully backed)

These are the places where the approved mockups outrun what the codebase supports
today. Each is implemented honestly — degraded, flagged in-code, or deferred —
never faked. Decide per item whether to build the backing.

## 1. Live voice session is turn-based, not streaming duplex
- **Design:** continuous, always-listening call with streaming transcript both ways.
- **Reality:** only turn-based STT (`useAudioRecorder` + `/worky/stt/transcribe`) and
  per-message TTS (`/worky/tts/speak`) exist. No streaming STT/TTS, no WebRTC/WS audio.
- **What shipped:** `useVoiceSession` chains them into a half-duplex "walkie-talkie"
  loop (listen → transcribe → send → await reply → speak → re-arm). Documented in
  `voice/useVoiceSession.ts`. `mute()` currently ends the session (no partial-mute).
- **To close:** streaming STT + streaming TTS + a duplex transport.

## 2. Agent identity has no avatar image
- **Design:** per-agent avatars.
- **Reality:** the `Agent` entity (`modules/agent`) has no avatar field; platform
  convention is initials (widget `avatarMode: 'initials'`).
- **What shipped:** `AgentAvatar` derives initials + a deterministic tint from the
  agent id/key. Swap the body for an image if an avatar field is added.

## 3. `assigneeKey` only populates as the manager emits `plan_steps.assignee`
- **Backed end-to-end now** (Phase A): Electric `plan_steps.assignee` → task
  `assigneeKey` → board API → frontend grouping. But until the orchestrator actually
  stamps AI steps with an assignee, groups may be sparse; unattributed tasks fall into
  the "Unassigned / AI workers" fallback card. No fabricated agents.

## 4. Desktop activity feed (Phase E3) — deferred
- **Design:** a live right-rail activity feed.
- **Reality:** SSE event vocabulary exists but events are not persisted/listable, and
  accumulating them needs new in-session wiring (and ideally a history endpoint).
- **What shipped:** collapsible left rail only. The activity feed is **not built** —
  deferred pending a decision on live-only vs. persisted history.

## 5. Dashboard KPIs limited to client-derivable ones (Phase E4)
- **Shipped:** Active streams / Total / Needs-attention — all derived from the loaded
  `useStreams()` list.
- **Omitted (flagged in `StreamsDashboard.tsx`):** "agents working" and cross-stream
  "tasks done today" — no aggregate endpoint exists; not shown rather than faked.

## 6. Minor interim UX
- Mobile "More" tab opens the budget sheet as a stand-in until a full "more" menu
  exists (noted in `WorkyMobileStream.tsx`).
