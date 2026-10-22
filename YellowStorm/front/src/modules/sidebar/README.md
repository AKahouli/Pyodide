# Sidebar Module (Frontend)

The sidebar module renders the application left navigation, conversation history list, and sidebar auto-collapse behavior.

## Overview

- `AppSidebar` composes the navigation shell, history panel, and footer controls.
- `ConversationItem` renders one conversation row with rename/share/delete actions.
- `useAutoCollapse` collapses the sidebar when the viewport shrinks **or** when the
  user is on Studio routes (`/studio`, `/studio/:sessionId`) — same treatment as
  classic `/conversation`.
- App Builder Studio history rows deep-link to `/studio/:sessionId` (not the
  legacy `/conversation-v2/…`). Helpers live in `chatGroups.ts`; delete-current navigates
  home to `/studio` (`RecentChats.tsx`).

Related: [`../app-builder-studio/studio-paths.ts`](../app-builder-studio/studio-paths.ts),
[`../app-builder/COMMITS.md`](../app-builder/COMMITS.md).

## Directory Structure

```text
sidebar/
├── index.ts
├── index.test.ts
├── hooks/
│   ├── index.ts
│   ├── index.test.ts
│   ├── useAutoCollapse.ts          # collapses on /studio and /conversation
│   └── useAutoCollapse.test.tsx
├── components/
│   ├── index.ts
│   ├── index.test.ts
│   ├── AppSidebar.tsx
│   ├── AppSidebar.test.tsx
│   ├── ConversationItem.tsx
│   ├── RecentChats.tsx             # history → /studio/:id
│   ├── chatGroups.ts               # buildHistoryRows → studio paths
│   └── ConversationItem.test.tsx
└── README.md
```

## Testing

- Tests are colocated with implementation files (`*.test.ts` / `*.test.tsx`).
- Covered behavior includes:
  - sidebar fetch/navigation/history interactions
  - conversation item action flows and typewriter branch
  - auto-collapse resize behavior **and** `/studio` path matching
  - `chatGroups` Studio URL building
  - barrel export integrity

Run sidebar tests from `front/`:

```bash
npm test -- src/modules/sidebar
```

Check duplication threshold (<3%):

```bash
npx jscpd src/modules/sidebar --pattern "**/*.test.{ts,tsx}" --threshold 3 --reporters console
```
