# Skills in Conversation V2 (Manus) — Backend

This document describes how user-selected **skills** are wired into the
Conversation V2 (Manus) chat flow on the backend. Skill CRUD itself lives in the
[`skill`](../skill) module; this feature is about attaching a per-conversation
skill selection to each message turn and forwarding it to the AI service (ADK)
over gRPC.

## Table of Contents

- [Overview](#overview)
- [Data Flow](#data-flow)
- [Request Contract](#request-contract)
- [Persistence](#persistence)
- [gRPC Contract](#grpc-contract)
- [Files Touched](#files-touched)

---

## Overview

- The client sends an optional `skillIds: string[]` with every message.
- For each turn the stream service resolves those IDs into full skill payloads
  (`SkillService.findByIdsForGrpc`) and ships them to the ADK over gRPC as part
  of the `Chat` request.
- The selection is **persisted on the session** (`selectedSkillIds`) on every
  send, so reloading a conversation re-displays the same selection. This mirrors
  v1's conversation-level `selectedSkills`.
- Selection is **refreshed on every send** — the stored set always reflects the
  latest selection, not a union over time.

## Data Flow

```
Client (POST message, { message, model, skillIds })
        │
        ▼
ConversationV2StreamController.stream      conversation-v2-stream.controller.ts
        │  passes skillIds into the StartStreamRequest
        ▼
ConversationV2StreamService.startStream    conversation-v2-stream.service.ts
        │  1. resolve skillIds → full gRPC skills
        │     skills = skillService.findByIdsForGrpc(req.skillIds)
        │  2. persist selection on the session
        │     sessions.setSelectedSkills(sessionId, req.skillIds ?? [])
        │  3. open the gRPC chat with the resolved skills
        ▼
ConversationV2GrpcClientService.chat(..., skills)  → ADK (repeated Skill)
```

On read (`GET` session pointer), the persisted `selectedSkillIds` is returned so
the client can re-hydrate the composer selection.

## Request Contract

`skillIds` is an optional array of skill ObjectId strings on the send-message
DTO ([`dto/send-message.dto.ts`](dto/send-message.dto.ts)). When absent or empty,
no skills are attached and no resolution call is made.

The session pointer response now exposes the persisted selection:

```ts
interface PointerSummary {
  // …
  selectedSkillIds: string[]; // persisted selection, [] when none
}
```

## Persistence

`ConversationV2Session` gained a `selectedSkillIds: string[]` field
([`persistence/conversation-v2-session.store.ts`](persistence/conversation-v2-session.store.ts) /
[`pg-conversation-v2-session.store.ts`](persistence/postgres/pg-conversation-v2-session.store.ts);
default `[]`).

`ConversationV2SessionService.setSelectedSkills(id, skillIds)` overwrites the
stored selection on every send. It is **re-display only** — there are no
access checks, and an invalid `id` is a no-op.

## gRPC Contract

`SkillService.findByIdsForGrpc(ids)` loads the skills and maps each to the gRPC
`Skill` message via `SkillService.toGrpcSkill` (id, name, description,
instructions, license, compatibility, metadata, allowed_tools, files). The
resolved list is passed to `ConversationV2GrpcClientService.chat(...)` and sent
to the ADK as the `repeated Skill skills` field on the chat request
(see `chatbot.proto`, "Conversation-level skills selected by the user").

## Files Touched

| File | Change |
| --- | --- |
| [`conversation-v2-stream.service.ts`](services/conversation-v2-stream.service.ts) | Resolve `skillIds` → gRPC skills, persist selection, forward to gRPC |
| [`services/conversation-v2-session.service.ts`](services/conversation-v2-session.service.ts) | `setSelectedSkills`; expose `selectedSkillIds` on `PointerSummary` |
| [`persistence/postgres/pg-conversation-v2-session.store.ts`](persistence/postgres/pg-conversation-v2-session.store.ts) | `selectedSkillIds` on session pointer |
| [`conversation-v2.controller.ts`](conversation-v2.controller.ts) | Return `selectedSkillIds` on the session pointer |
| [`dto/send-message.dto.ts`](dto/send-message.dto.ts) | Optional `skillIds` input |
| [`../skill/skill.service.ts`](../skill/skill.service.ts) | `findByIdsForGrpc` / `toGrpcSkill` (gRPC mapping) |
