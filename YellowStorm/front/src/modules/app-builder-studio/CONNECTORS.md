# Connectors in Conversation V2 (Manus) — Frontend

This document describes how a user attaches **connectors** (remote MCP servers) to
a Conversation V2 (Manus) chat. Connector discovery/management UI lives in the
[`connector`](../connector) module; this feature is about selecting connectors for
a conversation, showing them as pills, sending them with each message, and keeping
the selection across reloads and across the new-conversation → session navigation.

It mirrors the [Skills](./SKILLS.md) frontend wiring.

> Context: before this feature, neither v1 nor v2 had a real connector **tools**
> multi-select — the old "Connectors" composer menu drove `connector_repo` (a
> single GitHub repo, which Manus ignores). This is the first functional
> connector-tools selection in the v2 composer.

## Table of Contents

- [Overview](#overview)
- [State Management](#state-management)
- [Sending Connectors](#sending-connectors)
- [Selecting Connectors](#selecting-connectors)
- [Selected Connectors Pills](#selected-connectors-pills)
- [New Conversation → Session Hand-off](#new-conversation--session-hand-off)
- [Rehydration on Reload](#rehydration-on-reload)
- [Files Touched](#files-touched)

---

## Overview

- The user picks connectors from the composer menus (`RecentConnectorsMenu` /
  `ManageConnectorsDialog`); the selection is kept in the conversation-v2 store.
- Selected connectors render as removable **pills** below the composer
  (`SelectedConnectorsPills`).
- Every message send ships the current `selectedConnectorIds` to the backend.
- The selection is persisted server-side and re-hydrated when the session is
  reopened.

## State Management

The conversation-v2 Zustand store ([`store.ts`](store.ts)) owns the selection:

```ts
selectedConnectorIds: string[];                       // selected connectors, sent with every message
setSelectedConnectorIds: (ids: string[]) => void;     // replace the whole set
toggleSelectedConnector: (id: string) => void;        // add/remove one
```

## Sending Connectors

`sendMessage` reads `selectedConnectorIds` from the store and includes it in the
request only when non-empty:

```ts
const connectorIds = get().selectedConnectorIds;
// …
...(connectorIds.length ? { connectorIds } : {}),
```

The pointer/api type ([`api.ts`](api.ts)) exposes the persisted selection as
`selectedConnectorIds: string[]` and accepts `connectorIds?` on the send body.

## Selecting Connectors

The v2 [`Composer.tsx`](components/Composer.tsx) wires the existing connector
menus to the store:

- `RecentConnectorsMenu` — toggle → `toggleSelectedConnector`; keeps the OAuth
  "Connect" handling for connectors that need authentication first.
- `ManageConnectorsDialog` — `onUseConnector` → `toggleSelectedConnector`.

The old inline connector→repo submenu (`connector_repo`) was removed from the v2
composer only; the v1 `input.tsx` and the underlying store machinery are
untouched.

## Selected Connectors Pills

[`SelectedConnectorsPills`](../connector/components/SelectedConnectorsPills.tsx)
renders the selection as pills (logo + name + remove button). `onRemove` calls
`toggleSelectedConnector`. It is exported from the connector module barrel
([`../connector/index.ts`](../connector/index.ts)).

## New Conversation → Session Hand-off

The new-conversation page creates the session, then navigates to the session
page. Because the session loader hydrates `selectedConnectorIds` from the
brand-new (empty) pointer, the selection would be wiped before the first message
is sent. To avoid that, `NewConversationPage` carries the selection in router
state and `ConversationV2SessionPage` re-applies it right before the initial send
(`if (initialConnectorIds?.length) setSelectedConnectorIds(initialConnectorIds)`),
then `sendMessage` ships it. This mirrors the skills hand-off.

## Rehydration on Reload

When a session loads, the page reads the pointer and restores the selection:

```ts
setSelectedConnectorIds(pointer.selectedConnectorIds ?? []);
```

So reopening a conversation re-displays the same connector pills.

## Files Touched

| File | Change |
| --- | --- |
| [`store.ts`](store.ts) | `selectedConnectorIds` state, setters, send-message wiring |
| [`api.ts`](api.ts) | `connectorIds?` on send body; `selectedConnectorIds` on the pointer |
| [`components/Composer.tsx`](components/Composer.tsx) | `RecentConnectorsMenu` / `ManageConnectorsDialog` → store; `SelectedConnectorsPills`; remove the `connector_repo` submenu |
| [`ConversationV2SessionPage.tsx`](ConversationV2SessionPage.tsx) | Rehydrate selection; re-apply carried selection before initial send |
| [`../conversation/NewConversationPage.tsx`](../conversation/NewConversationPage.tsx) | Connector multi-select on the new-conversation page; carry selection in router state |
| [`../connector/components/SelectedConnectorsPills.tsx`](../connector/components/SelectedConnectorsPills.tsx) | Selected-connectors pills component |
| [`../connector/index.ts`](../connector/index.ts) | Export `SelectedConnectorsPills` |
