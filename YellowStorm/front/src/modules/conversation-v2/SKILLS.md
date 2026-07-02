# Skills in Conversation V2 (Manus) — Frontend

This document describes how a user attaches **skills** to a Conversation V2
(Manus) chat. Skill discovery/management UI lives in the
[`skill`](../skill) module; this feature is about selecting skills for a
conversation, showing them as pills, sending them with each message, and keeping
the selection across reloads and across the new-conversation → session
navigation.

## Table of Contents

- [Overview](#overview)
- [State Management](#state-management)
- [Sending Skills](#sending-skills)
- [Selected Skills Pills](#selected-skills-pills)
- [New Conversation → Session Hand-off](#new-conversation--session-hand-off)
- [Rehydration on Reload](#rehydration-on-reload)
- [Files Touched](#files-touched)

---

## Overview

- The user picks skills from the composer menus (`RecentSkillsMenu` /
  `ManageSkillsDialog`); the selection is kept in the conversation-v2 store.
- Selected skills render as removable **pills** below the composer
  (`SelectedSkillsPills`), shared by the v1 and v2 composers so they look
  identical.
- Every message send ships the current `selectedSkillIds` to the backend.
- The selection is persisted server-side and re-hydrated when the session is
  reopened.

## State Management

The conversation-v2 Zustand store ([`store.ts`](store.ts)) owns the selection:

```ts
selectedSkillIds: string[];                       // selected skills, sent with every message
setSelectedSkillIds: (ids: string[]) => void;     // replace the whole set
toggleSelectedSkill: (id: string) => void;        // add/remove one
```

## Sending Skills

`sendMessage` reads `selectedSkillIds` from the store and includes it in the
request only when non-empty:

```ts
const skillIds = get().selectedSkillIds;
// …
...(skillIds.length ? { skillIds } : {}),
```

The pointer type ([`api.ts`](api.ts)) exposes the persisted selection as
`selectedSkillIds: string[]`.

## Selected Skills Pills

[`SelectedSkillsPills`](../skill/components/SelectedSkillsPills.tsx) renders the
selection as pills (logo + name + remove button). Beyond
`MAX_VISIBLE_SKILL_PILLS` (3) the overflow collapses into a `+N` hover card.
`onRemove` calls `toggleSelectedSkill`. It is exported from the skill module
barrel ([`../skill/index.ts`](../skill/index.ts)) and used by both composers
(replacing the inline pill buttons previously duplicated in `Composer.tsx`,
`NewConversationPage.tsx`, and v1's `input.tsx`).

## New Conversation → Session Hand-off

The new-conversation page creates the session, then navigates to the session
page. Because the session loader hydrates `selectedSkillIds` from the brand-new
(empty) pointer, the selection would be wiped before the first message is sent.
To avoid that, `NewConversationPage` carries the selection in router state:

```ts
navigate(`/conversation-v2/${sessionId}`, {
  state: { initialMessage: text, model: litellmModel,
           skillIds: useConversationV2Store.getState().selectedSkillIds },
});
```

`ConversationV2SessionPage` re-applies it right before the initial send
(`if (initialSkillIds?.length) setSelectedSkillIds(initialSkillIds)`), then
`sendMessage` ships it.

## Rehydration on Reload

When a session loads, the page reads the pointer and restores the selection:

```ts
setSelectedSkillIds(pointer.selectedSkillIds ?? []);
```

So reopening a conversation re-displays the same skill pills.

## Files Touched

| File | Change |
| --- | --- |
| [`store.ts`](store.ts) | `selectedSkillIds` state, setters, send-message wiring |
| [`api.ts`](api.ts) | `selectedSkillIds` on `SessionPointer` |
| [`components/Composer.tsx`](components/Composer.tsx) | Use `SelectedSkillsPills` instead of inline pills |
| [`ConversationV2SessionPage.tsx`](ConversationV2SessionPage.tsx) | Rehydrate selection; re-apply carried selection before initial send |
| [`../conversation/NewConversationPage.tsx`](../conversation/NewConversationPage.tsx) | Carry selection in router state; use `SelectedSkillsPills` |
| [`../skill/components/SelectedSkillsPills.tsx`](../skill/components/SelectedSkillsPills.tsx) | New shared pills component (+ overflow hover card) |
| [`../skill/index.ts`](../skill/index.ts) | Export `SelectedSkillsPills` |
