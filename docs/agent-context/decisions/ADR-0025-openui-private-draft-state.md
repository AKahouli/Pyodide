---
id: ADR-0025
status: accepted
scope: conversation-openui-private-draft-state
source_paths:
  - YellowStorm/back/src/modules/postgres/schema/conversation.schema.ts
  - YellowStorm/back/src/modules/conversation/controllers/message.controller.ts
  - YellowStorm/back/src/modules/conversation/services/message.service.ts
  - YellowStorm/back/src/modules/conversation/persistence/postgres/postgres-message-store.ts
  - YellowStorm/front/src/modules/conversation/components/openui/use-mini-app-state.ts
accepted_at: 2026-10-17
---

# Private, revisioned OpenUI draft state

## Approval and scope

Accepted design. On 2026-10-17 the user explicitly approved the named
`conversation.openui_app_states` table and authenticated GET/PUT API in response
to the phase 3 change-control question. Verification is separate from approval.
No earlier accepted ADR directly governs viewer drafts. MCP authentication and
connector ownership under ADR-0017/0018 are unchanged.

## Decision

The existing ConversationModule owns one PostgreSQL table for private state,
scoped by authenticated actor, conversation, source assistant message, text
component and SHA-256 program digest. Extend the existing message controller,
service and PostgreSQL message store; introduce no service, module or runtime.

GET/PUT use
`/conversations/:conversationId/messages/:messageId/openui/:componentId/state`.
Both require current creator/member access in addition to the existing guard,
including governed audience checks. Invited and project read-only viewers cannot
read private drafts or write them. Derive the actor from authentication and the
program digest from a completed, nonstreaming AI message in that conversation.

PUT requires the matching digest and expected state revision. Atomic compare and
swap admits one winner; stale writes return conflict without overwriting newer
state. Lock the source message while checking its program and writing. Cascade
deletion from the source message and conversation. Branches and copied messages
have separate identities; do not copy private drafts.

Persist bounded JSON, retaining numbers, booleans, null, empty strings, arrays
and nested values. Reject dangerous keys, nonfinite numbers, unsupported JSONB
strings and excessive depth, nodes or bytes. Bounded user-entered text, including
pasted summarizer input, is private draft content. Do not put provider credentials,
image/file bytes, extracted document bodies or tool results into the state store.
Artifacts continue using existing authorized storage and references.

The frontend loads the draft before enabling edits and debounces changes by
500 ms. Serialize writes and queue the newest local snapshot. Show saving,
saved, error, read-only and conflict states. A conflict requires loading the saved
version or explicitly reapplying the local draft against a fresh revision. Never
automatically overwrite a conflicting revision. Scope callbacks and requests to
actor/source identity; ignore or abort late responses. Autosave creates no agent
turn or tool call. Existing accepted submissions remain available as initial
fallback when no private draft exists.

## Alternatives and limits

Explicit Save interactions add turns and cannot provide quiet autosave or CAS.
Mutating assistant component JSON would mix shared transcript and private drafts.
Browser storage would not provide server-enforced concurrency or cross-device
reload. None is used for the new draft store.

Dynamic mini-app export snapshots, document execution bridges, shared editable
state and incremental program edits remain separately scoped phases. Disabling
autosave does not rewrite saved conversation programs or explicit submissions.

## Qualification

Required: typed reload across different apps, first-write/update races, two-tab
conflicts, actor isolation, revoked/read-only access, source replacement, cascade
cleanup, bounded JSON, retry/late-response behavior and no inference during saves.
The phase plan records actual test and browser outcomes independently of this
design approval.
